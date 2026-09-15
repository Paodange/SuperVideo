import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktop = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const root = path.resolve(desktop, "..", "..");
const tsc = path.join(root, "node_modules", "typescript", "bin", "tsc");

function run(config) {
  const result = spawnSync(process.execPath, [tsc, "-p", config, "--noEmit"], {
    cwd: desktop,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) {
    throw new Error(`TypeScript could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("tsconfig.main.json");
run("tsconfig.preload.json");
run("tsconfig.renderer.json");
