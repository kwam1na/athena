import path from "node:path";
import fs from "node:fs";
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

  it("keeps runtime Tailwind out of the production document shell", () => {
    const indexHtml = fs.readFileSync(path.join(packageDir, "index.html"), "utf8");

    expect(indexHtml).not.toContain("cdn.tailwindcss.com");
    expect(indexHtml).not.toContain('type="text/tailwindcss"');
  });

  it("lets the deployment helper build the active checkout", () => {
    const repoRoot = path.resolve(packageDir, "../..");
    const deployScript = fs.readFileSync(
      path.join(repoRoot, "manage-athena-versions.sh"),
      "utf8",
    );

    expect(deployScript).toContain('git -C "$PWD" rev-parse --show-toplevel');
    expect(deployScript).toContain(
      'ATHENA_WEBAPP_DIR="$REPO_ROOT/packages/athena-webapp"',
    );
    expect(deployScript).not.toContain(
      'ATHENA_WEBAPP_DIR="$HOME/athena/packages/athena-webapp"',
    );
  });
});
