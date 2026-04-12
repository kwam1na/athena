import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { validateHarnessDocs } from "./harness-check";
import { writeGeneratedHarnessDocs } from "./harness-generate";

const REQUIRED_INDEX_LINKS = [
  "./architecture.md",
  "./testing.md",
  "./code-map.md",
  "./route-index.md",
  "./test-index.md",
  "./key-folder-index.md",
  "./validation-guide.md",
];
const REQUIRED_TESTING_LINKS = [
  "./test-index.md",
  "./validation-guide.md",
];
const REQUIRED_CODE_MAP_LINKS = [
  "./route-index.md",
  "./key-folder-index.md",
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
            "lint:convex:changed": "bash ./scripts/convex-lint-changed.sh",
            "lint:architecture": "bun ../../scripts/architecture-boundary-check.ts athena-webapp",
            build: "vite build && tsc --noEmit",
          }
        : {
            test: "vitest run",
            "test:e2e": "playwright test",
            "lint:architecture": "bun ../../scripts/architecture-boundary-check.ts storefront-webapp",
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
      [
        appName === "athena-webapp" ? "# Athena Webapp Testing" : "# Storefront Webapp Testing",
        "",
        ...REQUIRED_TESTING_LINKS.map((link) => `- [${link}](${link})`),
        "",
        ...(appName === "athena-webapp"
          ? [
              "The main test surfaces are `src/**/*.test.{ts,tsx}` and `convex/**/*.test.{ts,tsx}`.",
              "Run `bun run --filter '@athena/webapp' test` for the default regression pass.",
              "If you touch Convex code, also run `bun run --filter '@athena/webapp' audit:convex`.",
              "See [vitest config](../../vitest.config.ts).",
            ]
          : [
              "The main test surfaces are `src/**/*.test.{ts,tsx}` and `tests/e2e`.",
              "Run `bun run --filter '@athena/storefront-webapp' test` for the default regression pass.",
              "Run `bun run --filter '@athena/storefront-webapp' test:e2e` for browser journeys configured in [playwright.config.ts](../../playwright.config.ts).",
            ]),
      ].join("\n"),
      rootDir
    );
    await write(
      `packages/${appName}/docs/agent/code-map.md`,
      [
        appName === "athena-webapp" ? "# Athena Webapp Code Map" : "# Storefront Webapp Code Map",
        "",
        ...REQUIRED_CODE_MAP_LINKS.map((link) => `- [${link}](${link})`),
        "",
        appName === "athena-webapp"
          ? "Start from [architecture](./architecture.md) and inspect `src/main.tsx`."
          : "Start from [architecture](./architecture.md) and inspect `src/client.tsx`.",
        "",
      ].join("\n"),
      rootDir
    );

    if (appName === "athena-webapp") {
      await write("packages/athena-webapp/vitest.config.ts", "export default {};\n", rootDir);
      await write("packages/athena-webapp/src/main.tsx", "export {};\n", rootDir);
      await write(
        "packages/athena-webapp/src/routes/_authed/dashboard.index.tsx",
        "export {};\n",
        rootDir
      );
      await write(
        "packages/athena-webapp/src/components/providers/currency-provider.tsx",
        "export {};\n",
        rootDir
      );
      await write("packages/athena-webapp/src/hooks/useAuth.ts", "export {};\n", rootDir);
      await write("packages/athena-webapp/src/lib/utils.ts", "export {};\n", rootDir);
      await write("packages/athena-webapp/src/contexts/AuthContext.tsx", "export {};\n", rootDir);
      await write("packages/athena-webapp/src/example.test.tsx", "export {};\n", rootDir);
      await write("packages/athena-webapp/convex/example.test.ts", "export {};\n", rootDir);
      await write("packages/athena-webapp/convex/http.ts", "export {};\n", rootDir);
    } else {
      await write(
        "packages/storefront-webapp/playwright.config.ts",
        'export default { testDir: "./tests/e2e" };\n',
        rootDir
      );
      await write("packages/storefront-webapp/src/client.tsx", "export {};\n", rootDir);
      await write(
        "packages/storefront-webapp/src/routes/shop/checkout/index.tsx",
        "export {};\n",
        rootDir
      );
      await write(
        "packages/storefront-webapp/src/components/checkout/CheckoutProvider.tsx",
        "export {};\n",
        rootDir
      );
      await write(
        "packages/storefront-webapp/src/hooks/useShoppingBag.ts",
        "export {};\n",
        rootDir
      );
      await write("packages/storefront-webapp/src/lib/storeConfig.ts", "export {};\n", rootDir);
      await write(
        "packages/storefront-webapp/src/contexts/StoreContext.tsx",
        "export {};\n",
        rootDir
      );
      await write("packages/storefront-webapp/src/api/storefront.ts", "export {};\n", rootDir);
      await write("packages/storefront-webapp/src/example.test.tsx", "export {};\n", rootDir);
      await write("packages/storefront-webapp/tests/e2e/smoke.spec.ts", "export {};\n", rootDir);
    }
  }

  await writeGeneratedHarnessDocs(rootDir);

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

  it("reports onboarding gaps when a packages/* workspace is not registered", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/unregistered-webapp/package.json",
      JSON.stringify(
        {
          name: "@athena/unregistered-webapp",
          scripts: {
            test: "vitest run",
          },
        },
        null,
        2
      ),
      rootDir
    );

    await expect(validateHarnessDocs(rootDir)).resolves.toContain(
      "Harness onboarding gap: packages/unregistered-webapp exists under packages/* but is not registered in scripts/harness-app-registry.ts."
    );
  });

  it("reports onboarding gaps when a registered package is missing required entry docs", async () => {
    const rootDir = await createFixtureRepo();
    await rm(path.join(rootDir, "packages/athena-webapp/AGENTS.md"));

    await expect(validateHarnessDocs(rootDir)).resolves.toContain(
      "Harness onboarding gap: packages/athena-webapp is registered but missing required harness entry doc packages/athena-webapp/AGENTS.md."
    );
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

  it("reports missing required generated harness files", async () => {
    const rootDir = await createFixtureRepo();
    await rm(
      path.join(rootDir, "packages/athena-webapp/docs/agent/route-index.md")
    );

    await expect(validateHarnessDocs(rootDir)).resolves.toContain(
      "Missing required harness file: packages/athena-webapp/docs/agent/route-index.md"
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
        "- [route-index](./route-index.md)",
        "- [test-index](./test-index.md)",
        "- [key-folder-index](./key-folder-index.md)",
        "- [validation-guide](./validation-guide.md)",
      ].join("\n"),
      rootDir
    );

    await expect(validateHarnessDocs(rootDir)).resolves.toContain(
      "Missing required index link in packages/storefront-webapp/docs/agent/index.md: ./testing.md"
    );
  });

  it("reports missing required generated links from testing docs", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/athena-webapp/docs/agent/testing.md",
      [
        "# Athena Webapp Testing",
        "",
        "- [test-index](./test-index.md)",
        "",
        "The main test surfaces are `src/**/*.test.{ts,tsx}` and `convex/**/*.test.{ts,tsx}`.",
        "Run `bun run --filter '@athena/webapp' test` for the default regression pass.",
        "If you touch Convex code, also run `bun run --filter '@athena/webapp' audit:convex`.",
        "See [vitest config](../../vitest.config.ts).",
      ].join("\n"),
      rootDir
    );

    await expect(validateHarnessDocs(rootDir)).resolves.toContain(
      "Missing required testing link in packages/athena-webapp/docs/agent/testing.md: ./validation-guide.md"
    );
  });

  it("reports missing required generated links from code-map docs", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/storefront-webapp/docs/agent/code-map.md",
      [
        "# Storefront Webapp Code Map",
        "",
        "- [route-index](./route-index.md)",
        "",
        "Start from [architecture](./architecture.md) and inspect `src/client.tsx`.",
      ].join("\n"),
      rootDir
    );

    await expect(validateHarnessDocs(rootDir)).resolves.toContain(
      "Missing required code-map link in packages/storefront-webapp/docs/agent/code-map.md: ./key-folder-index.md"
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
        "- [test-index](./test-index.md)",
        "- [validation-guide](./validation-guide.md)",
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

  it("reports stale generated route indexes when route files change", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/storefront-webapp/src/routes/shop/checkout/complete.tsx",
      "export {};\n",
      rootDir
    );

    await expect(validateHarnessDocs(rootDir)).resolves.toContain(
      "Stale generated harness doc: packages/storefront-webapp/docs/agent/route-index.md"
    );
  });

  it("treats validation-map.json as a generated harness artifact", async () => {
    const rootDir = await createFixtureRepo();

    await expect(validateHarnessDocs(rootDir)).resolves.not.toContain(
      "Missing required harness file: packages/athena-webapp/docs/agent/validation-map.json"
    );
    await expect(validateHarnessDocs(rootDir)).resolves.not.toContain(
      "Missing required harness file: packages/storefront-webapp/docs/agent/validation-map.json"
    );
  });

  it("reports stale generated validation maps when the shared config changes", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/athena-webapp/docs/agent/validation-map.json",
      JSON.stringify(
        {
          workspace: "@athena/webapp",
          packageDir: "packages/athena-webapp",
          surfaces: [],
        },
        null,
        2
      ),
      rootDir
    );

    await expect(validateHarnessDocs(rootDir)).resolves.toContain(
      "Stale generated harness doc: packages/athena-webapp/docs/agent/validation-map.json"
    );
  });
});
