import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    setupFiles: "./vitest.setup.ts",
    environment: "jsdom",
    globals: true,
    mockReset: true,
    clearMocks: true,
    // In CI, use the dot reporter so the main thread spends less time rendering
    // per-task reporter output. That keeps the event loop responsive enough for
    // worker->main task-update RPCs to complete, avoiding the intermittent
    // `[vitest-worker]: Timeout calling "onTaskUpdate"` failure on this large
    // suite. Locally, keep the richer default reporter.
    reporters: process.env.CI ? ["dot"] : ["default"],
    include: [
      "src/**/*.test.{ts,tsx}",
      "convex/**/*.test.{ts,tsx}",
      "shared/**/*.test.{ts,tsx}",
    ],
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      // The `html` reporter walks and writes an HTML tree for every included
      // file (with `all: true`, that is the whole 600+ file source set) in one
      // synchronous end-of-run burst on the main thread — long enough to stall
      // the worker->main `onTaskUpdate` RPC past its timeout and fail the run.
      // CI only consumes the machine summaries (json-summary + lcov via the
      // coverage-policy scripts), so drop the html report there and keep it for
      // local humans.
      reporter: process.env.CI
        ? ["text-summary", "json-summary", "lcov"]
        : ["text-summary", "json-summary", "html", "lcov"],
      all: true,
      include: [
        "src/**/*.{ts,tsx}",
        "convex/**/*.{ts,tsx}",
        "shared/**/*.{ts,tsx}",
      ],
      exclude: [
        "node_modules/",
        "dist/",
        "**/*.d.ts",
        "**/*.config.*",
        "**/coverage/**",
        "src/**/*.test.{ts,tsx}",
        "shared/**/*.test.{ts,tsx}",
        "src/test/**",
        "src/routeTree.gen.ts",
        "src/assets/**",
        "convex/_generated/**",
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "~": path.resolve(__dirname),
    },
  },
});
