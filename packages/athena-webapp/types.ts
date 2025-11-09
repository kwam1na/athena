import { Infer } from "convex/values";
import { addressSchema } from "./convex/schemas/storeFront";
import { Doc } from "./convex/_generated/dataModel";

export type User = Doc<"users">;

export type Organization = Doc<"organization">;

export type Store = Doc<"store">;

export type Category = Doc<"category">;

export type Subcategory = Doc<"subcategory">;

export type ProductSku = Doc<"productSku"> & {
  productCategory?: string;
  colorName?: string | null;
  productName?: string;
  size?: string;
  length?: number;
};

export type Product = Doc<"product"> & {
  skus: ProductSku[];
  categoryName?: string;
  subcategoryName?: string;
  categorySlug?: string;
  subcategorySlug?: string;
  inventoryCount?: number;
};

export type Color = Doc<"color">;

// Store front
export type Bag = Doc<"bag">;

export type SavedBag = Doc<"savedBag">;

export type BagItem = Doc<"bagItem">;

export type SavedBagItem = Doc<"savedBagItem"> & {
  productCategory?: string;
  colorName?: string;
  productName?: string;
  productImage?: string;
  size?: string;
  length?: number;
};

export type Customer = Doc<"customer">;

export type Guest = Doc<"guest">;

export type Address = Infer<typeof addressSchema>;

export type AthenaUser = Doc<"athenaUser">;

export type CheckoutSessionItem = Doc<"checkoutSessionItem">;

export type InviteCode = Doc<"inviteCode">;

export type CheckoutSession = Doc<"checkoutSession">;

export type OnlineOrderItem = Doc<"onlineOrderItem">;

export type OnlineOrder = Doc<"onlineOrder">;

export type PromoCode = Doc<"promoCode">;

export type PromoCodeItem = Doc<"promoCodeItem"> & {
  productSku: ProductSku;
};

export type StoreFrontUser = Doc<"storeFrontUser">;

export type FeaturedItem = Doc<"featuredItem">;

export type BestSeller = Doc<"bestSeller">;

export type BannerMessage = Doc<"bannerMessage">;

export type Cashier = Doc<"cashier">;

export type Analytic = Doc<"analytics"> & {
  userData?: {
    email?: string;
  };
};

export type ComplimentaryProduct = Doc<"complimentaryProduct"> & {
  productSku: ProductSku;
};

export type Review = Doc<"review"> & {
  productImage?: string | null;
  productSku: ProductSku;
  user: Guest | StoreFrontUser;
};

export type Offer = Doc<"offer"> & {
  promoCode?: PromoCode;
};

// POS System Types
/**
 * POS (Point of Sale) system types for in-store transactions and customer management.
 *
 * The POS system is designed to work independently from the storefront but can
 * optionally link to existing storefront customers for unified customer experience.
 *
 * Key Features:
 * - Independent customer database for quick in-store lookup
 * - Optional linking to storefront users/guests
 * - Transaction tracking with inventory updates
 * - Customer loyalty and spending analytics
 * - Receipt generation and payment processing
 */

export type POSCustomer = Doc<"posCustomer">;

export type POSSession = Doc<"posSession"> & {
  customer?: POSCustomer; // Populated customer data when linked
};

export type POSTransaction = Doc<"posTransaction"> & {
  customer?: POSCustomer; // Populated customer data when linked
  items?: POSTransactionItem[]; // Transaction items
};

export type POSTransactionItem = Doc<"posTransactionItem"> & {
  product?: Product; // Populated product data
  productSku?: ProductSku; // Populated SKU data
  barcode?: string | null;
};

export type POSTerminal = Doc<"posTerminal">;

// Enhanced POS types with relationships for analytics and detailed views
export type POSCustomerWithStats = POSCustomer & {
  recentTransactions?: POSTransaction[];
  monthlySpending?: number;
  averageOrderValue?: number;
  lastPurchaseCategory?: string;
  visitFrequency?: number;
  loyaltyStatus?: "new" | "regular" | "vip";
};

export type POSTransactionWithDetails = POSTransaction & {
  customer?: POSCustomer;
  items: (POSTransactionItem & {
    product: Product;
    productSku: ProductSku;
  })[];
  cashier?: AthenaUser;
  store?: Store;
};

// Summary types for quick lookups and search results
export type POSCustomerSummary = Pick<
  POSCustomer,
  | "_id"
  | "_creationTime"
  | "name"
  | "email"
  | "phone"
  | "totalSpent"
  | "transactionCount"
  | "lastTransactionAt"
>;

export type POSTransactionSummary = Pick<
  POSTransaction,
  | "_id"
  | "_creationTime"
  | "transactionNumber"
  | "total"
  | "paymentMethod"
  | "status"
  | "completedAt"
>;
