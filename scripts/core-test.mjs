import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const isWindows = process.platform === "win32";
const venvPython = path.join(root, ".venv", isWindows ? "Scripts" : "bin", isWindows ? "python.exe" : "python");
const command = existsSync(venvPython) ? venvPython : isWindows ? "py.exe" : "python3";
const args = existsSync(venvPython)
  ? ["-m", "unittest", "discover", "-s", path.join(root, "services", "core", "tests"), "-p", "test_*.py"]
  : isWindows
    ? ["-3", "-m", "unittest", "discover", "-s", path.join(root, "services", "core", "tests"), "-p", "test_*.py"]
    : ["-m", "unittest", "discover", "-s", path.join(root, "services", "core", "tests"), "-p", "test_*.py"];
const coreSource = path.join(root, "services", "core", "src");
const pythonPath = process.env.PYTHONPATH ? `${coreSource}${path.delimiter}${process.env.PYTHONPATH}` : coreSource;

const result = spawnSync(command, args, {
  cwd: root,
  env: { ...process.env, PYTHONPATH: pythonPath },
  stdio: "inherit",
  shell: false,
  windowsHide: true,
});
if (result.error) {
  console.error(`[core:test] could not start Python. Run npm run core:setup first: ${result.error.message}`);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
