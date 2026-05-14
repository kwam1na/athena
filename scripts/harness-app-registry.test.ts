import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { HARNESS_APP_REGISTRY } from "./harness-app-registry";

describe("HARNESS_APP_REGISTRY", () => {
  it("keeps Convex changed-file lint aware of worktree edits", async () => {
    const script = await readFile(
      path.join(
        process.cwd(),
        "packages/athena-webapp/scripts/convex-lint-changed.sh"
      ),
      "utf8"
    );

    expect(script).toContain('"$MERGE_BASE"...HEAD');
    expect(script).toContain("git -C \"$REPO_ROOT\" diff --name-only --diff-filter=ACMR --");
    expect(script).toContain("git -C \"$REPO_ROOT\" diff --cached --name-only --diff-filter=ACMR --");
    expect(script).toContain("git -C \"$REPO_ROOT\" ls-files --others --exclude-standard --");
  });

  it("keeps the valkey proxy service registered as a service-package archetype", () => {
    const valkeyProxy = HARNESS_APP_REGISTRY.find(
      (entry) => entry.appName === "valkey-proxy-server"
    );

    expect(valkeyProxy?.appName).toBe("valkey-proxy-server");
    expect(valkeyProxy?.archetype).toBe("service-package");
    expect(valkeyProxy?.onboardingStatus).toBe("active");
    expect(valkeyProxy?.packageDir).toBe("packages/valkey-proxy-server");
    expect(valkeyProxy?.auditedRoots).toEqual(["."]);
    expect(valkeyProxy?.harnessDocs.entryIndexPath).toBe(
      "packages/valkey-proxy-server/docs/agent/entry-index.md"
    );
    expect(valkeyProxy?.harnessDocs.requiredIndexLinks).toContain(
      "./entry-index.md"
    );
    expect(valkeyProxy?.harnessDocs.requiredCodeMapLinks).toContain(
      "./entry-index.md"
    );
  });

  it("maps package metadata and service entry files into the valkey validation surface", () => {
    const valkeyProxy = HARNESS_APP_REGISTRY.find(
      (entry) => entry.appName === "valkey-proxy-server"
    );
    const serviceScenario = valkeyProxy?.validationScenarios.find(
      (scenario) => scenario.title === "Service logic, docs, or entrypoint edits"
    );
    const liveProbeScenario = valkeyProxy?.validationScenarios.find(
      (scenario) => scenario.title === "Live connection probe edits"
    );

    expect(serviceScenario).toMatchObject({
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
    });
    expect(serviceScenario?.behaviorScenarios).toEqual([
      "valkey-proxy-local-request-response",
    ]);
    expect(liveProbeScenario).toMatchObject({
      touchedPaths: ["test-connection.js"],
      commands: [
        { kind: "script", script: "test" },
        {
          kind: "raw",
          command: "node --check packages/valkey-proxy-server/test-connection.js",
        },
      ],
    });
  });

  it("keeps storefront full-browser validation scoped to routes and playwright specs", () => {
    const storefront = HARNESS_APP_REGISTRY.find(
      (entry) => entry.appName === "storefront-webapp"
    );
    const fullBrowserScenario = storefront?.validationScenarios.find(
      (scenario) => scenario.title === "Full browser journeys and payment redirects"
    );

    expect(fullBrowserScenario).toMatchObject({
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
    });
  });

  it("covers storefront runtime and build-pipeline edits with a typecheck scenario", () => {
    const storefront = HARNESS_APP_REGISTRY.find(
      (entry) => entry.appName === "storefront-webapp"
    );
    const runtimeScenario = storefront?.validationScenarios.find(
      (scenario) => scenario.title === "Route runtime or build-pipeline edits"
    );

    expect(runtimeScenario).toMatchObject({
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
    });
  });

  it("selects storefront backend first-load validation for API and deploy-surface edits", () => {
    const storefront = HARNESS_APP_REGISTRY.find(
      (entry) => entry.appName === "storefront-webapp"
    );
    const apiScenario = storefront?.validationScenarios.find(
      (scenario) => scenario.title === "Shared-lib, utility, or API-wrapper edits"
    );

    expect(apiScenario).toMatchObject({
      touchedPaths: ["src/lib", "src/utils", "src/api"],
      behaviorScenarios: ["storefront-backend-first-load"],
    });
  });

  it("covers Athena convex validation scripts in the backend-adjacent scenario", () => {
    const athena = HARNESS_APP_REGISTRY.find(
      (entry) => entry.appName === "athena-webapp"
    );
    const backendScenario = athena?.validationScenarios.find(
      (scenario) => scenario.title === "Convex or backend-adjacent edits"
    );

    expect(backendScenario).toMatchObject({
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
      note:
        "Any change that can affect Convex HTTP wiring, serviceOps schemas and workflows, shared operational rails, or route-to-backend composition should include the Convex audit pair.",
      behaviorScenarios: [
        "athena-convex-storefront-composition",
        "athena-convex-storefront-failure-visibility",
      ],
    });
  });

  it("covers changed Athena frontend source files with changed-file lint", () => {
    const athena = HARNESS_APP_REGISTRY.find(
      (entry) => entry.appName === "athena-webapp"
    );
    const frontendLintScenario = athena?.validationScenarios.find(
      (scenario) => scenario.title === "Changed frontend source lint"
    );

    expect(frontendLintScenario).toMatchObject({
      touchedPaths: ["src", "shared", "types.ts"],
      commands: [{ kind: "script", script: "lint:frontend:changed" }],
      note:
        "Run this for changed browser-facing TypeScript or TSX files so introduced ESLint failures are caught before PR handoff.",
    });
  });

  it("runs the Athena browser-boundary regression for route runtime changes", () => {
    const athena = HARNESS_APP_REGISTRY.find(
      (entry) => entry.appName === "athena-webapp"
    );
    const runtimeScenario = athena?.validationScenarios.find(
      (scenario) => scenario.title === "Route runtime or build-pipeline edits"
    );

    expect(runtimeScenario).toMatchObject({
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
          command: "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
        },
        { kind: "script", script: "build" },
      ],
    });
  });

  it("documents Daily store operations lifecycle validation coverage in Athena harness docs", () => {
    const athena = HARNESS_APP_REGISTRY.find(
      (entry) => entry.appName === "athena-webapp"
    );
    const dailyOperationsScenario = athena?.validationScenarios.find(
      (scenario) => scenario.title === "Daily store operations lifecycle edits"
    );

    expect(dailyOperationsScenario).toMatchObject({
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
          command: "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
        },
        { kind: "script", script: "build" },
      ],
      behaviorScenarios: ["athena-admin-shell-boot"],
      note:
        "Use this when Daily Opening, Daily Close, or the store-day operations route wiring changes. It validates the backend readiness gates, operator-facing acknowledgement views, generated Convex API surface, and route tree before broader package validation.",
    });
  });

  it("covers Athena frontend test harness surfaces including vitest setup", () => {
    const athena = HARNESS_APP_REGISTRY.find(
      (entry) => entry.appName === "athena-webapp"
    );
    const frontendHarnessScenario = athena?.validationScenarios.find(
      (scenario) => scenario.title === "Frontend test harness edits"
    );

    expect(frontendHarnessScenario).toMatchObject({
      touchedPaths: ["src/test", "src/tests", "vitest.setup.ts"],
      commands: [{ kind: "script", script: "test" }],
      note:
        "Run the package suite when package-local frontend test helpers or focused regression tests change.",
    });
  });

  it("documents Athena service management as a first-class harness discovery surface", () => {
    const athena = HARNESS_APP_REGISTRY.find(
      (entry) => entry.appName === "athena-webapp"
    );
    const backendFolders = athena?.keyFolderGroups.find(
      (group) => group.title === "Backend and test surfaces"
    )?.folders;
    const routeScenario = athena?.validationScenarios.find(
      (scenario) => scenario.title === "Route or UI-only edits"
    );

    expect(backendFolders).toContainEqual({
      path: "convex/serviceOps",
      description:
        "Service catalog, appointment, and service-case workflows layered on operational work items.",
    });
    expect(routeScenario?.note).toBe(
      "Use this for authenticated dashboard flows, service-management screens, route trees, and UI behavior changes that stay inside the frontend shell."
    );
    expect(routeScenario?.touchedPaths).toContain("src/config.test.ts");
  });

  it("documents cash-controls workflow validation coverage in Athena harness docs", () => {
    const athena = HARNESS_APP_REGISTRY.find(
      (entry) => entry.appName === "athena-webapp"
    );
    const cashControlsScenario = athena?.validationScenarios.find(
      (scenario) => scenario.title === "Cash-controls workflow edits"
    );

    expect(cashControlsScenario).toMatchObject({
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
          command: "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
        },
        { kind: "script", script: "build" },
      ],
      note:
        "Use this when register-session, deposit, closeout, dashboard, operations-queue approval, or cash-controls route wiring changes. This is the confirmation slice for drawers opened from POS showing up in the dashboard and register-session detail views. Run `bunx convex dev --once` from `packages/athena-webapp` before validation when generated client refs or new Convex function exports changed.",
      behaviorScenarios: ["athena-admin-shell-boot"],
    });
  });

  it("documents service-operations validation coverage in Athena harness docs", () => {
    const athena = HARNESS_APP_REGISTRY.find(
      (entry) => entry.appName === "athena-webapp"
    );
    const serviceOpsScenario = athena?.validationScenarios.find(
      (scenario) =>
        scenario.title ===
        "Service operations intake, catalog, appointments, and cases"
    );

    expect(serviceOpsScenario).toMatchObject({
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
          command: "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
        },
        { kind: "script", script: "build" },
      ],
      note:
        "Use this when service intake, catalog management, appointment scheduling, service-case execution, or manager-queue service handoffs change. It validates the command-result service flows plus the operator-facing intake, appointments, active-cases, catalog, and queue surfaces together before broader package validation.",
    });
  });

  it("documents auth, staff, and store-configuration validation coverage in Athena harness docs", () => {
    const athena = HARNESS_APP_REGISTRY.find(
      (entry) => entry.appName === "athena-webapp"
    );
    const staffFoundationScenario = athena?.validationScenarios.find(
      (scenario) => scenario.title === "Auth, staff, and store-configuration edits"
    );

    expect(staffFoundationScenario).toMatchObject({
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
          command: "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
        },
        { kind: "script", script: "build" },
      ],
      note:
        "Use this when login auth sync, store staff identity, admin store-configuration mutations, or cashier-auth command handling changes. It validates the retryable auth-sync path, the staff credential rules, the staff-management surface, the shared store-configuration hook plus fulfillment/maintenance/MTN MoMo regressions, and the register and cashier-auth flows that now share `staffProfileId` instead of the deleted cashier model.",
    });
  });

  it("documents expense-session validation coverage in Athena harness docs", () => {
    const athena = HARNESS_APP_REGISTRY.find(
      (entry) => entry.appName === "athena-webapp"
    );
    const expenseScenario = athena?.validationScenarios.find(
      (scenario) => scenario.title === "Expense-session and cart flow edits"
    );

    expect(expenseScenario).toMatchObject({
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
          command: "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
        },
        { kind: "script", script: "build" },
      ],
      note:
        "Use this when expense-session lifecycle, expense cart items, expense transaction finalization, or expense session hooks change. It validates the command-result expense session mutations plus the browser-facing session and cart hooks that now collapse expected failures to safe user-facing copy.",
    });
  });

  it("documents the shared client/server error foundation validation coverage in Athena harness docs", () => {
    const athena = HARNESS_APP_REGISTRY.find(
      (entry) => entry.appName === "athena-webapp"
    );
    const errorFoundationScenario = athena?.validationScenarios.find(
      (scenario) => scenario.title === "Client/server error foundation edits"
    );

    expect(errorFoundationScenario).toMatchObject({
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
          command: "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
        },
        { kind: "script", script: "build" },
      ],
      note:
        "Use this when the shared command-result contract, client command normalizers, generic catch boundary, or browser import boundary changes. Expected failures must stay in browser-safe `user_error` results, thrown faults must collapse to generic fallback copy, and shared modules must not import raw Convex server files into the browser tree.",
    });
  });

  it("documents omnichannel order and review validation coverage in Athena harness docs", () => {
    const athena = HARNESS_APP_REGISTRY.find(
      (entry) => entry.appName === "athena-webapp"
    );
    const omnichannelScenario = athena?.validationScenarios.find(
      (scenario) =>
        scenario.title ===
        "Omnichannel order, refund, review, and customer-history edits"
    );

    expect(omnichannelScenario).toMatchObject({
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
          command: "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
        },
        { kind: "script", script: "build" },
      ],
      behaviorScenarios: [
        "athena-convex-storefront-composition",
        "athena-convex-storefront-failure-visibility",
      ],
    });
  });

  it("documents admin quick-action unexpected-toast fallback coverage in Athena harness docs", () => {
    const athena = HARNESS_APP_REGISTRY.find(
      (entry) => entry.appName === "athena-webapp"
    );
    const adminQuickActionScenario = athena?.validationScenarios.find(
      (scenario) =>
        scenario.title === "Admin quick-action unexpected-toast fallback edits"
    );

    expect(adminQuickActionScenario).toMatchObject({
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
          command: "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
        },
        { kind: "script", script: "build" },
      ],
    });
  });

  it("documents stock-ops procurement validation coverage in Athena harness docs", () => {
    const athena = HARNESS_APP_REGISTRY.find(
      (entry) => entry.appName === "athena-webapp"
    );
    const coreFolders = athena?.keyFolderGroups.find(
      (group) => group.title === "Core app surfaces"
    )?.folders;
    const backendFolders = athena?.keyFolderGroups.find(
      (group) => group.title === "Backend and test surfaces"
    )?.folders;
    const stockOpsScenario = athena?.validationScenarios.find(
      (scenario) => scenario.title === "Stock-ops procurement and receiving edits"
    );

    expect(coreFolders).toContainEqual({
      path: "src/components/procurement",
      description:
        "Procurement planning and receiving views for replenishment pressure and purchase-order execution.",
    });
    expect(backendFolders).toContainEqual({
      path: "convex/stockOps",
      description:
        "Stock-adjustment, procurement, replenishment, receiving, and vendor flows layered over inventory state.",
    });
    expect(stockOpsScenario).toMatchObject({
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
      note:
        "Use this when stock adjustments, procurement recommendations, purchase-order lifecycle changes, or receiving route wiring move. Run `bunx convex dev --once` from `packages/athena-webapp` before validation when generated client refs or new stockOps function exports changed.",
      behaviorScenarios: ["athena-admin-shell-boot"],
    });
  });

  it("documents workflow trace foundation validation coverage in Athena harness docs", () => {
    const athena = HARNESS_APP_REGISTRY.find(
      (entry) => entry.appName === "athena-webapp"
    );
    const coreFolders = athena?.keyFolderGroups.find(
      (group) => group.title === "Core app surfaces"
    )?.folders;
    const backendFolders = athena?.keyFolderGroups.find(
      (group) => group.title === "Backend and test surfaces"
    )?.folders;
    const workflowTraceScenario = athena?.validationScenarios.find(
      (scenario) =>
        scenario.title ===
        "Workflow trace foundation, POS local sync/register, and trace-link edits"
    );

    expect(coreFolders).toContainEqual({
      path: "src/components/traces",
      description:
        "Shared workflow trace screens, ordered timelines, and trace detail primitives.",
    });
    expect(backendFolders).toContainEqual({
      path: "convex/workflowTraces",
      description:
        "Shared workflow trace creation, lookup, presentation, and adapter helpers.",
    });
    expect(workflowTraceScenario?.touchedPaths).toEqual([
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
    ]);
    expect(workflowTraceScenario?.commands).toEqual([
      {
        kind: "raw",
        command:
          "bun run --filter '@athena/webapp' test -- convex/workflowTraces/presentation.test.ts convex/workflowTraces/queryUsage.test.ts convex/workflowTraces/schemaIndexes.test.ts convex/workflowTraces/adapters/posSession.test.ts convex/workflowTraces/adapters/registerSession.test.ts convex/pos/application/completeTransaction.test.ts convex/pos/application/getTransactions.test.ts convex/pos/application/posSessionTracing.test.ts convex/pos/application/terminals.test.ts convex/pos/application/sync/ingestLocalEvents.test.ts convex/pos/application/sync/projectLocalEvents.test.ts convex/pos/public/sync.test.ts convex/pos/public/terminals.test.ts convex/inventory/posSessions.trace.test.ts convex/operations/registerSessionTracing.test.ts convex/operations/registerSessions.trace.test.ts convex/cashControls/registerSessionTraceLifecycle.test.ts src/components/traces/WorkflowTraceView.test.tsx 'src/routes/_authed/$orgUrlSlug/store/$storeUrlSlug/traces/$traceId.test.tsx' src/components/pos/PointOfSaleView.test.tsx src/components/pos/transactions/transactionColumns.test.tsx src/components/pos/transactions/TransactionView.test.tsx src/components/pos/transactions/TransactionsView.test.tsx src/components/pos/SessionManager.test.tsx src/components/pos/register/POSRegisterOpeningGuard.test.tsx src/components/pos/register/POSRegisterView.test.tsx src/components/pos/session/HeldSessionsList.test.tsx src/hooks/useGetTerminal.test.ts src/lib/pos/infrastructure/local/localPosEntryContext.test.ts src/lib/pos/infrastructure/local/localPosReadiness.test.ts src/lib/pos/infrastructure/local/posLocalStore.test.ts src/lib/pos/infrastructure/local/syncContract.test.ts src/lib/pos/infrastructure/local/syncScheduler.test.ts src/lib/pos/infrastructure/local/syncStatus.test.ts src/lib/pos/infrastructure/local/usePosLocalSyncRuntime.test.ts src/lib/pos/infrastructure/local/registerReadModel.test.ts src/lib/pos/infrastructure/local/localCommandGateway.test.ts src/lib/pos/presentation/register/useRegisterViewModel.test.ts src/components/cash-controls/CashControlsDashboard.test.tsx src/components/cash-controls/RegisterSessionView.test.tsx src/lib/traces/createWorkflowTraceId.test.ts",
      },
      { kind: "script", script: "audit:convex" },
      { kind: "script", script: "lint:convex:changed" },
      {
        kind: "raw",
        command: "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
      },
      { kind: "script", script: "build" },
    ]);
    expect(workflowTraceScenario?.note).toBe(
      "Use this when the shared workflow-trace or POS local sync contract, POS local-first sync/storage/read-model/command-gateway files, terminal seed lookup, POS local entry/readiness files, the POS register bootstrap or drawer gate, the `pos_session` / `register_session` trace writers, the trace route/view, or POS register, transaction, and cash-controls trace entry points change. It exercises the trace schema and presentation contract, the session/register trace writers, local sync ingestion/projection/read-model adjacency, POS entry/readiness gating, the drawer-open bootstrap handoff, the shared trace route, terminal fallback behavior, and the operator-facing POS and cash-controls surfaces before broader package validation."
    );
    expect(workflowTraceScenario?.behaviorScenarios).toEqual([
      "athena-admin-shell-boot",
      "athena-convex-storefront-composition",
      "athena-convex-storefront-failure-visibility",
    ]);
  });

  it("covers Athena shared type exports in the shared-lib validation scenario", () => {
    const athena = HARNESS_APP_REGISTRY.find(
      (entry) => entry.appName === "athena-webapp"
    );
    const sharedLibScenario = athena?.validationScenarios.find(
      (scenario) => scenario.title === "Shared-lib or utility edits"
    );
    const coreFolders = athena?.keyFolderGroups.find(
      (group) => group.title === "Core app surfaces"
    )?.folders;

    expect(athena?.auditedRoots).toEqual(["src", "shared", "convex"]);
    expect(coreFolders).toContainEqual({
      path: "shared",
      description: "Browser-safe helpers shared with Convex-backed workflows.",
    });
    expect(sharedLibScenario).toMatchObject({
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
          command: "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
        },
      ],
    });
  });

  it("covers Athena Storybook and frontend tooling edits with isolated validation", () => {
    const athena = HARNESS_APP_REGISTRY.find(
      (entry) => entry.appName === "athena-webapp"
    );
    const storybookScenario = athena?.validationScenarios.find(
      (scenario) => scenario.title === "Storybook and frontend tooling edits"
    );

    expect(storybookScenario).toMatchObject({
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
      note:
        "Use this when the document shell, Storybook config, story files, or package-level frontend tooling changes need isolated validation.",
    });
  });

  it("keeps every registered app active once onboarding is complete", () => {
    const statuses = HARNESS_APP_REGISTRY.map((entry) => entry.onboardingStatus);

    expect(statuses).toEqual(["active", "active", "active"]);
  });
});
