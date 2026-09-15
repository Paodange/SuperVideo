import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const isWindows = process.platform === "win32";
const venvPython = path.join(root, ".venv", isWindows ? "Scripts" : "bin", isWindows ? "python.exe" : "python");
const coreSource = path.join(root, "services", "core", "src");

function pythonLaunch() {
  if (existsSync(venvPython)) {
    return { command: venvPython, prefix: [] };
  }
  return isWindows ? { command: "py.exe", prefix: ["-3"] } : { command: "python3", prefix: [] };
}

function runPhase(launch, databasePath, phase) {
  const result = spawnSync(
    launch.command,
    [...launch.prefix, "-m", "supervideo_core.storage.smoke", "--db", databasePath, "--phase", phase],
    {
      cwd: root,
      env: { ...process.env, PYTHONPATH: process.env.PYTHONPATH ? `${coreSource}${path.delimiter}${process.env.PYTHONPATH}` : coreSource },
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      stdio: "pipe",
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error(`${phase} phase failed.`);
  }
  return result.stdout.trim();
}

let temporaryRoot;
try {
  temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "supervideo-storage-smoke-"));
  const projectRoot = path.join(temporaryRoot, "项目 with spaces");
  const dataDirectory = path.join(projectRoot, "data");
  mkdirSync(dataDirectory, { recursive: true });
  const databasePath = path.join(dataDirectory, "project.db");
  const launch = pythonLaunch();
  runPhase(launch, databasePath, "write");
  const verification = runPhase(launch, databasePath, "verify");
  console.log(verification);
} catch (error) {
  console.error(`[core:storage:smoke] ${error instanceof Error ? error.message : "failed."}`);
  process.exitCode = 1;
} finally {
  if (temporaryRoot) {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}
