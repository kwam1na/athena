import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  // Test-result caches are outputs, not mutations of installed dependencies.
  cacheDir: "./.cache",
  test: {
    setupFiles: "./vitest.setup.ts",
    environment: "jsdom",
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      reporter: ["text-summary", "json-summary", "html", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["**/*.d.ts", "src/**/*.test.{ts,tsx}", "src/routeTree.gen.ts"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
