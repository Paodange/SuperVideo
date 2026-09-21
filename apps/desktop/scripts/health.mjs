import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktop = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const root = path.resolve(desktop, "..", "..");
const mainEntry = path.join(desktop, "dist", "main", "main.js");
const preloadEntry = path.join(desktop, "dist", "preload", "preload.js");
const rendererEntry = path.join(desktop, "dist", "renderer", "index.html");
const agentWorkerEntry = path.join(desktop, "dist", "worker", "agent-worker-bootstrap.cjs");

for (const entry of [mainEntry, preloadEntry, rendererEntry, agentWorkerEntry]) {
  if (!existsSync(entry)) {
    console.error(`Missing desktop build entry: ${path.relative(root, entry)}`);
    process.exit(1);
  }
}

for (const entry of [mainEntry, preloadEntry]) {
  const result = spawnSync(process.execPath, ["--check", entry], {
    cwd: root,
    stdio: "inherit",
    shell: false,
  });
  if (result.error || result.status !== 0) {
    console.error(`Invalid desktop JavaScript entry: ${path.relative(root, entry)}`);
    process.exit(result.status ?? 1);
  }
}

const rendererHtml = readFileSync(rendererEntry, "utf8");
if (!rendererHtml.includes("SuperVideo") || !rendererHtml.includes("<script")) {
  console.error("Renderer entry does not contain the expected application shell");
  process.exit(1);
}

const rendererDirectory = path.dirname(rendererEntry);
const rendererAssetReferences = [...rendererHtml.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
  .map((match) => match[1])
  .filter((reference) => reference && !reference.startsWith("data:"));
for (const reference of rendererAssetReferences) {
  if (path.isAbsolute(reference) || reference.startsWith("/") || reference.startsWith("\\")) {
    console.error(`Renderer asset reference must be relative for file:// loading: ${reference}`);
    process.exit(1);
  }
  const resolvedAsset = path.resolve(rendererDirectory, reference);
  if (!resolvedAsset.startsWith(`${rendererDirectory}${path.sep}`) || !existsSync(resolvedAsset)) {
    console.error(`Missing renderer asset referenced by index.html: ${reference}`);
    process.exit(1);
  }
}

console.log(JSON.stringify({ service: "desktop", status: "ok" }));
