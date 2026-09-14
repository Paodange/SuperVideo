/* Electron utilityProcess uses this small CommonJS entrypoint, then loads the ESM worker. */
import("./agent-worker.mjs").catch((error) => {
  console.error(error?.stack ?? error);
  process.exit(1);
});
