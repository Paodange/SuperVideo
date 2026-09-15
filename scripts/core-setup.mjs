import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const venvDir = path.join(root, ".venv");
const venvPython = path.join(venvDir, process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python");
const lockFile = path.join(root, "services", "core", "requirements.lock");
const corePackage = path.join(root, "services", "core");

function run(command, args, label) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: false, windowsHide: true });
  if (result.error) {
    throw new Error(`${label} could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? 1}.`);
  }
}

function canRun(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "ignore", shell: false, windowsHide: true });
  return !result.error && result.status === 0;
}

function supportsRequiredPython(command, args) {
  return canRun(command, [...args, "-c", "import sys; raise SystemExit(0 if sys.version_info >= (3, 12) else 1)"]);
}

function findPython() {
  if (process.platform === "win32" && supportsRequiredPython("py.exe", ["-3.12"])) {
    return { command: "py.exe", args: ["-3.12"] };
  }
  if (process.platform === "win32" && supportsRequiredPython("py.exe", ["-3"])) {
    return { command: "py.exe", args: ["-3"] };
  }
  if (supportsRequiredPython(process.platform === "win32" ? "python.exe" : "python3", [])) {
    return { command: process.platform === "win32" ? "python.exe" : "python3", args: [] };
  }
  throw new Error("Python 3.12+ was not found. Install Python or make the py.exe launcher available, then retry.");
}

try {
  if (!existsSync(venvPython)) {
    const host = findPython();
    run(host.command, [...host.args, "-m", "venv", venvDir], "creating .venv");
  }
  if (!existsSync(venvPython)) {
    throw new Error(`The virtual environment was not created at ${path.relative(root, venvPython)}.`);
  }
  run(venvPython, ["-c", "import sys; raise SystemExit(0 if sys.version_info >= (3, 12) else 1)"], "checking .venv Python version");
  run(venvPython, ["-m", "pip", "install", "--disable-pip-version-check", "--requirement", lockFile], "installing Python Core dependencies");
  run(venvPython, ["-m", "pip", "install", "--disable-pip-version-check", "--no-deps", "--editable", corePackage], "installing Python Core package");
  console.log(`Python Core environment ready: ${path.relative(root, venvPython)}`);
} catch (error) {
  console.error(`[core:setup] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
