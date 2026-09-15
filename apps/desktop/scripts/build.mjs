import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktop = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const root = path.resolve(desktop, "..", "..");
const tsc = path.join(root, "node_modules", "typescript", "bin", "tsc");
const vite = path.join(root, "node_modules", "vite", "bin", "vite.js");

function run(command, args, label) {
  const result = spawnSync(process.execPath, [command, ...args], {
    cwd: desktop,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) {
    throw new Error(`${label} could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run(tsc, ["-p", "tsconfig.main.json"], "Electron Main build");
run(tsc, ["-p", "tsconfig.preload.json"], "preload build");
run(vite, ["build"], "React renderer build");
