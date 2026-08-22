/**
 * Closed catalog of Athena read intents.
 *
 * Read intents are not write capabilities: a capability names an effect a
 * caller may cause, an intent names a body of data a caller may observe. The
 * operation admission rail resolves read definitions against this union, and
 * shared-demo read policy grants a subset of it (see
 * `SHARED_DEMO_ALLOWED_READ_INTENTS` in `convex/sharedDemo/policy.ts`).
 *
 * Seeded in U1a from every intent declared in `readDefinitions.ts`, then CLOSED
 * in U1c by sweeping every public Convex query and every Hono route in
 * `convex/**` and naming the surface each one observes. Phase B units reference
 * intents from this list; they never coin new ones. If a unit finds a read that
 * genuinely fits nothing here, that is a catalog change reviewed on its own,
 * not a literal typed inline at a call site.
 *
 * Naming is `<area>.view`. The split that matters is who the data is FOR, not
 * which table it lives in: `inventory.catalog.view` is the operator's catalog,
 * `storefront.catalog.view` is the same rows as a shopper sees them, and the
 * two are separate intents because a demo or storefront-customer grant on one
 * must not silently carry the other.
 *
 * `delegation` (agent harness, V26-1262) states which organization-member role
 * HOLDS the intent when an operator delegates reads to an agent run, or `null`
 * when the intent is never agent-delegable (identity probes, demo bootstrap,
 * support channels, shopper-facing surfaces). It is derived from the
 * `allowedRoles` the owning domain handlers already enforce — `pos_only` where
 * every read on the surface admits both roles, `full_admin` where any read on
 * the surface is admin-only — and it only ever NARROWS what a delegated run may
 * reach. The public read rail does not consult it.
 */
export const ATHENA_READ_INTENT_DELEGATION_ROLES = ["pos_only", "full_admin"] as const;
export type AthenaReadIntentDelegationRole = (typeof ATHENA_READ_INTENT_DELEGATION_ROLES)[number];

export const ATHENA_READ_INTENT_CATALOG = [
  { id: "cash_controls.view", label: "Cash control reads", delegation: { minimumRole: "pos_only" } },
  { id: "customer_messaging.view", label: "Customer messaging reads", delegation: { minimumRole: "pos_only" } },
  { id: "daily_close.view", label: "Daily close reads", delegation: { minimumRole: "pos_only" } },
  { id: "daily_operations.view", label: "Daily operations reads", delegation: { minimumRole: "pos_only" } },
  { id: "demo.context.view", label: "Shared demo context reads", delegation: null },
  { id: "expenses.view", label: "Expense session and transaction reads", delegation: { minimumRole: "full_admin" } },
  { id: "harness.waivers.view", label: "Harness waiver request reads", delegation: null },
  { id: "identity.view", label: "Athena identity reads", delegation: null },
  { id: "intelligence.view", label: "Athena intelligence reads", delegation: { minimumRole: "full_admin" } },
  { id: "inventory.catalog.view", label: "Inventory catalog reads", delegation: { minimumRole: "pos_only" } },
  { id: "inventory.cost_overlay.view", label: "Inventory cost overlay reads", delegation: { minimumRole: "full_admin" } },
  { id: "inventory.stock.view", label: "Stock position and SKU activity reads", delegation: { minimumRole: "pos_only" } },
  {
    id: "notifications.subscriptions.view",
    label: "Notification subscription reads",
    delegation: { minimumRole: "full_admin" },
  },
  { id: "online_orders.view", label: "Online order reads", delegation: { minimumRole: "pos_only" } },
  { id: "operations.workItems.view", label: "Operational work item reads", delegation: { minimumRole: "pos_only" } },
  { id: "organization.view", label: "Organization reads", delegation: { minimumRole: "pos_only" } },
  { id: "platform.health.view", label: "Platform health reads", delegation: { minimumRole: "full_admin" } },
  { id: "pos.view", label: "POS reads", delegation: { minimumRole: "pos_only" } },
  { id: "procurement.view", label: "Procurement and replenishment reads", delegation: { minimumRole: "full_admin" } },
  { id: "remote_assist.view", label: "Remote Assist reads", delegation: null },
  { id: "reports.view", label: "Reporting surface reads", delegation: { minimumRole: "full_admin" } },
  { id: "service_ops.view", label: "Service operations reads", delegation: { minimumRole: "full_admin" } },
  { id: "staff.messages.view", label: "Staff message reads", delegation: { minimumRole: "pos_only" } },
  { id: "staff.view", label: "Staff profile and credential reads", delegation: { minimumRole: "full_admin" } },
  { id: "stock_adjustments.view", label: "Stock adjustment reads", delegation: { minimumRole: "pos_only" } },
  { id: "store.configuration.view", label: "Store configuration reads", delegation: { minimumRole: "full_admin" } },
  { id: "storefront.account.view", label: "Storefront shopper account reads", delegation: null },
  { id: "storefront.analytics.view", label: "Storefront analytics reads", delegation: { minimumRole: "full_admin" } },
  { id: "storefront.catalog.view", label: "Storefront catalog reads", delegation: null },
  { id: "storefront.reviews.view", label: "Storefront review reads", delegation: null },
  { id: "storefront.rewards.view", label: "Storefront rewards reads", delegation: null },
  { id: "workflow_traces.view", label: "Workflow trace reads", delegation: { minimumRole: "full_admin" } },
] as const;

export type AthenaReadIntent = (typeof ATHENA_READ_INTENT_CATALOG)[number]["id"];

const KNOWN_READ_INTENTS = new Set<string>(
  ATHENA_READ_INTENT_CATALOG.map(({ id }) => id),
);

export function isAthenaReadIntent(
  intent: string,
): intent is AthenaReadIntent {
  return KNOWN_READ_INTENTS.has(intent);
}

/**
 * Read intents an organization member of `role` holds when delegating to an
 * agent run. `full_admin` holds every delegable intent; `pos_only` holds only
 * the intents whose surface admits both roles. Non-delegable intents are never
 * returned for any role.
 */
export function delegatedReadIntentsForRole(
  role: AthenaReadIntentDelegationRole,
): AthenaReadIntent[] {
  return ATHENA_READ_INTENT_CATALOG.filter((entry) => {
    if (entry.delegation === null) return false;
    return role === "full_admin" || entry.delegation.minimumRole === "pos_only";
  }).map((entry) => entry.id);
}
