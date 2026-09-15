import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const electronCli = path.join(root, "node_modules", "electron", "cli.js");
const mainEntry = path.join(root, "apps", "desktop", "dist", "main", "main.js");
const workerEntry = path.join(root, "apps", "desktop", "dist", "worker", "agent-worker-bootstrap.cjs");
const timeoutMs = 60_000;

for (const entry of [electronCli, mainEntry, workerEntry]) {
  if (!existsSync(entry)) {
    console.error(`[project-smoke] missing build entry: ${path.relative(root, entry)}; run npm run build first`);
    process.exit(1);
  }
}

const child = spawn(process.execPath, [electronCli, mainEntry, "--project-smoke"], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
  shell: false,
  windowsHide: true,
});

let output = "";
child.stdout.on("data", (chunk) => { output += chunk.toString(); });
child.stderr.on("data", (chunk) => { output += chunk.toString(); });

const timer = setTimeout(() => {
  child.kill();
  console.error(`[project-smoke] timed out after ${timeoutMs} ms`);
  process.exit(1);
}, timeoutMs);

child.once("error", (error) => {
  clearTimeout(timer);
  console.error(`[project-smoke] could not start: ${error.message}`);
  process.exit(1);
});

child.once("exit", (code, signal) => {
  clearTimeout(timer);
  if (code === 0) {
    console.log("Project create/reference/reopen smoke passed.");
    return;
  }
  console.error(`[project-smoke] Electron exited with ${signal ?? `code ${code ?? 1}`}`);
  if (output.trim()) console.error(output.trim());
  process.exit(code ?? 1);
});
