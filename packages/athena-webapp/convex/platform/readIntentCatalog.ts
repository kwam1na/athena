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
 */
export const ATHENA_READ_INTENT_CATALOG = [
  { id: "cash_controls.view", label: "Cash control reads" },
  { id: "customer_messaging.view", label: "Customer messaging reads" },
  { id: "daily_close.view", label: "Daily close reads" },
  { id: "daily_operations.view", label: "Daily operations reads" },
  { id: "demo.context.view", label: "Shared demo context reads" },
  { id: "expenses.view", label: "Expense session and transaction reads" },
  { id: "harness.waivers.view", label: "Harness waiver request reads" },
  { id: "identity.view", label: "Athena identity reads" },
  { id: "intelligence.view", label: "Athena intelligence reads" },
  { id: "inventory.catalog.view", label: "Inventory catalog reads" },
  { id: "inventory.cost_overlay.view", label: "Inventory cost overlay reads" },
  { id: "inventory.stock.view", label: "Stock position and SKU activity reads" },
  {
    id: "notifications.subscriptions.view",
    label: "Notification subscription reads",
  },
  { id: "online_orders.view", label: "Online order reads" },
  { id: "operations.workItems.view", label: "Operational work item reads" },
  { id: "organization.view", label: "Organization reads" },
  { id: "platform.health.view", label: "Platform health reads" },
  { id: "pos.view", label: "POS reads" },
  { id: "procurement.view", label: "Procurement and replenishment reads" },
  { id: "remote_assist.view", label: "Remote Assist reads" },
  { id: "reports.view", label: "Reporting surface reads" },
  { id: "service_ops.view", label: "Service operations reads" },
  { id: "staff.messages.view", label: "Staff message reads" },
  { id: "staff.view", label: "Staff profile and credential reads" },
  { id: "stock_adjustments.view", label: "Stock adjustment reads" },
  { id: "store.configuration.view", label: "Store configuration reads" },
  { id: "storefront.account.view", label: "Storefront shopper account reads" },
  { id: "storefront.analytics.view", label: "Storefront analytics reads" },
  { id: "storefront.catalog.view", label: "Storefront catalog reads" },
  { id: "storefront.reviews.view", label: "Storefront review reads" },
  { id: "storefront.rewards.view", label: "Storefront rewards reads" },
  { id: "workflow_traces.view", label: "Workflow trace reads" },
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
