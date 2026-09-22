import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");

function run(command, args, label, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: "inherit", shell: false, windowsHide: true });
  if (result.error) throw new Error(`${label} could not start: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log("[video-assembly:smoke] build shared contract");
run(process.execPath, [npmCli, "run", "build", "--workspace", "@supervideo/shared"], "shared build");

console.log("[video-assembly:smoke] TypeScript contract and deterministic assembly");
run(process.execPath, ["--test", path.join(root, "tests", "video-assembly-contract.test.mjs")], "TypeScript D07 smoke");

const isWindows = process.platform === "win32";
const venvPython = path.join(root, ".venv", isWindows ? "Scripts" : "bin", isWindows ? "python.exe" : "python");
const configuredPython = process.env.SUPERVIDEO_PYTHON;
const hasVenv = existsSync(venvPython);
const pythonCommand = hasVenv ? venvPython : configuredPython ?? (isWindows ? "py.exe" : "python3");
const pythonArgs = hasVenv
  ? ["-m", "unittest", "services.core.tests.test_video_assembly", "-v"]
  : configuredPython
    ? ["-m", "unittest", "services.core.tests.test_video_assembly", "-v"]
  : isWindows
    ? ["-3", "-m", "unittest", "services.core.tests.test_video_assembly", "-v"]
    : ["-m", "unittest", "services.core.tests.test_video_assembly", "-v"];
const coreSource = path.join(root, "services", "core", "src");
const pythonPath = process.env.PYTHONPATH ? `${coreSource}${path.delimiter}${process.env.PYTHONPATH}` : coreSource;

console.log("[video-assembly:smoke] Python Core contract and deterministic assembly");
run(pythonCommand, pythonArgs, "Python D07 smoke", { ...process.env, PYTHONPATH: pythonPath });
console.log("[video-assembly:smoke] all checks passed");
