import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
  test: {
    environment: "node",
    testTimeout: 300_000, // eval replays full agent runs
    hookTimeout: 60_000,
  },
});
