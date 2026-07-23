/**
 * Shared context for the operations screenshot fixtures (Daily Operations, Opening
 * Handoff, EOD Review).
 *
 * The three fixtures tell one continuous story about the same store day, so identity,
 * routing, dates, staff and the day's headline totals live here rather than being
 * re-authored (and drifting) in each file. Everything is pinned to the shared demo store
 * so a capture taken against `/demo` reads coherently with the real app chrome.
 *
 * Money is in minor units (pesewas), matching the rest of the app.
 */

import type { Id } from "~/convex/_generated/dataModel";

/** Saturday. The trading week runs Sunday 2026-07-12 → Saturday 2026-07-18. */
export const OPERATING_DATE = "2026-07-18";

export const STORE_ID = "demo-store-osu-atelier" as Id<"store">;

// The shared demo store's actual route params, so links resolve against the session a
// capture is taken in.
export const ORG_URL_SLUG = "demo";
export const STORE_URL_SLUG = "central";

export const LINK_PARAMS = {
  orgUrlSlug: ORG_URL_SLUG,
  storeUrlSlug: STORE_URL_SLUG,
} as const;

export const DAY_START = new Date(2026, 6, 18, 0, 0).getTime();
export const DAY_END = new Date(2026, 6, 19, 0, 0).getTime();

/** Minutes past local midnight on the operating day → epoch millis. */
export function momentAt(hour: number, minute: number) {
  return new Date(2026, 6, 18, hour, minute).getTime();
}

/**
 * Staff from the shared demo store's story (shared/sharedDemoStory.ts): Afua Okyere
 * cashiers, Kwabena Agyei manages. Fixtures and screenshots use the abbreviated
 * display form ("Afua O.").
 */
export const DEMO_STAFF = {
  cashier: "Afua O.",
  manager: "Kwabena A.",
} as const;

/**
 * Register sessions display as `{terminalName} / Register {registerNumber}` — see
 * `formatTerminalRegisterLinkLabel` in convex/operations/dailyOperations.ts. Values are
 * the shared demo store's terminal name and register number.
 */
export const REGISTER_DISPLAY_LABEL = "Studio Front Counter / Register 01";

/**
 * The carry-forward work item threaded through the Daily Operations stock nudge, the EOD
 * Review close, and the next Opening Handoff.
 *
 * A carry-forward row's title is the underlying operational work item's own `title` — for
 * an inventory follow-up the real template is `Review inventory for {product}` (see
 * `projectLocalEvents.ts`); there is no "restock"/"reorder" title in the product. The
 * work item type is likewise the real `synced_sale_inventory_review`.
 *
 * Because a synced-sale inventory review carries a product SKU, the product projects it as
 * a single-member *logical work group* rather than a bare work item (see the branch at
 * `dailyClose.ts` / `dailyOpening.ts` guarding on `synced_sale_inventory_review` +
 * `productSkuId`). That is why `subject.type` is `logical_operational_work_group` and the
 * metadata carries `oldestActionableAt` — EOD Review renders that as "Open since" and drops
 * status.
 */
export const KENTE_CARRY_FORWARD = {
  groupKey: "synced_sale_inventory_review:kente-scarf",
  priority: "normal",
  status: "open",
  title: "Review inventory for Kente Scarf",
  workItemType: "synced_sale_inventory_review",
} as const;

/**
 * The operating day's headline totals, shared so Daily Operations and EOD Review agree on
 * what Saturday earned. Cash + card + mobile money sum to `salesTotal`; the transaction
 * counts sum to `transactionCount`.
 */
export const SATURDAY_TOTALS = {
  cardTotal: 55000,
  cardTransactionCount: 5,
  cashTotal: 121400,
  cashTransactionCount: 15,
  itemsSold: 61,
  mobileMoneyTotal: 142500,
  mobileMoneyTransactionCount: 14,
  openingFloat: 50000,
  salesTotal: 318900,
  transactionCount: 34,
} as const;
