import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function parseHealth(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env,
    shell: false,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("agent worker exposes a stable executable health entry", () => {
  const health = parseHealth(process.execPath, [path.join(root, "workers", "agent", "dist", "health.js")]);
  assert.deepEqual(health, { service: "agent-worker", status: "ok" });
});

test("python core exposes a stable module health entry", () => {
  const coreSource = path.join(root, "services", "core", "src");
  const pythonCommand = process.env.SUPERVIDEO_PYTHON ?? (process.platform === "win32" ? "py.exe" : "python3");
  const pythonArgs = process.platform === "win32" ? ["-3", "-m", "supervideo_core.health"] : ["-m", "supervideo_core.health"];
  const pythonPath = process.env.PYTHONPATH ? `${coreSource}${path.delimiter}${process.env.PYTHONPATH}` : coreSource;
  const health = parseHealth(pythonCommand, pythonArgs, { ...process.env, PYTHONPATH: pythonPath });
  assert.deepEqual(health, { service: "python-core", status: "ok" });
});

test("desktop build keeps the renderer outside the Node boundary", () => {
  const mainSource = readFileSync(path.join(root, "apps", "desktop", "src", "main", "main.ts"), "utf8");
  assert.match(mainSource, /contextIsolation:\s*true/);
  assert.match(mainSource, /nodeIntegration:\s*false/);
  assert.ok(existsSync(path.join(root, "apps", "desktop", "dist", "renderer", "index.html")));
  assert.ok(existsSync(path.join(root, "apps", "desktop", "dist", "main", "main.js")));
  assert.ok(existsSync(path.join(root, "apps", "desktop", "dist", "preload", "preload.js")));
});
