// @vitest-environment node

import { describe, expect, it } from "vitest";
import { createAthenaStorybookViteConfig } from "../../.storybook/vite-final";

describe("Storybook Vite config", () => {
  it("filters incompatible app plugins without duplicating Storybook plugins", async () => {
    const finalConfig = createAthenaStorybookViteConfig(
      {
        plugins: [
          { name: "storybook:code-generator-plugin" },
          { name: "tanstack-router:hmr" },
        ],
      },
      "/athena/packages/athena-webapp",
    );

    const pluginNames = ((finalConfig?.plugins ?? []).flat() as unknown[])
      .filter(
        (plugin: unknown): plugin is { name: string } =>
          plugin !== null &&
          typeof plugin === "object" &&
          "name" in plugin &&
          typeof plugin.name === "string",
      )
      .map((plugin) => plugin.name);

    expect(pluginNames).toEqual(["storybook:code-generator-plugin"]);
  });
});
