import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import { visualizer } from "rollup-plugin-visualizer";

export default defineConfig({
  base: "/",
  build: {
    rollupOptions: {
      treeshake: true,
      plugins: [
        visualizer({
          filename: "stats.html",
          template: "treemap",
        }),
      ],
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("@tanstack")) return "tanstack-vendor";

            if (id.includes("zod")) return "zod-vendor";

            if (id.includes("framer-motion")) return "framer-motion-vendor";

            if (id.includes("@radix-ui")) return "radix-ui-vendor";

            if (id.includes("hls.js")) return "hls-js-vendor";

            if (id.includes("posthog-js")) return "posthog-js-vendor";

            // Fallback for other node_modules
            return "vendor";
          }
        },
      },
    },
  },
  plugins: [TanStackRouterVite(), react()],
  resolve: {
    alias: {
      "~": __dirname,
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
