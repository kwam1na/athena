import {
  SHARED_DEMO_PRODUCTS,
  SHARED_DEMO_STAFF_STORY,
  SHARED_DEMO_STORE_IDENTITY,
  sharedDemoProductBySlug,
} from "~/shared/sharedDemoStory";
import { formatStoredCurrencyAmount } from "@/lib/pos/displayAmounts";

// One fictional operating day at the shared demo store. Every scene on the
// landing page reads from this module so the numbers reconcile page-wide:
// the 3:14 PM sale is part of the cash total, the cash total builds the
// drawer's expected amount, and the payment split sums to net sales.
// demoDay.test.ts enforces those invariants.
//
// The day is the busy Wednesday (2026-07-15) from the operations screenshot
// fixtures (src/stories/operations) — the same day captured in the landing
// page's workspace shots — so the live scenes and the screenshots tell one
// story: GH₵6,700 net, GH₵1,900 cash on a GH₵500 float, and the GH₵5
// shortage surfaced at close.

export const demoStore = {
  currency: SHARED_DEMO_STORE_IDENTITY.currency,
  name: SHARED_DEMO_STORE_IDENTITY.storeName,
  registerNumber: "01",
} as const;

export const demoStaff = {
  cashierFirstName: SHARED_DEMO_STAFF_STORY.cashier.firstName,
  managerFirstName: SHARED_DEMO_STAFF_STORY.manager.firstName,
} as const;

export const dayMoments = [
  // 9:34 AM is when Athena starts the store day in the Opening Handoff shot;
  // 1:08 PM matches the Daily Operations shot's "data refreshed" clock.
  { key: "opening", label: "Opening Handoff", time: "9:34 AM" },
  { key: "operations", label: "Daily Operations", time: "1:08 PM" },
  { key: "sale", label: "Point of Sale", time: "3:14 PM" },
  { key: "cash", label: "Cash Controls", time: "5:40 PM" },
  { key: "close", label: "EOD Review", time: "8:03 PM" },
] as const;

// The traceable sale: completed offline at the register at 3:14 PM, paid in
// cash, then synced into the register session in Cash Controls.
const kenteScarf = sharedDemoProductBySlug("demo-kente-scarf");
const blackSoap = sharedDemoProductBySlug("demo-black-soap");

export const tracedSale = {
  cashier: SHARED_DEMO_STAFF_STORY.cashier.firstName,
  items: [
    { name: kenteScarf.name, price: kenteScarf.price, quantity: 1 },
    { name: blackSoap.name, price: blackSoap.price, quantity: 1 },
  ],
  // The Daily Operations shot's timeline reaches sale #1149 by 12:58 PM;
  // this mid-afternoon sale comes a few receipts later.
  receiptNumber: "1154",
  time: "3:14 PM",
  total: kenteScarf.price + blackSoap.price, // 38500
} as const;

// Cash drawer economics. The GH₵500 float is the "carried-over cash" tile in
// the Daily Operations shot; expected/counted/deposited match the Wednesday
// close in the operations screenshot fixtures.
export const drawer = {
  countedCash: 239_500,
  depositAmount: 200_000,
  // float + all cash payments across the day
  expectedCash: 50_000 + 190_000,
  // drawer state either side of the 3:14 PM sale (float + cash so far)
  expectedAfterSale: 183_500,
  expectedBeforeSale: 145_000,
  openingFloat: 50_000,
  variance: 239_500 - 240_000, // GH₵5 short, surfaced at closeout
} as const;

// How customers paid across the full day; sums to net sales. Mirrors the
// payment-mix panel in the Daily Operations shot (momo-heavy, 28 payments).
export const payments = {
  card: 150_000,
  cash: 190_000,
  mobileMoney: 330_000,
} as const;

export const dayTotals = {
  itemsSold: 51,
  netSales: payments.cash + payments.card + payments.mobileMoney, // 670000
  transactions: 28,
} as const;

// Where the day stood when the owner glanced at Daily Operations mid-morning.
export const morningSnapshot = {
  itemsSold: 11,
  netSales: 68_000,
  transactions: 6,
} as const;

// Highest-volume items in the day's close; quantities priced from the shared
// catalog so the amounts stay honest. Same list as the "Today's top items"
// panel in the Daily Operations shot.
export const topItems = [
  { name: kenteScarf.name, quantity: 4, total: kenteScarf.price * 4 },
  { name: sharedDemoProductBySlug("demo-bolga-basket").name, quantity: 5, total: sharedDemoProductBySlug("demo-bolga-basket").price * 5 },
  { name: sharedDemoProductBySlug("demo-batik-tote").name, quantity: 4, total: sharedDemoProductBySlug("demo-batik-tote").price * 4 },
  { name: sharedDemoProductBySlug("demo-soy-candle").name, quantity: 7, total: sharedDemoProductBySlug("demo-soy-candle").price * 7 },
  { name: sharedDemoProductBySlug("demo-shea-butter").name, quantity: 11, total: sharedDemoProductBySlug("demo-shea-butter").price * 11 },
] as const;

// Kente Scarf starts the day with 6 on hand and sells 4 (the 11:47 AM
// low-stock alert in the Daily Operations shot fires at 3 left, then the
// 3:14 PM traced sale takes one more), so the carry-forward that EOD hands
// to tomorrow's opening reads "2 left".
export const carryForward = {
  itemName: kenteScarf.name,
  remaining:
    SHARED_DEMO_PRODUCTS.find((product) => product.slug === "demo-kente-scarf")!
      .inventoryCount - 4,
} as const;

export const automationMoments = [
  { key: "opening", label: "Started the store day and staged the opening checklist" },
  { key: "operations", label: "Watched the registers and routed attention" },
  { key: "sale", label: "Synced every sale from the counter" },
  { key: "cash", label: "Reconciled the drawer and surfaced the variance" },
  { key: "close", label: "Prepared the close under the rules the owner set" },
] as const;

export function formatDemoMoney(minorUnits: number) {
  return formatStoredCurrencyAmount(demoStore.currency, minorUnits, {
    revealMinorUnits: true,
  });
}
