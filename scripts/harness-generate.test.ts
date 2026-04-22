import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { generateHarnessDocs, writeGeneratedHarnessDocs } from "./harness-generate";

const tempRoots: string[] = [];

async function write(relativePath: string, contents: string, rootDir: string) {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

async function createFixtureRepo() {
  const rootDir = await mkdtemp(path.join(tmpdir(), "athena-harness-generate-"));
  tempRoots.push(rootDir);

  await write(
    "packages/athena-webapp/package.json",
    JSON.stringify(
      {
        name: "@athena/webapp",
        scripts: {
          test: "vitest run",
          "audit:convex": "bash ./scripts/convex-audit.sh",
          "lint:convex:changed": "bash ./scripts/convex-lint-changed.sh",
          build: "vite build && tsc --noEmit",
          "storybook:build": "storybook build",
          "lint:architecture": "bun ../../scripts/architecture-boundary-check.ts athena-webapp",
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
          test: "vitest run",
          "test:e2e": "playwright test",
          build: "vite build && tsc --noEmit",
          "lint:architecture": "bun ../../scripts/architecture-boundary-check.ts storefront-webapp",
        },
      },
      null,
      2
    ),
    rootDir
  );

  await write("packages/athena-webapp/src/routes/_authed/dashboard.index.tsx", "export {};\n", rootDir);
  await write("packages/athena-webapp/src/routes/login/index.tsx", "export {};\n", rootDir);
  await write("packages/athena-webapp/src/components/providers/currency-provider.tsx", "export {};\n", rootDir);
  await write("packages/athena-webapp/src/hooks/useAuth.ts", "export {};\n", rootDir);
  await write("packages/athena-webapp/src/lib/utils.ts", "export {};\n", rootDir);
  await write("packages/athena-webapp/src/contexts/AuthContext.tsx", "export {};\n", rootDir);
  await write("packages/athena-webapp/src/example.test.tsx", "export {};\n", rootDir);
  await write("packages/athena-webapp/convex/example.test.ts", "export {};\n", rootDir);
  await write("packages/athena-webapp/convex/http.ts", "export {};\n", rootDir);
  await write("packages/athena-webapp/.storybook/main.ts", "export default {};\n", rootDir);
  await write(
    "packages/athena-webapp/src/stories/Guidance/Introduction.stories.tsx",
    "export default {};\n",
    rootDir
  );
  await write("packages/athena-webapp/.gitignore", "storybook-static\n", rootDir);
  await write("packages/athena-webapp/eslint.config.js", "export default [];\n", rootDir);

  await write(
    "packages/valkey-proxy-server/package.json",
    JSON.stringify(
      {
        name: "valkey-proxy-server",
        scripts: {
          start: "node index.js",
          test: "node --test app.test.js",
          "test:connection": "node test-connection.js",
          dev: "nodemon index.js",
        },
      },
      null,
      2
    ),
    rootDir
  );
  await write(
    "packages/valkey-proxy-server/README.md",
    "# Valkey Proxy Server\n",
    rootDir
  );
  await write("packages/valkey-proxy-server/app.js", "module.exports = {};\n", rootDir);
  await write("packages/valkey-proxy-server/app.test.js", "module.exports = {};\n", rootDir);
  await write("packages/valkey-proxy-server/docs/agent/index.md", "# Docs\n", rootDir);
  await write("packages/valkey-proxy-server/index.js", "export {};\n", rootDir);
  await write(
    "packages/valkey-proxy-server/test-connection.js",
    "export {};\n",
    rootDir
  );

  await write("packages/storefront-webapp/src/routes/shop/index.tsx", "export {};\n", rootDir);
  await write("packages/storefront-webapp/src/routes/shop/checkout/index.tsx", "export {};\n", rootDir);
  await write(
    "packages/storefront-webapp/index.html",
    "<!doctype html><html><body><div id=\"root\"></div></body></html>\n",
    rootDir
  );
  await write(
    "packages/storefront-webapp/tsconfig.json",
    JSON.stringify({ compilerOptions: {} }, null, 2),
    rootDir
  );
  await write("packages/storefront-webapp/vite.config.ts", "export default {};\n", rootDir);
  await write("packages/storefront-webapp/src/main.tsx", "export {};\n", rootDir);
  await write("packages/storefront-webapp/src/router.tsx", "export {};\n", rootDir);
  await write("packages/storefront-webapp/src/routeTree.gen.ts", "export {};\n", rootDir);
  await write("packages/storefront-webapp/src/components/checkout/CheckoutProvider.tsx", "export {};\n", rootDir);
  await write("packages/storefront-webapp/src/hooks/useShoppingBag.ts", "export {};\n", rootDir);
  await write("packages/storefront-webapp/src/lib/storeConfig.ts", "export {};\n", rootDir);
  await write("packages/storefront-webapp/src/contexts/StoreContext.tsx", "export {};\n", rootDir);
  await write("packages/storefront-webapp/src/api/storefront.ts", "export {};\n", rootDir);
  await write("packages/storefront-webapp/src/example.test.tsx", "export {};\n", rootDir);
  await write(
    "packages/storefront-webapp/playwright.config.ts",
    'export default { testDir: "./tests/e2e" };\n',
    rootDir
  );
  await write("packages/storefront-webapp/tests/e2e/smoke.spec.ts", "export {};\n", rootDir);

  return rootDir;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((rootDir) => rm(rootDir, { recursive: true, force: true })));
});

describe("generateHarnessDocs", () => {
  it("builds deterministic discovery docs and validation guides for both apps", async () => {
    const rootDir = await createFixtureRepo();

    const docs = await generateHarnessDocs(rootDir);

    expect(docs.get("packages/athena-webapp/docs/agent/route-index.md")).toContain(
      "src/routes/_authed/dashboard.index.tsx"
    );
    expect(docs.get("packages/valkey-proxy-server/docs/agent/entry-index.md")).toBeDefined();
    expect(docs.get("packages/valkey-proxy-server/docs/agent/entry-index.md")).toContain("package.json");
    expect(docs.get("packages/valkey-proxy-server/docs/agent/entry-index.md")).toContain("README.md");
    expect(docs.get("packages/valkey-proxy-server/docs/agent/entry-index.md")).toContain("app.js");
    expect(docs.get("packages/valkey-proxy-server/docs/agent/entry-index.md")).toContain("app.test.js");
    expect(docs.get("packages/valkey-proxy-server/docs/agent/entry-index.md")).toContain("index.js");
    expect(docs.get("packages/valkey-proxy-server/docs/agent/entry-index.md")).toContain("test-connection.js");
    expect(docs.get("packages/valkey-proxy-server/docs/agent/test-index.md")).toContain(
      "bun run --filter 'valkey-proxy-server' test"
    );
    expect(docs.get("packages/valkey-proxy-server/docs/agent/key-folder-index.md")).toContain(
      "entry-index.md"
    );
    expect(docs.get("packages/storefront-webapp/docs/agent/test-index.md")).toContain(
      "tests/e2e"
    );
    expect(docs.get("packages/athena-webapp/docs/agent/key-folder-index.md")).toContain(
      "src/components"
    );
    expect(docs.get("packages/storefront-webapp/docs/agent/validation-guide.md")).toContain(
      "Full browser journeys"
    );
    expect(docs.get("packages/athena-webapp/docs/agent/validation-guide.md")).toContain(
      "src/routeTree.browser-boundary.test.ts"
    );
    expect(docs.get("packages/athena-webapp/docs/agent/validation-guide.md")).toContain(
      "Touched surfaces: `src/lib`, `shared`, `src/settings`, `src/utils`, `src/stores`, `types.ts`"
    );
    expect(docs.get("packages/athena-webapp/docs/agent/validation-map.json")).toContain(
      "\"commands\""
    );
    expect(docs.get("packages/athena-webapp/docs/agent/validation-map.json")).toContain(
      "\"behaviorScenarios\""
    );
    expect(docs.get("packages/storefront-webapp/docs/agent/validation-map.json")).toContain(
      "\"kind\": \"raw\""
    );

    expect(await generateHarnessDocs(rootDir)).toEqual(docs);
  });

  it("writes the generated docs to disk", async () => {
    const rootDir = await createFixtureRepo();

    await writeGeneratedHarnessDocs(rootDir);

    await expect(
      readFile(
        path.join(rootDir, "packages/athena-webapp/docs/agent/route-index.md"),
        "utf8"
      )
    ).resolves.toContain("# Athena Webapp Route Index");
    await expect(
      readFile(
        path.join(rootDir, "packages/valkey-proxy-server/docs/agent/entry-index.md"),
        "utf8"
      )
    ).resolves.toContain("# Valkey Proxy Server Entry Index");
    await expect(
      readFile(
        path.join(rootDir, "packages/storefront-webapp/docs/agent/validation-guide.md"),
        "utf8"
      )
    ).resolves.toContain("# Storefront Webapp Validation Guide");
    await expect(
      readFile(
        path.join(rootDir, "packages/athena-webapp/docs/agent/validation-map.json"),
        "utf8"
      )
    ).resolves.toContain("\"lint:architecture\"");
  });
});
