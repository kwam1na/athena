import { Doc } from "~/convex/_generated/dataModel";

export type User = Doc<"users">;

export type Organization = Doc<"organization">;

export type Store = Doc<"store">;

export type Category = Doc<"category">;

export type Subcategory = Doc<"subcategory">;

export type ProductSku = Doc<"productSku">;

export type Product = Doc<"product"> & { skus: ProductSku[] };

export type Color = Doc<"color">;

// Store front
export type Bag = Doc<"bag">;

export type BagItem = Doc<"bagItem">;

export type Customer = Doc<"customer">;

export type Guest = Doc<"guest">;

export type CheckoutSessionItem = Doc<"checkoutSessionItem">;

export type CheckoutSession = Doc<"checkoutSession">;

export type OnlineOrderItem = Doc<"onlineOrderItem">;

export type OnlineOrder = Doc<"onlineOrder">;
