/**
 * Closed catalog of Athena write capabilities.
 *
 * A capability names an effect a caller may CAUSE; its read-side sibling,
 * `readIntentCatalog.ts`, names a body of data a caller may OBSERVE. The
 * operation admission rail resolves every write definition against this union,
 * and shared-demo write policy grants a subset of it (see
 * `SHARED_DEMO_ALLOWED_CAPABILITIES` below).
 *
 * The catalog is CLOSED. Definitions reference ids from this list; they never
 * coin new ones at a call site. If an operation genuinely fits nothing here,
 * that is a catalog change reviewed on its own merits — propose it, do not
 * inline a literal. A capability added carelessly is a permission grant nobody
 * reviewed.
 *
 * Ids are `<area>.<effect>`, ordered alphabetically so a diff to this file is
 * readable as a policy change.
 */
export const ATHENA_CAPABILITY_CATALOG = [
  { id: "administration.destructive", label: "Destructive administration" },
  { id: "administration.maintenance", label: "System maintenance" },
  { id: "appointments.manage", label: "Appointments" },
  { id: "approvals.manage", label: "Operational approvals" },
  { id: "billing.manage", label: "Payment collection and billing" },
  { id: "cash.control.write", label: "Cash controls" },
  { id: "catalog.quick_add", label: "Quick product creation" },
  { id: "catalog.maintain", label: "Catalog maintenance" },
  { id: "catalog.manage", label: "Catalog management" },
  { id: "customer.messaging.send", label: "Customer messaging" },
  { id: "daily_operations.write", label: "Daily operations" },
  { id: "demo.lifecycle", label: "Demo lifecycle" },
  { id: "expense.manage", label: "Expenses" },
  { id: "exports.generate", label: "Data exports" },
  { id: "identity.authenticate", label: "Identity authentication" },
  { id: "identity.manage", label: "Identity management" },
  { id: "integrations.manage", label: "Integrations and provider media" },
  { id: "intelligence.generate", label: "Athena intelligence generation" },
  { id: "intelligence.manage", label: "Athena intelligence management" },
  { id: "inventory.adjust", label: "Inventory adjustments and counts" },
  { id: "inventory.import", label: "Inventory import" },
  // The two public marketing ingress routes (`/walkthrough-requests`,
  // `/landing-funnel-events`) accept unauthenticated writes and are not backed
  // by any Convex module, so they have no module capability to inherit.
  // Naming them here is what lets their route definitions declare one instead
  // of coining a literal.
  { id: "marketing.funnel.track", label: "Landing funnel tracking" },
  { id: "marketing.walkthrough.request", label: "Walkthrough requests" },
  { id: "orders.create", label: "Order creation" },
  { id: "orders.fulfill", label: "Order fulfillment" },
  { id: "orders.manage", label: "Order management" },
  { id: "orders.return", label: "Order returns" },
  { id: "organization.manage", label: "Organization management" },
  { id: "payments.refund", label: "Refunds and payment reversals" },
  { id: "permissions.manage", label: "Permissions and invitations" },
  { id: "pos.catalog.manage", label: "POS catalog operations" },
  { id: "pos.customer.manage", label: "POS customers" },
  { id: "pos.recovery.manage", label: "POS recovery" },
  { id: "pos.sale.complete", label: "POS sale completion" },
  { id: "pos.session.manage", label: "POS sessions" },
  { id: "pos.sync.write", label: "POS synchronization" },
  { id: "pos.terminal.manage", label: "POS terminals" },
  { id: "pos.transaction.correct", label: "POS transaction corrections" },
  { id: "pos.transaction.void", label: "POS transaction voids" },
  { id: "procurement.manage", label: "Procurement" },
  { id: "remote_assist.manage", label: "Remote Assist" },
  { id: "reporting.generate", label: "Report generation" },
  { id: "reporting.maintain", label: "Reporting maintenance" },
  { id: "reviews.manage", label: "Reviews" },
  { id: "rewards.manage", label: "Rewards" },
  { id: "service.catalog.manage", label: "Service catalog" },
  { id: "service.cases.manage", label: "Service cases" },
  { id: "service.intake.write", label: "Service intake" },
  { id: "staff.authenticate", label: "Staff authentication and elevation" },
  { id: "staff.communication.write", label: "Staff communication" },
  { id: "staff.manage", label: "Staff management" },
  { id: "store.configure", label: "Store configuration" },
  { id: "storefront.analytics.write", label: "Storefront analytics" },
  { id: "storefront.content.manage", label: "Storefront merchandising" },
  { id: "storefront.session.manage", label: "Storefront sessions" },
  { id: "workspace.telemetry.write", label: "Workspace telemetry" },
] as const;

export type AthenaCapability = (typeof ATHENA_CAPABILITY_CATALOG)[number]["id"];

/** Store-scoped, fail-closed rollout for the weekly Reports surface. */
export const WEEKLY_REPORT_STORE_ALLOWLIST_ENV =
  "REPORTS_WEEKLY_STORE_ALLOWLIST";

export function hasCompletedWeeklyObservedAtVerification(
  store:
    | { weeklyObservedAtVerification?: { status: string } }
    | null
    | undefined,
): boolean {
  return store?.weeklyObservedAtVerification?.status === "complete";
}

/**
 * Every schedule version this store has ever had carries an explicit reporting
 * anchor.
 *
 * Absent evidence is NOT "probably fine": a version without
 * `reportingCycleStartsOn` resolves to Monday by default, so an unverified
 * store can be shown a seven-date frame it never agreed to. Written only by
 * `verifyStoreReportingCycleStartWithCtx`.
 */
export function hasCompletedWeeklyReportingCycleAnchorVerification(
  store:
    | { weeklyReportingCycleAnchorVerification?: { status: string } }
    | null
    | undefined,
): boolean {
  return (
    store?.weeklyReportingCycleAnchorVerification?.status === "complete"
  );
}

/**
 * A close completed before the store's weekly activation may not derive an
 * accepted baseline: "accepted EOW history begins when this lifecycle ships",
 * so recovery reconciliation must not manufacture retrospective acceptance
 * from pre-feature closes. A store without a floor is legacy-permissive.
 */
export function isCloseWithinWeeklyAcceptanceFloor(
  store: { weeklyReportingAcceptanceFloor?: number } | null | undefined,
  closeCompletedAt: number | undefined,
): boolean {
  const floor = store?.weeklyReportingAcceptanceFloor;
  if (floor === undefined) return true;
  return closeCompletedAt !== undefined && closeCompletedAt >= floor;
}

/**
 * The store-scoped weekly Reports gate.
 *
 * Three independent conditions, all fail-closed: an explicit allowlist entry,
 * a store-wide `observedAt` verification (the acceptance cutoff is meaningless
 * without it), and a store-wide reporting-anchor verification (the frame
 * itself is a guess without it). Prefer `isWeeklyReportingEnabledForStoreDoc`
 * at call sites that already hold the store document.
 */
export function isWeeklyReportingEnabledForStore(
  storeId: string,
  rawAllowlist: string | undefined = process.env[
    WEEKLY_REPORT_STORE_ALLOWLIST_ENV
  ],
  observedAtVerificationComplete = false,
  reportingCycleAnchorVerificationComplete = false,
): boolean {
  if (!rawAllowlist) return false;
  if (!observedAtVerificationComplete) return false;
  if (!reportingCycleAnchorVerificationComplete) return false;
  return rawAllowlist
    .split(",")
    .map((candidate) => candidate.trim())
    .filter(Boolean)
    .includes(storeId);
}

/** The same gate, reading both migration evidences off the store document. */
export function isWeeklyReportingEnabledForStoreDoc(
  storeId: string,
  store:
    | {
        weeklyObservedAtVerification?: { status: string };
        weeklyReportingCycleAnchorVerification?: { status: string };
      }
    | null
    | undefined,
  rawAllowlist: string | undefined = process.env[
    WEEKLY_REPORT_STORE_ALLOWLIST_ENV
  ],
): boolean {
  return isWeeklyReportingEnabledForStore(
    storeId,
    rawAllowlist,
    hasCompletedWeeklyObservedAtVerification(store),
    hasCompletedWeeklyReportingCycleAnchorVerification(store),
  );
}

export const SHARED_DEMO_ALLOWED_CAPABILITIES = [
  "approvals.manage",
  "cash.control.write",
  "catalog.maintain",
  "catalog.quick_add",
  "customer.messaging.send",
  "daily_operations.write",
  // Recording expenses is a first-class POS operation the demo exposes (the
  // /pos/expense route). Without this grant, expense event sync is rejected while
  // sales (pos.sale.complete) succeed.
  "expense.manage",
  "inventory.adjust",
  "orders.fulfill",
  "orders.manage",
  "orders.return",
  "payments.refund",
  "pos.sale.complete",
  "pos.sync.write",
  "pos.transaction.correct",
  "pos.transaction.void",
  // NOTE: the retired `reports.read` capability lived here so the demo could
  // READ Reports. Its successor is the `reports.view` READ intent in
  // `sharedDemo/policy.ts` — see `SHARED_DEMO_ALLOWED_READ_INTENTS`.
  "reviews.manage",
  "staff.authenticate",
  "staff.communication.write",
] as const satisfies readonly AthenaCapability[];

export function isSharedDemoCapabilityAllowed(capability: AthenaCapability) {
  return (
    SHARED_DEMO_ALLOWED_CAPABILITIES as readonly AthenaCapability[]
  ).includes(capability);
}
