import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Production Electron loads this document through file://. Relative asset
  // URLs keep the bundled renderer independent of the filesystem root.
  base: "./",
  build: {
    outDir: "dist/renderer",
    emptyOutDir: true,
  },
});
