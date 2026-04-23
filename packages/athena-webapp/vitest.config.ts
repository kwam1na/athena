import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    setupFiles: "./vitest.setup.ts",
    environment: "jsdom",
    globals: true,
    mockReset: true,
    clearMocks: true,
    include: [
      "src/**/*.test.{ts,tsx}",
      "convex/**/*.test.{ts,tsx}",
      "shared/**/*.test.{ts,tsx}",
    ],
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      reporter: ["text-summary", "json-summary", "html", "lcov"],
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
