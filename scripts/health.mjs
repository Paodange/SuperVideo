import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const npmCommand = process.execPath;
const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");

function run(args, label) {
  const result = spawnSync(npmCommand, [npmCli, ...args], {
    cwd: root,
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

function runPythonHealth() {
  const pythonCommand = process.env.SUPERVIDEO_PYTHON ?? (process.platform === "win32" ? "py.exe" : "python3");
  const pythonArgs = process.platform === "win32" ? ["-3", "-m", "supervideo_core.health"] : ["-m", "supervideo_core.health"];
  const coreSource = path.join(root, "services", "core", "src");
  const existingPythonPath = process.env.PYTHONPATH;
  const pythonPath = existingPythonPath ? `${coreSource}${path.delimiter}${existingPythonPath}` : coreSource;
  const result = spawnSync(pythonCommand, pythonArgs, {
    cwd: root,
    env: { ...process.env, PYTHONPATH: pythonPath },
    stdio: "inherit",
    shell: false,
  });

  if (result.error) {
    throw new Error(`python-core health could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("[health] shared");
run(["run", "build", "--workspace", "@supervideo/shared"], "shared build");

console.log("[health] agent-worker");
run(["run", "build", "--workspace", "@supervideo/agent-worker"], "agent build");
run(["run", "health", "--workspace", "@supervideo/agent-worker"], "agent health");

console.log("[health] desktop");
run(["run", "build", "--workspace", "@supervideo/desktop"], "desktop build");
run(["run", "health", "--workspace", "@supervideo/desktop"], "desktop health");

console.log("[health] python-core");
runPythonHealth();

console.log("[health] all checks passed");
