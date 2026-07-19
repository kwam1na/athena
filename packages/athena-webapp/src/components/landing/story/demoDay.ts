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

export const demoStore = {
  currency: SHARED_DEMO_STORE_IDENTITY.currency,
  name: SHARED_DEMO_STORE_IDENTITY.storeName,
  registerNumber: "DEMO-01",
} as const;

export const demoStaff = {
  cashierFirstName: SHARED_DEMO_STAFF_STORY.cashier.firstName,
  managerFirstName: SHARED_DEMO_STAFF_STORY.manager.firstName,
} as const;

export const dayMoments = [
  { key: "opening", label: "Opening Handoff", time: "8:47 AM" },
  { key: "operations", label: "Daily Operations", time: "11:20 AM" },
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
  receiptNumber: "0041",
  time: "3:14 PM",
  total: kenteScarf.price + blackSoap.price, // 38500
} as const;

// Cash drawer economics. Opening float matches SHARED_DEMO_CASH_SEED.
export const drawer = {
  countedCash: 128_500,
  depositAmount: 120_000,
  // float + all cash payments across the day
  expectedCash: 5_000 + 124_000,
  // drawer state either side of the 3:14 PM sale (float + cash so far)
  expectedAfterSale: 103_300,
  expectedBeforeSale: 64_800,
  openingFloat: 5_000,
  variance: 128_500 - 129_000, // GH₵5 short, approved at closeout
} as const;

// How customers paid across the full day; sums to net sales.
export const payments = {
  card: 65_500,
  cash: 124_000,
  mobileMoney: 25_000,
} as const;

export const dayTotals = {
  itemsSold: 26,
  netSales: payments.cash + payments.card + payments.mobileMoney, // 214500
  transactions: 14,
} as const;

// Where the day stood when the owner glanced at Daily Operations mid-morning.
export const morningSnapshot = {
  itemsSold: 11,
  netSales: 68_000,
  transactions: 6,
} as const;

// Highest-volume items in the day's close; quantities priced from the shared
// catalog so the amounts stay honest.
export const topItems = [
  { name: kenteScarf.name, quantity: 2, total: kenteScarf.price * 2 },
  { name: sharedDemoProductBySlug("demo-shea-butter").name, quantity: 5, total: sharedDemoProductBySlug("demo-shea-butter").price * 5 },
  { name: blackSoap.name, quantity: 6, total: blackSoap.price * 6 },
  { name: sharedDemoProductBySlug("demo-clay-mug").name, quantity: 3, total: sharedDemoProductBySlug("demo-clay-mug").price * 3 },
] as const;

// Kente Scarf starts the day with 6 on hand and sells 2, so the low-stock
// carry-forward that EOD hands to tomorrow's opening reads "4 left".
export const carryForward = {
  itemName: kenteScarf.name,
  remaining:
    SHARED_DEMO_PRODUCTS.find((product) => product.slug === "demo-kente-scarf")!
      .inventoryCount - 2,
} as const;

export const automationMoments = [
  { key: "opening", label: "Started the opening and confirmed the float" },
  { key: "operations", label: "Watched the registers and routed attention" },
  { key: "sale", label: "Synced every sale from the counter" },
  { key: "cash", label: "Reconciled the drawer and surfaced the variance" },
  { key: "close", label: "Prepared the close under store policy" },
] as const;

export function formatDemoMoney(minorUnits: number) {
  return formatStoredCurrencyAmount(demoStore.currency, minorUnits, {
    revealMinorUnits: true,
  });
}
