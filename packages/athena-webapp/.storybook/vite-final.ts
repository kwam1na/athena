import path from "node:path";
import type { InlineConfig } from "vite";
import { mergeConfig } from "vite";

const storybookFilteredPluginNames = new Set([
  "tanstack:router-generator",
  "tanstack-router:hmr",
  "tanstack-router:autoimport",
  "tanstack-router:code-splitter:compile-reference-file",
  "tanstack-router:code-splitter:compile-virtual-file",
  "tanstack-router:code-splitter:compile-shared-file",
]);

export function createAthenaStorybookViteConfig(
  config: InlineConfig,
  packageRoot: string,
) {
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
