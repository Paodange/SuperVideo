import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const worker = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const root = path.resolve(worker, "..", "..");
const tsc = path.join(root, "node_modules", "typescript", "bin", "tsc");
const result = spawnSync(process.execPath, [tsc, "-p", path.join(worker, "tsconfig.json")], {
  cwd: worker,
  stdio: "inherit",
  shell: false,
});

if (result.error) {
  throw new Error(`Agent Worker build could not start: ${result.error.message}`);
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const output = path.join(worker, "dist");
mkdirSync(output, { recursive: true });
copyFileSync(path.join(worker, "src", "agent-worker-bootstrap.cjs"), path.join(output, "agent-worker-bootstrap.cjs"));
