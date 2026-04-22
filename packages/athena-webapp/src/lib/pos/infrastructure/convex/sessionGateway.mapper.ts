import { z } from "zod";

import type { CartItem } from "@/components/pos/types";

const normalizedCartItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  barcode: z.string().optional(),
  sku: z.string().optional(),
  price: z.number(),
  quantity: z.number(),
  image: z.string().nullish().optional(),
  size: z.string().optional(),
  length: z.number().nullish().optional(),
  color: z.string().optional(),
  productId: z.string().optional(),
  skuId: z.string().optional(),
  areProcessingFeesAbsorbed: z.boolean().optional(),
}).transform((item) => ({
  id: item.id as CartItem["id"],
  name: item.name,
  barcode: item.barcode ?? "",
  sku: item.sku,
  price: item.price,
  quantity: item.quantity,
  image: item.image ?? null,
  size: item.size,
  length: item.length ?? null,
  color: item.color,
  productId: item.productId as CartItem["productId"],
  skuId: item.skuId as CartItem["skuId"],
  areProcessingFeesAbsorbed: item.areProcessingFeesAbsorbed,
}));

const rawSessionCartItemSchema = z.object({
  _id: z.string(),
  productName: z.string(),
  barcode: z.string().optional(),
  productSku: z.string().optional(),
  price: z.number(),
  quantity: z.number(),
  image: z.string().optional(),
  size: z.string().optional(),
  length: z.number().optional(),
  color: z.string().optional(),
  productId: z.string(),
  productSkuId: z.string(),
  areProcessingFeesAbsorbed: z.boolean().optional(),
}).transform((item) => ({
  id: item._id as CartItem["id"],
  name: item.productName,
  barcode: item.barcode ?? "",
  sku: item.productSku,
  price: item.price,
  quantity: item.quantity,
  image: item.image ?? null,
  size: item.size,
  length: item.length ?? null,
  color: item.color,
  productId: item.productId as CartItem["productId"],
  skuId: item.productSkuId as CartItem["skuId"],
  areProcessingFeesAbsorbed: item.areProcessingFeesAbsorbed,
}));

const sessionCartItemSchema = z.union([
  normalizedCartItemSchema,
  rawSessionCartItemSchema,
]);

type SessionWithCartItems = {
  cartItems?: unknown[];
};

type SessionWithNormalizedCartItems<TSession extends SessionWithCartItems> =
  Omit<TSession, "cartItems"> & {
    cartItems: CartItem[];
  };

function normalizeCartItems(items: unknown[] | undefined): CartItem[] {
  return z.array(sessionCartItemSchema).parse(items ?? []);
}

export function mapActiveSessionDto<TSession extends SessionWithCartItems>(
  session: TSession | null | undefined,
): SessionWithNormalizedCartItems<TSession> | null | undefined {
  if (session === undefined) {
    return undefined;
  }

  if (session === null) {
    return null;
  }

  return {
    ...session,
    cartItems: normalizeCartItems(session.cartItems),
  };
}

export function mapHeldSessionsDto<TSession extends SessionWithCartItems>(
  sessions: TSession[] | undefined,
): Array<SessionWithNormalizedCartItems<TSession>> | undefined {
  if (sessions === undefined) {
    return undefined;
  }

  return sessions.map((session) => ({
    ...session,
    cartItems: normalizeCartItems(session.cartItems),
  }));
}
