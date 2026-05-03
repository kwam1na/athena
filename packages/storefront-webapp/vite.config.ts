import path from "path";
import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import { visualizer } from "rollup-plugin-visualizer";

const storefrontQaHost = process.env.STOREFRONT_QA_HOST ?? "qa.wigclub.store";

export default defineConfig({
  base: "/",
  server: {
    host: "127.0.0.1",
    port: 5174,
    allowedHosts: [storefrontQaHost],
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

            if (id.includes("zod")) return "zod-vendor";

            if (id.includes("framer-motion")) return "framer-motion-vendor";

            if (id.includes("@radix-ui")) return "radix-ui-vendor";

            if (id.includes("hls.js")) return "hls-js-vendor";

            if (id.includes("posthog-js")) return "posthog-js-vendor";

            if (id.includes("lucide-react")) return "icons-vendor";

            if (
              id.includes("react-hook-form") ||
              id.includes("@hookform")
            ) {
              return "forms-vendor";
            }

            if (
              id.includes("@aws-sdk") ||
              id.includes("@smithy") ||
              id.includes("aws-amplify") ||
              id.includes("amazon-cognito-identity-js")
            ) {
              return "aws-vendor";
            }

            if (id.includes("recharts")) return "charts-vendor";

            if (id.includes("zustand")) return "state-vendor";

            if (id.includes("jose") || id.includes("jsonwebtoken")) {
              return "auth-vendor";
            }

            if (
              id.includes("cmdk") ||
              id.includes("input-otp") ||
              id.includes("next-themes") ||
              id.includes("react-day-picker") ||
              id.includes("react-hot-toast") ||
              id.includes("react-resizable-panels") ||
              id.includes("sonner") ||
              id.includes("tailwind-merge") ||
              id.includes("class-variance-authority") ||
              id.includes("clsx")
            ) {
              return "ui-vendor";
            }

            if (id.includes("react-dropzone")) {
              return "media-tools-vendor";
            }

            // Fallback for other node_modules
            return "vendor";
          }
        },
      },
    },
  },
  plugins: [
    TanStackRouterVite({
      autoCodeSplitting: true,
    }),
    react() as unknown as PluginOption,
  ],
  resolve: {
    alias: {
      "~": __dirname,
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
