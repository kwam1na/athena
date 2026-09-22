/**
 * Stock state: the three words every customer-facing surface is allowed to
 * say about availability.
 *
 * Deliberately import-free. It is read by the agent harness's inventory ports
 * (which import the composition root) and by the assistant catalogue endpoint
 * (which must not), so the threshold lives in a module either side can pull in
 * without dragging the other's dependencies along. One threshold, one place:
 * a second definition is how "low" starts meaning two different things on two
 * surfaces of the same shop.
 */

/** The store's own low-stock line, unchanged since the inventory ports. */
export const LOW_STOCK_THRESHOLD = 5;

export type StockState = "in_stock" | "low" | "out";

export function stockStateOf(available: number): StockState {
  if (available <= 0) return "out";
  return available <= LOW_STOCK_THRESHOLD ? "low" : "in_stock";
}
