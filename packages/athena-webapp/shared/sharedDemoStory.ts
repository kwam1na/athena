// Single source of truth for the shared demo store's story: identity, staff,
// and catalog. The Convex provisioning seed and the public landing page both
// read from this module so the demo a visitor opens matches the store the
// marketing narrative shows.

export const SHARED_DEMO_STORE_IDENTITY = {
  contactEmail: "hello@osustudio.com",
  contactLocation: "14 Nii Nortei Nyanchi Street, Osu, Accra, Ghana",
  contactPhoneNumber: "+233 24 555 0142",
  currency: "GHS",
  organizationName: "Osu Studio",
  receiptPolicyLines: [
    "Exchange unused handmade goods within 7 days with this receipt.",
    "Opened bath and body goods are final sale.",
  ],
  storeName: "Osu Studio — Atelier",
} as const;

export const SHARED_DEMO_STAFF_STORY = {
  cashier: {
    firstName: "Afua",
    fullName: "Afua Okyere",
    jobTitle: "Cashier",
    lastName: "Okyere",
    username: "afua",
  },
  manager: {
    firstName: "Kwabena",
    fullName: "Kwabena Agyei",
    jobTitle: "Studio Manager",
    lastName: "Agyei",
    username: "kay",
  },
  owner: {
    firstName: "Studio",
    fullName: "Studio Owner",
    jobTitle: "Owner",
    lastName: "Owner",
  },
} as const;

export const SHARED_DEMO_TERMINAL_DISPLAY_NAME = "Studio Front Counter";

export const SHARED_DEMO_OPENING_MESSAGE =
  "Afua: Morning studio count is complete. The pickup order is ready at the counter.";

/** "Afua O." — the abbreviated display form fixtures and screenshots use. */
export function sharedDemoStaffShortName(staff: {
  firstName: string;
  lastName: string;
}) {
  return `${staff.firstName} ${staff.lastName.charAt(0)}.`;
}

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
  imageFilename: string;
  inventoryCount: number;
  name: string;
  price: number;
  sku: string;
  slug: string;
  subcategoryKey: SharedDemoSubcategoryKey;
  unitCost: number;
};

export const SHARED_DEMO_PRODUCT_IMAGE_VERSION = "v2";

// Prices and unit costs are minor units (pesewas); GH₵25.00 === 2500.
export const SHARED_DEMO_PRODUCTS: readonly SharedDemoProductStory[] = [
  {
    imageFilename: "demo-shea-250.webp",
    inventoryCount: 18,
    name: "Raw Shea Butter 250g",
    price: 6000,
    sku: "FM5W-7K2-3Q9",
    slug: "demo-shea-butter",
    subcategoryKey: "bath-body",
    unitCost: 3900,
  },
  {
    imageFilename: "demo-soap-bar.webp",
    inventoryCount: 30,
    name: "Black Soap Bar",
    price: 3500,
    sku: "FM5W-4HT-8N6",
    slug: "demo-black-soap",
    subcategoryKey: "bath-body",
    unitCost: 2100,
  },
  {
    imageFilename: "demo-clay-mug.webp",
    inventoryCount: 12,
    name: "Hand-Thrown Clay Mug",
    price: 9500,
    sku: "FM5W-9C3-2RD",
    slug: "demo-clay-mug",
    subcategoryKey: "home-living",
    unitCost: 6200,
  },
  {
    imageFilename: "demo-bolga-basket.webp",
    inventoryCount: 8,
    name: "Bolga Woven Basket",
    price: 22000,
    sku: "FM5W-6BX-5W1",
    slug: "demo-bolga-basket",
    subcategoryKey: "home-living",
    unitCost: 14500,
  },
  {
    imageFilename: "demo-soy-candle.webp",
    inventoryCount: 16,
    name: "Hibiscus Soy Candle",
    price: 12000,
    sku: "FM5W-2MP-7F4",
    slug: "demo-soy-candle",
    subcategoryKey: "home-living",
    unitCost: 7800,
  },
  {
    imageFilename: "demo-kente-scarf.webp",
    inventoryCount: 6,
    name: "Kente Scarf",
    price: 35000,
    sku: "FM5W-8QJ-4K7",
    slug: "demo-kente-scarf",
    subcategoryKey: "textiles",
    unitCost: 23000,
  },
  {
    imageFilename: "demo-batik-tote.webp",
    inventoryCount: 10,
    name: "Batik Tote Bag",
    price: 18000,
    sku: "FM5W-5K4-9T2",
    slug: "demo-batik-tote",
    subcategoryKey: "textiles",
    unitCost: 11700,
  },
  {
    imageFilename: "demo-bead-bracelet.webp",
    inventoryCount: 24,
    name: "Beaded Bracelet",
    price: 5500,
    sku: "FM5W-3VN-6H8",
    slug: "demo-beaded-bracelet",
    subcategoryKey: "textiles",
    unitCost: 3300,
  },
] as const;

export function sharedDemoProductImageUrl({
  product,
  publicUrl,
  storeId,
}: {
  product: Pick<SharedDemoProductStory, "imageFilename">;
  publicUrl: string;
  storeId: string;
}) {
  const normalizedPublicUrl = publicUrl.trim().replace(/\/+$/, "");
  if (!normalizedPublicUrl) {
    throw new Error("The shared demo product image base URL is missing.");
  }
  return `${normalizedPublicUrl}/stores/${storeId}/products/shared-demo/${SHARED_DEMO_PRODUCT_IMAGE_VERSION}/${product.imageFilename}`;
}

export function sharedDemoProductBySku(sku: string) {
  const product = SHARED_DEMO_PRODUCTS.find((entry) => entry.sku === sku);
  if (!product) throw new Error(`Unknown shared demo product sku: ${sku}`);
  return product;
}

export function sharedDemoProductBySlug(slug: string) {
  const product = SHARED_DEMO_PRODUCTS.find((entry) => entry.slug === slug);
  if (!product) throw new Error(`Unknown shared demo product slug: ${slug}`);
  return product;
}

// The seeded ready-for-pickup online order, paid by card.
export const SHARED_DEMO_PICKUP_ORDER = {
  customerEmail: "customer@osustudio.com",
  customerFirstName: "Abena",
  customerLastName: "Owusu",
  customerPhoneNumber: "024 555 0142",
  orderNumber: "10427",
  quantity: 1,
  sku: sharedDemoProductBySlug("demo-black-soap").sku,
} as const;

const SHARED_DEMO_PICKUP_ORDER_AGE_MS = 4 * 60 * 60 * 1_000;
export function sharedDemoPickupOrderTimeline(now: number) {
  const placedAt = now - SHARED_DEMO_PICKUP_ORDER_AGE_MS;
  return {
    orderReceivedEmailSentAt: placedAt,
    placedAt,
  } as const;
}

export function sharedDemoPickupOrderAmount() {
  return (
    sharedDemoProductBySku(SHARED_DEMO_PICKUP_ORDER.sku).price *
    SHARED_DEMO_PICKUP_ORDER.quantity
  );
}
