import path from "node:path";

export const PACKAGES_ROOT_DIR = "packages";
export const PACKAGES_AGENTS_PATH = `${PACKAGES_ROOT_DIR}/AGENTS.md` as const;

export const GENERATED_HARNESS_DOCS = [
  "docs/agent/test-index.md",
  "docs/agent/key-folder-index.md",
  "docs/agent/validation-guide.md",
  "docs/agent/validation-map.json",
] as const;

export const REQUIRED_HARNESS_ENTRY_DOCS = [
  "AGENTS.md",
  "docs/agent/index.md",
  "docs/agent/architecture.md",
  "docs/agent/testing.md",
  "docs/agent/code-map.md",
] as const;

export const REQUIRED_INDEX_LINKS = [
  "./architecture.md",
  "./testing.md",
  "./code-map.md",
  "./route-index.md",
  "./test-index.md",
  "./key-folder-index.md",
  "./validation-guide.md",
] as const;

export const REQUIRED_TESTING_LINKS = [
  "./test-index.md",
  "./validation-guide.md",
] as const;

export const REQUIRED_CODE_MAP_LINKS = [
  "./route-index.md",
  "./key-folder-index.md",
] as const;

export const SERVICE_REQUIRED_INDEX_LINKS = [
  "./architecture.md",
  "./testing.md",
  "./code-map.md",
  "./entry-index.md",
  "./test-index.md",
  "./key-folder-index.md",
  "./validation-guide.md",
] as const;

export const SERVICE_REQUIRED_CODE_MAP_LINKS = [
  "./entry-index.md",
  "./key-folder-index.md",
] as const;

export type ValidationCommand =
  | { kind: "script"; script: string }
  | { kind: "raw"; command: string };

export type HarnessKeyFolderGroup = {
  title: string;
  folders: Array<{ path: string; description: string }>;
};

export type HarnessValidationScenario = {
  title: string;
  touchedPaths: string[];
  commands: ValidationCommand[];
  behaviorScenarios?: string[];
  note: string;
};

export type HarnessAppName = "athena-webapp" | "storefront-webapp" | "valkey-proxy-server";

export type HarnessAppArchetype = "webapp" | "service-package";
export type HarnessOnboardingStatus = "active" | "planned";

export type HarnessDocPaths = {
  agentsPath: string;
  indexPath: string;
  architecturePath: string;
  testingPath: string;
  codeMapPath: string;
  routeIndexPath?: string;
  entryIndexPath?: string;
  testIndexPath: string;
  keyFolderIndexPath: string;
  validationGuidePath: string;
  validationMapPath: string;
  requiredIndexLinks: readonly string[];
  requiredCodeMapLinks: readonly string[];
  requiredEntryDocs: readonly string[];
  generatedDocs: readonly string[];
};

export type HarnessAppRegistryEntry = {
  appName: HarnessAppName;
  label: string;
  packageDir: string;
  archetype: HarnessAppArchetype;
  onboardingStatus: HarnessOnboardingStatus;
  routeRoot?: string;
  auditedRoots: readonly string[];
  harnessDocs: HarnessDocPaths;
  keyFolderGroups: HarnessKeyFolderGroup[];
  validationScenarios: HarnessValidationScenario[];
};

type HarnessAppPackageRegistration = {
  kind: "harness-app";
  packageDir: string;
  appName: HarnessAppName;
  requiredEntryDocs: readonly string[];
};

type NonHarnessPackageRegistration = {
  kind: "non-harness";
  packageDir: string;
  note: string;
};

export type HarnessPackageRegistration =
  | HarnessAppPackageRegistration
  | NonHarnessPackageRegistration;

function buildHarnessDocPaths(packageDir: string): HarnessDocPaths {
  return buildHarnessDocPathsForArchetype(packageDir, "webapp");
}

function buildHarnessDocPathsForArchetype(
  packageDir: string,
  archetype: HarnessAppArchetype
): HarnessDocPaths {
  const requiredEntryDocs = REQUIRED_HARNESS_ENTRY_DOCS.map((relativePath) =>
    path.posix.join(packageDir, relativePath)
  );
  const discoveryIndexPath =
    archetype === "webapp"
      ? path.posix.join(packageDir, "docs/agent/route-index.md")
      : path.posix.join(packageDir, "docs/agent/entry-index.md");
  const generatedDocs = [discoveryIndexPath, ...GENERATED_HARNESS_DOCS.map((relativePath) =>
    path.posix.join(packageDir, relativePath)
  )];

  return {
    agentsPath: path.posix.join(packageDir, "AGENTS.md"),
    indexPath: path.posix.join(packageDir, "docs/agent/index.md"),
    architecturePath: path.posix.join(packageDir, "docs/agent/architecture.md"),
    testingPath: path.posix.join(packageDir, "docs/agent/testing.md"),
    codeMapPath: path.posix.join(packageDir, "docs/agent/code-map.md"),
    routeIndexPath:
      archetype === "webapp" ? path.posix.join(packageDir, "docs/agent/route-index.md") : undefined,
    entryIndexPath:
      archetype === "service-package"
        ? path.posix.join(packageDir, "docs/agent/entry-index.md")
        : undefined,
    testIndexPath: path.posix.join(packageDir, "docs/agent/test-index.md"),
    keyFolderIndexPath: path.posix.join(packageDir, "docs/agent/key-folder-index.md"),
    validationGuidePath: path.posix.join(packageDir, "docs/agent/validation-guide.md"),
    validationMapPath: path.posix.join(packageDir, "docs/agent/validation-map.json"),
    requiredIndexLinks:
      archetype === "webapp"
        ? REQUIRED_INDEX_LINKS
        : SERVICE_REQUIRED_INDEX_LINKS,
    requiredCodeMapLinks:
      archetype === "webapp"
        ? REQUIRED_CODE_MAP_LINKS
        : SERVICE_REQUIRED_CODE_MAP_LINKS,
    requiredEntryDocs,
    generatedDocs,
  };
}

export const HARNESS_APP_REGISTRY = [
  {
    appName: "athena-webapp",
    label: "Athena Webapp",
    archetype: "webapp",
    onboardingStatus: "active",
    packageDir: "packages/athena-webapp",
    routeRoot: "src/routes",
    auditedRoots: ["src", "shared", "convex"],
    harnessDocs: buildHarnessDocPathsForArchetype("packages/athena-webapp", "webapp"),
    keyFolderGroups: [
      {
        title: "Core app surfaces",
        folders: [
          {
            path: "src/routes",
            description: "TanStack route entrypoints and authenticated shells.",
          },
          {
            path: "src/components",
            description: "UI components, views, and package-local feature widgets.",
          },
          {
            path: "src/components/traces",
            description:
              "Shared workflow trace screens, ordered timelines, and trace detail primitives.",
          },
          {
            path: "src/components/operations",
            description:
              "Manager-queue and stock-adjustment workflows that share approval rails with other operational surfaces.",
          },
          {
            path: "src/components/procurement",
            description:
              "Procurement planning and receiving views for replenishment pressure and purchase-order execution.",
          },
          {
            path: "src/hooks",
            description: "React hooks that fan out auth, shell, and feature state.",
          },
          {
            path: "src/contexts",
            description: "Context providers for app-wide state and wiring.",
          },
          {
            path: "src/lib",
            description: "Shared frontend helpers, schemas, and package utilities.",
          },
          {
            path: "shared",
            description: "Browser-safe helpers shared with Convex-backed workflows.",
          },
          {
            path: "src/utils",
            description: "Cross-cutting browser helpers and lower-level utilities.",
          },
        ],
      },
      {
        title: "Backend and test surfaces",
        folders: [
          {
            path: "convex/stockOps",
            description:
              "Stock-adjustment, procurement, replenishment, receiving, and vendor flows layered over inventory state.",
          },
          {
            path: "convex/serviceOps",
            description:
              "Service catalog, appointment, and service-case workflows layered on operational work items.",
          },
          {
            path: "convex/workflowTraces",
            description:
              "Shared workflow trace creation, lookup, presentation, and adapter helpers.",
          },
          {
            path: "convex",
            description: "Convex functions, HTTP composition, schemas, and backend tests.",
          },
          {
            path: "src/tests",
            description: "Focused browser-facing regression tests.",
          },
          {
            path: "src/test",
            description: "Package test harness helpers and setup.",
          },
        ],
      },
    ],
    validationScenarios: [
      {
        title: "Route or UI-only edits",
        touchedPaths: [
          "src/assets",
          "src/config.ts",
          "src/routes",
          "src/components",
          "src/hooks",
          "src/contexts",
          "src/index.css",
        ],
        commands: [
          { kind: "script", script: "test" },
          { kind: "script", script: "lint:architecture" },
        ],
        note:
          "Use this for authenticated dashboard flows, service-management screens, route trees, and UI behavior changes that stay inside the frontend shell.",
      },
      {
        title: "Stock-ops procurement and receiving edits",
        touchedPaths: [
          "convex/stockOps",
          "convex/operations/approvalRequests.ts",
          "src/components/operations/OperationsQueueView.tsx",
          "src/components/operations/StockAdjustmentWorkspace.tsx",
          "src/components/procurement",
          "src/components/app-sidebar.tsx",
          "src/routes/_authed/$orgUrlSlug/store/$storeUrlSlug/operations",
          "src/routes/_authed/$orgUrlSlug/store/$storeUrlSlug/procurement.index.tsx",
        ],
        commands: [
          {
            kind: "raw",
            command:
              "bun run --filter '@athena/webapp' test -- convex/stockOps/access.test.ts convex/stockOps/adjustments.test.ts convex/stockOps/purchaseOrders.test.ts convex/stockOps/receiving.test.ts convex/stockOps/replenishment.test.ts convex/stockOps/vendors.test.ts src/components/operations/StockAdjustmentWorkspace.test.tsx src/components/operations/OperationsQueueView.test.tsx src/components/procurement/ProcurementView.test.tsx src/components/procurement/ReceivingView.test.tsx",
          },
          { kind: "script", script: "audit:convex" },
          { kind: "script", script: "lint:convex:changed" },
          {
            kind: "raw",
            command: "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
          },
          { kind: "script", script: "build" },
        ],
        behaviorScenarios: ["athena-admin-shell-boot"],
        note:
          "Use this when stock adjustments, procurement recommendations, purchase-order lifecycle changes, or receiving route wiring move. Start `bunx convex dev` from `packages/athena-webapp` before validation when generated client refs or new stockOps function exports changed.",
      },
      {
        title: "Cash-controls workflow edits",
        touchedPaths: [
          "convex/cashControls",
          "convex/operations/registerSessions.ts",
          "src/components/cash-controls",
          "src/components/operations/OperationsQueueView.tsx",
          "src/components/app-sidebar.tsx",
          "src/routes/_authed/$orgUrlSlug/store/$storeUrlSlug/cash-controls",
        ],
        commands: [
          {
            kind: "raw",
            command:
              "bun run --filter '@athena/webapp' test -- convex/cashControls/registerSessions.test.ts convex/cashControls/closeouts.test.ts convex/cashControls/deposits.test.ts src/components/cash-controls/RegisterCloseoutView.test.tsx src/components/cash-controls/CashControlsDashboard.test.tsx src/components/cash-controls/RegisterSessionView.test.tsx src/components/operations/OperationsQueueView.test.tsx",
          },
          {
            kind: "raw",
            command: "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
          },
          { kind: "script", script: "build" },
        ],
        behaviorScenarios: ["athena-admin-shell-boot"],
        note:
          "Use this when register-session, deposit, closeout, dashboard, operations-queue approval, or cash-controls route wiring changes. Start `bunx convex dev` from `packages/athena-webapp` before validation when generated client refs or new Convex function exports changed.",
      },
      {
        title: "Workflow trace foundation and POS trace-link edits",
        touchedPaths: [
          "convex/workflowTraces",
          "convex/schemas/observability",
          "convex/pos/application/commands/completeTransaction.ts",
          "convex/pos/application/queries/getTransactions.ts",
          "convex/pos/public/transactions.ts",
          "convex/schemas/pos/posTransaction.ts",
          "shared/workflowTrace.ts",
          "src/components/traces",
          "src/components/pos/transactions",
          "src/routes/_authed/$orgUrlSlug/store/$storeUrlSlug/traces",
        ],
        commands: [
          {
            kind: "raw",
            command:
              "bun run --filter '@athena/webapp' test -- convex/workflowTraces/presentation.test.ts convex/workflowTraces/queryUsage.test.ts convex/workflowTraces/schemaIndexes.test.ts convex/workflowTraces/adapters/posSale.test.ts convex/pos/application/completeTransaction.test.ts convex/pos/application/getTransactions.test.ts src/components/traces/WorkflowTraceView.test.tsx 'src/routes/_authed/$orgUrlSlug/store/$storeUrlSlug/traces/$traceId.test.tsx' src/components/pos/transactions/WorkflowTraceLink.test.tsx src/components/pos/transactions/transactionColumns.test.tsx src/components/pos/transactions/TransactionView.test.tsx src/components/pos/transactions/TransactionsView.test.tsx src/lib/traces/createWorkflowTraceId.test.ts",
          },
          { kind: "script", script: "audit:convex" },
          { kind: "script", script: "lint:convex:changed" },
          {
            kind: "raw",
            command: "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
          },
          { kind: "script", script: "build" },
        ],
        behaviorScenarios: [
          "athena-admin-shell-boot",
          "athena-convex-storefront-composition",
          "athena-convex-storefront-failure-visibility",
        ],
        note:
          "Use this when the shared workflow-trace contract, the trace route/view, or POS transaction trace links change. It exercises the trace schema and presentation contract, the shared trace route, and the operator-facing POS link surfaces before broader package validation.",
      },
      {
        title: "Shared-lib or utility edits",
        touchedPaths: ["src/lib", "shared", "src/settings", "src/utils", "src/stores", "types.ts"],
        commands: [
          { kind: "script", script: "test" },
          {
            kind: "raw",
            command: "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
          },
        ],
        note: "Reach for the package suite first, then typecheck when helpers or shared state can affect many call sites.",
      },
      {
        title: "Frontend test harness edits",
        touchedPaths: ["src/test", "src/tests"],
        commands: [{ kind: "script", script: "test" }],
        note: "Run the package suite when package-local frontend test helpers or focused regression tests change.",
      },
      {
        title: "Convex or backend-adjacent edits",
        touchedPaths: [
          "convex",
          "scripts/convex-audit.sh",
          "scripts/convex-lint-changed.sh",
          "src/routes/_authed",
          "src/main.tsx",
        ],
        commands: [
          { kind: "script", script: "test" },
          { kind: "script", script: "audit:convex" },
          { kind: "script", script: "lint:convex:changed" },
        ],
        behaviorScenarios: [
          "athena-convex-storefront-composition",
          "athena-convex-storefront-failure-visibility",
        ],
        note:
          "Any change that can affect Convex HTTP wiring, serviceOps schemas and workflows, shared operational rails, or route-to-backend composition should include the Convex audit pair.",
      },
      {
        title: "Route runtime or build-pipeline edits",
        touchedPaths: [
          "src/main.tsx",
          "src/routeTree.gen.ts",
          "src/routeTree.browser-boundary.test.ts",
          "vite.config.ts",
        ],
        commands: [
          {
            kind: "raw",
            command:
              "bun run --filter '@athena/webapp' test -- src/routeTree.browser-boundary.test.ts",
          },
          {
            kind: "raw",
            command: "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
          },
          { kind: "script", script: "build" },
        ],
        behaviorScenarios: ["athena-admin-shell-boot"],
        note:
          "Run these when bootstrap, generated router state, or package build configuration changes so browser-entry regressions fail before the route tree reaches Arc.",
      },
      {
        title: "Storybook and frontend tooling edits",
        touchedPaths: [
          ".storybook",
          "src/stories",
          "src/index.css",
          "tailwind.config.js",
          "package.json",
          "eslint.config.js",
          ".gitignore",
        ],
        commands: [
          { kind: "script", script: "test" },
          { kind: "script", script: "build" },
          { kind: "script", script: "storybook:build" },
        ],
        note: "Use this when Storybook config, story files, or package-level frontend tooling changes need isolated validation.",
      },
    ],
  },
  {
    appName: "storefront-webapp",
    label: "Storefront Webapp",
    archetype: "webapp",
    onboardingStatus: "active",
    packageDir: "packages/storefront-webapp",
    routeRoot: "src/routes",
    auditedRoots: ["src", "tests"],
    harnessDocs: buildHarnessDocPathsForArchetype("packages/storefront-webapp", "webapp"),
    keyFolderGroups: [
      {
        title: "Core app surfaces",
        folders: [
          {
            path: "src/routes",
            description: "TanStack Router routes, layouts, and browser journey entrypoints.",
          },
          {
            path: "src/components",
            description: "Reusable storefront UI and feature-specific checkout/catalog components.",
          },
          {
            path: "src/hooks",
            description: "Client hooks for bag, routing, observability, and auth interactions.",
          },
          {
            path: "src/contexts",
            description: "Shared client providers for store, navigation, and observability state.",
          },
          {
            path: "src/lib",
            description: "Shared utilities, query helpers, schemas, and domain logic.",
          },
          {
            path: "src/api",
            description: "Backend-facing request wrappers and typed API helpers.",
          },
        ],
      },
      {
        title: "Validation and support surfaces",
        folders: [
          {
            path: "tests/e2e",
            description: "Playwright browser journeys and redirect/payment coverage.",
          },
          {
            path: "src/utils",
            description: "Lower-level runtime helpers used across route and API code.",
          },
        ],
      },
    ],
    validationScenarios: [
      {
        title: "Route or UI-only edits",
        touchedPaths: [
          "src/assets",
          "src/config.ts",
          "src/index.css",
          "src/routes",
          "src/components",
          "src/hooks",
          "src/contexts",
        ],
        commands: [{ kind: "script", script: "test" }],
        note: "Start here for most layout, component, and route behavior changes that do not alter the checkout or browser-journey contract.",
      },
      {
        title: "Route runtime or build-pipeline edits",
        touchedPaths: [
          "index.html",
          "package.json",
          "tsconfig.json",
          "src/main.tsx",
          "src/router.tsx",
          "src/routeTree.gen.ts",
          "vite.config.ts",
        ],
        commands: [
          { kind: "script", script: "test" },
          { kind: "script", script: "build" },
          {
            kind: "raw",
            command:
              "bunx tsc --noEmit -p packages/storefront-webapp/tsconfig.json",
          },
        ],
        note: "Use this when the Vite browser bootstrap, package manifest, generated router state, or TypeScript/build wiring changes.",
      },
      {
        title: "Shared-lib, utility, or API-wrapper edits",
        touchedPaths: ["src/lib", "src/utils", "src/api"],
        commands: [
          { kind: "script", script: "test" },
          {
            kind: "raw",
            command:
              "bunx tsc --noEmit -p packages/storefront-webapp/tsconfig.json",
          },
        ],
        note: "These surfaces fan out widely across the app, so pair the default suite with a typecheck when shared helpers change.",
      },
      {
        title: "Checkout or auth route-boundary edits",
        touchedPaths: [
          "src/routes/shop/checkout",
          "src/components/checkout",
          "src/routes/auth.verify.tsx",
        ],
        commands: [
          { kind: "script", script: "test" },
          { kind: "script", script: "lint:architecture" },
        ],
        behaviorScenarios: ["storefront-checkout-bootstrap"],
        note: "Use the scoped architecture lint when lower-level helpers could accidentally depend on checkout or auth route entrypoints.",
      },
      {
        title: "Full browser journeys and payment redirects",
        touchedPaths: ["tests/e2e", "src/routes/shop/checkout"],
        commands: [
          { kind: "script", script: "test" },
          { kind: "script", script: "test:e2e" },
        ],
        behaviorScenarios: [
          "storefront-checkout-bootstrap",
          "storefront-checkout-validation-blocker",
          "storefront-checkout-verification-recovery",
        ],
        note: "Run the Playwright layer when navigation, checkout, or redirect behavior could change the end-to-end customer path.",
      },
    ],
  },
  {
    appName: "valkey-proxy-server",
    label: "Valkey Proxy Server",
    archetype: "service-package",
    onboardingStatus: "active",
    packageDir: "packages/valkey-proxy-server",
    auditedRoots: ["."],
    harnessDocs: buildHarnessDocPathsForArchetype(
      "packages/valkey-proxy-server",
      "service-package"
    ),
    keyFolderGroups: [
      {
        title: "Service entry and support surfaces",
        folders: [
          {
            path: ".",
            description: "Root service entry files, connection probes, and package metadata.",
          },
        ],
      },
      {
        title: "Docs and harness surfaces",
        folders: [
          {
            path: "docs/agent",
            description: "Harness docs, generated indexes, and validation map content.",
          },
        ],
      },
    ],
    validationScenarios: [
      {
        title: "Service logic, docs, or entrypoint edits",
        touchedPaths: [
          "package.json",
          "README.md",
          "app.js",
          "app.test.js",
          "index.js",
        ],
        commands: [
          { kind: "script", script: "test" },
          {
            kind: "raw",
            command: "node --check packages/valkey-proxy-server/app.js",
          },
          {
            kind: "raw",
            command: "node --check packages/valkey-proxy-server/index.js",
          },
        ],
        behaviorScenarios: ["valkey-proxy-local-request-response"],
        note: "Use the local test suite and syntax checks when handler logic, operator docs, or runtime bootstrap changes.",
      },
      {
        title: "Live connection probe edits",
        touchedPaths: ["test-connection.js"],
        commands: [
          { kind: "script", script: "test" },
          {
            kind: "raw",
            command: "node --check packages/valkey-proxy-server/test-connection.js",
          },
        ],
        note: "Keep the live Redis probe syntax-checked locally; run the environment-dependent connection probe manually when cluster access is available.",
      },
    ],
  },
] satisfies HarnessAppRegistryEntry[];

const NON_HARNESS_PACKAGE_REGISTRY = [] as const satisfies readonly NonHarnessPackageRegistration[];

export const HARNESS_PACKAGE_REGISTRY = [
  ...HARNESS_APP_REGISTRY.map((entry) => ({
    kind: "harness-app",
    appName: entry.appName,
    packageDir: entry.packageDir,
    requiredEntryDocs: entry.harnessDocs.requiredEntryDocs,
  })),
  ...NON_HARNESS_PACKAGE_REGISTRY,
] satisfies readonly HarnessPackageRegistration[];

export function getHarnessPackageRegistration(packageDir: string) {
  return HARNESS_PACKAGE_REGISTRY.find((entry) => entry.packageDir === packageDir);
}
