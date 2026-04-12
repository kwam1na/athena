import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runHarnessAudit } from "./harness-audit";
import { writeGeneratedHarnessDocs } from "./harness-generate";

const tempRoots: string[] = [];

async function write(relativePath: string, contents: string, rootDir: string) {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

async function createFixtureRepo() {
  const rootDir = await mkdtemp(path.join(tmpdir(), "athena-harness-audit-"));
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

  await write(
    "packages/athena-webapp/package.json",
    JSON.stringify(
      {
        name: "@athena/webapp",
        scripts: {
          "audit:convex": "echo audit",
          build: "echo build",
          "lint:architecture": "echo architecture",
          "lint:convex:changed": "echo lint",
          test: "echo test",
        },
      },
      null,
      2
    ),
    rootDir
  );
  await write(
    "packages/storefront-webapp/package.json",
    JSON.stringify(
      {
        name: "@athena/storefront-webapp",
        scripts: {
          build: "echo build",
          "lint:architecture": "echo architecture",
          test: "echo test",
          "test:e2e": "echo e2e",
        },
      },
      null,
      2
    ),
    rootDir
  );

  await write(
    "packages/athena-webapp/AGENTS.md",
    [
      "# Athena Webapp Agent Guide",
      "",
      "- [Harness index](./docs/agent/index.md)",
      "- [Architecture](./docs/agent/architecture.md)",
      "- [Testing](./docs/agent/testing.md)",
      "- [Code map](./docs/agent/code-map.md)",
    ].join("\n"),
    rootDir
  );
  await write(
    "packages/storefront-webapp/AGENTS.md",
    [
      "# Storefront Webapp Agent Guide",
      "",
      "- [Harness index](./docs/agent/index.md)",
      "- [Architecture](./docs/agent/architecture.md)",
      "- [Testing](./docs/agent/testing.md)",
      "- [Code map](./docs/agent/code-map.md)",
    ].join("\n"),
    rootDir
  );

  for (const appName of ["athena-webapp", "storefront-webapp"] as const) {
    await write(
      `packages/${appName}/docs/agent/index.md`,
      [
        `# ${appName} agent docs`,
        "",
        "- [Architecture](./architecture.md)",
        "- [Testing](./testing.md)",
        "- [Code map](./code-map.md)",
        "- [Route index](./route-index.md)",
        "- [Test index](./test-index.md)",
        "- [Key folder index](./key-folder-index.md)",
        "- [Validation guide](./validation-guide.md)",
      ].join("\n"),
      rootDir
    );

    await write(
      `packages/${appName}/docs/agent/architecture.md`,
      "# Architecture\n",
      rootDir
    );
    await write(
      `packages/${appName}/docs/agent/code-map.md`,
      appName === "athena-webapp"
        ? [
            "# Athena Webapp Code Map",
            "",
            "- [Route index](./route-index.md)",
            "- [Key folder index](./key-folder-index.md)",
            "",
            "- [Routes](../../src/routes/index.tsx)",
            "- [Convex HTTP](../../convex/http.ts)",
          ].join("\n")
        : [
            "# Storefront Webapp Code Map",
            "",
            "- [Route index](./route-index.md)",
            "- [Key folder index](./key-folder-index.md)",
            "",
            "- [Routes](../../src/routes/__root.tsx)",
            "- [API](../../src/api/storefront.ts)",
          ].join("\n"),
      rootDir
    );
  }

  await write(
    "packages/athena-webapp/docs/agent/testing.md",
    [
      "# Athena Webapp Testing",
      "",
      "Run `bun run harness:check` to validate docs freshness.",
      "Run `bun run harness:review` for touched-file validation coverage.",
      "Run `bun run harness:audit` for full-app stale-doc and validation-map coverage auditing.",
      "Machine-readable review coverage lives in [validation-map.json](./validation-map.json).",
      "- [Test index](./test-index.md)",
      "- [Validation guide](./validation-guide.md)",
      "Default regression: `bun run --filter '@athena/webapp' test`.",
      "Convex validation: `bun run --filter '@athena/webapp' audit:convex` and `bun run --filter '@athena/webapp' lint:convex:changed`.",
      "Covered test surfaces include `src/tests` and `convex`.",
    ].join("\n"),
    rootDir
  );
  await write(
    "packages/storefront-webapp/docs/agent/testing.md",
    [
      "# Storefront Webapp Testing",
      "",
      "Run `bun run harness:check` to validate docs freshness.",
      "Run `bun run harness:review` for touched-file validation coverage.",
      "Run `bun run harness:audit` for full-app stale-doc and validation-map coverage auditing.",
      "Machine-readable review coverage lives in [validation-map.json](./validation-map.json).",
      "- [Test index](./test-index.md)",
      "- [Validation guide](./validation-guide.md)",
      "Default regression: `bun run --filter '@athena/storefront-webapp' test`.",
      "Browser journeys: `bun run --filter '@athena/storefront-webapp' test:e2e`.",
      "Covered test surfaces include `tests/e2e`.",
    ].join("\n"),
    rootDir
  );

  await write(
    "packages/athena-webapp/docs/agent/validation-map.json",
    JSON.stringify(
      {
        workspace: "@athena/webapp",
        packageDir: "packages/athena-webapp",
        surfaces: [
          {
            name: "routes-runtime",
            pathPrefixes: [
              "packages/athena-webapp/src/main.tsx",
              "packages/athena-webapp/src/routes/",
              "packages/athena-webapp/src/routeTree.gen.ts",
            ],
            commands: [{ kind: "script", script: "test" }],
          },
          {
            name: "shared-ui",
            pathPrefixes: [
              "packages/athena-webapp/src/components/",
              "packages/athena-webapp/src/contexts/",
              "packages/athena-webapp/src/hooks/",
              "packages/athena-webapp/src/lib/",
              "packages/athena-webapp/src/settings/",
              "packages/athena-webapp/src/stores/",
              "packages/athena-webapp/src/utils/",
            ],
            commands: [{ kind: "script", script: "test" }],
          },
          {
            name: "convex-surface",
            pathPrefixes: [
              "packages/athena-webapp/convex/http.ts",
              "packages/athena-webapp/convex/http/",
              "packages/athena-webapp/convex/inventory/",
              "packages/athena-webapp/convex/storeFront/",
            ],
            commands: [
              { kind: "script", script: "audit:convex" },
              { kind: "script", script: "lint:convex:changed" },
              { kind: "script", script: "test" },
            ],
          },
          {
            name: "tests",
            pathPrefixes: [
              "packages/athena-webapp/src/test/",
              "packages/athena-webapp/src/tests/",
            ],
            commands: [{ kind: "script", script: "test" }],
          },
        ],
      },
      null,
      2
    ),
    rootDir
  );
  await write(
    "packages/storefront-webapp/docs/agent/validation-map.json",
    JSON.stringify(
      {
        workspace: "@athena/storefront-webapp",
        packageDir: "packages/storefront-webapp",
        surfaces: [
          {
            name: "runtime-routes",
            pathPrefixes: [
              "packages/storefront-webapp/src/client.tsx",
              "packages/storefront-webapp/src/router.tsx",
              "packages/storefront-webapp/src/routeTree.gen.ts",
              "packages/storefront-webapp/src/routes/",
              "packages/storefront-webapp/src/ssr.tsx",
            ],
            commands: [{ kind: "script", script: "test" }],
          },
          {
            name: "shared-app",
            pathPrefixes: [
              "packages/storefront-webapp/src/api/",
              "packages/storefront-webapp/src/components/",
              "packages/storefront-webapp/src/contexts/",
              "packages/storefront-webapp/src/hooks/",
              "packages/storefront-webapp/src/lib/",
              "packages/storefront-webapp/src/utils/",
            ],
            commands: [{ kind: "script", script: "test" }],
          },
          {
            name: "tests",
            pathPrefixes: ["packages/storefront-webapp/tests/e2e/"],
            commands: [
              { kind: "script", script: "test" },
              { kind: "script", script: "test:e2e" },
            ],
          },
        ],
      },
      null,
      2
    ),
    rootDir
  );

  await write("packages/athena-webapp/src/main.tsx", "export {};\n", rootDir);
  await write("packages/athena-webapp/src/assets/placeholder.png", "", rootDir);
  await write("packages/athena-webapp/src/config.ts", "export {};\n", rootDir);
  await write("packages/athena-webapp/src/index.css", "body {}\n", rootDir);
  await write("packages/athena-webapp/src/routeTree.gen.ts", "export {};\n", rootDir);
  await write("packages/athena-webapp/src/routes/_authed/index.tsx", "export {};\n", rootDir);
  await write("packages/athena-webapp/src/routes/index.tsx", "export {};\n", rootDir);
  await write("packages/athena-webapp/src/components/AppShell.tsx", "export {};\n", rootDir);
  await write("packages/athena-webapp/src/hooks/useAuth.ts", "export {};\n", rootDir);
  await write("packages/athena-webapp/src/contexts/AuthContext.tsx", "export {};\n", rootDir);
  await write("packages/athena-webapp/src/lib/session.ts", "export {};\n", rootDir);
  await write("packages/athena-webapp/src/settings/store.ts", "export {};\n", rootDir);
  await write("packages/athena-webapp/src/stores/appStore.ts", "export {};\n", rootDir);
  await write("packages/athena-webapp/src/utils/format.ts", "export {};\n", rootDir);
  await write("packages/athena-webapp/src/tests/app.test.tsx", "export {};\n", rootDir);
  await write("packages/athena-webapp/src/test/setup.ts", "export {};\n", rootDir);
  await write("packages/athena-webapp/convex/http.ts", "export {};\n", rootDir);
  await write("packages/athena-webapp/convex/http/router.ts", "export {};\n", rootDir);
  await write("packages/athena-webapp/convex/inventory/item.ts", "export {};\n", rootDir);
  await write("packages/athena-webapp/convex/storeFront/cart.ts", "export {};\n", rootDir);
  await write("packages/athena-webapp/vite.config.ts", "export default {};\n", rootDir);

  await write("packages/storefront-webapp/src/assets/placeholder.png", "", rootDir);
  await write("packages/storefront-webapp/src/client.tsx", "export {};\n", rootDir);
  await write("packages/storefront-webapp/src/config.ts", "export {};\n", rootDir);
  await write("packages/storefront-webapp/src/index.css", "body {}\n", rootDir);
  await write("packages/storefront-webapp/src/main.tsx", "export {};\n", rootDir);
  await write("packages/storefront-webapp/src/router.tsx", "export {};\n", rootDir);
  await write("packages/storefront-webapp/src/routeTree.gen.ts", "export {};\n", rootDir);
  await write("packages/storefront-webapp/src/routes/auth.verify.tsx", "export {};\n", rootDir);
  await write("packages/storefront-webapp/src/routes/__root.tsx", "export {};\n", rootDir);
  await write("packages/storefront-webapp/src/routes/shop/checkout/index.tsx", "export {};\n", rootDir);
  await write("packages/storefront-webapp/src/ssr.tsx", "export {};\n", rootDir);
  await write("packages/storefront-webapp/src/api/storefront.ts", "export {};\n", rootDir);
  await write("packages/storefront-webapp/src/components/checkout/Bag.tsx", "export {};\n", rootDir);
  await write("packages/storefront-webapp/src/contexts/StoreContext.tsx", "export {};\n", rootDir);
  await write("packages/storefront-webapp/src/hooks/useBag.ts", "export {};\n", rootDir);
  await write("packages/storefront-webapp/src/lib/storefrontObservability.ts", "export {};\n", rootDir);
  await write("packages/storefront-webapp/src/utils/price.ts", "export {};\n", rootDir);
  await write("packages/storefront-webapp/tests/e2e/checkout.spec.ts", "export {};\n", rootDir);

  await writeGeneratedHarnessDocs(rootDir);

  return rootDir;
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((rootDir) =>
      rm(rootDir, { recursive: true, force: true })
    )
  );
});

describe("runHarnessAudit", () => {
  it("passes when current app surfaces are fully mapped", async () => {
    const rootDir = await createFixtureRepo();

    await expect(runHarnessAudit(rootDir)).resolves.toBeUndefined();
  });

  it("ignores local-only noise files when auditing live surfaces", async () => {
    const rootDir = await createFixtureRepo();
    await write("packages/athena-webapp/src/.DS_Store", "", rootDir);
    await write("packages/athena-webapp/convex/.DS_Store", "", rootDir);
    await write("packages/storefront-webapp/src/.env", "FOO=bar\n", rootDir);

    await expect(runHarnessAudit(rootDir)).resolves.toBeUndefined();
  });

  it("fails when a live app surface is missing from the validation map", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/storefront-webapp/src/hooks/useCheckoutState.ts",
      "export {};\n",
      rootDir
    );
    await write(
      "packages/storefront-webapp/docs/agent/validation-map.json",
      JSON.stringify(
        {
          workspace: "@athena/storefront-webapp",
          packageDir: "packages/storefront-webapp",
          surfaces: [
            {
              name: "runtime-routes",
              pathPrefixes: [
                "packages/storefront-webapp/src/client.tsx",
                "packages/storefront-webapp/src/router.tsx",
                "packages/storefront-webapp/src/routeTree.gen.ts",
                "packages/storefront-webapp/src/routes/",
                "packages/storefront-webapp/src/ssr.tsx",
              ],
              commands: [{ kind: "script", script: "test" }],
            },
            {
              name: "tests",
              pathPrefixes: ["packages/storefront-webapp/tests/e2e/"],
              commands: [
                { kind: "script", script: "test" },
                { kind: "script", script: "test:e2e" },
              ],
            },
          ],
        },
        null,
        2
      ),
      rootDir
    );

    await expect(runHarnessAudit(rootDir)).rejects.toThrow(
      /storefront-webapp[\s\S]*Uncovered live surface: packages\/storefront-webapp\/src\/hooks\//
    );
  });

  it("fails when a mapped surface points at a path that no longer exists", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/athena-webapp/docs/agent/validation-map.json",
      JSON.stringify(
        {
          workspace: "@athena/webapp",
          packageDir: "packages/athena-webapp",
          surfaces: [
            {
              name: "routes-runtime",
              pathPrefixes: [
                "packages/athena-webapp/src/main.tsx",
                "packages/athena-webapp/src/routes/",
                "packages/athena-webapp/src/routeTree.gen.ts",
                "packages/athena-webapp/src/missing-runtime/",
              ],
              commands: [{ kind: "script", script: "test" }],
            },
          ],
        },
        null,
        2
      ),
      rootDir
    );

    await expect(runHarnessAudit(rootDir)).rejects.toThrow(
      /athena-webapp[\s\S]*Stale validation surface: packages\/athena-webapp\/src\/missing-runtime\//
    );
  });

  it("fails when testing docs reference a missing validation script", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/storefront-webapp/package.json",
      JSON.stringify(
        {
          name: "@athena/storefront-webapp",
          scripts: {
            build: "echo build",
            "lint:architecture": "echo architecture",
            test: "echo test",
          },
        },
        null,
        2
      ),
      rootDir
    );

    await expect(runHarnessAudit(rootDir)).rejects.toThrow(
      /Missing required script "@athena\/storefront-webapp:test:e2e" while generating harness docs\./
    );
  });

  it("accepts generated command-based validation surfaces that include raw repo-root commands", async () => {
    const rootDir = await createFixtureRepo();
    await expect(
      readFile(
        path.join(rootDir, "packages/athena-webapp/docs/agent/validation-map.json"),
        "utf8"
      )
    ).resolves.toContain('"kind": "raw"');
    await expect(
      readFile(
        path.join(
          rootDir,
          "packages/storefront-webapp/docs/agent/validation-map.json"
        ),
        "utf8"
      )
    ).resolves.toContain('"kind": "raw"');

    await expect(runHarnessAudit(rootDir)).resolves.toBeUndefined();
  });
});
