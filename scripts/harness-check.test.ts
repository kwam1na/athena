import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { validateHarnessDocs } from "./harness-check";

const REQUIRED_INDEX_LINKS = [
  "./architecture.md",
  "./testing.md",
  "./code-map.md",
];

const tempRoots: string[] = [];

async function write(relativePath: string, contents: string, rootDir: string) {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

async function createFixtureRepo() {
  const rootDir = await mkdtemp(path.join(tmpdir(), "athena-harness-check-"));
  tempRoots.push(rootDir);

  await write(
    "packages/AGENTS.md",
    [
      "# Packages Agent Router",
      "",
      "- [Athena webapp](./athena-webapp/AGENTS.md)",
      "- [Storefront webapp](./storefront-webapp/AGENTS.md)",
    ].join("\n"),
    rootDir
  );

  for (const appName of ["athena-webapp", "storefront-webapp"]) {
    const packageName =
      appName === "athena-webapp"
        ? "@athena/webapp"
        : "@athena/storefront-webapp";
    const scripts =
      appName === "athena-webapp"
        ? {
            test: "vitest run",
            "audit:convex": "bash ./scripts/convex-audit.sh",
          }
        : {
            test: "vitest run",
            "test:e2e": "playwright test",
          };

    await write(
      `packages/${appName}/package.json`,
      JSON.stringify({ name: packageName, scripts }, null, 2),
      rootDir
    );

    await write(
      `packages/${appName}/AGENTS.md`,
      [
        `# ${appName}`,
        "",
        "- [Harness index](./docs/agent/index.md)",
        "- [Architecture](./docs/agent/architecture.md)",
        "- [Testing](./docs/agent/testing.md)",
        "- [Code map](./docs/agent/code-map.md)",
      ].join("\n"),
      rootDir
    );

    await write(
      `packages/${appName}/docs/agent/index.md`,
      [
        `# ${appName} agent docs`,
        "",
        ...REQUIRED_INDEX_LINKS.map((link) => `- [${link}](${link})`),
      ].join("\n"),
      rootDir
    );

    await write(
      `packages/${appName}/docs/agent/architecture.md`,
      "# Architecture\n\nSee [testing](./testing.md).\n",
      rootDir
    );
    await write(
      `packages/${appName}/docs/agent/testing.md`,
      appName === "athena-webapp"
        ? [
            "# Testing",
            "",
            "The main test surfaces are `src/**/*.test.{ts,tsx}` and `convex/**/*.test.{ts,tsx}`.",
            "Run `bun run --filter '@athena/webapp' test` for the default regression pass.",
            "If you touch Convex code, also run `bun run --filter '@athena/webapp' audit:convex`.",
            "See [vitest config](../../vitest.config.ts).",
          ].join("\n")
        : [
            "# Testing",
            "",
            "The main test surfaces are `src/**/*.test.{ts,tsx}` and `tests/e2e`.",
            "Run `bun run --filter '@athena/storefront-webapp' test` for the default regression pass.",
            "Run `bun run --filter '@athena/storefront-webapp' test:e2e` for browser journeys configured in [playwright.config.ts](../../playwright.config.ts).",
          ].join("\n"),
      rootDir
    );
    await write(
      `packages/${appName}/docs/agent/code-map.md`,
      appName === "athena-webapp"
        ? "# Code map\n\nStart from [architecture](./architecture.md) and inspect `src/main.tsx`.\n"
        : "# Code map\n\nStart from [architecture](./architecture.md) and inspect `src/client.tsx`.\n",
      rootDir
    );

    if (appName === "athena-webapp") {
      await write("packages/athena-webapp/vitest.config.ts", "export default {};\n", rootDir);
      await write("packages/athena-webapp/src/main.tsx", "export {};\n", rootDir);
      await write("packages/athena-webapp/src/example.test.tsx", "export {};\n", rootDir);
      await write("packages/athena-webapp/convex/example.test.ts", "export {};\n", rootDir);
    } else {
      await write(
        "packages/storefront-webapp/playwright.config.ts",
        'export default { testDir: "./tests/e2e" };\n',
        rootDir
      );
      await write("packages/storefront-webapp/src/client.tsx", "export {};\n", rootDir);
      await write("packages/storefront-webapp/src/example.test.tsx", "export {};\n", rootDir);
      await write("packages/storefront-webapp/tests/e2e/smoke.spec.ts", "export {};\n", rootDir);
    }
  }

  return rootDir;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((rootDir) => rm(rootDir, { recursive: true, force: true })));
});

describe("validateHarnessDocs", () => {
  it("passes when every required harness file and relative link is present", async () => {
    const rootDir = await createFixtureRepo();

    await expect(validateHarnessDocs(rootDir)).resolves.toEqual([]);
  });

  it("reports missing required harness files", async () => {
    const rootDir = await createFixtureRepo();
    await rm(
      path.join(rootDir, "packages/storefront-webapp/docs/agent/testing.md")
    );

    await expect(validateHarnessDocs(rootDir)).resolves.toContain(
      "Missing required harness file: packages/storefront-webapp/docs/agent/testing.md"
    );
  });

  it("reports broken relative markdown links in harness docs", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/athena-webapp/AGENTS.md",
      "# athena-webapp\n\n- [Broken](./docs/agent/missing.md)\n",
      rootDir
    );

    await expect(validateHarnessDocs(rootDir)).resolves.toContain(
      "Broken markdown link in packages/athena-webapp/AGENTS.md: ./docs/agent/missing.md"
    );
  });

  it("reports missing required core-doc links from an app index", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/storefront-webapp/docs/agent/index.md",
      [
        "# storefront-webapp agent docs",
        "",
        "- [architecture](./architecture.md)",
        "- [code-map](./code-map.md)",
      ].join("\n"),
      rootDir
    );

    await expect(validateHarnessDocs(rootDir)).resolves.toContain(
      "Missing required index link in packages/storefront-webapp/docs/agent/index.md: ./testing.md"
    );
  });

  it("reports stale inline path references in code-map docs", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/athena-webapp/docs/agent/code-map.md",
      [
        "# Athena Webapp Code Map",
        "",
        "Start from `src/missing-entry.tsx`.",
      ].join("\n"),
      rootDir
    );

    await expect(validateHarnessDocs(rootDir)).resolves.toContain(
      "Missing referenced path in packages/athena-webapp/docs/agent/code-map.md: src/missing-entry.tsx"
    );
  });

  it("reports invalid documented test commands", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/athena-webapp/docs/agent/testing.md",
      [
        "# Testing",
        "",
        "The main test surfaces are `src/**/*.test.{ts,tsx}` and `convex/**/*.test.{ts,tsx}`.",
        "Run `bun run --filter '@athena/webapp' test` for the default regression pass.",
        "Run `bun run --filter '@athena/webapp' test:foo` for the imaginary suite.",
      ].join("\n"),
      rootDir
    );

    await expect(validateHarnessDocs(rootDir)).resolves.toContain(
      "Invalid documented test command in packages/athena-webapp/docs/agent/testing.md: bun run --filter '@athena/webapp' test:foo"
    );
  });

  it("reports missing live test surfaces from testing docs", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/storefront-webapp/docs/agent/testing.md",
      [
        "# Testing",
        "",
        "The main test surfaces are `src/**/*.test.{ts,tsx}`.",
        "Run `bun run --filter '@athena/storefront-webapp' test` for the default regression pass.",
        "Run `bun run --filter '@athena/storefront-webapp' test:e2e` for browser journeys.",
      ].join("\n"),
      rootDir
    );

    await expect(validateHarnessDocs(rootDir)).resolves.toContain(
      "Missing documented test surface in packages/storefront-webapp/docs/agent/testing.md: tests/e2e"
    );
  });
});
