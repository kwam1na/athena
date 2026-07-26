// @vitest-environment node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));

describe("storefront Storybook config", () => {
  it("uses one package-local config with accessibility enabled", () => {
    const mainConfig = readFileSync(
      path.join(packageRoot, ".storybook/main.ts"),
      "utf8",
    );
    const previewConfig = readFileSync(
      path.join(packageRoot, ".storybook/preview.ts"),
      "utf8",
    );

    expect(mainConfig).toContain("@storybook/addon-a11y");
    expect(mainConfig).toContain("@storybook/addon-docs");
    expect(mainConfig).toContain("../src/**/*.stories.@(ts|tsx)");
    expect(mainConfig).toContain("reactDocgen: false");
    expect(previewConfig).toContain('import "../src/index.css"');
    expect(previewConfig).toContain('test: "error"');
    expect(previewConfig).toContain(
      '["Guidance", "Foundations", "Primitives", "Patterns", "Templates"]',
    );
  });

  it("exposes package scripts that all use the local config", () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(packageRoot, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.storybook).toBe("storybook dev -p 6007");
    expect(packageJson.scripts?.["storybook:build"]).toBe("storybook build");
    expect(packageJson.scripts?.["build-storybook"]).toBe(
      "bun run storybook:build",
    );
    expect(packageJson.scripts?.["lint:design-system:changed"]).toBe(
      "bash scripts/design-system-policy-changed.sh",
    );
  });

  it("keeps generated Storybook output outside the TypeScript program", () => {
    const tsconfig = readFileSync(
      path.join(packageRoot, "tsconfig.json"),
      "utf8",
    );

    expect(tsconfig).toContain('"storybook-static"');
  });
});
