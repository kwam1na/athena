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
  { kind: "script"; script: string } | { kind: "raw"; command: string };

export type HarnessKeyFolderGroup = {
  title: string;
  folders: Array<{ path: string; description: string }>;
};

export type HarnessValidationScenario = {
  id: string;
  reviewSensitive: boolean;
  title: string;
  touchedPaths: string[];
  commands: ValidationCommand[];
  behaviorScenarios?: string[];
  note: string;
};

export type HarnessAppName =
  "athena-webapp" | "storefront-webapp" | "valkey-proxy-server";

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
  HarnessAppPackageRegistration | NonHarnessPackageRegistration;

function buildHarnessDocPaths(packageDir: string): HarnessDocPaths {
  return buildHarnessDocPathsForArchetype(packageDir, "webapp");
}

function buildHarnessDocPathsForArchetype(
  packageDir: string,
  archetype: HarnessAppArchetype,
): HarnessDocPaths {
  const requiredEntryDocs = REQUIRED_HARNESS_ENTRY_DOCS.map((relativePath) =>
    path.posix.join(packageDir, relativePath),
  );
  const discoveryIndexPath =
    archetype === "webapp"
      ? path.posix.join(packageDir, "docs/agent/route-index.md")
      : path.posix.join(packageDir, "docs/agent/entry-index.md");
  const generatedDocs = [
    discoveryIndexPath,
    ...GENERATED_HARNESS_DOCS.map((relativePath) =>
      path.posix.join(packageDir, relativePath),
    ),
  ];

  return {
    agentsPath: path.posix.join(packageDir, "AGENTS.md"),
    indexPath: path.posix.join(packageDir, "docs/agent/index.md"),
    architecturePath: path.posix.join(packageDir, "docs/agent/architecture.md"),
    testingPath: path.posix.join(packageDir, "docs/agent/testing.md"),
    codeMapPath: path.posix.join(packageDir, "docs/agent/code-map.md"),
    routeIndexPath:
      archetype === "webapp"
        ? path.posix.join(packageDir, "docs/agent/route-index.md")
        : undefined,
    entryIndexPath:
      archetype === "service-package"
        ? path.posix.join(packageDir, "docs/agent/entry-index.md")
        : undefined,
    testIndexPath: path.posix.join(packageDir, "docs/agent/test-index.md"),
    keyFolderIndexPath: path.posix.join(
      packageDir,
      "docs/agent/key-folder-index.md",
    ),
    validationGuidePath: path.posix.join(
      packageDir,
      "docs/agent/validation-guide.md",
    ),
    validationMapPath: path.posix.join(
      packageDir,
      "docs/agent/validation-map.json",
    ),
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
    harnessDocs: buildHarnessDocPathsForArchetype(
      "packages/athena-webapp",
      "webapp",
    ),
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
            description:
              "UI components, views, and package-local feature widgets.",
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
            description:
              "React hooks that fan out auth, shell, and feature state.",
          },
          {
            path: "src/contexts",
            description: "Context providers for app-wide state and wiring.",
          },
          {
            path: "src/lib",
            description:
              "Shared frontend helpers, schemas, and package utilities.",
          },
          {
            path: "shared",
            description:
              "Browser-safe helpers shared with Convex-backed workflows.",
          },
          {
            path: "src/utils",
            description:
              "Cross-cutting browser helpers and lower-level utilities.",
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
            path: "convex/reports",
            description:
              "Canonical fact ledger, the deterministic day fold, sweeper-maintained day/SKU/rollup read models, source-truth verification, and store-scoped reporting reads.",
          },
          {
            path: "convex/inventoryLedger",
            description:
              "Inventory valuation and costing: weighted-average cost pools, deficit lots, position revisions, and SKU valuation corrections.",
          },
          {
            path: "convex/storeTime",
            description:
              "Store timezone authority and operating-day resolution shared by reporting and operational surfaces.",
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
            description:
              "Convex functions, HTTP composition, schemas, and backend tests.",
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
        id: "athena.shared-demo-admission",
        reviewSensitive: true,
        title: "Shared demo admission, restore, and orientation edits",
        touchedPaths: [
          "assets/shared-demo-products",
          "docs/shared-demo-backend-coverage.md",
          "convex/sharedDemo",
          "convex/auth.ts",
          "convex/auth/SharedDemoTicket.ts",
          "convex/contextTracking",
          "convex/crons.ts",
          "convex/http.ts",
          "convex/operationAdmission",
          "src/components/shared-demo",
          "playwright.demo.config.ts",
          "src/lib/errors/sharedDemoDenialObserver.ts",
          "src/routes/demo.tsx",
          "src/routes/_authed.tsx",
        ],
        commands: [
          {
            kind: "raw",
            command:
              "bun run --filter '@athena/webapp' test -- convex/sharedDemo convex/contextTracking convex/operationAdmission src/components/shared-demo src/tests/demo/navigationCases.test.ts src/components/product/AnalyticsInsights.test.tsx src/components/reports/ReportsSkuDetailView.test.tsx src/components/operations/InventoryImportView.test.tsx src/lib/errors/sharedDemoDenialObserver.test.ts src/routes/demo.test.tsx src/routes/_authed.test.tsx",
          },
          { kind: "script", script: "audit:convex" },
          { kind: "script", script: "lint:convex:changed" },
          { kind: "script", script: "lint:frontend:changed" },
          {
            kind: "raw",
            command:
              "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
          },
          { kind: "script", script: "build" },
        ],
        behaviorScenarios: ["athena-admin-shell-boot"],
        note: "Use this when the configured shared demo changes admission, shared-store authority, restore semantics, effect restrictions, visitor-activity tracking on the context event rail, or the owner-oriented application shell. It validates the server boundary, credentialless entry, orientation layer, demo telemetry capture, and generated application contracts together. Demo activity events are support-visible and non-compilable on purpose: demo visitors are store admins of the one shared store, so store-visible telemetry would expose one visitor's behavior to another.",
      },
      {
        id: "athena.route-ui",
        reviewSensitive: false,
        title: "Route or UI-only edits",
        touchedPaths: [
          "src/assets",
          "src/config.ts",
          "src/config.test.ts",
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
        note: "Use this for authenticated dashboard flows, service-management screens, route trees, and UI behavior changes that stay inside the frontend shell.",
      },
      {
        id: "athena.changed-frontend-source-lint",
        reviewSensitive: false,
        title: "Changed frontend source lint",
        touchedPaths: ["src", "shared", "types.ts"],
        commands: [{ kind: "script", script: "lint:frontend:changed" }],
        note: "Run this for changed browser-facing TypeScript or TSX files so introduced ESLint failures are caught before PR handoff.",
      },
      {
        id: "athena.reporting-fact-ledger",
        reviewSensitive: false,
        title: "Reporting fact ledger, day fold, and read-model edits",
        touchedPaths: [
          "convex/reports",
          "convex/schemas/reports",
          "convex/inventoryLedger",
          "convex/storeTime",
          "shared/reportsContract.ts",
        ],
        commands: [
          {
            kind: "raw",
            command: "bun run --filter '@athena/webapp' test -- convex/reports",
          },
          { kind: "script", script: "audit:convex" },
          { kind: "script", script: "lint:convex:changed" },
          {
            kind: "raw",
            command:
              "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
          },
          { kind: "script", script: "build" },
        ],
        note: "Use this for the reporting contract, fact ingestion, the day fold, the sweeper and its read models, custom ranges, reseed, or source-truth verification. Pair it with the owning source-domain scenario when a POS, storefront, service, payment, inventory, or Daily Close command emits new facts. Source state and inventory effects remain atomic with the command; the fold is replayable asynchronous work and must never decide operational success. The fold is the correctness authority — the open-day incremental path is only a preview of it.",
      },
      {
        id: "athena.agent-harness",
        reviewSensitive: true,
        title: "Agent harness, capability packages, and profile edits",
        touchedPaths: [
          "convex/agentHarness",
          "convex/automation/agentCapabilities",
          "convex/cashControls/agentCapabilities",
          "convex/operations/agentCapabilities",
          "convex/reports/agentCapabilities",
          "convex/stockOps/agentCapabilities",
          "convex/lib/agentCapabilityManifests.ts",
          "convex/lib/agentCapabilitySupport.ts",
          "convex/operationAdmission/delegatedAuthority.ts",
          "convex/sharedDemo/delegatedAuthority.ts",
          "convex/platform/operationAdmission.ts",
          "convex/intelligence/providers/convexAgent.ts",
          "convex.json",
          "shared/agentHarness",
          "src/components/agent",
          "src/components/operations/dailyOperationsAgentPresentation.ts",
        ],
        commands: [
          {
            kind: "raw",
            command:
              "bun run --filter '@athena/webapp' test -- convex/agentHarness shared/agentHarness convex/operationAdmission convex/platform src/components/agent",
          },
          { kind: "raw", command: "bun run agent-sdk:check" },
          { kind: "script", script: "audit:convex" },
          { kind: "script", script: "lint:convex:changed" },
          { kind: "script", script: "lint:frontend:changed" },
          {
            kind: "raw",
            command:
              "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
          },
          { kind: "script", script: "build" },
        ],
        note: 'Use this for the agent harness kernel, a domain capability package, a profile, the delegated admission ports, or the reusable agent host. Three things gate a merge here and none of them may be skipped: generated registry drift (`agent-sdk:check` refuses a stale artifact and names the regeneration command), operation-admission coverage (the checker must report zero findings and the caller table must be current), and the focused conformance, security, and data-governance suites — `releaseConformance`, `security`, `dataGovernance`, and the `evals` smoke matrix — which are what stand between a capability and an operator. Changing a read port\'s behaviour also requires bumping its `implementationVersion`, which moves the compatibility digest and therefore requires the pre-deploy fence (`bun scripts/agent-harness-fence.ts --reason "<id>"`) before the change deploys. Release itself is one switch: publish, smoke through the direct harness while the switch is off, one broad enable, watch the first turns, and disable to roll back — no cohorts, canaries, staged profile versions, or drain gates.',
      },
      {
        id: "athena.daily-store-operations",
        reviewSensitive: false,
        title: "Daily store operations lifecycle edits",
        touchedPaths: [
          "convex/operations/dailyClose.ts",
          "convex/operations/dailyOpening.ts",
          "convex/operations/dailyOperations.ts",
          "convex/schemas/operations/dailyClose.ts",
          "convex/schemas/operations/dailyOpening.ts",
          "src/components/operations/DailyCloseHistoryView.tsx",
          "src/components/operations/DailyCloseView.tsx",
          "src/components/operations/DailyOpeningView.tsx",
          "src/components/operations/DailyOperationsView.tsx",
          "src/components/app-sidebar.tsx",
          "src/routes/_authed/$orgUrlSlug/store/$storeUrlSlug/operations/index.tsx",
          "src/routes/_authed/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close-history.tsx",
          "src/routes/_authed/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close.tsx",
          "src/routes/_authed/$orgUrlSlug/store/$storeUrlSlug/operations/opening.tsx",
        ],
        commands: [
          {
            kind: "raw",
            command:
              "bun run --filter '@athena/webapp' test -- convex/operations/dailyOperations.test.ts convex/operations/dailyOpening.test.ts convex/operations/dailyClose.test.ts convex/operations/operationsQueryIndexes.test.ts src/components/operations/DailyOperationsView.test.tsx src/components/operations/DailyOpeningView.test.tsx src/components/operations/DailyCloseView.test.tsx src/components/operations/DailyCloseHistoryView.test.tsx",
          },
          { kind: "script", script: "audit:convex" },
          { kind: "script", script: "lint:convex:changed" },
          { kind: "script", script: "lint:frontend:changed" },
          {
            kind: "raw",
            command:
              "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
          },
          { kind: "script", script: "build" },
        ],
        behaviorScenarios: ["athena-admin-shell-boot"],
        note: "Use this when Daily Opening, Daily Close, or the store-day operations route wiring changes. It validates the backend readiness gates, operator-facing acknowledgement views, generated Convex API surface, and route tree before broader package validation.",
      },
      {
        id: "athena.stock-ops-procurement",
        reviewSensitive: false,
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
            command:
              "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
          },
          { kind: "script", script: "build" },
        ],
        behaviorScenarios: ["athena-admin-shell-boot"],
        note: "Use this when stock adjustments, procurement recommendations, purchase-order lifecycle changes, or receiving route wiring move. Run `bunx convex dev --once` from `packages/athena-webapp` before validation when generated client refs or new stockOps function exports changed.",
      },
      {
        id: "athena.cash-controls",
        reviewSensitive: true,
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
              "bun run --filter '@athena/webapp' test -- convex/cashControls/registerSessions.test.ts convex/cashControls/closeouts.test.ts convex/cashControls/deposits.test.ts src/components/cash-controls/CashControlsDashboard.test.tsx src/components/cash-controls/RegisterSessionView.test.tsx src/components/operations/OperationsQueueView.test.tsx",
          },
          {
            kind: "raw",
            command:
              "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
          },
          { kind: "script", script: "build" },
        ],
        behaviorScenarios: ["athena-admin-shell-boot"],
        note: "Use this when register-session, deposit, closeout, dashboard, operations-queue approval, or cash-controls route wiring changes. This is the confirmation slice for drawers opened from POS showing up in the dashboard and register-session detail views. Run `bunx convex dev --once` from `packages/athena-webapp` before validation when generated client refs or new Convex function exports changed.",
      },
      {
        id: "athena.pos-item-adjustment",
        reviewSensitive: true,
        title: "POS transaction item-adjustment reporting edits",
        touchedPaths: [
          "convex/pos/application/commands",
          "convex/pos/application/corrections",
          "convex/pos/infrastructure/repositories/transactionRepository.ts",
          "convex/schemas/pos",
          "convex/operations/dailyClose.ts",
          "convex/operations/dailyOperations.ts",
          "src/components/cash-controls/RegisterSessionView.tsx",
          "src/components/pos/transactions/TransactionView.tsx",
          "src/components/operations/OperationsQueueView.tsx",
        ],
        commands: [
          {
            kind: "raw",
            command:
              "bun run --filter '@athena/webapp' test -- convex/operations/dailyClose.test.ts convex/operations/dailyOperations.test.ts convex/pos/application/completeTransaction.test.ts convex/pos/application/correctTransactionPaymentMethod.test.ts convex/pos/application/transactionAdjustmentPlanner.test.ts convex/pos/application/adjustTransactionItems.test.ts convex/pos/application/transactionAdjustments.test.ts convex/pos/application/getTransactions.test.ts convex/pos/public/transactions.test.ts src/components/cash-controls/RegisterSessionView.test.tsx src/components/pos/transactions/TransactionView.test.tsx src/components/operations/OperationsQueueView.test.tsx",
          },
          { kind: "script", script: "audit:convex" },
          { kind: "script", script: "lint:convex:changed" },
          { kind: "script", script: "lint:frontend:changed" },
          {
            kind: "raw",
            command:
              "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
          },
          { kind: "script", script: "build" },
        ],
        behaviorScenarios: ["athena-admin-shell-boot"],
        note: "Use this when completed-transaction item adjustments, adjustment approval/application, transaction detail adjustment history, daily close/operations adjusted totals, or cash-control settlement display changes. It keeps original sale totals and explicit adjusted/net settlement fields covered together.",
      },
      {
        id: "athena.pos-mixed-checkout",
        reviewSensitive: true,
        title: "POS service mixed-checkout edits",
        touchedPaths: [
          "convex/pos/application/commands/completeTransaction.ts",
          "convex/pos/application/commands/correctTransaction.ts",
          "convex/pos/application/queries/getTransactions.ts",
          "convex/pos/application/sync",
          "convex/pos/public/transactions.ts",
          "convex/operations/dailyClose.ts",
          "convex/cashControls",
          "convex/serviceOps",
          "shared/posLocalSyncContract.ts",
          "src/components/pos/OrderSummary.tsx",
          "src/components/pos/register/RegisterCheckoutPanel.tsx",
          "src/components/pos/receipt/PosReceiptShareControl.tsx",
          "src/components/pos/transactions",
          "src/components/services/ServiceCasesView.tsx",
          "src/components/operations/CommandApprovalDialog.tsx",
          "src/lib/pos/infrastructure/local",
          "src/lib/pos/presentation/register",
        ],
        commands: [
          {
            kind: "raw",
            command:
              "bun run --filter '@athena/webapp' test -- convex/pos/application/completeTransaction.test.ts convex/pos/application/getTransactions.test.ts convex/pos/public/transactions.test.ts convex/operations/dailyClose.test.ts convex/cashControls/registerSessions.test.ts src/components/pos/OrderSummary.test.tsx src/components/pos/register/RegisterCheckoutPanel.test.tsx src/components/pos/receipt/PosReceiptShareControl.test.tsx src/components/pos/transactions/TransactionView.test.tsx src/components/pos/transactions/TransactionsView.test.tsx src/components/services/ServiceCasesView.test.tsx src/components/operations/CommandApprovalDialog.test.tsx src/lib/pos/infrastructure/local/localPosReadiness.test.ts src/lib/pos/infrastructure/local/posLocalStore.test.ts src/lib/pos/infrastructure/local/usePosLocalSyncRuntime.test.ts",
          },
          { kind: "script", script: "audit:convex" },
          { kind: "script", script: "lint:convex:changed" },
          { kind: "script", script: "lint:frontend:changed" },
          {
            kind: "raw",
            command:
              "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
          },
          { kind: "script", script: "build" },
        ],
        behaviorScenarios: ["athena-admin-shell-boot"],
        note: "Use this when POS service mixed checkout changes receipts, transaction read models, service-case payment context, service catalog local readiness, payment allocation splits, daily close/cash-control reporting, or mixed-sale void guardrails. It preserves the split between retail add-ons and service material usage while confirming drawer tender is counted once.",
      },
      {
        id: "athena.service-operations",
        reviewSensitive: false,
        title: "Service operations intake, catalog, appointments, and cases",
        touchedPaths: [
          "convex/serviceOps",
          "convex/operations/serviceIntake.ts",
          "src/components/services",
          "src/components/operations/OperationsQueueView.tsx",
          "src/routes/_authed/$orgUrlSlug/store/$storeUrlSlug/services",
        ],
        commands: [
          {
            kind: "raw",
            command:
              "bun run --filter '@athena/webapp' test -- convex/serviceOps/serviceCases.test.ts convex/serviceOps/catalogAppointments.test.ts convex/serviceOps/moduleWiring.test.ts convex/operations/serviceIntake.test.ts src/components/services/ServiceIntakeView.test.tsx src/components/services/ServiceIntakeView.auth.test.tsx src/components/services/ServiceAppointmentsView.test.tsx src/components/services/ServiceCasesView.test.tsx src/components/services/ServiceCatalogView.test.tsx src/components/operations/OperationsQueueView.test.tsx",
          },
          { kind: "script", script: "audit:convex" },
          { kind: "script", script: "lint:convex:changed" },
          {
            kind: "raw",
            command:
              "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
          },
          { kind: "script", script: "build" },
        ],
        note: "Use this when service intake, catalog management, appointment scheduling, service-case execution, or manager-queue service handoffs change. It validates the command-result service flows plus the operator-facing intake, appointments, active-cases, catalog, and queue surfaces together before broader package validation.",
      },
      {
        id: "athena.auth-staff-store-configuration",
        reviewSensitive: true,
        title: "Auth, staff, and store-configuration edits",
        touchedPaths: [
          "convex/inventory/auth.ts",
          "convex/inventory/stores.ts",
          "convex/operations/staffCredentials.ts",
          "convex/operations/staffProfiles.ts",
          "convex/schema.ts",
          "convex/inventory/posSessions.ts",
          "convex/pos/application/queries/getRegisterState.ts",
          "convex/pos/infrastructure/repositories/cashierRepository.ts",
          "src/routes/login/_layout.tsx",
          "src/components/staff/StaffManagement.tsx",
          "src/components/store-configuration",
          "src/components/pos/CashierAuthDialog.tsx",
          "src/lib/pos/application/results.ts",
          "src/lib/pos/presentation/register/useRegisterViewModel.ts",
        ],
        commands: [
          {
            kind: "raw",
            command:
              "bun run --filter '@athena/webapp' test -- src/routes/login/_layout.test.tsx convex/operations/staffCredentials.test.ts convex/operations/staffProfiles.test.ts convex/inventory/sessionQueryIndexes.test.ts convex/pos/application/sessionCommands.test.ts convex/pos/application/completeTransaction.test.ts convex/pos/application/getTransactions.test.ts convex/pos/infrastructure/repositories/sessionRepository.test.ts convex/pos/application/getRegisterState.test.ts convex/inventory/posSessions.trace.test.ts convex/pos/application/posSessionTracing.test.ts src/lib/pos/infrastructure/convex/sessionGateway.test.ts src/lib/pos/infrastructure/convex/registerGateway.test.ts src/components/pos/CashierAuthDialog.test.tsx src/components/pos/register/POSRegisterView.test.tsx src/lib/pos/presentation/register/useRegisterViewModel.test.ts src/components/pos/transactions/TransactionView.test.tsx src/components/staff/StaffManagement.test.tsx src/components/store-configuration/hooks/useStoreConfigUpdate.test.tsx src/components/store-configuration/components/FulfillmentView.test.tsx src/components/store-configuration/components/MaintenanceView.test.tsx src/components/store-configuration/components/MtnMomoView.test.tsx",
          },
          {
            kind: "raw",
            command:
              "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
          },
          { kind: "script", script: "build" },
        ],
        note: "Use this when login auth sync, store staff identity, admin store-configuration mutations, or cashier-auth command handling changes. It validates the retryable auth-sync path, the staff credential rules, the staff-management surface, the shared store-configuration hook plus fulfillment/maintenance/MTN MoMo regressions, and the register and cashier-auth flows that now share `staffProfileId` instead of the deleted cashier model.",
      },
      {
        id: "athena.expense-session-cart",
        reviewSensitive: false,
        title: "Expense-session and cart flow edits",
        touchedPaths: [
          "convex/inventory/expenseSessions.ts",
          "convex/inventory/expenseSessionItems.ts",
          "convex/inventory/expenseTransactions.ts",
          "src/hooks/useExpenseSessions.ts",
          "src/hooks/useExpenseOperations.ts",
          "src/hooks/useSessionManagementExpense.ts",
          "src/components/expense/ExpenseView.tsx",
          "src/components/expense/ExpenseCompletion.tsx",
          "src/stores/expenseStore.ts",
          "types.ts",
        ],
        commands: [
          {
            kind: "raw",
            command:
              "bun run --filter '@athena/webapp' test -- convex/inventory/expenseSessions.test.ts convex/inventory/sessionQueryIndexes.test.ts src/hooks/useExpenseSessions.test.ts",
          },
          {
            kind: "raw",
            command:
              "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
          },
          { kind: "script", script: "build" },
        ],
        note: "Use this when expense-session lifecycle, expense cart items, expense transaction finalization, or expense session hooks change. It validates the command-result expense session mutations plus the browser-facing session and cart hooks that now collapse expected failures to safe user-facing copy.",
      },
      {
        id: "athena.omnichannel-order-refund",
        reviewSensitive: true,
        title: "Omnichannel order, refund, review, and customer-history edits",
        touchedPaths: [
          "convex/storeFront/onlineOrder.ts",
          "convex/storeFront/onlineOrderUtilFns.ts",
          "convex/storeFront/payment.ts",
          "convex/storeFront/reviews.ts",
          "convex/storeFront/helpers/returnExchangeOperations.ts",
          "convex/storeFront/helpers/customerEngagementEvents.ts",
          "convex/storeFront/customerBehaviorTimeline.ts",
          "convex/storeFront/customerObservabilityTimelineData.ts",
          "src/components/orders",
          "src/components/reviews",
          "src/components/users/CustomerBehaviorTimeline.tsx",
          "src/components/users/TimelineEventCard.tsx",
          "src/routes/_authed/$orgUrlSlug/store/$storeUrlSlug/orders",
          "src/routes/_authed/$orgUrlSlug/store/$storeUrlSlug/reviews",
        ],
        commands: [
          {
            kind: "raw",
            command:
              "bun run --filter '@athena/webapp' test -- convex/storeFront/errorFoundation.test.ts convex/storeFront/orderOperations.test.ts convex/storeFront/returnExchangeOperations.test.ts convex/storeFront/customerBehaviorTimeline.test.ts convex/storeFront/customerObservabilityTimeline.test.ts convex/storeFront/helpers/customerEngagementEvents.test.ts src/components/orders/ReturnExchangeView.test.tsx src/components/users/TimelineEventCard.test.tsx",
          },
          { kind: "script", script: "audit:convex" },
          { kind: "script", script: "lint:convex:changed" },
          {
            kind: "raw",
            command:
              "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
          },
          { kind: "script", script: "build" },
        ],
        behaviorScenarios: [
          "athena-convex-storefront-composition",
          "athena-convex-storefront-failure-visibility",
        ],
        note: "Use this when order updates, refunds, return-exchange execution, review moderation, feedback-request messaging, or customer-history presentation changes. It validates the migrated storefront command-result surfaces plus the operator-facing order, review, and customer-history views before broader package validation. Run `bunx convex dev --once` from `packages/athena-webapp` before validation when generated client refs or new storefront function exports changed.",
      },
      {
        id: "athena.workflow-trace-foundation",
        reviewSensitive: false,
        title:
          "Workflow trace foundation, POS local sync/register, and trace-link edits",
        touchedPaths: [
          "convex/workflowTraces",
          "convex/schemas/observability",
          "convex/pos/application/sync",
          "convex/pos/application/commands/terminals.ts",
          "convex/pos/application/commands/completeTransaction.ts",
          "convex/pos/application/commands/posSessionTracing.ts",
          "convex/pos/application/queries/getTransactions.ts",
          "convex/pos/public/sync.ts",
          "convex/pos/public/terminals.ts",
          "convex/pos/public/transactions.ts",
          "convex/pos/infrastructure/repositories/localSyncRepository.ts",
          "convex/inventory/posSessions.ts",
          "convex/operations/registerSessionTracing.ts",
          "convex/operations/registerSessions.ts",
          "convex/cashControls/closeouts.ts",
          "convex/cashControls/deposits.ts",
          "convex/schemas/pos/posLocalSyncConflict.ts",
          "convex/schemas/pos/posLocalSyncEvent.ts",
          "convex/schemas/pos/posLocalSyncMapping.ts",
          "convex/schemas/pos/posTransaction.ts",
          "shared/posLocalSyncContract.ts",
          "shared/workflowTrace.ts",
          "src/components/traces",
          "src/components/pos/PointOfSaleView.tsx",
          "src/components/pos/SessionManager.tsx",
          "src/components/pos/register",
          "src/components/pos/session/HeldSessionsList.tsx",
          "src/components/pos/transactions",
          "src/hooks/useGetTerminal.ts",
          "src/lib/pos/infrastructure/local",
          "src/lib/pos/presentation/register",
          "src/lib/pos/presentation/syncStatusPresentation.ts",
          "src/components/cash-controls/CashControlsDashboard.tsx",
          "src/components/cash-controls/RegisterSessionView.tsx",
          "src/routes/_authed/$orgUrlSlug/store/$storeUrlSlug/traces",
        ],
        commands: [
          {
            kind: "raw",
            command:
              "bun run --filter '@athena/webapp' test -- convex/workflowTraces/presentation.test.ts convex/workflowTraces/queryUsage.test.ts convex/workflowTraces/schemaIndexes.test.ts convex/workflowTraces/adapters/posSession.test.ts convex/workflowTraces/adapters/registerSession.test.ts convex/pos/application/completeTransaction.test.ts convex/pos/application/getTransactions.test.ts convex/pos/application/posSessionTracing.test.ts convex/pos/application/terminals.test.ts convex/pos/application/sync/ingestLocalEvents.test.ts convex/pos/application/sync/projectLocalEvents.test.ts convex/pos/public/sync.test.ts convex/pos/public/terminals.test.ts convex/inventory/posSessions.trace.test.ts convex/operations/registerSessionTracing.test.ts convex/operations/registerSessions.trace.test.ts convex/cashControls/registerSessionTraceLifecycle.test.ts src/components/traces/WorkflowTraceView.test.tsx 'src/routes/_authed/$orgUrlSlug/store/$storeUrlSlug/traces/$traceId.test.tsx' src/components/pos/PointOfSaleView.test.tsx src/components/pos/transactions/transactionColumns.test.tsx src/components/pos/transactions/TransactionView.test.tsx src/components/pos/transactions/TransactionsView.test.tsx src/components/pos/SessionManager.test.tsx src/components/pos/register/POSRegisterOpeningGuard.test.tsx src/components/pos/register/POSRegisterView.test.tsx src/components/pos/session/HeldSessionsList.test.tsx src/hooks/useGetTerminal.test.ts src/lib/pos/infrastructure/local/localPosEntryContext.test.ts src/lib/pos/infrastructure/local/localPosReadiness.test.ts src/lib/pos/infrastructure/local/posLocalStore.test.ts src/lib/pos/infrastructure/local/syncContract.test.ts src/lib/pos/infrastructure/local/syncScheduler.test.ts src/lib/pos/infrastructure/local/syncStatus.test.ts src/lib/pos/infrastructure/local/usePosLocalSyncRuntime.test.ts src/lib/pos/infrastructure/local/registerReadModel.test.ts src/lib/pos/infrastructure/local/localCommandGateway.test.ts src/lib/pos/presentation/register/useRegisterViewModel.test.ts src/components/cash-controls/CashControlsDashboard.test.tsx src/components/cash-controls/RegisterSessionView.test.tsx src/lib/traces/createWorkflowTraceId.test.ts",
          },
          { kind: "script", script: "test:timing-parity" },
          { kind: "script", script: "audit:convex" },
          { kind: "script", script: "lint:convex:changed" },
          {
            kind: "raw",
            command:
              "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
          },
          { kind: "script", script: "build" },
        ],
        behaviorScenarios: [
          "athena-admin-shell-boot",
          "athena-convex-storefront-composition",
          "athena-convex-storefront-failure-visibility",
        ],
        note: "Use this when the shared workflow-trace or POS local sync contract, POS local sync repository, POS local-first sync/storage/read-model/command-gateway files, terminal seed lookup, POS local entry/readiness files, the POS register bootstrap or drawer gate, the `pos_session` / `register_session` trace writers, the trace route/view, or POS register, transaction, and cash-controls trace entry points change. It exercises the trace schema and presentation contract, the session/register trace writers, local sync ingestion/projection/repository/read-model adjacency, POS entry/readiness gating, the drawer-open bootstrap handoff, the shared trace route, terminal fallback behavior, and the operator-facing POS and cash-controls surfaces before broader package validation. `test:timing-parity` re-runs the POS suites with every scheduled delay multiplied (`ATHENA_TEST_TIMER_LAG`), which is the only local sensor that reproduces the timing skew of the CI coverage run: it is where `await waitFor(positive)` followed by `expect(...).not.toHaveBeenCalled()` gets caught, because the awaited work keeps advancing between the poll and the negative assertion.",
      },
      {
        id: "athena.pos-app-session-continuity",
        reviewSensitive: true,
        title: "POS hub app-session continuity edits",
        touchedPaths: [
          "convex/pos/public/terminalAppSessions.ts",
          "convex/pos/public/terminals.ts",
          "convex/pos/application/commands/terminals.ts",
          "convex/schemas/pos/posTerminalRuntimeStatus.ts",
          "src/routes/_authed.tsx",
          "src/components/pos/PointOfSaleView.tsx",
          "src/lib/pos/infrastructure/terminal/usePosTerminalAppSessionRecovery.ts",
          "src/lib/pos/infrastructure/terminal/posTerminalAppSessionRecoveryContext.tsx",
          "src/lib/pos/infrastructure/local/usePosLocalSyncRuntime.ts",
          "src/lib/pos/infrastructure/local/terminalRuntimeStatus.ts",
        ],
        commands: [
          {
            kind: "raw",
            command:
              "bun run --filter '@athena/webapp' test -- src/routes/_authed.test.tsx convex/pos/public/terminalAppSessions.test.ts src/lib/pos/infrastructure/terminal/usePosTerminalAppSessionRecovery.test.ts convex/pos/application/terminals.test.ts convex/pos/public/terminals.test.ts src/lib/pos/infrastructure/local/usePosLocalSyncRuntime.test.ts src/components/pos/PointOfSaleView.test.tsx",
          },
          { kind: "script", script: "audit:convex" },
          { kind: "script", script: "lint:convex:changed" },
          { kind: "script", script: "lint:frontend:changed" },
          {
            kind: "raw",
            command:
              "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
          },
          { kind: "script", script: "build" },
        ],
        behaviorScenarios: ["athena-admin-shell-boot"],
        note: "Use this when POS hub app-session recovery, route-shell continuity, terminal recovery validation, or app-session diagnostics change. It proves the recovery assertion stays POS-hub scoped, non-POS routes still require normal app auth, server validation rejects unsafe scopes, recovery retries stay bounded, terminal diagnostics redact raw recovery data, and sale authority still depends on terminal integrity, drawer authority, local command invariants, and staff proof.",
      },
      {
        id: "athena.pos-offline-route-access",
        reviewSensitive: true,
        title: "POS offline route access and app-shell edits",
        touchedPaths: [
          "public/pos-app-shell-sw.js",
          "playwright.config.ts",
          "playwright.prod.config.ts",
          "src/main.tsx",
          "src/offline",
          "src/routes/_authed.tsx",
          "src/routes/_authed/$orgUrlSlug/store/$storeUrlSlug/pos",
          "src/components/pos/PointOfSaleView.tsx",
          "src/components/pos/register",
          "src/components/pos/settings/POSSettingsView.tsx",
          "src/components/pos/terminals/POSTerminalHealthView.tsx",
          "src/lib/pos/infrastructure/local",
          "src/lib/pos/presentation/register",
          "src/tests/pos/offlineRouteAccess.spec.ts",
          "src/tests/pos/offlineSalesContinuity.spec.ts",
          "src/tests/prod/posFlow.prod.spec.ts",
        ],
        commands: [
          {
            kind: "raw",
            command:
              "bun run --filter '@athena/webapp' test -- src/offline/posAppShellRoutes.test.ts src/offline/registerPosAppShellServiceWorker.test.ts src/offline/posOfflineReadiness.test.ts src/routes/_authed.test.tsx src/components/pos/PointOfSaleView.test.tsx src/components/pos/settings/POSSettingsView.test.tsx src/components/pos/terminals/POSTerminalHealthView.test.tsx src/components/pos/register/POSRegisterOpeningGuard.test.tsx src/lib/pos/presentation/register/useRegisterViewModel.test.ts",
          },
          {
            kind: "raw",
            command:
              "bun run --filter '@athena/webapp' test:e2e -- src/tests/pos/offlineRouteAccess.spec.ts src/tests/pos/offlineSalesContinuity.spec.ts",
          },
          {
            kind: "raw",
            command: "bun run --filter '@athena/webapp' test:e2e:prod:pos",
          },
          {
            kind: "raw",
            command:
              "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
          },
          { kind: "script", script: "build" },
        ],
        note: "Use this when POS service-worker app-shell caching, POS-only offline route entry, offline readiness diagnostics, or hard-reload register continuity changes. Cache Storage must stay limited to static shell assets; POS business state, staff authority, cart events, payments, and catalog snapshots remain in IndexedDB/local POS stores.",
      },
      {
        id: "athena.app-update-readiness",
        reviewSensitive: false,
        title: "App update readiness and apply-safety edits",
        touchedPaths: [
          "public/pos-app-shell-sw.js",
          "src/main.tsx",
          "src/routes/__root.tsx",
          "src/lib/app-update",
          "src/components/app-update",
          "src/utils/versionChecker.ts",
          "src/offline/posAppShellRoutes.ts",
          "src/components/operations/InventoryImportView.tsx",
          "src/components/operations/InventoryImportView.test.tsx",
          "src/components/pos/register/POSRegisterView.tsx",
          "src/components/pos/register/POSRegisterView.test.tsx",
          "src/lib/pos/presentation/register/registerUiState.ts",
          "src/lib/pos/presentation/register/useRegisterViewModel.ts",
          "src/lib/pos/presentation/register/useRegisterViewModel.test.ts",
        ],
        commands: [
          {
            kind: "raw",
            command:
              "bun run --filter '@athena/webapp' test -- src/lib/app-update/updateCoordinator.test.ts src/lib/app-update/updateAssetStaging.test.ts src/lib/app-update/updateDetectionSequencer.test.ts src/utils/versionChecker.test.ts src/components/app-update/UpdateReadyBanner.test.tsx src/offline/posAppShellRoutes.test.ts src/offline/posAppShellServiceWorkerStaging.test.ts src/offline/registerPosAppShellServiceWorker.test.ts src/offline/posOfflineReadiness.test.ts src/lib/pos/presentation/register/registerUiState.test.ts src/lib/pos/presentation/register/useRegisterViewModel.test.ts src/components/pos/register/POSRegisterView.test.tsx src/components/operations/InventoryImportView.test.tsx",
          },
          {
            kind: "raw",
            command:
              "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
          },
          { kind: "script", script: "build" },
        ],
        note: "Use this when app update detection, Update Ready UI, cross-tab apply blockers, service-worker static update staging, POS update blockers, or Inventory Import update blockers change. Version detection must not reload automatically; surfaces should opt in only while active work, commands, or resumability risk make refresh unsafe.",
      },
      {
        id: "athena.pos-terminal-health",
        reviewSensitive: false,
        title: "POS terminal health visibility and diagnostics edits",
        touchedPaths: [
          "convex/schemas/pos/posTerminal.ts",
          "convex/schemas/pos/posTerminalRuntimeStatus.ts",
          "convex/pos/application/commands/terminals.ts",
          "convex/pos/application/queries/terminals.ts",
          "convex/pos/application/terminalRecovery",
          "convex/pos/infrastructure/repositories/terminalRepository.ts",
          "convex/pos/infrastructure/repositories/terminalRecoveryRepository.ts",
          "convex/pos/public/terminals.ts",
          "convex/schemas/pos/posTerminalRecovery.ts",
          "convex/inventory/posTerminal.ts",
          "src/components/pos/settings/POSSettingsView.tsx",
          "src/hooks/useGetTerminal.ts",
          "src/lib/pos/application/registerAndProvisionPosTerminal.ts",
          "src/lib/pos/infrastructure/terminal",
          "src/lib/pos/infrastructure/local/terminalRecoveryCommands.ts",
          "src/lib/pos/infrastructure/local/terminalRuntimeStatus.ts",
          "src/lib/pos/infrastructure/local/usePosLocalSyncRuntime.ts",
          "src/lib/pos/presentation/syncStatusPresentation.ts",
          "src/components/pos/register/POSRegisterView.tsx",
          "src/components/pos/terminals",
          "src/routes/_authed/$orgUrlSlug/store/$storeUrlSlug/pos/terminals",
          "src/components/cash-controls/CashControlsDashboard.tsx",
          "src/components/cash-controls/RegisterSessionView.tsx",
        ],
        commands: [
          {
            kind: "raw",
            command:
              "bun run --filter '@athena/webapp' test -- convex/schemas/pos/posTerminal.test.ts convex/pos/application/terminals.test.ts convex/pos/application/terminalRecovery/cloudRepairPolicy.test.ts convex/pos/application/terminalRecovery/terminalCommandService.test.ts convex/pos/infrastructure/repositories/terminalRepository.test.ts convex/pos/infrastructure/repositories/terminalRecoveryRepository.test.ts convex/pos/public/terminals.test.ts src/components/pos/settings/POSSettingsView.test.tsx src/hooks/useGetTerminal.test.ts src/lib/pos/infrastructure/local/terminalRecoveryCommands.test.ts src/lib/pos/infrastructure/local/terminalRuntimeStatus.test.ts src/lib/pos/infrastructure/local/usePosLocalSyncRuntime.test.ts src/lib/pos/infrastructure/local/posLocalStore.test.ts src/lib/pos/infrastructure/local/localCommandGateway.test.ts src/lib/pos/infrastructure/local/registerReadModel.test.ts src/lib/pos/presentation/syncStatusPresentation.test.ts src/components/pos/register/POSRegisterView.test.tsx src/components/pos/terminals/terminalHealthPresentation.test.ts src/components/pos/terminals/POSTerminalHealthView.test.tsx src/components/pos/terminals/POSTerminalDetailView.test.tsx 'src/routes/_authed/$orgUrlSlug/store/$storeUrlSlug/pos/terminals.route.test.tsx' src/components/cash-controls/CashControlsDashboard.test.tsx src/components/cash-controls/RegisterSessionView.test.tsx",
          },
          { kind: "script", script: "audit:convex" },
          { kind: "script", script: "lint:convex:changed" },
          { kind: "script", script: "lint:frontend:changed" },
          {
            kind: "raw",
            command:
              "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
          },
          { kind: "script", script: "build" },
        ],
        behaviorScenarios: ["athena-admin-shell-boot"],
        note: "Use this when POS terminal registration, terminal runtime status, browser-side health publisher/readout, terminal recovery commands, terminal setup/detail UI, POS support diagnostics, or cash-controls terminal evidence changes. Stale or pending terminal check-ins are telemetry and should stay out of manager-review queues; unresolved local sync conflicts remain the source of needs-review copy. Browser-local terminal recovery must be verified by a fresh runtime check-in before support treats a terminal as healthy.",
      },
      {
        id: "athena.shared-lib-utility",
        reviewSensitive: false,
        title: "Shared-lib or utility edits",
        touchedPaths: [
          "src/lib",
          "shared",
          "src/settings",
          "src/utils",
          "src/stores",
          "types.ts",
        ],
        commands: [
          { kind: "script", script: "test" },
          {
            kind: "raw",
            command:
              "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
          },
        ],
        note: "Reach for the package suite first, then typecheck when helpers or shared state can affect many call sites.",
      },
      {
        id: "athena.client-server-error-foundation",
        reviewSensitive: false,
        title: "Client/server error foundation edits",
        touchedPaths: [
          "shared/commandResult.ts",
          "src/lib/errors",
          "src/lib/errors/presentUnexpectedErrorToast.ts",
          "src/lib/errors/presentUnexpectedErrorToast.test.ts",
          "src/components/auth/DefaultCatchBoundary.tsx",
          "src/components/auth/DefaultCatchBoundary.test.tsx",
          "src/routeTree.browser-boundary.test.ts",
        ],
        commands: [
          {
            kind: "raw",
            command:
              "bun run --filter '@athena/webapp' test -- shared/commandResult.test.ts src/lib/errors/runCommand.test.ts src/lib/errors/presentCommandToast.test.ts src/lib/errors/presentUnexpectedErrorToast.test.ts src/components/auth/DefaultCatchBoundary.test.tsx src/routeTree.browser-boundary.test.ts",
          },
          {
            kind: "raw",
            command:
              "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
          },
          { kind: "script", script: "build" },
        ],
        note: "Use this when the shared command-result contract, client command normalizers, generic catch boundary, or browser import boundary changes. Expected failures must stay in browser-safe `user_error` results, thrown faults must collapse to generic fallback copy, and shared modules must not import raw Convex server files into the browser tree.",
      },
      {
        id: "athena.admin-quick-action-toast",
        reviewSensitive: false,
        title: "Admin quick-action unexpected-toast fallback edits",
        touchedPaths: [
          "src/components/add-product",
          "src/components/assets",
          "src/components/join-team",
          "src/components/organization-members",
          "src/components/promo-codes",
          "src/lib/errors/presentUnexpectedErrorToast.ts",
          "src/lib/errors/presentUnexpectedErrorToast.test.ts",
          "src/settings/organization",
          "src/settings/store",
        ],
        commands: [
          {
            kind: "raw",
            command:
              "bun run --filter '@athena/webapp' test -- src/lib/errors/presentUnexpectedErrorToast.test.ts src/components/join-team/index.test.tsx src/components/promo-codes/PromoCodeHeader.test.tsx",
          },
          {
            kind: "raw",
            command:
              "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
          },
          { kind: "script", script: "build" },
        ],
        note: "Use this when admin quick actions still resolve through toast-only UX. Preserve any explicit business-validation copy returned by the surface, but route unexpected failures through the shared generic unexpected-error fallback so raw backend text never reaches the browser.",
      },
      {
        id: "athena.frontend-test-harness",
        reviewSensitive: false,
        title: "Frontend test harness edits",
        touchedPaths: ["src/test", "src/tests", "vitest.setup.ts", ".env.test"],
        commands: [
          { kind: "script", script: "test" },
          { kind: "script", script: "test:timing-parity" },
        ],
        note: "Run the package suite when package-local frontend test helpers, focused regression tests, or the test-mode env file change. `vitest.setup.ts` also owns the opt-in `ATHENA_TEST_TIMER_LAG` shim behind `test:timing-parity`, so run that sensor too when the setup file changes.",
      },
      {
        id: "athena.convex-backend-adjacent",
        reviewSensitive: false,
        title: "Convex or backend-adjacent edits",
        touchedPaths: [
          "convex",
          "scripts/convex-audit.sh",
          "scripts/convex-lint-changed.sh",
          "scripts/convexPaginationAntiPatternCheck.py",
          "scripts/empty-table.json",
          "scripts/purge-reporting-dev.sh",
          "src/routes/_authed",
          "src/main.tsx",
        ],
        commands: [
          { kind: "raw", command: "bun run dependency:check:backend" },
          { kind: "script", script: "test" },
          { kind: "script", script: "audit:convex" },
          { kind: "script", script: "lint:convex:changed" },
        ],
        behaviorScenarios: [
          "athena-convex-storefront-composition",
          "athena-convex-storefront-failure-visibility",
        ],
        note: "Any change that can affect Convex HTTP wiring, serviceOps schemas and workflows, shared operational rails, reporting maintenance scripts, or route-to-backend composition should include the Convex audit pair. The shrink-only backend dependency guard runs (`bun run dependency:check:backend`) whenever Convex sources change: it snapshots backend import cycles and kernel-boundary violations against a committed baseline, blocks new cycles/violations, and treats baseline removals as drift until the baseline is regenerated (`--update-baseline` is shrink-only, so it cannot absorb new violations). When a public Convex function with an explicit `returns` validator changes, add executable return-contract proof with `assertConformsToExportedReturns`; loose `exportReturns()` string checks do not prove the production return contract. Convex query handlers must not reach mutation-only DB APIs directly or through write-capable repositories/services; split read factories from `MutationCtx`-only write factories when shared code crosses query and mutation boundaries.",
      },
      {
        id: "athena.route-runtime-build",
        reviewSensitive: false,
        title: "Route runtime or build-pipeline edits",
        touchedPaths: [
          "src/main.tsx",
          "src/routeTree.gen.ts",
          "src/routeTree.browser-boundary.test.ts",
          "bunfig.toml",
          "vitest.config.ts",
          "vite.config.ts",
          "vite-docs-content-plugin.ts",
          "tsconfig.json",
        ],
        commands: [
          {
            kind: "raw",
            command:
              "bun run --filter '@athena/webapp' test -- src/routeTree.browser-boundary.test.ts",
          },
          {
            kind: "raw",
            command:
              "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
          },
          { kind: "script", script: "build" },
        ],
        behaviorScenarios: ["athena-admin-shell-boot"],
        note: "Run these when bootstrap, generated router state, or package build configuration changes so browser-entry regressions fail before the route tree reaches Arc. `bunfig.toml` only preloads the repo-root `bun test` runner guard, so a change there must still leave the package Vitest suite running normally.",
      },
      {
        id: "athena.storybook-frontend-tooling",
        reviewSensitive: false,
        title: "Storybook and frontend tooling edits",
        touchedPaths: [
          ".storybook",
          "index.html",
          "public/favicon.svg",
          "public/favicon-16x16.png",
          "public/favicon-32x32.png",
          "public/apple-touch-icon.png",
          "public/android-chrome-192x192.png",
          "public/android-chrome-512x512.png",
          "public/site.webmanifest",
          "src/stories",
          "src/index.css",
          "src/design-system-build-config.test.ts",
          "tailwind.config.js",
          "postcss.config.js",
          "package.json",
          "README.md",
          "eslint.config.js",
          "scripts/frontend-lint-changed.sh",
          "scripts/capture-operations-shot.mjs",
          "scripts/capture-hero-shot.mjs",
          "scripts/capture-register-shot.mjs",
          ".gitignore",
        ],
        commands: [
          { kind: "script", script: "test" },
          { kind: "script", script: "build" },
          { kind: "script", script: "storybook:build" },
        ],
        note: "Use this when the document shell, favicon and web-manifest assets, Storybook config, story files, package-level frontend tooling, or the operations/landing screenshot capture scripts change need isolated validation.",
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
    harnessDocs: buildHarnessDocPathsForArchetype(
      "packages/storefront-webapp",
      "webapp",
    ),
    keyFolderGroups: [
      {
        title: "Core app surfaces",
        folders: [
          {
            path: "src/routes",
            description:
              "TanStack Router routes, layouts, and browser journey entrypoints.",
          },
          {
            path: "src/components",
            description:
              "Reusable storefront UI and feature-specific checkout/catalog components.",
          },
          {
            path: "src/hooks",
            description:
              "Client hooks for bag, routing, observability, and auth interactions.",
          },
          {
            path: "src/contexts",
            description:
              "Shared client providers for store, navigation, and observability state.",
          },
          {
            path: "src/lib",
            description:
              "Shared utilities, query helpers, schemas, and domain logic.",
          },
          {
            path: "src/api",
            description:
              "Backend-facing request wrappers and typed API helpers.",
          },
        ],
      },
      {
        title: "Validation and support surfaces",
        folders: [
          {
            path: "tests/e2e",
            description:
              "Playwright browser journeys and redirect/payment coverage.",
          },
          {
            path: "src/utils",
            description:
              "Lower-level runtime helpers used across route and API code.",
          },
        ],
      },
    ],
    validationScenarios: [
      {
        id: "storefront.route-ui",
        reviewSensitive: false,
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
        id: "storefront.route-runtime-build",
        reviewSensitive: false,
        title: "Route runtime or build-pipeline edits",
        touchedPaths: [
          "index.html",
          "package.json",
          "tsconfig.json",
          "bunfig.toml",
          "src/main.tsx",
          "src/router.tsx",
          "src/routeTree.gen.ts",
          "vitest.config.ts",
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
        behaviorScenarios: ["storefront-backend-first-load"],
        note: "Use this when the Vite browser bootstrap, package manifest, generated router state, or TypeScript/build wiring changes. `bunfig.toml` only preloads the repo-root `bun test` runner guard, so a change there must still leave the package Vitest suite running normally.",
      },
      {
        id: "storefront.shared-lib-api-wrapper",
        reviewSensitive: false,
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
        behaviorScenarios: ["storefront-backend-first-load"],
        note: "These surfaces fan out widely across the app, so pair the default suite with a typecheck when shared helpers change.",
      },
      {
        id: "storefront.checkout-auth-boundary",
        reviewSensitive: true,
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
        id: "storefront.payment-redirect-journeys",
        reviewSensitive: true,
        title: "Full browser journeys and payment redirects",
        touchedPaths: [
          "playwright.config.ts",
          "tests/e2e",
          "src/routes/shop/checkout",
        ],
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
      "service-package",
    ),
    keyFolderGroups: [
      {
        title: "Service entry and support surfaces",
        folders: [
          {
            path: ".",
            description:
              "Root service entry files, connection probes, and package metadata.",
          },
        ],
      },
      {
        title: "Docs and harness surfaces",
        folders: [
          {
            path: "docs/agent",
            description:
              "Harness docs, generated indexes, and validation map content.",
          },
        ],
      },
    ],
    validationScenarios: [
      {
        id: "valkey.service-logic-entrypoint",
        reviewSensitive: false,
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
        id: "valkey.live-connection-probe",
        reviewSensitive: false,
        title: "Live connection probe edits",
        touchedPaths: ["test-connection.js"],
        commands: [
          { kind: "script", script: "test" },
          {
            kind: "raw",
            command:
              "node --check packages/valkey-proxy-server/test-connection.js",
          },
        ],
        note: "Keep the live Redis probe syntax-checked locally; run the environment-dependent connection probe manually when cluster access is available.",
      },
    ],
  },
] satisfies HarnessAppRegistryEntry[];

const NON_HARNESS_PACKAGE_REGISTRY = [
  {
    kind: "non-harness",
    packageDir: "packages/athena-contracts",
    note:
      "Neutral contract surface shared by athena-webapp and storefront-webapp. " +
      "It owns no domain logic of its own: the index surface is types plus one " +
      "string-literal array, its runtime exports are thin re-exports of " +
      "athena-webapp/shared browser-safe helpers, and the seam to " +
      "convex/_generated is `import type` and erases at build. That leaves no " +
      "independent validation surface to onboard -- it is exercised through the " +
      "typecheck, tests, and build of the two packages that consume it.",
  },
] as const satisfies readonly NonHarnessPackageRegistration[];

export const HARNESS_PACKAGE_REGISTRY = [
  ...HARNESS_APP_REGISTRY.map((entry) => ({
    kind: "harness-app" as const,
    appName: entry.appName,
    packageDir: entry.packageDir,
    requiredEntryDocs: entry.harnessDocs.requiredEntryDocs,
  })),
  ...NON_HARNESS_PACKAGE_REGISTRY,
] satisfies readonly HarnessPackageRegistration[];

export function getHarnessPackageRegistration(packageDir: string) {
  return HARNESS_PACKAGE_REGISTRY.find(
    (entry) => entry.packageDir === packageDir,
  );
}

/** Qualification contract; the live gate remains authoritative until explicit cutover. */
export type CanonicalValidationCheck = {
  id: string;
  profile: string;
  argv: string[];
  cwd: string;
  membership: string[];
  inputs: string[];
  absentInputs: string[];
  prerequisites: string[];
  supersedes: Array<{ checkId: string; profile: string; reason: string }>;
};

export type CanonicalValidationSurface = {
  id: string;
  pathPrefixes: string[];
  checks: string[];
  reason: string;
};

export type CanonicalValidationRegistry = {
  schemaVersion: "athena-validation-registry/1";
  checks: CanonicalValidationCheck[];
  surfaces: CanonicalValidationSurface[];
  alwaysRequired: string[];
  impact?: {
    packages: Array<{
      root: string;
      testPatterns: string[];
      unitChecks: string[];
      fallbackChecks: string[];
    }>;
    relationships: Array<{
      kind?: "data";
      guards?: Record<string, string>;
      lazyProducers?: Record<string, string>;
      id: string;
      inputs: string[];
      consumers: string[];
      checks?: string[];
      publishingChecks?: string[];
      boundedConsumers?: Record<string, string>;
    }>;
  };
};

/** Runtime consumers ordinary imports cannot establish. Resolved into canonical checks by the generator. */
export const VALIDATION_RUNTIME_RELATIONSHIPS = [
  {
    id: "source-reader-convex-agentHarness-agentRuntime-convexAgent.contract.test.ts",
    kind: "data",
    inputs: [
      "packages/athena-webapp/convex/agentHarness/agentRuntime/convexAgentRefs.ts",
      "packages/athena-webapp/convex/agentHarness/agentRuntime/convexAgentCleanup.ts",
    ],
    consumers: [
      "packages/athena-webapp/convex/agentHarness/agentRuntime/convexAgent.contract.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/convex/agentHarness/agentRuntime/convexAgent.contract.test.ts":
        "9cc77e0576c3e5e1c38b2da624c44e1a35627bbcba42caa4841a788a1acfff7b",
    },
  },
  {
    id: "source-reader-convex-agentHarness-agentRuntime-convexAgentPersistence.test.ts",
    kind: "data",
    inputs: [
      "packages/athena-webapp/package.json",
      "packages/athena-webapp/docs/agent/agent-harness-runtime.md",
      "node_modules/@convex-dev/agent/package.json",
      "node_modules/ai/package.json",
      "node_modules/@ai-sdk/openai/package.json",
    ],
    consumers: [
      "packages/athena-webapp/convex/agentHarness/agentRuntime/convexAgentPersistence.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/convex/agentHarness/agentRuntime/convexAgentPersistence.test.ts":
        "1ee8cdc602f837d32541952d2a6c0d093d4e734c7e553dac5e94da78031e4725",
    },
  },
  {
    id: "source-reader-convex-agentHarness-delegatedAdmission.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: [
      "packages/athena-webapp/convex/agentHarness/delegatedAdmission.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/convex/agentHarness/delegatedAdmission.test.ts":
        "d96331b04c9361d88b936cadcc55488fc4776945c8a3e82362e2c1cc47b3c72f",
    },
  },
  {
    id: "source-reader-convex-agentHarness-historyProjection.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: [
      "packages/athena-webapp/convex/agentHarness/historyProjection.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/convex/agentHarness/historyProjection.test.ts":
        "3bce14fad1141a66f93514b0e4d50f36b7ff966ba72cd625379af9af79224c4b",
    },
  },
  {
    id: "source-reader-convex-agentHarness-importBoundary.test.ts",
    kind: "data",
    inputs: [
      "packages/athena-webapp/convex",
      "packages/athena-webapp/shared",
      "packages/athena-webapp/src",
    ],
    consumers: [
      "packages/athena-webapp/convex/agentHarness/importBoundary.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/convex/agentHarness/importBoundary.test.ts":
        "a58b09542b52cf8a441c90b8c2440c59bf08df7b3ba64dcc3ea0ff5799bd660b",
    },
  },
  {
    id: "source-reader-convex-agentHarness-profiles-dailyOperations.test.ts",
    kind: "data",
    inputs: [
      "packages/athena-webapp/src/components/operations/DailyOperationsView.tsx",
      "packages/athena-webapp/src/components/store-pulse/StorePulseSummaryView.tsx",
    ],
    consumers: [
      "packages/athena-webapp/convex/agentHarness/profiles/dailyOperations.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/convex/agentHarness/profiles/dailyOperations.test.ts":
        "d9ab2086f4778145c7bd24ffc28e5d237227f7894f422ef0fef49d649ad8d436",
    },
  },
  {
    id: "source-reader-convex-agentHarness-retention.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: ["packages/athena-webapp/convex/agentHarness/retention.test.ts"],
    boundedConsumers: {
      "packages/athena-webapp/convex/agentHarness/retention.test.ts":
        "9f85dcd3a79cd4ca307ea00e77d3befde4dc2342833af95b09d7fba4106fad30",
    },
  },
  {
    id: "source-reader-convex-cashControls-closeouts.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: ["packages/athena-webapp/convex/cashControls/closeouts.test.ts"],
    boundedConsumers: {
      "packages/athena-webapp/convex/cashControls/closeouts.test.ts":
        "50691fda21e5e59ef6f287490e8ce7bab18433aa0ae022b95922f81ac398a9a6",
    },
  },
  {
    id: "source-reader-convex-cashControls-deposits.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: ["packages/athena-webapp/convex/cashControls/deposits.test.ts"],
    boundedConsumers: {
      "packages/athena-webapp/convex/cashControls/deposits.test.ts":
        "76ec40dc03667d470bbf59aeac7797af4e53cdf0e7f397e343c7b70b03c55893",
    },
  },
  {
    id: "source-reader-convex-cashControls-paymentAllocationAttribution.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: [
      "packages/athena-webapp/convex/cashControls/paymentAllocationAttribution.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/convex/cashControls/paymentAllocationAttribution.test.ts":
        "033ad48fa9b60fdfebbe2b2f1eb3284f5d7b784d8a7f7b4d6e9a6c260f52b1be",
    },
  },
  {
    id: "source-reader-convex-contextTracking-contextEvents.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: [
      "packages/athena-webapp/convex/contextTracking/contextEvents.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/convex/contextTracking/contextEvents.test.ts":
        "8858338af6ef357af14f73e1859497adaf438f883fffd4a6f364f5d40db93d0b",
    },
  },
  {
    id: "source-reader-convex-crons.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: ["packages/athena-webapp/convex/crons.test.ts"],
    boundedConsumers: {
      "packages/athena-webapp/convex/crons.test.ts":
        "237977375eca5639daaaf8de91043ca9bb3b3e93319944b4976b574d101b3221",
    },
  },
  {
    id: "source-reader-convex-emails-OrderEmail.test.tsx",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: ["packages/athena-webapp/convex/emails/OrderEmail.test.tsx"],
    boundedConsumers: {
      "packages/athena-webapp/convex/emails/OrderEmail.test.tsx":
        "5b8845f09f3f80fc4c9decb904a4789d1a3f190303eff502b7526c5d40c16364",
    },
  },
  {
    id: "source-reader-convex-http-domains-core-routes-landingFunnelEvents.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: [
      "packages/athena-webapp/convex/http/domains/core/routes/landingFunnelEvents.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/convex/http/domains/core/routes/landingFunnelEvents.test.ts":
        "b1f29755835dc85fd9c17bb790c64d7a6aaffb4941d0bb38e19b414801fdc975",
    },
  },
  {
    id: "source-reader-convex-http-domains-customerChannel-routes-storefrontCors.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: [
      "packages/athena-webapp/convex/http/domains/customerChannel/routes/storefrontCors.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/convex/http/domains/customerChannel/routes/storefrontCors.test.ts":
        "fdf4b2b3ac3a5af50c66a17df2bc203bb4e8362e405381ea0ff3ee8e3cc7aada",
    },
  },
  {
    id: "source-reader-convex-http-health.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: ["packages/athena-webapp/convex/http/health.test.ts"],
    boundedConsumers: {
      "packages/athena-webapp/convex/http/health.test.ts":
        "cdcde2e6d75a9262055e59f857286666cf4684cbf584177a44ad3c1f7bc9cc19",
    },
  },
  {
    id: "source-reader-convex-http-routerComposition.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: ["packages/athena-webapp/convex/http/routerComposition.test.ts"],
    boundedConsumers: {
      "packages/athena-webapp/convex/http/routerComposition.test.ts":
        "69c9920cf9d245d130c76cbd75baba87353735803f44ae799bcfd108d6f3c500",
    },
  },
  {
    id: "source-reader-convex-inventory-athenaUserIdentityWriters.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: [
      "packages/athena-webapp/convex/inventory/athenaUserIdentityWriters.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/convex/inventory/athenaUserIdentityWriters.test.ts":
        "5debc8ddfa26c22e1de383957ce66a0e35c0e5ca5d16c9b8a0d3804135e92787",
    },
  },
  {
    id: "source-reader-convex-inventory-sessionQueryIndexes.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: [
      "packages/athena-webapp/convex/inventory/sessionQueryIndexes.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/convex/inventory/sessionQueryIndexes.test.ts":
        "b90f76d49d021421c5bd1e31efed3380e2e7801d2535eb627b23d0efcbf2292e",
    },
  },
  {
    id: "source-reader-convex-inventory-skuSearch.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: ["packages/athena-webapp/convex/inventory/skuSearch.test.ts"],
    boundedConsumers: {
      "packages/athena-webapp/convex/inventory/skuSearch.test.ts":
        "d559e713a90e2ee87a4a3837364ca67b64b4a294cf22abaad04e04236a24c43b",
    },
  },
  {
    id: "source-reader-convex-inventory-storeSchedule.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: [
      "packages/athena-webapp/convex/inventory/storeSchedule.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/convex/inventory/storeSchedule.test.ts":
        "cfeea1fb00b846e0a2171b634c9c47c031cacaf58c81468d879541667f4e40d6",
    },
  },
  {
    id: "source-reader-convex-inventoryLedger-deficitResolutionWork.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: [
      "packages/athena-webapp/convex/inventoryLedger/deficitResolutionWork.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/convex/inventoryLedger/deficitResolutionWork.test.ts":
        "466bf2c46da36024e5ee5c941e19c813a167c55cc8d1400781aae1d200745458",
    },
  },
  {
    id: "source-reader-convex-inventoryLedger-effects.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: [
      "packages/athena-webapp/convex/inventoryLedger/effects.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/convex/inventoryLedger/effects.test.ts":
        "edf5db1cf21cb34c9fb41cb972ab9d991140da23b55cec36c9c41fa3ed9f8636",
    },
  },
  {
    id: "source-reader-convex-migrations-backfillReportFactObservedAt.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: [
      "packages/athena-webapp/convex/migrations/backfillReportFactObservedAt.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/convex/migrations/backfillReportFactObservedAt.test.ts":
        "f934bf89106e0baeb4ebad9722eed5bad116a0a76dc01ef5477b0feb9e23a58f",
    },
  },
  {
    id: "source-reader-convex-mtn-foundation.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: ["packages/athena-webapp/convex/mtn/foundation.test.ts"],
    boundedConsumers: {
      "packages/athena-webapp/convex/mtn/foundation.test.ts":
        "092bb19494f49dfaf0cff9a28b0157a7e5f7da88366cb4e138776b7a5a515432",
    },
  },
  {
    id: "source-reader-convex-operationAdmission-importAllowlist.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: [
      "packages/athena-webapp/convex/operationAdmission/importAllowlist.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/convex/operationAdmission/importAllowlist.test.ts":
        "1beda968bbab15e4a037c0d0d1b2bc846d0b009c91106d003deb6bf63f31ef05",
    },
  },
  {
    id: "source-reader-convex-operations-approvalRequestHelpers.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: [
      "packages/athena-webapp/convex/operations/approvalRequestHelpers.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/convex/operations/approvalRequestHelpers.test.ts":
        "c8da049a6a322931fde7baac4b0fbba9c21787f9c9aea66547be258b0a703a45",
    },
  },
  {
    id: "source-reader-convex-operations-inventoryContributionWriteSites.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: [
      "packages/athena-webapp/convex/operations/inventoryContributionWriteSites.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/convex/operations/inventoryContributionWriteSites.test.ts":
        "fdd6952498e5753cd4d70e09d197053edf7a6e133fdbc5ec38f7cd4f216e124d",
    },
  },
  {
    id: "source-reader-convex-operations-operationsQueryIndexes.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: [
      "packages/athena-webapp/convex/operations/operationsQueryIndexes.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/convex/operations/operationsQueryIndexes.test.ts":
        "a456be449859c45b4ed5263700a22ac51a6e37c1acef6383913cc5c4fd1a8fc4",
    },
  },
  {
    id: "source-reader-convex-operations-paymentAllocationCallers.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: [
      "packages/athena-webapp/convex/operations/paymentAllocationCallers.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/convex/operations/paymentAllocationCallers.test.ts":
        "60f5bda1c528cb5cc9fbdc3d8b5bce21bad239e0c3b1f9df93394db3535ff743",
    },
  },
  {
    id: "source-reader-convex-operations-serviceIntake.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: [
      "packages/athena-webapp/convex/operations/serviceIntake.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/convex/operations/serviceIntake.test.ts":
        "9fcb3c9d8f5fda5b8c2da35ab4641c43b8a2f57030c66def3cf49d54969f34d9",
    },
  },
  {
    id: "source-reader-convex-pos-application-expenseSessionCommands.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: [
      "packages/athena-webapp/convex/pos/application/expenseSessionCommands.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/convex/pos/application/expenseSessionCommands.test.ts":
        "c66e3aa0a4c6940ff844c00b8ce8446a8944961bd93383bbba3fa02164581e39",
    },
  },
  {
    id: "source-reader-convex-pos-infrastructure-repositories-localSyncRepository.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: [
      "packages/athena-webapp/convex/pos/infrastructure/repositories/localSyncRepository.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/convex/pos/infrastructure/repositories/localSyncRepository.test.ts":
        "00fed6774de32d48d14e69f24587b4dbf87582f71ba42ee6368b80aa0b775c8c",
    },
  },
  {
    id: "source-reader-convex-pos-infrastructure-repositories-sessionCommandRepository.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: [
      "packages/athena-webapp/convex/pos/infrastructure/repositories/sessionCommandRepository.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/convex/pos/infrastructure/repositories/sessionCommandRepository.test.ts":
        "55eee5d6318b03562215bf576a54769339666eb97c579fae13626f852b02d78f",
    },
  },
  {
    id: "source-reader-convex-pos-public-posRecoveryCodes.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: [
      "packages/athena-webapp/convex/pos/public/posRecoveryCodes.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/convex/pos/public/posRecoveryCodes.test.ts":
        "0d988f91eb005fd8892c2c0d715cd050cde98897dfeb8e13a81e92132ab9369d",
    },
  },
  {
    id: "source-reader-convex-reports-pipelineAcceptedWriteSites.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: [
      "packages/athena-webapp/convex/reports/pipelineAcceptedWriteSites.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/convex/reports/pipelineAcceptedWriteSites.test.ts":
        "bfeeefc957ac4f369a11134e89a6d9113c0692659ac1c17cb65608ce5e358028",
    },
  },
  {
    id: "source-reader-convex-serviceOps-moduleWiring.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: [
      "packages/athena-webapp/convex/serviceOps/moduleWiring.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/convex/serviceOps/moduleWiring.test.ts":
        "8adbc480f52d6cb3276fd148352aa2ce27fe6a4e7a992e07766995f0ff983daf",
    },
  },
  {
    id: "source-reader-convex-sharedDemo-coverage.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: ["packages/athena-webapp/convex/sharedDemo/coverage.test.ts"],
    boundedConsumers: {
      "packages/athena-webapp/convex/sharedDemo/coverage.test.ts":
        "569341a3582c05dc32e0c98b43344b59f9793693bb7673eaacf0be4dc0b0ed6a",
    },
  },
  {
    id: "source-reader-convex-sharedDemo-domainRestore.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: [
      "packages/athena-webapp/convex/sharedDemo/domainRestore.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/convex/sharedDemo/domainRestore.test.ts":
        "688193fc69f2e927ad7e3edb2717116fcd69e85808c8a1612f036835202a5f2d",
    },
  },
  {
    id: "source-reader-convex-sharedDemo-enforcement.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: ["packages/athena-webapp/convex/sharedDemo/enforcement.test.ts"],
    boundedConsumers: {
      "packages/athena-webapp/convex/sharedDemo/enforcement.test.ts":
        "602be252ff63e0405741a22cea972814c1ccfb0f124d54d1ed25533afbd48f7b",
    },
  },
  {
    id: "source-reader-convex-sharedDemo-posStoreReadAccessCoverage.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: [
      "packages/athena-webapp/convex/sharedDemo/posStoreReadAccessCoverage.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/convex/sharedDemo/posStoreReadAccessCoverage.test.ts":
        "632b63be654afa1b3da83b1f71ade42009f786fce4d59a22dace35e2949f40dd",
    },
  },
  {
    id: "source-reader-convex-sharedDemo-provision.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: ["packages/athena-webapp/convex/sharedDemo/provision.test.ts"],
    boundedConsumers: {
      "packages/athena-webapp/convex/sharedDemo/provision.test.ts":
        "19e5754a1e22c09a34ccde6b4483b37a03b155180c77ff8a961c55521d9ee4cb",
    },
  },
  {
    id: "source-reader-convex-sharedDemo-public.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: ["packages/athena-webapp/convex/sharedDemo/public.test.ts"],
    boundedConsumers: {
      "packages/athena-webapp/convex/sharedDemo/public.test.ts":
        "d92a6f85eb40ec86cd603229439931e6a49bd50be0a84d09070396a01c88e227",
    },
  },
  {
    id: "source-reader-convex-sharedDemo-registerBaseline.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: [
      "packages/athena-webapp/convex/sharedDemo/registerBaseline.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/convex/sharedDemo/registerBaseline.test.ts":
        "262d185e34add5b840a32fca6b295e182f23e6261321c52be606959cb1c94813",
    },
  },
  {
    id: "source-reader-convex-sharedDemo-restore.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: ["packages/athena-webapp/convex/sharedDemo/restore.test.ts"],
    boundedConsumers: {
      "packages/athena-webapp/convex/sharedDemo/restore.test.ts":
        "adf757b8d4e38dbb83ed6607e9e4ec755914670944ddc96ae30a74a83708f8f2",
    },
  },
  {
    id: "source-reader-convex-sharedDemo-serviceEffectBoundaryCoverage.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: [
      "packages/athena-webapp/convex/sharedDemo/serviceEffectBoundaryCoverage.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/convex/sharedDemo/serviceEffectBoundaryCoverage.test.ts":
        "aa903169cd4a30de89e5ef70d447142f545b02399191c6fd400eee887b251f5b",
    },
  },
  {
    id: "source-reader-convex-stockOps-adjustments.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: ["packages/athena-webapp/convex/stockOps/adjustments.test.ts"],
    boundedConsumers: {
      "packages/athena-webapp/convex/stockOps/adjustments.test.ts":
        "a3be973c0d974e7dd0c7a2781a2f833fcce0720f5a758d60ca9a059d69b16fe7",
    },
  },
  {
    id: "source-reader-convex-stockOps-purchaseOrders.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: [
      "packages/athena-webapp/convex/stockOps/purchaseOrders.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/convex/stockOps/purchaseOrders.test.ts":
        "a455d885e61721fa4ebd68189b3212096c777d36b29dd2d3a6c052c729b09722",
    },
  },
  {
    id: "source-reader-convex-stockOps-receiving.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: ["packages/athena-webapp/convex/stockOps/receiving.test.ts"],
    boundedConsumers: {
      "packages/athena-webapp/convex/stockOps/receiving.test.ts":
        "8d0caed4fe253a7bc6f4e08ed49260e8b0b47a85df0acb739dd2605571d0daf3",
    },
  },
  {
    id: "source-reader-convex-stockOps-replenishment.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: ["packages/athena-webapp/convex/stockOps/replenishment.test.ts"],
    boundedConsumers: {
      "packages/athena-webapp/convex/stockOps/replenishment.test.ts":
        "999b890a65f0912aef7a7a438e7deb48b958cc607154bd3b8fdffd48fe4fabe8",
    },
  },
  {
    id: "source-reader-convex-stockOps-vendors.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: ["packages/athena-webapp/convex/stockOps/vendors.test.ts"],
    boundedConsumers: {
      "packages/athena-webapp/convex/stockOps/vendors.test.ts":
        "a52b7683cb3d7d60052c92981b07efc6252e32c0891a213295b03bfb19df0543",
    },
  },
  {
    id: "source-reader-convex-storeFront-commerceQueryIndexes.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: [
      "packages/athena-webapp/convex/storeFront/commerceQueryIndexes.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/convex/storeFront/commerceQueryIndexes.test.ts":
        "330f0a499188a4a438948211ba365b8f99803bad67c1e579628c053e283335ee",
    },
  },
  {
    id: "source-reader-convex-storeFront-errorFoundation.test.ts",
    kind: "data",
    inputs: [
      "packages/athena-webapp/convex/storeFront/onlineOrder.ts",
      "packages/athena-webapp/convex/storeFront/payment.ts",
      "packages/athena-webapp/convex/storeFront/reviews.ts",
      "packages/athena-webapp/convex/storeFront/onlineOrderUtilFns.ts",
      "packages/athena-webapp/src/components/orders/OrderView.tsx",
      "packages/athena-webapp/src/components/orders/OrderItemsView.tsx",
      "packages/athena-webapp/src/components/orders/EmailStatusView.tsx",
      "packages/athena-webapp/src/components/orders/RefundsView.tsx",
      "packages/athena-webapp/src/components/orders/ReturnExchangeView.tsx",
      "packages/athena-webapp/src/components/reviews/ReviewsView.tsx",
    ],
    consumers: [
      "packages/athena-webapp/convex/storeFront/errorFoundation.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/convex/storeFront/errorFoundation.test.ts":
        "91e0e0a876e0f731ae8c0f7d25691a21ec465ad07c139a670313203edc7ad50e",
    },
  },
  {
    id: "source-reader-convex-storeFront-helperOrchestration.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: [
      "packages/athena-webapp/convex/storeFront/helperOrchestration.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/convex/storeFront/helperOrchestration.test.ts":
        "a88a3f9659d9f6e82343d9628d43e1ed5e55085b38ca96615e9a83ef691952ef",
    },
  },
  {
    id: "source-reader-convex-storeFront-onlineOrder.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: ["packages/athena-webapp/convex/storeFront/onlineOrder.test.ts"],
    boundedConsumers: {
      "packages/athena-webapp/convex/storeFront/onlineOrder.test.ts":
        "45306af403b1f24e64678d345c94a3d04f7fccbcdff6a338a6a1cb4958c0b5fa",
    },
  },
  {
    id: "source-reader-convex-storeFront-returnExchangeOperations.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: [
      "packages/athena-webapp/convex/storeFront/returnExchangeOperations.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/convex/storeFront/returnExchangeOperations.test.ts":
        "8117e57830785869d3061000544ab2c9d85c75476b8acbc6844e42911c1fd598",
    },
  },
  {
    id: "source-reader-convex-storeFront-timeQueryRefactors.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: [
      "packages/athena-webapp/convex/storeFront/timeQueryRefactors.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/convex/storeFront/timeQueryRefactors.test.ts":
        "f7a4eb8253c3a2456de92ee0e25d20ae553d47c8ad4a66f6a60fccb9705f4b98",
    },
  },
  {
    id: "source-reader-convex-storeTime-operatingPeriods.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: [
      "packages/athena-webapp/convex/storeTime/operatingPeriods.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/convex/storeTime/operatingPeriods.test.ts":
        "acbf17b089871a3a44246e516f6835a970ec613fcbcdb6664fb853e6710f149a",
    },
  },
  {
    id: "source-reader-convex-storeTime-storeTimeAuthority.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp/convex"],
    consumers: [
      "packages/athena-webapp/convex/storeTime/storeTimeAuthority.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/convex/storeTime/storeTimeAuthority.test.ts":
        "b440b07fe8da0293a0a62491d13a78773ed072cbec794bc1145d392daafd2d8a",
    },
  },
  {
    id: "source-reader-src-components-agent-importBoundary.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp"],
    consumers: [
      "packages/athena-webapp/src/components/agent/importBoundary.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/src/components/agent/importBoundary.test.ts":
        "7bf65c1487c1e5c1944d3dbf27285aa8d41869d0f30ab3a6a6f847613178b021",
    },
  },
  {
    id: "source-reader-src-components-analytics-analyticsWorkspaceEfficiency.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp"],
    consumers: [
      "packages/athena-webapp/src/components/analytics/analyticsWorkspaceEfficiency.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/src/components/analytics/analyticsWorkspaceEfficiency.test.ts":
        "e50e2520616de52b745ca169e9c7b24fcb29d09019b78218706e0013c1809bbc",
    },
  },
  {
    id: "source-reader-src-components-orders-OrderDetailsView.test.tsx",
    kind: "data",
    inputs: ["packages/athena-webapp"],
    consumers: [
      "packages/athena-webapp/src/components/orders/OrderDetailsView.test.tsx",
    ],
    boundedConsumers: {
      "packages/athena-webapp/src/components/orders/OrderDetailsView.test.tsx":
        "4c0f4bbde30d9c4b9661158160ed03987e135a2f541ce31c17daa37a01b1a9b8",
    },
  },
  {
    id: "source-reader-src-components-orders-OrderView.test.tsx",
    kind: "data",
    inputs: ["packages/athena-webapp"],
    consumers: [
      "packages/athena-webapp/src/components/orders/OrderView.test.tsx",
    ],
    boundedConsumers: {
      "packages/athena-webapp/src/components/orders/OrderView.test.tsx":
        "7b9188f8cc49c24b67393e9cdb8e655c3fb548632207c41037bcef39f9661a23",
    },
  },
  {
    id: "source-reader-src-components-orders-OrdersView.test.tsx",
    kind: "data",
    inputs: ["packages/athena-webapp"],
    consumers: [
      "packages/athena-webapp/src/components/orders/OrdersView.test.tsx",
    ],
    boundedConsumers: {
      "packages/athena-webapp/src/components/orders/OrdersView.test.tsx":
        "367b9f9f80b9468183ea74fe1d18e75eb34bcc9d12ee3f9bc68836bde4cd38ae",
    },
  },
  {
    id: "source-reader-src-components-orders-RefundsView.test.tsx",
    kind: "data",
    inputs: ["packages/athena-webapp"],
    consumers: [
      "packages/athena-webapp/src/components/orders/RefundsView.test.tsx",
    ],
    boundedConsumers: {
      "packages/athena-webapp/src/components/orders/RefundsView.test.tsx":
        "2df10214a8315a02c62028e8402a5bf9c3814fcd7941b26eee93c37e1d1e646b",
    },
  },
  {
    id: "source-reader-src-components-promo-codes-PromoCodesView.test.tsx",
    kind: "data",
    inputs: ["packages/athena-webapp"],
    consumers: [
      "packages/athena-webapp/src/components/promo-codes/PromoCodesView.test.tsx",
    ],
    boundedConsumers: {
      "packages/athena-webapp/src/components/promo-codes/PromoCodesView.test.tsx":
        "64074a9bbe88bca5753b47117f6f2b767ccea85eb4a91a1f82cbe7aa5dfaa11f",
    },
  },
  {
    id: "source-reader-src-components-services-ServiceCasesView.test.tsx",
    kind: "data",
    inputs: ["packages/athena-webapp"],
    consumers: [
      "packages/athena-webapp/src/components/services/ServiceCasesView.test.tsx",
    ],
    boundedConsumers: {
      "packages/athena-webapp/src/components/services/ServiceCasesView.test.tsx":
        "55a0e1e6c44ca7ea3f920ceb06a88a3e1beecafb18ffad1699841add29d45076",
    },
  },
  {
    id: "source-reader-src-components-shared-demo-SharedDemoRestrictedSurface.test.tsx",
    kind: "data",
    inputs: ["packages/athena-webapp"],
    consumers: [
      "packages/athena-webapp/src/components/shared-demo/SharedDemoRestrictedSurface.test.tsx",
    ],
    boundedConsumers: {
      "packages/athena-webapp/src/components/shared-demo/SharedDemoRestrictedSurface.test.tsx":
        "40ffaf023bd02ef0b31d308bfd507de4a8e3d001cef233eb731dadf72d481b46",
    },
  },
  {
    id: "source-reader-src-components-shared-demo-SharedDemoRuntime.test.tsx",
    kind: "data",
    inputs: ["packages/athena-webapp"],
    consumers: [
      "packages/athena-webapp/src/components/shared-demo/SharedDemoRuntime.test.tsx",
    ],
    boundedConsumers: {
      "packages/athena-webapp/src/components/shared-demo/SharedDemoRuntime.test.tsx":
        "eb987e1e9a1caad742b06a2fe7152f1cb14bdba68a4bd0bc5c1252ac7cbb71bc",
    },
  },
  {
    id: "source-reader-src-components-shared-demo-sharedDemoReportsFixture.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp"],
    consumers: [
      "packages/athena-webapp/src/components/shared-demo/sharedDemoReportsFixture.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/src/components/shared-demo/sharedDemoReportsFixture.test.ts":
        "ba5933c251ccba4290fcb41faed440f2c42e7b19d5c8571e6d8817e5caadd927",
    },
  },
  {
    id: "source-reader-src-design-system-build-config.test.ts",
    kind: "data",
    inputs: [
      "packages/athena-webapp",
      "manage-athena-versions.sh",
      "scripts/deploy-vps.sh",
    ],
    consumers: [
      "packages/athena-webapp/src/design-system-build-config.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/src/design-system-build-config.test.ts":
        "b80fcb8809cf128edcfd39e22b00fe49d7fe3712a9f04bdf1f08a9f382cb2a2a",
    },
  },
  {
    id: "source-reader-src-lib-moneyEntryAudit.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp", "packages/storefront-webapp/src"],
    consumers: ["packages/athena-webapp/src/lib/moneyEntryAudit.test.ts"],
    boundedConsumers: {
      "packages/athena-webapp/src/lib/moneyEntryAudit.test.ts":
        "1c8b1ccaac4da9dab3624dc0fa38da8e0cd2c88e45591b513e964dd866b6c564",
    },
  },
  {
    id: "source-reader-src-lib-pos-infrastructure-local-posLocalStorageBoundary.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp"],
    consumers: [
      "packages/athena-webapp/src/lib/pos/infrastructure/local/posLocalStorageBoundary.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/src/lib/pos/infrastructure/local/posLocalStorageBoundary.test.ts":
        "f16437bfcaab84f7925dea9955ab5ce07e33df225bcb43cdde29a3bad5ceebeb",
    },
  },
  {
    id: "source-reader-src-lib-pos-presentation-expense-useExpenseRegisterViewModel.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp"],
    consumers: [
      "packages/athena-webapp/src/lib/pos/presentation/expense/useExpenseRegisterViewModel.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/src/lib/pos/presentation/expense/useExpenseRegisterViewModel.test.ts":
        "e8fa04c0dfccff9de6d7c250809300183705bbe9a5b4d4fcd2134b1ec85288cf",
    },
  },
  {
    id: "source-reader-src-lib-pos-presentation-register-useRegisterViewModel.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp"],
    consumers: [
      "packages/athena-webapp/src/lib/pos/presentation/register/useRegisterViewModel.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/src/lib/pos/presentation/register/useRegisterViewModel.test.ts":
        "365431d0a28f2311f2a3775ac31b188721b0f7ba5f56295133eb3f9577503537",
    },
  },
  {
    id: "source-reader-src-routeTree.browser-boundary.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp"],
    consumers: [
      "packages/athena-webapp/src/routeTree.browser-boundary.test.ts",
    ],
    boundedConsumers: {
      "packages/athena-webapp/src/routeTree.browser-boundary.test.ts":
        "ea963ba3eb6028da28b67b5c66e656d6cf2539171806ec88f0172eed19adfa52",
    },
  },
  {
    id: "source-reader-src-routes-_authed-$orgUrlSlug-store-$storeUrlSlug-pos.route.test.tsx",
    kind: "data",
    inputs: ["packages/athena-webapp"],
    consumers: [
      "packages/athena-webapp/src/routes/_authed/$orgUrlSlug/store/$storeUrlSlug/pos.route.test.tsx",
    ],
    boundedConsumers: {
      "packages/athena-webapp/src/routes/_authed/$orgUrlSlug/store/$storeUrlSlug/pos.route.test.tsx":
        "c7dd86fecfffa77ba401d9de26fda8c9f9c4070ed607737aae7af2f7b572c53e",
    },
  },
  {
    id: "source-reader-src-static-product-metadata.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp"],
    consumers: ["packages/athena-webapp/src/static-product-metadata.test.ts"],
    boundedConsumers: {
      "packages/athena-webapp/src/static-product-metadata.test.ts":
        "cc00f96fe7b8bca3040313c934c7e8f031b836d5c559b7426e3de41f7f4b07a5",
    },
  },
  {
    id: "source-reader-src-stories-Foundations-foundations-content.test.tsx",
    kind: "data",
    inputs: ["packages/athena-webapp"],
    consumers: [
      "packages/athena-webapp/src/stories/Foundations/foundations-content.test.tsx",
    ],
    boundedConsumers: {
      "packages/athena-webapp/src/stories/Foundations/foundations-content.test.tsx":
        "e090dd8f923c3e0ef40ad5d5175f460076d45bdd87523e19428ab727daecb840",
    },
  },
  {
    id: "source-reader-src-stories-storybook-config.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp", ".storybook-athena/main.ts"],
    consumers: ["packages/athena-webapp/src/stories/storybook-config.test.ts"],
    boundedConsumers: {
      "packages/athena-webapp/src/stories/storybook-config.test.ts":
        "589cd455c0c89d6fcef99299f00ab4605df5c6becd3e0f164f0a2532899aadbf",
    },
  },
  {
    id: "source-reader-src-viteConfig.test.ts",
    kind: "data",
    inputs: ["packages/athena-webapp"],
    consumers: ["packages/athena-webapp/src/viteConfig.test.ts"],
    boundedConsumers: {
      "packages/athena-webapp/src/viteConfig.test.ts":
        "4187500a340e73fc7f6dd3d843ea30eabe320551181cc37fe32fdd95ff554974",
    },
  },
  {
    id: "athena-webapp-style-data",
    kind: "data",
    inputs: [
      "packages/athena-webapp/src",
      "packages/athena-webapp/tailwind.config.js",
      "packages/athena-webapp/postcss.config.js",
      "packages/athena-webapp/package.json",
      "package.json",
      "bun.lockb",
    ],
    consumers: ["packages/athena-webapp/src/index.css"],
    boundedConsumers: {
      "packages/athena-webapp/src/index.css":
        "19b1975759050061922553648379e469ab127f8c508ca45cb83110691bc8f749",
    },
    guards: {
      "packages/athena-webapp/tailwind.config.js":
        "16db701de61eca6b2d25fba5dde219020e017c46b248661c51b6b2be7a1e5702",
      "packages/athena-webapp/postcss.config.js":
        "c3ae79dd928ac53509e8fea8ca5baa2f913abf5e47be7f8159c0bc5e8c9300e6",
    },
  },
  {
    id: "storefront-webapp-style-data",
    kind: "data",
    inputs: [
      "packages/storefront-webapp/src",
      "packages/storefront-webapp/tailwind.config.js",
      "packages/storefront-webapp/postcss.config.cjs",
      "packages/storefront-webapp/package.json",
      "package.json",
      "bun.lockb",
    ],
    consumers: ["packages/storefront-webapp/src/index.css"],
    boundedConsumers: {
      "packages/storefront-webapp/src/index.css":
        "9b7b77053c5fbbfcaa3a37f187bd70e166b86006cc4321df61c1d5d77d6e6c30",
    },
    guards: {
      "packages/storefront-webapp/tailwind.config.js":
        "db2c9c23b87ed001141577e108d9269d2bccc29e5d39fa6fb764d1345c89560b",
      "packages/storefront-webapp/postcss.config.cjs":
        "3e9616a36ca4b966f787bf317fa29add7c793e13cee632000e72f1bd1e3fee12",
    },
  },
  {
    id: "style-data-storybook",
    kind: "data",
    inputs: ["packages/athena-webapp/.storybook/storybook.css"],
    consumers: ["packages/athena-webapp/.storybook/storybook.css"],
    boundedConsumers: {
      "packages/athena-webapp/.storybook/storybook.css":
        "7d89d1485cac5951b6f80355555c2cf02589f4fe9169e4c8395e4b7ad28e597d",
    },
  },
  {
    id: "style-data-docs-prose",
    kind: "data",
    inputs: ["packages/athena-webapp/src/components/docs/docs-prose.css"],
    consumers: ["packages/athena-webapp/src/components/docs/docs-prose.css"],
    boundedConsumers: {
      "packages/athena-webapp/src/components/docs/docs-prose.css":
        "9d77fa2a28d7d418222b377ae1c86f1d33dad831fe0d42036aa4862d257a1284",
    },
  },
  {
    id: "style-data-docs-report",
    kind: "data",
    inputs: ["packages/athena-webapp/src/components/docs/docs-report.css"],
    consumers: ["packages/athena-webapp/src/components/docs/docs-report.css"],
    boundedConsumers: {
      "packages/athena-webapp/src/components/docs/docs-report.css":
        "030484f8f9c4edc6cdcca2a763d2d9771b9a3bd72fe93242c75a6a2e080f1e8f",
    },
  },
  {
    id: "style-data-docs-scroll-to-top",
    kind: "data",
    inputs: [
      "packages/athena-webapp/src/components/docs/docs-scroll-to-top.css",
    ],
    consumers: [
      "packages/athena-webapp/src/components/docs/docs-scroll-to-top.css",
    ],
    boundedConsumers: {
      "packages/athena-webapp/src/components/docs/docs-scroll-to-top.css":
        "d9ec0b3b44ff5c126566a93b4fe48d1d1c84d1b97352ea9d015a588a5a67d058",
    },
  },
  {
    id: "style-data-docs-texture",
    kind: "data",
    inputs: ["packages/athena-webapp/src/components/docs/docs-texture.css"],
    consumers: ["packages/athena-webapp/src/components/docs/docs-texture.css"],
    boundedConsumers: {
      "packages/athena-webapp/src/components/docs/docs-texture.css":
        "c9993c04d79d73dcde5f0c29de709060df9dcdf5b45b029fd2d0d6122cd57d45",
    },
  },
  {
    id: "docs-publishing",
    kind: "data",
    inputs: ["docs/reports", "docs/solutions"],
    consumers: ["packages/athena-webapp/src/lib/docs/content.ts"],
    publishing: true,
    lazyProducers: {
      "packages/athena-webapp/vite-docs-content-plugin.ts":
        "58d363d506a79d8c8089a19ddeac88056fdd8c1684921b4ab2b13c4464f11a47",
    },
  },
  {
    id: "route-registration",
    inputs: ["packages/athena-webapp/src/routes"],
    consumers: [
      "packages/athena-webapp/src/routeTree.gen.ts",
      "packages/athena-webapp/src/appRouter.ts",
    ],
  },
  {
    id: "convex-schema-tables",
    inputs: [
      "packages/athena-webapp/convex/schema.ts",
      "packages/athena-webapp/convex/schemas",
    ],
    consumers: ["packages/athena-webapp/convex"],
  },
  {
    id: "convex-generated-api",
    inputs: ["packages/athena-webapp/convex/_generated"],
    consumers: ["packages/athena-webapp/convex", "packages/athena-webapp/src"],
  },
  {
    id: "convex-function-admission",
    inputs: ["packages/athena-webapp/convex"],
    consumers: [],
    command: "bun scripts/convex-operation-admission-check.ts",
  },
] as const;

export const VALIDATION_IMPACT_TEST_PATTERNS = {
  "packages/athena-webapp": [
    "packages/athena-webapp/{src,convex,shared}/**/*.test.{ts,tsx}",
  ],
  "packages/storefront-webapp": [
    "packages/storefront-webapp/**/*.{test,spec}.{ts,tsx,js,jsx,mts,cts,mjs,cjs}",
  ],
  "packages/valkey-proxy-server": ["packages/valkey-proxy-server/app.test.js"],
  ".": ["scripts/*.test.ts"],
} as const;

export const VALIDATION_PLAN_POLICY = {
  schemaVersion: "athena-validation-plan/1",
  authority: "legacy-gate",
  modes: ["delivery", "comparison", "full-health"],
  sharedInputs: [
    "package.json",
    "bun.lockb",
    "bunfig.toml",
    "scripts/harness-app-registry.ts",
    "scripts/harness-validation-plan.ts",
    "scripts/harness-validation-impact.ts",
    "scripts/harness-repo-validation.ts",
  ],
  publishingPrefixes: ["docs/reports", "docs/solutions"],
  publishingCommands: [
    "reports:presentation:check",
    "docs:links:check",
    "landed-report:check",
  ],
  fullHealthCommands: [
    "test:coverage",
    "harness:test",
    "workflow:check",
    "architecture:check",
    "harness:inferential-review",
    "graphify:check",
  ],
  // These profiles have different configuration/environment semantics even when files overlap.
  distinctProfiles: [
    "unit",
    "aggregate-coverage",
    "timer-stress",
    "browser",
    "behavior",
  ],
} as const;

/** Characterized runner membership, independent from impact selection. */
export const VALIDATION_TEST_MEMBERSHIP = {
  operatorUnit:
    /^packages\/athena-webapp\/(src|convex|shared)\/.*\.test\.(ts|tsx)$/,
  storefrontUnit:
    /^packages\/storefront-webapp\/(?!node_modules\/|dist\/).*\.(test|spec)\.[cm]?[jt]sx?$/,
  rootUnit: /^scripts\/[^/]+\.test\.ts$/,
  operatorBrowser: /^packages\/athena-webapp\/src\/tests\/.*\.spec\.ts$/,
  storefrontBrowser: /^packages\/storefront-webapp\/tests\/e2e\/.*\.e2e\.ts$/,
} as const;
