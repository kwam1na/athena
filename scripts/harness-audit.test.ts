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
    "README.md",
    [
      "# athena",
      "",
      "Start with [the Graphify wiki index](./graphify-out/wiki/index.md) for repo and package navigation.",
      "Use [the packages router](./packages/AGENTS.md) for operational package entry docs.",
      "",
      "List runtime behavior scenarios with `bun run harness:behavior --list`.",
      "Bundled scenarios include:",
      "",
      "- `sample-runtime-smoke`",
      "- `athena-admin-shell-boot`",
      "- `athena-convex-storefront-composition`",
      "- `athena-convex-storefront-failure-visibility`",
      "- `valkey-proxy-local-request-response`",
      "- `storefront-checkout-bootstrap`",
      "- `storefront-checkout-validation-blocker`",
      "- `storefront-checkout-verification-recovery`",
      "",
    ].join("\n"),
    rootDir
  );

  await write(
    "packages/AGENTS.md",
    [
      "# Packages Agent Router",
      "",
      "- [Graphify wiki index](../graphify-out/wiki/index.md)",
      "- [Athena webapp graph page](../graphify-out/wiki/packages/athena-webapp.md)",
      "- [Storefront webapp graph page](../graphify-out/wiki/packages/storefront-webapp.md)",
      "- [Valkey proxy server graph page](../graphify-out/wiki/packages/valkey-proxy-server.md)",
      "- [Athena webapp](./athena-webapp/AGENTS.md)",
      "- [Storefront webapp](./storefront-webapp/AGENTS.md)",
      "- [Valkey proxy server](./valkey-proxy-server/AGENTS.md)",
    ].join("\n"),
    rootDir
  );

  await write("graphify-out/wiki/index.md", "# Graphify Wiki\n", rootDir);
  await write(
    "graphify-out/wiki/packages/athena-webapp.md",
    "# Athena Webapp\n",
    rootDir
  );
  await write(
    "graphify-out/wiki/packages/storefront-webapp.md",
    "# Storefront Webapp\n",
    rootDir
  );
  await write(
    "graphify-out/wiki/packages/valkey-proxy-server.md",
    "# Valkey Proxy Server\n",
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
          "storybook:build": "echo storybook",
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
  await write("packages/athena-webapp/types.ts", "export type Placeholder = {};\n", rootDir);
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

  await write(
    "packages/athena-webapp/AGENTS.md",
    [
      "# Athena Webapp Agent Guide",
      "",
      "- [Graph page](../../graphify-out/wiki/packages/athena-webapp.md)",
      "- [Harness index](./docs/agent/index.md)",
      "- [Architecture](./docs/agent/architecture.md)",
      "- [Testing](./docs/agent/testing.md)",
      "- [Code map](./docs/agent/code-map.md)",
    ].join("\n"),
    rootDir
  );
  await write("packages/athena-webapp/.storybook/main.ts", "export default {};\n", rootDir);
  await write("packages/athena-webapp/index.html", "<div id=\"app\"></div>\n", rootDir);
  await write(
    "packages/athena-webapp/src/stories/Guidance/Introduction.stories.tsx",
    "export default {};\n",
    rootDir
  );
  await write("packages/athena-webapp/.gitignore", "storybook-static\n", rootDir);
  await write("packages/athena-webapp/eslint.config.js", "export default [];\n", rootDir);
  await write("packages/athena-webapp/tailwind.config.js", "export default {};\n", rootDir);
  await write("packages/athena-webapp/postcss.config.js", "export default {};\n", rootDir);
  await write(
    "packages/athena-webapp/src/design-system-build-config.test.ts",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/storefront-webapp/AGENTS.md",
    [
      "# Storefront Webapp Agent Guide",
      "",
      "- [Graph page](../../graphify-out/wiki/packages/storefront-webapp.md)",
      "- [Harness index](./docs/agent/index.md)",
      "- [Architecture](./docs/agent/architecture.md)",
      "- [Testing](./docs/agent/testing.md)",
      "- [Code map](./docs/agent/code-map.md)",
    ].join("\n"),
    rootDir
  );
  await write(
    "packages/valkey-proxy-server/AGENTS.md",
    [
      "# Valkey Proxy Server Agent Guide",
      "",
      "- [Graph page](../../graphify-out/wiki/packages/valkey-proxy-server.md)",
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
    "packages/valkey-proxy-server/docs/agent/index.md",
    [
      "# Valkey Proxy Server agent docs",
      "",
      "- [Architecture](./architecture.md)",
      "- [Testing](./testing.md)",
      "- [Code map](./code-map.md)",
      "- [Entry index](./entry-index.md)",
      "- [Test index](./test-index.md)",
      "- [Key folder index](./key-folder-index.md)",
      "- [Validation guide](./validation-guide.md)",
    ].join("\n"),
    rootDir
  );
  await write(
    "packages/valkey-proxy-server/docs/agent/architecture.md",
    "# Architecture\n",
    rootDir
  );
  await write(
    "packages/valkey-proxy-server/docs/agent/code-map.md",
    [
      "# Valkey Proxy Server Code Map",
      "",
      "- [Entry index](./entry-index.md)",
      "- [Key folder index](./key-folder-index.md)",
      "",
      "- [Entrypoint](../../index.js)",
      "- [Connection probe](../../test-connection.js)",
    ].join("\n"),
    rootDir
  );

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
      "Use `bun run harness:behavior --list` to inspect available runtime scenarios.",
      "Current shared scenarios include:",
      "- `sample-runtime-smoke`",
      "- `athena-admin-shell-boot`",
      "- `athena-convex-storefront-composition`",
      "- `athena-convex-storefront-failure-visibility`",
      "- `valkey-proxy-local-request-response`",
      "- `storefront-checkout-bootstrap`",
      "- `storefront-checkout-validation-blocker`",
      "- `storefront-checkout-verification-recovery`",
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
      "Use `bun run harness:behavior --list` to inspect available runtime scenarios.",
      "Current shared scenarios include:",
      "- `sample-runtime-smoke`",
      "- `athena-admin-shell-boot`",
      "- `athena-convex-storefront-composition`",
      "- `athena-convex-storefront-failure-visibility`",
      "- `valkey-proxy-local-request-response`",
      "- `storefront-checkout-bootstrap`",
      "- `storefront-checkout-validation-blocker`",
      "- `storefront-checkout-verification-recovery`",
      "Default regression: `bun run --filter '@athena/storefront-webapp' test`.",
      "Browser journeys: `bun run --filter '@athena/storefront-webapp' test:e2e`.",
      "Covered test surfaces include `tests/e2e`.",
    ].join("\n"),
    rootDir
  );
  await write(
    "packages/valkey-proxy-server/docs/agent/testing.md",
    [
      "# Valkey Proxy Server Testing",
      "",
      "Run `bun run harness:check` to validate docs freshness.",
      "Run `bun run harness:review` for touched-file validation coverage.",
      "Run `bun run harness:audit` for full-package stale-doc and validation-map coverage auditing.",
      "Machine-readable review coverage lives in [validation-map.json](./validation-map.json).",
      "- [Test index](./test-index.md)",
      "- [Validation guide](./validation-guide.md)",
      "The main test surfaces are `package.json`, `README.md`, `app.js`, `app.test.js`, `index.js`, and `test-connection.js`.",
      "Use `bun run harness:behavior --list` to inspect available runtime scenarios.",
      "Current shared scenarios include:",
      "- `sample-runtime-smoke`",
      "- `athena-admin-shell-boot`",
      "- `athena-convex-storefront-composition`",
      "- `athena-convex-storefront-failure-visibility`",
      "- `valkey-proxy-local-request-response`",
      "- `storefront-checkout-bootstrap`",
      "- `storefront-checkout-validation-blocker`",
      "- `storefront-checkout-verification-recovery`",
      "",
      "Use `bun run harness:behavior --scenario valkey-proxy-local-request-response` for the local request/response smoke check.",
      "Run `bun run --filter 'valkey-proxy-server' test` for the deterministic local pass.",
      "Run `bun run --filter 'valkey-proxy-server' test:connection` for the connection probe.",
      "Covered test surfaces include `app.test.js`, `app.js`, `index.js`, and `test-connection.js`.",
    ].join("\n"),
    rootDir
  );
  await write(
    "packages/valkey-proxy-server/docs/agent/entry-index.md",
    [
      "# Valkey Proxy Server Entry Index",
      "",
      "> Generated by `bun run harness:generate`. Regenerate instead of editing by hand.",
      "",
      "This entry index enumerates the current files under the package root so agents can orient quickly without scanning the whole package.",
      "",
      "## Top-level entries",
      "",
      "- [`index.js`](../../index.js)",
      "- [`test-connection.js`](../../test-connection.js)",
      "",
    ].join("\n"),
    rootDir
  );
  await write(
    "packages/valkey-proxy-server/docs/agent/test-index.md",
    [
      "# Valkey Proxy Server Test Index",
      "",
      "> Generated by `bun run harness:generate`. Regenerate instead of editing by hand.",
      "",
      "This index enumerates the current automated test files and ties them back to the package-level commands agents should start from.",
      "",
      "## Package-level commands",
      "",
      "- `bun run --filter 'valkey-proxy-server' test:connection`",
      "",
      "## Detected test surfaces",
      "",
      "- `index.js`",
      "- `test-connection.js`",
      "",
    ].join("\n"),
    rootDir
  );
  await write(
    "packages/valkey-proxy-server/docs/agent/key-folder-index.md",
    [
      "# Valkey Proxy Server Key Folder Index",
      "",
      "> Generated by `bun run harness:generate`. Regenerate instead of editing by hand.",
      "",
      "This key-folder index highlights the main directories agents are likely to need for fast package orientation.",
      "",
      "## Runtime surfaces",
      "",
      "- `.` — Service entry files and local test helpers. Currently 4 file(s); key children: AGENTS.md, README.md, docs, index.js, package.json.",
      "",
    ].join("\n"),
    rootDir
  );
  await write(
    "packages/valkey-proxy-server/docs/agent/validation-guide.md",
    [
      "# Valkey Proxy Server Validation Guide",
      "",
      "> Generated by `bun run harness:generate`. Regenerate instead of editing by hand.",
      "",
      "Use this decision guide to answer “what should I run for this change?” based on the surface you touched.",
      "",
      "## Service entry or connection probe edits",
      "",
      "Touched surfaces: `index.js`, `test-connection.js`",
      "",
      "Run:",
      "",
      "- `bun run --filter 'valkey-proxy-server' test:connection`",
      "",
      "Use the connection probe when the service entrypoint or connection harness changes.",
      "",
    ].join("\n"),
    rootDir
  );
  await write(
    "packages/valkey-proxy-server/docs/agent/validation-map.json",
    JSON.stringify(
      {
        workspace: "valkey-proxy-server",
        packageDir: "packages/valkey-proxy-server",
        surfaces: [
          {
            name: "service-entry-or-connection-probe-edits",
            pathPrefixes: [
              "packages/valkey-proxy-server/package.json",
              "packages/valkey-proxy-server/README.md",
              "packages/valkey-proxy-server/index.js",
              "packages/valkey-proxy-server/test-connection.js",
            ],
            commands: [{ kind: "script", script: "test:connection" }],
          },
        ],
      },
      null,
      2
    ),
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
              "packages/storefront-webapp/index.html",
              "packages/storefront-webapp/package.json",
              "packages/storefront-webapp/tsconfig.json",
              "packages/storefront-webapp/src/main.tsx",
              "packages/storefront-webapp/src/router.tsx",
              "packages/storefront-webapp/src/routeTree.gen.ts",
              "packages/storefront-webapp/src/routes/",
              "packages/storefront-webapp/vite.config.ts",
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
  await write(
    "packages/athena-webapp/src/routeTree.browser-boundary.test.ts",
    "export {};\n",
    rootDir
  );
  await write("packages/athena-webapp/vitest.setup.ts", "export {};\n", rootDir);
  await write("packages/athena-webapp/src/routes/_authed/index.tsx", "export {};\n", rootDir);
  await write(
    "packages/athena-webapp/src/routes/_authed/$orgUrlSlug/store/$storeUrlSlug/cash-controls/index.tsx",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/src/routes/_authed/$orgUrlSlug/store/$storeUrlSlug/operations/index.tsx",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/src/routes/_authed/$orgUrlSlug/store/$storeUrlSlug/services/index.tsx",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/src/routes/_authed/$orgUrlSlug/store/$storeUrlSlug/procurement.index.tsx",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/src/routes/_authed/$orgUrlSlug/store/$storeUrlSlug/orders/index.tsx",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/src/routes/_authed/$orgUrlSlug/store/$storeUrlSlug/reviews/index.tsx",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/src/routes/_authed/$orgUrlSlug/store/$storeUrlSlug/traces/$traceId.tsx",
    "export {};\n",
    rootDir
  );
  await write("packages/athena-webapp/src/routes/index.tsx", "export {};\n", rootDir);
  await write("packages/athena-webapp/src/components/AppShell.tsx", "export {};\n", rootDir);
  await write(
    "packages/athena-webapp/src/components/app-sidebar.tsx",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/src/components/pos/transactions/TransactionsView.tsx",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/src/components/pos/SessionManager.tsx",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/src/components/pos/register/POSRegisterView.tsx",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/src/components/pos/register/RegisterDrawerGate.tsx",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/src/components/pos/session/HeldSessionsList.tsx",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/src/components/cash-controls/CashControlsDashboard.tsx",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/src/components/cash-controls/RegisterSessionView.tsx",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/src/components/staff/StaffManagement.tsx",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/src/components/services/ServiceCatalogView.tsx",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/src/components/add-product/ProductView.tsx",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/src/components/assets/index.tsx",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/src/components/join-team/index.tsx",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/src/components/organization-members/index.tsx",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/src/components/orders/OrderView.tsx",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/src/components/promo-codes/PromoCodeHeader.tsx",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/src/components/reviews/ReviewsView.tsx",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/src/components/store-configuration/hooks/useStoreConfigUpdate.ts",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/src/components/traces/WorkflowTraceView.tsx",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/src/components/operations/OperationsQueueView.tsx",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/src/components/operations/StockAdjustmentWorkspace.tsx",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/src/components/procurement/ProcurementView.tsx",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/src/components/procurement/ReceivingView.tsx",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/src/components/expense/ExpenseCompletion.tsx",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/src/components/expense/ExpenseView.tsx",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/src/components/pos/CashierAuthDialog.tsx",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/src/routes/login/_layout.tsx",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/src/components/auth/DefaultCatchBoundary.tsx",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/src/components/auth/DefaultCatchBoundary.test.tsx",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/src/routeTree.browser-boundary.test.ts",
    "export {};\n",
    rootDir
  );
  await write("packages/athena-webapp/src/hooks/useAuth.ts", "export {};\n", rootDir);
  await write(
    "packages/athena-webapp/src/hooks/useExpenseSessions.ts",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/src/hooks/useExpenseOperations.ts",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/src/hooks/useSessionManagementExpense.ts",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/src/components/users/CustomerBehaviorTimeline.tsx",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/src/components/users/TimelineEventCard.tsx",
    "export {};\n",
    rootDir
  );
  await write("packages/athena-webapp/src/contexts/AuthContext.tsx", "export {};\n", rootDir);
  await write("packages/athena-webapp/src/lib/session.ts", "export {};\n", rootDir);
  await write(
    "packages/athena-webapp/src/lib/errors/runCommand.ts",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/src/lib/errors/presentCommandToast.ts",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/src/lib/errors/presentUnexpectedErrorToast.ts",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/src/lib/errors/presentUnexpectedErrorToast.test.ts",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/src/lib/pos/application/results.ts",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/src/lib/pos/presentation/register/useRegisterViewModel.ts",
    "export {};\n",
    rootDir
  );
  await write("packages/athena-webapp/src/stores/expenseStore.ts", "export {};\n", rootDir);
  await write(
    "packages/athena-webapp/shared/commandResult.ts",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/shared/serviceIntake.ts",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/shared/stockAdjustment.ts",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/shared/workflowTrace.ts",
    "export {};\n",
    rootDir
  );
  await write("packages/athena-webapp/src/settings/store.ts", "export {};\n", rootDir);
  await write(
    "packages/athena-webapp/src/settings/store/StoreSettingsView.tsx",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/src/settings/organization/components/OrganizationSettingsView.tsx",
    "export {};\n",
    rootDir
  );
  await write("packages/athena-webapp/src/stores/appStore.ts", "export {};\n", rootDir);
  await write("packages/athena-webapp/src/utils/format.ts", "export {};\n", rootDir);
  await write("packages/athena-webapp/vitest.config.ts", "export default {};\n", rootDir);
  await write("packages/athena-webapp/src/tests/app.test.tsx", "export {};\n", rootDir);
  await write("packages/athena-webapp/src/test/setup.ts", "export {};\n", rootDir);
  await write("packages/athena-webapp/convex/http.ts", "export {};\n", rootDir);
  await write("packages/athena-webapp/convex/http/router.ts", "export {};\n", rootDir);
  await write("packages/athena-webapp/convex/schema.ts", "export {};\n", rootDir);
  await write(
    "packages/athena-webapp/convex/cashControls/closeouts.ts",
    "export {};\n",
    rootDir
  );
  await write("packages/athena-webapp/convex/inventory/item.ts", "export {};\n", rootDir);
  await write(
    "packages/athena-webapp/convex/pos/application/commands/completeTransaction.ts",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/convex/pos/application/commands/posSessionTracing.ts",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/convex/pos/application/queries/getTransactions.ts",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/convex/pos/application/queries/getRegisterState.ts",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/convex/pos/public/transactions.ts",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/convex/operations/approvalRequests.ts",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/convex/operations/registerSessionTracing.ts",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/convex/operations/registerSessions.ts",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/convex/operations/staffCredentials.ts",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/convex/operations/staffProfiles.ts",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/convex/cashControls/deposits.ts",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/convex/inventory/auth.ts",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/convex/inventory/stores.ts",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/convex/inventory/expenseSessions.ts",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/convex/inventory/expenseSessionItems.ts",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/convex/inventory/expenseTransactions.ts",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/convex/inventory/posSessions.ts",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/convex/operations/serviceIntake.ts",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/convex/pos/infrastructure/repositories/cashierRepository.ts",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/convex/serviceOps/serviceCases.ts",
    "export {};\n",
    rootDir
  );
  await write("packages/athena-webapp/convex/stockOps/access.ts", "export {};\n", rootDir);
  await write("packages/athena-webapp/convex/storeFront/cart.ts", "export {};\n", rootDir);
  await write(
    "packages/athena-webapp/convex/storeFront/onlineOrder.ts",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/convex/storeFront/onlineOrderUtilFns.ts",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/convex/storeFront/payment.ts",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/convex/storeFront/reviews.ts",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/convex/storeFront/customerBehaviorTimeline.ts",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/convex/storeFront/customerObservabilityTimelineData.ts",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/convex/storeFront/helpers/returnExchangeOperations.ts",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/convex/storeFront/helpers/customerEngagementEvents.ts",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/scripts/convex-audit.sh",
    "#!/usr/bin/env bash\nexit 0\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/scripts/convex-lint-changed.sh",
    "#!/usr/bin/env bash\nexit 0\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/scripts/convexPaginationAntiPatternCheck.py",
    "print('ok')\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/convex/schemas/observability/workflowTrace.ts",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/convex/schemas/pos/posTransaction.ts",
    "export {};\n",
    rootDir
  );
  await write(
    "packages/athena-webapp/convex/workflowTraces/core.ts",
    "export {};\n",
    rootDir
  );
  await write("packages/athena-webapp/vite.config.ts", "export default {};\n", rootDir);

  await write(
    "packages/storefront-webapp/index.html",
    "<!doctype html><html><body><div id=\"root\"></div></body></html>\n",
    rootDir
  );
  await write("packages/storefront-webapp/src/assets/placeholder.png", "", rootDir);
  await write(
    "packages/storefront-webapp/tsconfig.json",
    JSON.stringify({ compilerOptions: {} }, null, 2),
    rootDir
  );
  await write("packages/storefront-webapp/vite.config.ts", "export default {};\n", rootDir);
  await write("packages/storefront-webapp/src/config.ts", "export {};\n", rootDir);
  await write("packages/storefront-webapp/src/index.css", "body {}\n", rootDir);
  await write("packages/storefront-webapp/src/main.tsx", "export {};\n", rootDir);
  await write("packages/storefront-webapp/src/router.tsx", "export {};\n", rootDir);
  await write("packages/storefront-webapp/src/routeTree.gen.ts", "export {};\n", rootDir);
  await write("packages/storefront-webapp/src/routes/auth.verify.tsx", "export {};\n", rootDir);
  await write("packages/storefront-webapp/src/routes/__root.tsx", "export {};\n", rootDir);
  await write("packages/storefront-webapp/src/routes/shop/checkout/index.tsx", "export {};\n", rootDir);
  await write("packages/storefront-webapp/src/api/storefront.ts", "export {};\n", rootDir);
  await write("packages/storefront-webapp/src/components/checkout/Bag.tsx", "export {};\n", rootDir);
  await write("packages/storefront-webapp/src/contexts/StoreContext.tsx", "export {};\n", rootDir);
  await write("packages/storefront-webapp/src/hooks/useBag.ts", "export {};\n", rootDir);
  await write("packages/storefront-webapp/src/lib/storefrontObservability.ts", "export {};\n", rootDir);
  await write("packages/storefront-webapp/src/utils/price.ts", "export {};\n", rootDir);
  await write("packages/storefront-webapp/tests/e2e/checkout.spec.ts", "export {};\n", rootDir);
  await write("packages/valkey-proxy-server/app.js", "export const app = true;\n", rootDir);
  await write(
    "packages/valkey-proxy-server/app.test.js",
    "export const appTest = true;\n",
    rootDir
  );
  await write("packages/valkey-proxy-server/index.js", "export const proxy = true;\n", rootDir);
  await write(
    "packages/valkey-proxy-server/test-connection.js",
    "export const probe = true;\n",
    rootDir
  );

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

  it("reports missing generated service entry docs for in-scope service packages", async () => {
    const rootDir = await createFixtureRepo();
    await rm(
      path.join(rootDir, "packages/valkey-proxy-server/docs/agent/entry-index.md")
    );

    await expect(runHarnessAudit(rootDir)).rejects.toThrow(
      /valkey-proxy-server[\s\S]*Missing required harness file: packages\/valkey-proxy-server\/docs\/agent\/entry-index\.md/
    );
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
                "packages/storefront-webapp/index.html",
                "packages/storefront-webapp/package.json",
                "packages/storefront-webapp/tsconfig.json",
                "packages/storefront-webapp/src/main.tsx",
                "packages/storefront-webapp/vite.config.ts",
                "packages/storefront-webapp/src/router.tsx",
                "packages/storefront-webapp/src/routeTree.gen.ts",
                "packages/storefront-webapp/src/routes/",
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
