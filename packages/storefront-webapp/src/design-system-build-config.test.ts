import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import tailwindConfig from "../tailwind.config.js";

const packageDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const readPackageFile = (file: string) =>
  fs.readFileSync(path.join(packageDir, file), "utf8");

describe("storefront design-system foundation", () => {
  it("resolves semantic Tailwind roles from the package-local token authority", () => {
    expect(tailwindConfig.content).toEqual({
      relative: true,
      files: ["./src/**/*.{js,ts,jsx,tsx}"],
    });

    const colors = tailwindConfig.theme.extend.colors;
    expect(colors.canvas).toBe("hsl(var(--canvas))");
    expect(colors.surface.DEFAULT).toBe("hsl(var(--surface))");
    expect(colors.brand.DEFAULT).toBe("hsl(var(--brand))");
    expect(colors.selection.DEFAULT).toBe("hsl(var(--selection))");
    expect(colors.offer.DEFAULT).toBe("hsl(var(--offer))");
    expect(colors.success.DEFAULT).toBe("hsl(var(--success))");
    expect(colors.warning.DEFAULT).toBe("hsl(var(--warning))");
    expect(colors.danger.DEFAULT).toBe("hsl(var(--danger))");
    expect(colors.info.DEFAULT).toBe("hsl(var(--info))");
    expect(colors.inventory.low).toBe("hsl(var(--inventory-low))");
    expect(colors.focus).toBe("hsl(var(--focus))");
    expect(colors.overlay).toBe("hsl(var(--overlay) / <alpha-value>)");
  });

  it("keeps historical accent aliases resolving only as a migration bridge", () => {
    const colors = tailwindConfig.theme.extend.colors;

    expect(colors.accent2.DEFAULT).toBe("hsl(var(--accent-2))");
    expect(colors.accent3.DEFAULT).toBe("hsl(var(--accent-3))");
    expect(colors.accent4.DEFAULT).toBe("hsl(var(--accent-4))");
    expect(colors.accent5.DEFAULT).toBe("hsl(var(--accent-5))");

    const designGuide = readPackageFile("docs/agent/design.md");
    expect(designGuide).toContain("Legacy migration aliases");
    expect(designGuide).toContain("non-canonical");
  });

  it("uses one scalable viewport and one global stylesheet authority", () => {
    const indexHtml = readPackageFile("index.html");
    const rootRoute = readPackageFile("src/routes/__root.tsx");
    const mainSource = readPackageFile("src/main.tsx");

    expect(indexHtml.match(/name=["']viewport["']/g)).toHaveLength(1);
    expect(indexHtml).not.toMatch(/maximum-scale|user-scalable/i);
    expect(rootRoute).not.toMatch(/name:\s*["']viewport["']/);
    expect(indexHtml).not.toContain('type="text/tailwindcss"');
    expect(mainSource.match(/import\s+["'][^"']+\.css["'];?/g)).toEqual([
      'import "./index.css";',
    ]);
  });

  it("points shadcn at the live stylesheet and ships a light-only toast theme", () => {
    const manifest = JSON.parse(readPackageFile("components.json"));
    const sonner = readPackageFile("src/components/ui/sonner.tsx");
    const packageJson = JSON.parse(readPackageFile("package.json"));

    expect(manifest.tailwind.css).toBe("src/index.css");
    expect(sonner).toContain('theme="light"');
    expect(sonner).not.toContain("useTheme");
    expect(packageJson.dependencies).not.toHaveProperty("next-themes");
  });

  it("defines a visible semantic focus treatment on light surfaces", () => {
    const indexCss = readPackageFile("src/index.css");

    expect(indexCss).toContain("--focus:");
    expect(indexCss).toContain(":focus-visible");
    expect(indexCss).toContain("outline:");
    expect(indexCss).toContain("hsl(var(--focus))");
    expect(indexCss).not.toContain("color-scheme: light dark");
    expect(indexCss).not.toContain(".dark");
  });

  it("records a migration baseline for every storefront route source", () => {
    const baseline = readPackageFile(
      "docs/agent/design-system-migration-baseline.md",
    );
    const routeFiles = fs
      .readdirSync(path.join(packageDir, "src/routes"), {
        recursive: true,
        withFileTypes: true,
      })
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name.endsWith(".tsx") &&
          !entry.name.endsWith(".test.tsx"),
      )
      .map((entry) =>
        path
          .relative(
            path.join(packageDir, "src/routes"),
            path.join(entry.parentPath, entry.name),
          )
          .split(path.sep)
          .join("/"),
      )
      .sort();

    expect(routeFiles).toHaveLength(34);
    for (const routeFile of routeFiles) {
      expect(baseline).toContain(`\`src/routes/${routeFile}\``);
    }
    expect(baseline).toContain("Readiness / selectors");
    expect(baseline).toContain("Persistence");
    expect(baseline).toContain("Telemetry");
    expect(baseline).toContain("Baseline evidence");
  });

  it("documents privacy and lifecycle rules before browser evidence is retained", () => {
    const policy = readPackageFile(
      "docs/agent/design-system-artifact-policy.md",
    );

    expect(policy).toContain("Synthetic fixtures");
    expect(policy).toContain("Redaction");
    expect(policy).toContain("Access");
    expect(policy).toContain("Deployment");
    expect(policy).toContain("Retention");
    expect(policy).toMatch(/payment|session token/i);
  });
});
