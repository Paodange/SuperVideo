import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
const isWindows = process.platform === "win32";
const venvPython = path.join(root, ".venv", isWindows ? "Scripts" : "bin", isWindows ? "python.exe" : "python");

function run(command, args, label, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: "inherit", shell: false, windowsHide: true });
  if (result.error) throw new Error(`${label} could not start: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log("[generation-fallback:smoke] build shared contract");
run(process.execPath, [npmCli, "run", "build", "--workspace", "@supervideo/shared"], "shared build");

console.log("[generation-fallback:smoke] TypeScript D08 contract and D07 handoff");
run(process.execPath, ["--test", path.join(root, "tests", "generation-fallback-contract.test.mjs")], "TypeScript D08 tests");

const python = existsSync(venvPython) ? venvPython : isWindows ? "py.exe" : "python3";
const pythonArgs = existsSync(venvPython)
  ? ["-m", "unittest", "services.core.tests.test_generation_fallback", "-v"]
  : isWindows
    ? ["-3", "-m", "unittest", "services.core.tests.test_generation_fallback", "-v"]
    : ["-m", "unittest", "services.core.tests.test_generation_fallback", "-v"];
const coreSource = path.join(root, "services", "core", "src");
const env = { ...process.env, PYTHONPATH: process.env.PYTHONPATH ? `${coreSource}${path.delimiter}${process.env.PYTHONPATH}` : coreSource };

console.log("[generation-fallback:smoke] Python Core D08 policy and D07 handoff");
run(python, pythonArgs, "Python D08 tests", env);
console.log("[generation-fallback:smoke] all checks passed");
