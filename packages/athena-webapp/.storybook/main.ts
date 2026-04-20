import path from "node:path";
import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";
import { mergeConfig } from "vite";

function getAbsolutePath(value: string) {
  return path.dirname(fileURLToPath(import.meta.resolve(`${value}/package.json`)));
}

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const storybookFilteredPluginNames = new Set([
  "tanstack:router-generator",
  "tanstack-router:hmr",
  "tanstack-router:autoimport",
  "tanstack-router:code-splitter:compile-reference-file",
  "tanstack-router:code-splitter:compile-virtual-file",
  "tanstack-router:code-splitter:compile-shared-file",
]);

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: [
    getAbsolutePath("@storybook/addon-docs"),
    getAbsolutePath("@storybook/addon-a11y"),
  ],
  framework: {
    name: getAbsolutePath("@storybook/react-vite"),
    options: {},
  },
  docs: {
    autodocs: false,
  },
  core: {
    disableTelemetry: true,
  },
  viteFinal: async (config) =>
    mergeConfig(config, {
      plugins: (config.plugins ?? []).filter((plugin) => {
        if (!plugin || Array.isArray(plugin)) {
          return true;
        }

        return !storybookFilteredPluginNames.has(plugin.name);
      }),
      resolve: {
        alias: {
          "~": packageRoot,
          "@": path.resolve(packageRoot, "src"),
          "@cvx": path.resolve(packageRoot, "convex"),
        },
      },
    }),
};

export default config;
