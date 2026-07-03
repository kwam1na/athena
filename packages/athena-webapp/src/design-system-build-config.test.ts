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

  it("keeps warning foreground legible on dark soft-warning surfaces", () => {
    const indexCss = fs.readFileSync(path.join(packageDir, "src/index.css"), "utf8");

    expect(indexCss).toContain(".dark .bg-warning\\/10.text-warning-foreground");
    expect(indexCss).toContain(".dark .bg-warning\\/10 .text-warning-foreground");
    expect(indexCss).toContain("color: hsl(var(--warning));");
  });

  it("keeps the charcoal dark theme active while preserving the classic dark palette", () => {
    const indexCss = fs.readFileSync(path.join(packageDir, "src/index.css"), "utf8");

    expect(indexCss).toContain("--app-canvas: 22 22 22;");
    expect(indexCss).toContain("--ring: 0 0% 0% / 0;");
    expect(indexCss).toContain("--sidebar-ring: var(--ring);");
    expect(indexCss).toContain(".dark :focus-visible");
    expect(indexCss).toContain("--tw-ring-shadow: 0 0 #0000 !important;");
    expect(indexCss).toContain('.dark[data-theme-variant="classic"]');
    expect(indexCss).toContain("--app-canvas: 17 19 28;");
    expect(indexCss).not.toContain("--ring: 31 91% 67%;");
  });

  it("keeps dark success labels legible on soft success surfaces", () => {
    const indexCss = fs.readFileSync(path.join(packageDir, "src/index.css"), "utf8");

    expect(indexCss.match(/--success: 145 36% 58%;/g)).toHaveLength(2);
    expect(indexCss.match(/--success-foreground: 145 60% 8%;/g)).toHaveLength(2);
  });

  it("routes deployment helpers through the active checkout", () => {
    const repoRoot = path.resolve(packageDir, "../..");
    const interactiveDeployScript = fs.readFileSync(
      path.join(repoRoot, "manage-athena-versions.sh"),
      "utf8",
    );
    const authoritativeDeployScript = fs.readFileSync(
      path.join(repoRoot, "scripts/deploy-vps.sh"),
      "utf8",
    );

    expect(interactiveDeployScript).toContain(
      'git -C "$PWD" rev-parse --show-toplevel',
    );
    expect(interactiveDeployScript).toContain(
      '"$DEPLOY_VPS_SCRIPT" "$@"',
    );
    expect(authoritativeDeployScript).toContain('"packages/athena-webapp"');
    expect(authoritativeDeployScript).not.toContain(
      'ATHENA_WEBAPP_DIR="$HOME/athena/packages/athena-webapp"',
    );
  });
});
