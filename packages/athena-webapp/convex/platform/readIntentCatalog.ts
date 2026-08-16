/**
 * Closed catalog of Athena read intents.
 *
 * Read intents are not write capabilities: a capability names an effect a
 * caller may cause, an intent names a body of data a caller may observe. The
 * operation admission rail resolves read definitions against this union, and
 * shared-demo read policy grants a subset of it (see
 * `SHARED_DEMO_ALLOWED_READ_INTENTS` in `convex/sharedDemo/policy.ts`).
 *
 * Seeded in U1a from every intent declared in `readDefinitions.ts`; U1c closes
 * it for the remaining queries and HTTP read routes. Units reference intents,
 * they never coin them.
 */
export const ATHENA_READ_INTENT_CATALOG = [
  { id: "cash_controls.view", label: "Cash control reads" },
  { id: "daily_close.view", label: "Daily close reads" },
  { id: "daily_operations.view", label: "Daily operations reads" },
  { id: "inventory.catalog.view", label: "Inventory catalog reads" },
  { id: "inventory.cost_overlay.view", label: "Inventory cost overlay reads" },
  {
    id: "notifications.subscriptions.view",
    label: "Notification subscription reads",
  },
  { id: "online_orders.view", label: "Online order reads" },
  { id: "operations.workItems.view", label: "Operational work item reads" },
  { id: "organization.view", label: "Organization reads" },
  { id: "pos.view", label: "POS reads" },
  { id: "stock_adjustments.view", label: "Stock adjustment reads" },
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
