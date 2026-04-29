import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import postcssConfig from "../postcss.config.js";
import tailwindConfig from "../tailwind.config.js";

const packageDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

describe("design system build config", () => {
  it("resolves Tailwind content paths relative to the Athena package", () => {
    expect(tailwindConfig.content).toEqual({
      relative: true,
      files: ["./src/**/*.{js,ts,jsx,tsx}"],
    });
  });

  it("pins PostCSS to the Athena Tailwind config for production builds", () => {
    const tailwindPlugin = postcssConfig.plugins.tailwindcss;

    expect(path.resolve(tailwindPlugin.config)).toBe(
      path.join(packageDir, "tailwind.config.js"),
    );
  });
});
