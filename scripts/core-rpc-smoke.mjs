import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const clientModule = await import(pathToFileURL(path.join(root, "workers", "agent", "dist", "python-core-client.js")).href);
const { CoreRpcError, PythonCoreClient } = clientModule;

const progress = [];
const client = new PythonCoreClient({
  rootDir: root,
  onProgress: (event) => progress.push(event),
});

try {
  const health = await client.start();
  assert.equal(health.service, "python-core");
  assert.equal(health.protocolVersion, 1);
  const result = await client.runSmokeCountdown({ steps: 4, delayMs: 25 });
  assert.deepEqual(result, { status: "completed", steps: 4 });
  assert.ok(progress.length >= 2, `expected at least two progress events, got ${progress.length}`);
  assert.ok(progress.every((event, index) => index === 0 || event.sequence > progress[index - 1].sequence));

  await assert.rejects(
    client.runSmokeCountdown({ steps: 3, delayMs: 100 }, { timeoutMs: 40 }),
    (error) => error instanceof CoreRpcError && error.code === "REQUEST_TIMEOUT",
  );
  console.log(`Python Core RPC smoke passed (${progress.length} progress events).`);
} finally {
  await client.shutdown();
}
