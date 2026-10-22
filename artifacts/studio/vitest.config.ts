import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    // gates/flaky_test.md: 5s/10s defaults made scheduling delay under load
    // indistinguishable from failure. scripts/harness/gate.sh refuses any run
    // that still hits these.
    testTimeout: 15000,
    hookTimeout: 30000,
    setupFiles: ["./src/__tests__/setup.ts"],
    exclude: ["**/node_modules/**", "**/e2e/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
});
