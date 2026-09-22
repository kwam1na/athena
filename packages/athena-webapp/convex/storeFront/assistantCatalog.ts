import { v } from "convex/values";

import { internalQuery } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { toDisplayAmount } from "../lib/currency";
import { currencyFormatter } from "../utils";
import { adjustSkuAvailabilityForActiveHolds } from "../inventory/products";
import { searchAssistantVisibleProductSkusWithCtx } from "../inventory/skuSearch";
import { stockStateOf } from "../stockOps/stockState";

/**
 * `assistant_catalog.v1` — what an external assistant may be told about this
 * shop's catalogue.
 *
 * The validator is CLOSED on purpose, and it is the contract rather than the
 * privacy control: the search it projects already ran over an index that
 * never held a barcode or a hidden row, so nothing forbidden could reach this
 * point. What the closed shape buys is that the next field someone adds to a
 * projection row does not silently become public — adding it here is a
 * decision, reviewed as one.
 *
 * Everything in it is already on the storefront: name, description, category,
 * the option axes, the price as this store formats it, and stock as one of
 * three words. Counts, costs, ids and POS flags have no field to travel in.
 */
export const ASSISTANT_CATALOG_CONTRACT_VERSION = "assistant_catalog.v1";

/** Enough to say what a thing is; not enough to republish the shop's copy. */
export const ASSISTANT_CATALOG_DESCRIPTION_MAX_LENGTH = 400;
export const ASSISTANT_CATALOG_IMAGE_URLS_PER_OPTION = 3;
/** The wire protocol caps a response at 32 KB; this leaves headroom for it. */
export const ASSISTANT_CATALOG_BODY_MAX_BYTES = 24 * 1024;

const nullableStringValidator = v.union(v.string(), v.null());
const nullableNumberValidator = v.union(v.number(), v.null());

export const assistantCatalogOptionValidator = v.object({
  colorName: nullableStringValidator,
  imageUrls: v.array(v.string()),
  length: nullableNumberValidator,
  priceAmountMinor: v.number(),
  priceFormatted: v.string(),
  size: nullableStringValidator,
  // Absent, not null: a SKU whose code equals its barcode has no code to
  // give, and an empty string would still be a slot to read a barcode out of.
  sku: v.optional(v.string()),
  stock: v.union(v.literal("in_stock"), v.literal("low"), v.literal("out")),
});

export const assistantCatalogMatchValidator = v.object({
  categoryName: nullableStringValidator,
  description: nullableStringValidator,
  options: v.array(assistantCatalogOptionValidator),
  productName: v.string(),
  productSlug: nullableStringValidator,
  subcategoryName: nullableStringValidator,
});

export const assistantCatalogResponseValidator = v.object({
  contractVersion: v.literal(ASSISTANT_CATALOG_CONTRACT_VERSION),
  /** Hey Lobby's clock stamps receipt; this is validated, never rendered. */
  fetchedAt: v.string(),
  /** The visible catalogue was searched for every meaningful token. */
  exhaustive: v.boolean(),
  hasMore: v.boolean(),
  matches: v.array(assistantCatalogMatchValidator),
  source: v.object({ currency: v.string(), name: v.string() }),
});

const HTML_TAG = /<[^>]*>/g;
const WHITESPACE = /\s+/g;

/** Product copy is authored as markup; an assistant quotes text, not tags. */
export function toPlainDescription(value: string | undefined): string | null {
  if (!value) return null;
  const plain = value
    .replace(HTML_TAG, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(WHITESPACE, " ")
    .trim();
  if (!plain) return null;
  return Array.from(plain)
    .slice(0, ASSISTANT_CATALOG_DESCRIPTION_MAX_LENGTH)
    .join("");
}

export type AssistantCatalogBody = {
  contractVersion: typeof ASSISTANT_CATALOG_CONTRACT_VERSION;
  exhaustive: boolean;
  fetchedAt: string;
  hasMore: boolean;
  matches: Array<{
    categoryName: string | null;
    description: string | null;
    options: Array<{
      colorName: string | null;
      imageUrls: string[];
      length: number | null;
      priceAmountMinor: number;
      priceFormatted: string;
      size: string | null;
      sku?: string;
      stock: "in_stock" | "low" | "out";
    }>;
    productName: string;
    productSlug: string | null;
    subcategoryName: string | null;
  }>;
  source: { currency: string; name: string };
};

function byteLengthOf(body: AssistantCatalogBody): number {
  return new TextEncoder().encode(JSON.stringify(body)).length;
}

/**
 * Drop whole trailing matches until the body fits, and say so.
 *
 * Trailing, because the search already ranked them: the answer keeps the best
 * matches rather than a truncated version of all of them, and `hasMore` tells
 * the caller the shortening happened.
 */
export function fitAssistantCatalogBody(
  body: AssistantCatalogBody,
): AssistantCatalogBody {
  let fitted = body;
  while (
    fitted.matches.length > 0 &&
    byteLengthOf(fitted) > ASSISTANT_CATALOG_BODY_MAX_BYTES
  ) {
    fitted = {
      ...fitted,
      hasMore: true,
      matches: fitted.matches.slice(0, -1),
    };
  }
  return fitted;
}

export async function searchAssistantCatalogWithCtx(
  ctx: QueryCtx,
  args: { limit: number; q: string; storeId: Id<"store"> },
): Promise<AssistantCatalogBody> {
  const store = await ctx.db.get("store", args.storeId);
  const currency = store?.currency ?? "GHS";
  const formatter = currencyFormatter(currency);
  const fetchedAt = new Date().toISOString();

  const search = await searchAssistantVisibleProductSkusWithCtx(ctx, {
    limit: args.limit,
    query: args.q,
    storeId: args.storeId,
  });

  // One holds read for every option in the answer, so the stock a shopper is
  // told matches what the register has already taken off the shelf.
  const options = search.products.flatMap((product) => product.options);
  const adjusted = await adjustSkuAvailabilityForActiveHolds(ctx, {
    skus: options.map((projection) => ({
      _id: projection.productSkuId,
      quantityAvailable: projection.quantityAvailable,
    })),
    storeId: args.storeId,
  });
  const availableBySku = new Map<string, number>(
    adjusted.map((sku) => [String(sku._id), sku.quantityAvailable]),
  );

  const matches = search.products.map((product) => {
    const first = product.options[0];
    return {
      categoryName: first.categoryName ?? null,
      description: toPlainDescription(first.productDescription),
      options: product.options.map((projection) => {
        const codeIsBarcode =
          projection.normalizedSku !== undefined &&
          projection.normalizedSku === projection.normalizedBarcode;
        return {
          colorName: projection.colorName ?? null,
          imageUrls: projection.images.slice(
            0,
            ASSISTANT_CATALOG_IMAGE_URLS_PER_OPTION,
          ),
          length: projection.length ?? null,
          priceAmountMinor: projection.price,
          priceFormatted: formatter.format(toDisplayAmount(projection.price)),
          size: projection.size ?? null,
          ...(projection.sku && !codeIsBarcode ? { sku: projection.sku } : {}),
          stock: stockStateOf(
            availableBySku.get(String(projection.productSkuId)) ?? 0,
          ),
        };
      }),
      productName: first.productName,
      productSlug: first.productSlug ?? null,
      subcategoryName: first.subcategoryName ?? null,
    };
  });

  return fitAssistantCatalogBody({
    contractVersion: ASSISTANT_CATALOG_CONTRACT_VERSION,
    exhaustive: search.searched && !search.candidateOverflow,
    fetchedAt,
    hasMore: search.truncated,
    matches,
    source: { currency, name: store?.name ?? "" },
  });
}

/**
 * The only catalogue read the assistant endpoint makes.
 *
 * `q` arrives as a plain string with every bound already applied by the route,
 * so a validator failure here can never print the shopper's question into a
 * Convex error message.
 */
export const search = internalQuery({
  args: {
    limit: v.number(),
    q: v.string(),
    storeId: v.id("store"),
  },
  returns: assistantCatalogResponseValidator,
  handler: async (ctx, args) => searchAssistantCatalogWithCtx(ctx, args),
});
