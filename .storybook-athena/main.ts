import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergeConfig } from "vite";

const packageRoot = fileURLToPath(
  new URL("../packages/athena-webapp", import.meta.url),
);
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const storybookFilteredPluginNames = new Set([
  "tanstack:router-generator",
  "tanstack-router:hmr",
  "tanstack-router:autoimport",
  "tanstack-router:code-splitter:compile-reference-file",
  "tanstack-router:code-splitter:compile-virtual-file",
  "tanstack-router:code-splitter:compile-shared-file",
]);

function createAthenaStorybookViteConfig(config) {
  const plugins = (config.plugins ?? []).filter((plugin) => {
    if (
      !plugin ||
      Array.isArray(plugin) ||
      typeof plugin !== "object" ||
      !("name" in plugin)
    ) {
      return true;
    }

    return !storybookFilteredPluginNames.has(plugin.name);
  });

  return mergeConfig(
    {
      ...config,
      plugins,
    },
    {
      root: packageRoot,
      server: {
        fs: {
          allow: [repoRoot, packageRoot],
        },
      },
      resolve: {
        alias: {
          "~": packageRoot,
          "@": path.resolve(packageRoot, "src"),
          "@cvx": path.resolve(packageRoot, "convex"),
        },
      },
    },
  );
}

const config = {
  stories: [`${packageRoot}/src/**/*.stories.@(ts|tsx)`],
  addons: [],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  docs: {
    autodocs: false,
  },
  typescript: {
    reactDocgen: false,
  },
  core: {
    disableTelemetry: true,
  },
  viteFinal: async (config) => createAthenaStorybookViteConfig(config),
};

export default config;
