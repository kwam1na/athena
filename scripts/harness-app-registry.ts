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

export type HarnessAppName =
  | "athena-webapp"
  | "storefront-webapp"
  | "valkey-proxy-server";

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
        title: "Changed frontend source lint",
        touchedPaths: ["src", "shared", "types.ts"],
        commands: [{ kind: "script", script: "lint:frontend:changed" }],
        note: "Run this for changed browser-facing TypeScript or TSX files so introduced ESLint failures are caught before PR handoff.",
      },
      {
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
              "bun run --filter '@athena/webapp' test -- convex/workflowTraces/presentation.test.ts convex/workflowTraces/queryUsage.test.ts convex/workflowTraces/schemaIndexes.test.ts convex/workflowTraces/adapters/posSession.test.ts convex/workflowTraces/adapters/registerSession.test.ts convex/pos/application/completeTransaction.test.ts convex/pos/application/getTransactions.test.ts convex/pos/application/posSessionTracing.test.ts convex/pos/application/terminals.test.ts convex/pos/application/sync/ingestLocalEvents.test.ts convex/pos/application/sync/projectLocalEvents.test.ts convex/pos/public/sync.test.ts convex/pos/public/terminals.test.ts convex/inventory/posSessions.trace.test.ts convex/operations/registerSessionTracing.test.ts convex/operations/registerSessions.trace.test.ts convex/cashControls/registerSessionTraceLifecycle.test.ts src/components/traces/WorkflowTraceView.test.tsx 'src/routes/_authed/$orgUrlSlug/store/$storeUrlSlug/traces/$traceId.test.tsx' src/components/pos/transactions/transactionColumns.test.tsx src/components/pos/transactions/TransactionView.test.tsx src/components/pos/transactions/TransactionsView.test.tsx src/components/pos/SessionManager.test.tsx src/components/pos/register/POSRegisterView.test.tsx src/components/pos/session/HeldSessionsList.test.tsx src/hooks/useGetTerminal.test.ts src/lib/pos/infrastructure/local/posLocalStore.test.ts src/lib/pos/infrastructure/local/syncContract.test.ts src/lib/pos/infrastructure/local/syncScheduler.test.ts src/lib/pos/infrastructure/local/syncStatus.test.ts src/lib/pos/infrastructure/local/usePosLocalSyncRuntime.test.ts src/lib/pos/infrastructure/local/registerReadModel.test.ts src/lib/pos/infrastructure/local/localCommandGateway.test.ts src/lib/pos/presentation/register/useRegisterViewModel.test.ts src/components/cash-controls/CashControlsDashboard.test.tsx src/components/cash-controls/RegisterSessionView.test.tsx src/lib/traces/createWorkflowTraceId.test.ts",
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
          "athena-admin-shell-boot",
          "athena-convex-storefront-composition",
          "athena-convex-storefront-failure-visibility",
        ],
        note: "Use this when the shared workflow-trace or POS local sync contract, POS local-first sync/storage/read-model/command-gateway files, terminal seed lookup, the POS register bootstrap or drawer gate, the `pos_session` / `register_session` trace writers, the trace route/view, or POS register, transaction, and cash-controls trace entry points change. It exercises the trace schema and presentation contract, the session/register trace writers, local sync ingestion/projection/read-model adjacency, the drawer-open bootstrap handoff, the shared trace route, terminal fallback behavior, and the operator-facing POS and cash-controls surfaces before broader package validation.",
      },
      {
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
        title: "Frontend test harness edits",
        touchedPaths: ["src/test", "src/tests", "vitest.setup.ts"],
        commands: [{ kind: "script", script: "test" }],
        note: "Run the package suite when package-local frontend test helpers or focused regression tests change.",
      },
      {
        title: "Convex or backend-adjacent edits",
        touchedPaths: [
          "convex",
          "scripts/convex-audit.sh",
          "scripts/convex-lint-changed.sh",
          "scripts/convexPaginationAntiPatternCheck.py",
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
        note: "Any change that can affect Convex HTTP wiring, serviceOps schemas and workflows, shared operational rails, or route-to-backend composition should include the Convex audit pair.",
      },
      {
        title: "Route runtime or build-pipeline edits",
        touchedPaths: [
          "src/main.tsx",
          "src/routeTree.gen.ts",
          "src/routeTree.browser-boundary.test.ts",
          "vitest.config.ts",
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
            command:
              "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
          },
          { kind: "script", script: "build" },
        ],
        behaviorScenarios: ["athena-admin-shell-boot"],
        note: "Run these when bootstrap, generated router state, or package build configuration changes so browser-entry regressions fail before the route tree reaches Arc.",
      },
      {
        title: "Storybook and frontend tooling edits",
        touchedPaths: [
          ".storybook",
          "index.html",
          "src/stories",
          "src/index.css",
          "src/design-system-build-config.test.ts",
          "tailwind.config.js",
          "postcss.config.js",
          "package.json",
          "README.md",
          "eslint.config.js",
          "scripts/frontend-lint-changed.sh",
          ".gitignore",
        ],
        commands: [
          { kind: "script", script: "test" },
          { kind: "script", script: "build" },
          { kind: "script", script: "storybook:build" },
        ],
        note: "Use this when the document shell, Storybook config, story files, or package-level frontend tooling changes need isolated validation.",
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
        behaviorScenarios: ["storefront-backend-first-load"],
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
        behaviorScenarios: ["storefront-backend-first-load"],
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
            command:
              "node --check packages/valkey-proxy-server/test-connection.js",
          },
        ],
        note: "Keep the live Redis probe syntax-checked locally; run the environment-dependent connection probe manually when cluster access is available.",
      },
    ],
  },
] satisfies HarnessAppRegistryEntry[];

const NON_HARNESS_PACKAGE_REGISTRY =
  [] as const satisfies readonly NonHarnessPackageRegistration[];

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
  return HARNESS_PACKAGE_REGISTRY.find(
    (entry) => entry.packageDir === packageDir,
  );
}
