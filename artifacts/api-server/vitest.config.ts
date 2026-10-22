import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    // gates/flaky_test.md: 5s/10s defaults made scheduling delay under load
    // indistinguishable from failure. scripts/harness/gate.sh refuses any run
    // that still hits these.
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
