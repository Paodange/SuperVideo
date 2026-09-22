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

run(process.execPath, [npmCli, "run", "build", "--workspace", "@supervideo/shared"], "shared build");
run(process.execPath, ["--test", path.join(root, "tests", "remotion-contract.test.mjs")], "Remotion shared offline smoke");
const isWindows = process.platform === "win32";
const venvPython = path.join(root, ".venv", isWindows ? "Scripts" : "bin", isWindows ? "python.exe" : "python");
const python = existsSync(venvPython) ? venvPython : isWindows ? "py.exe" : "python3";
const args = existsSync(venvPython)
  ? ["-m", "unittest", "services/core/tests/test_remotion.py"]
  : isWindows ? ["-3", "-m", "unittest", "services/core/tests/test_remotion.py"] : ["-m", "unittest", "services/core/tests/test_remotion.py"];
const coreSource = path.join(root, "services", "core", "src");
const pythonPath = process.env.PYTHONPATH ? `${coreSource}${path.delimiter}${process.env.PYTHONPATH}` : coreSource;
run(python, args, "Remotion Core offline smoke", { ...process.env, PYTHONPATH: pythonPath });
console.log("D03 Remotion offline smoke passed.");
