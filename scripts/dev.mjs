import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const desktop = path.join(root, "apps", "desktop");
const npmCommand = process.execPath;
const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
const devServerUrl = "http://127.0.0.1:5173";
const electronEntry = path.join(desktop, "dist", "main", "main.js");
const children = [];

function runSync(command, args, label) {
  const result = spawnSync(command, args, {
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

function start(command, args, cwd, label) {
  const child = spawn(command, args, {
    cwd,
    stdio: "inherit",
    shell: false,
    env: { ...process.env, BROWSER: "none" },
  });
  child.once("error", (error) => {
    console.error(`[dev] ${label} failed: ${error.message}`);
  });
  children.push(child);
  return child;
}

function stopChildren() {
  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }
}

function waitForDevServer(child) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let settled = false;

    const finish = (callback, value) => {
      if (!settled) {
        settled = true;
        callback(value);
      }
    };

    const poll = () => {
      if (Date.now() - startedAt > 15000) {
        finish(reject, new Error("Vite dev server did not start within 15 seconds"));
        return;
      }

      const request = http.get(devServerUrl, (response) => {
        response.resume();
        if (response.statusCode && response.statusCode < 500) {
          finish(resolve);
        } else {
          setTimeout(poll, 100);
        }
      });
      request.on("error", () => setTimeout(poll, 100));
    };

    child.once("exit", (code) => {
      finish(reject, new Error(`Vite exited before startup with code ${code ?? 0}`));
    });
    poll();
  });
}

process.on("SIGINT", () => {
  stopChildren();
  process.exit(0);
});
process.on("SIGTERM", () => {
  stopChildren();
  process.exit(0);
});

runSync(npmCommand, [npmCli, "run", "build", "--workspace", "@supervideo/desktop"], "desktop build");

const vite = start(npmCommand, [npmCli, "exec", "--", "vite", "--host", "127.0.0.1", "--port", "5173"], desktop, "Vite");
try {
  await waitForDevServer(vite);
} catch (error) {
  stopChildren();
  throw error;
}

const electron = start(
  npmCommand,
  [npmCli, "exec", "--", "electron", electronEntry, `--dev-server=${devServerUrl}`],
  root,
  "Electron",
);

electron.once("exit", (code) => {
  stopChildren();
  process.exit(code ?? 0);
});
vite.once("exit", (code) => {
  if (code && !electron.killed) {
    console.error(`[dev] Vite exited with code ${code}`);
    electron.kill();
  }
});
