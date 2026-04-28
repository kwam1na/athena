import path from "node:path";
import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";

import { createAthenaStorybookViteConfig } from "./vite-final.ts";

function getAbsolutePath(value: string) {
  return path.dirname(fileURLToPath(import.meta.resolve(`${value}/package.json`)));
}

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

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
  viteFinal: async (config) => createAthenaStorybookViteConfig(config, packageRoot),
};

export default config;
