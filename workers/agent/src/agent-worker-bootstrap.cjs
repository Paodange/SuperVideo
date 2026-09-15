/* Keep the utility-process entry CommonJS; the runtime itself is ESM. */
import("./agent-worker.js").catch(() => {
  process.exit(1);
});
