import react from "@vitejs/plugin-react";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import path from "path";
import { visualizer } from "rollup-plugin-visualizer";
import { defineConfig } from "vitest/config";
// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  base: "/",
  build: {
    rollupOptions: {
      treeshake: true,
      // plugins: [
      //   visualizer({
      //     filename: "stats.html",
      //     template: "treemap",
      //   }),
      // ],
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("hls.js")) return "hls-js-vendor";

            return "vendor";
          }
        },
      },
    },
  },
  plugins: (mode === "test"
    ? [react()]
    : [TanStackRouterVite(), react()]) as any,
  resolve: {
    alias: {
      "~": __dirname,
      "@": path.resolve(__dirname, "./src"),
      "@cvx": path.resolve(__dirname, "./convex"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    include: ["src/**/*.test.{ts,tsx}", "convex/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      reporter: ["text-summary", "json-summary", "html", "lcov"],
      all: true,
      include: ["src/**/*.{ts,tsx}", "convex/**/*.{ts,tsx}"],
      exclude: [
        "**/*.d.ts",
        "src/**/*.test.{ts,tsx}",
        "src/test/**",
        "src/routeTree.gen.ts",
        "src/assets/**",
        "convex/_generated/**",
      ],
    },
  },
}));
