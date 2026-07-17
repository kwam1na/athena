// Single source of truth for the shared demo store's story: identity, staff,
// and catalog. The Convex provisioning seed and the public landing page both
// read from this module so the demo a visitor opens matches the store the
// marketing narrative shows.

export const SHARED_DEMO_STORE_IDENTITY = {
  currency: "GHS",
  organizationName: "Osu Studio",
  storeName: "Osu Studio — Atelier",
} as const;

export const SHARED_DEMO_STAFF_STORY = {
  cashier: {
    firstName: "Efua",
    fullName: "Efua Tetteh",
    jobTitle: "Cashier",
    lastName: "Tetteh",
    username: "efua",
  },
  manager: {
    firstName: "Kwabena",
    fullName: "Kwabena Osei",
    jobTitle: "Studio Manager",
    lastName: "Osei",
    username: "kwabena",
  },
  owner: {
    firstName: "Studio",
    fullName: "Studio Owner",
    jobTitle: "Owner",
    lastName: "Owner",
  },
} as const;

export const SHARED_DEMO_TERMINAL_DISPLAY_NAME = "Studio Front Register";

export const SHARED_DEMO_OPENING_MESSAGE =
  "Efua: Morning studio count is complete. The pickup order is ready at the counter.";

export const SHARED_DEMO_CATEGORY = {
  name: "Handmade",
  slug: "demo-handmade",
} as const;

export const SHARED_DEMO_SUBCATEGORIES = [
  { key: "bath-body", name: "Bath & Body", slug: "demo-bath-body" },
  { key: "home-living", name: "Home & Living", slug: "demo-home-living" },
  { key: "textiles", name: "Textiles", slug: "demo-textiles" },
] as const;

export type SharedDemoSubcategoryKey =
  (typeof SHARED_DEMO_SUBCATEGORIES)[number]["key"];

export type SharedDemoProductStory = {
  inventoryCount: number;
  name: string;
  price: number;
  sku: string;
  slug: string;
  subcategoryKey: SharedDemoSubcategoryKey;
  unitCost: number;
};

// Prices and unit costs are minor units (pesewas); GH₵25.00 === 2500.
export const SHARED_DEMO_PRODUCTS: readonly SharedDemoProductStory[] = [
  { inventoryCount: 18, name: "Raw Shea Butter 250g", price: 6000, sku: "DEMO-SHEA-250", slug: "demo-shea-butter", subcategoryKey: "bath-body", unitCost: 3900 },
  { inventoryCount: 30, name: "Black Soap Bar", price: 3500, sku: "DEMO-SOAP-BAR", slug: "demo-black-soap", subcategoryKey: "bath-body", unitCost: 2100 },
  { inventoryCount: 12, name: "Hand-Thrown Clay Mug", price: 9500, sku: "DEMO-CLAY-MUG", slug: "demo-clay-mug", subcategoryKey: "home-living", unitCost: 6200 },
  { inventoryCount: 8, name: "Bolga Woven Basket", price: 22000, sku: "DEMO-BOLGA-BASKET", slug: "demo-bolga-basket", subcategoryKey: "home-living", unitCost: 14500 },
  { inventoryCount: 16, name: "Hibiscus Soy Candle", price: 12000, sku: "DEMO-SOY-CANDLE", slug: "demo-soy-candle", subcategoryKey: "home-living", unitCost: 7800 },
  { inventoryCount: 6, name: "Kente Scarf", price: 35000, sku: "DEMO-KENTE-SCARF", slug: "demo-kente-scarf", subcategoryKey: "textiles", unitCost: 23000 },
  { inventoryCount: 10, name: "Batik Tote Bag", price: 18000, sku: "DEMO-BATIK-TOTE", slug: "demo-batik-tote", subcategoryKey: "textiles", unitCost: 11700 },
  { inventoryCount: 24, name: "Beaded Bracelet", price: 5500, sku: "DEMO-BEAD-BRACELET", slug: "demo-beaded-bracelet", subcategoryKey: "textiles", unitCost: 3300 },
] as const;

export function sharedDemoProductBySku(sku: string) {
  const product = SHARED_DEMO_PRODUCTS.find((entry) => entry.sku === sku);
  if (!product) throw new Error(`Unknown shared demo product sku: ${sku}`);
  return product;
}

// The seeded ready-for-pickup online order, paid by card.
export const SHARED_DEMO_PICKUP_ORDER = {
  orderNumber: "DEMO-ORDER-001",
  quantity: 1,
  sku: "DEMO-SOAP-BAR",
} as const;

export function sharedDemoPickupOrderAmount() {
  return (
    sharedDemoProductBySku(SHARED_DEMO_PICKUP_ORDER.sku).price *
    SHARED_DEMO_PICKUP_ORDER.quantity
  );
}
