import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const isWindows = process.platform === "win32";
const venvPython = path.join(root, ".venv", isWindows ? "Scripts" : "bin", isWindows ? "python.exe" : "python");
const python = existsSync(venvPython) ? venvPython : isWindows ? "py.exe" : "python3";
const pythonArgs = existsSync(venvPython) ? ["-m", "unittest", "services.core.tests.test_d06_image", "-v"] : isWindows ? ["-3", "-m", "unittest", "services.core.tests.test_d06_image", "-v"] : ["-m", "unittest", "services.core.tests.test_d06_image", "-v"];
const coreSource = path.join(root, "services", "core", "src");
const env = { ...process.env, PYTHONPATH: process.env.PYTHONPATH ? `${coreSource}${path.delimiter}${process.env.PYTHONPATH}` : coreSource };

function run(command, args, label, runEnv = env) {
  const result = spawnSync(command, args, { cwd: root, env: runEnv, stdio: "inherit", shell: false, windowsHide: true });
  if (result.error) { console.error(`[image:smoke] ${label} could not start: ${result.error.message}`); process.exit(1); }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(process.execPath, [path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"), "run", "build"], "build");
run(python, pythonArgs, "Python D06 tests");
run(process.execPath, ["--test", path.join(root, "tests", "image-adapter.test.mjs")], "TypeScript D06 tests", process.env);
