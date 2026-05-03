import react from "@vitejs/plugin-react";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import path from "path";
import { visualizer } from "rollup-plugin-visualizer";
import { defineConfig } from "vitest/config";
// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  base: "/",
  server: {
    allowedHosts: ["athena-qa.wigclub.store"],
  },
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
            const normalizedId = id.split(path.sep).join("/");

            if (
              normalizedId.includes("/node_modules/react/") ||
              normalizedId.includes("/node_modules/react-dom/") ||
              normalizedId.includes("/node_modules/scheduler/") ||
              normalizedId.includes("/node_modules/use-sync-external-store/")
            ) {
              return "react-vendor";
            }
            if (id.includes("@tanstack")) return "tanstack-vendor";
            if (id.includes("@radix-ui")) return "radix-vendor";
            if (id.includes("convex")) return "convex-vendor";
            if (id.includes("lucide-react")) return "icons-vendor";
            if (id.includes("recharts")) return "charts-vendor";
            if (
              id.includes("react-hook-form") ||
              id.includes("@hookform") ||
              id.includes("@tanstack/zod-form-adapter") ||
              id.includes("zod")
            ) {
              return "forms-vendor";
            }
            if (id.includes("date-fns")) return "date-vendor";
            if (id.includes("framer-motion")) return "motion-vendor";
            if (id.includes("hls.js")) return "hls-js-vendor";
            if (id.includes("@aws-sdk") || id.includes("@smithy")) {
              return "aws-vendor";
            }
            if (
              id.includes("cmdk") ||
              id.includes("input-otp") ||
              id.includes("next-themes") ||
              id.includes("react-day-picker") ||
              id.includes("react-hot-toast") ||
              id.includes("react-qr-code") ||
              id.includes("react-resizable-panels") ||
              id.includes("sonner") ||
              id.includes("tailwind-merge") ||
              id.includes("class-variance-authority") ||
              id.includes("clsx")
            ) {
              return "ui-vendor";
            }
            if (id.includes("zustand") || id.includes("immer")) {
              return "state-vendor";
            }
            if (id.includes("@auth/core") || id.includes("jose")) {
              return "auth-vendor";
            }
            if (id.includes("@floating-ui")) return "floating-ui-vendor";
            if (id.includes("@hello-pangea")) return "dnd-vendor";
            if (
              id.includes("react-dropzone") ||
              id.includes("html-to-image") ||
              id.includes("@jsquash") ||
              id.includes("webp-converter-browser")
            ) {
              return "media-tools-vendor";
            }

            return "vendor";
          }
        },
      },
    },
  },
  plugins: (mode === "test"
    ? [react()]
    : [
        TanStackRouterVite({
          // Keep colocated route tests out of route generation.
          routeFileIgnorePattern: "\\.test\\.",
          autoCodeSplitting: true,
        }),
        react(),
      ]) as any,
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
