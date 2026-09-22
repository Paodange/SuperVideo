import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const npmCommand = process.execPath;
const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");

function run(command, args, label) {
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

run(npmCommand, [npmCli, "run", "build"], "workspace build");
run(
  process.execPath,
  [
    "--test",
    path.join(root, "tests", "health.test.mjs"),
    path.join(root, "tests", "electron-security.test.mjs"),
    path.join(root, "tests", "agent-worker.test.mjs"),
    path.join(root, "tests", "python-rpc.test.mjs"),
    path.join(root, "tests", "diagnostics.test.mjs"),
    path.join(root, "tests", "provider-contract.test.mjs"),
    path.join(root, "tests", "tts-adapter.test.mjs"),
    path.join(root, "tests", "timeline-ir.test.mjs"),
    path.join(root, "tests", "c04-aroll-cut-join.test.mjs"),
    path.join(root, "tests", "c05-subtitle-plan.test.mjs"),
    path.join(root, "tests", "c06-preview-render.test.mjs"),
    path.join(root, "tests", "c07-quality-check.test.mjs"),
    path.join(root, "tests", "c08-final-export.test.mjs"),
    path.join(root, "tests", "c09-timeline-edit.test.mjs"),
    path.join(root, "tests", "c10-timeline-versions.test.mjs"),
    path.join(root, "tests", "remotion-contract.test.mjs"),
  ],
  "automated tests",
);
