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

export type Product = Doc<"product"> & { skus: ProductSku[] };

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

export type PromoCodeItem = Doc<"promoCodeItem">;

export type StoreFrontUser = Doc<"storeFrontUser">;

export type FeaturedItem = Doc<"featuredItem">;

export type BestSeller = Doc<"bestSeller">;

export type Analytic = Doc<"analytics">;
