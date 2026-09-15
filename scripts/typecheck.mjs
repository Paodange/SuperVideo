import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
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

run(["run", "typecheck", "--workspace", "@supervideo/shared"], "shared typecheck");
run(["run", "typecheck", "--workspace", "@supervideo/agent-worker"], "agent typecheck");
run(["run", "typecheck", "--workspace", "@supervideo/desktop"], "desktop typecheck");
