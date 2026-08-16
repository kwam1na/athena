/* eslint-disable @convex-dev/no-collect-in-query -- Query refactors are tracked in V26-168, V26-169, and V26-170; this PR only hardens API boundaries. */
import { v } from "convex/values";
import { action, internalQuery, mutation, query } from "../_generated/server";
import { deleteFileInR2, uploadFileToR2 } from "../cloudflare/r2";
import { refreshCatalogSummaryWithCtx } from "./catalogSummary";
import { getProductName } from "../utils";
import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { requireAuthenticatedAthenaUserWithCtx } from "../lib/athenaUserAuth";
import {
  admitPublicAction,
  admitPublicMutation,
  admitPublicQuery,
} from "../platform/operationAdmission";
import {
  backfillUndefinedSkuVisibilityOperationDefinition,
  deleteProductSkuImagesOperationDefinition,
  generateProductSkuUploadUrlOperationDefinition,
  makeAllProductsVisibleOperationDefinition,
  nukeProblematicImagesOperationDefinition,
  updateProductSkuOperationDefinition,
  uploadProductSkuImagesOperationDefinition,
} from "../operationAdmission/domains/u3_inventoryCatalog_definitions";
import {
  getInventoryBySkuIdsReadDefinition,
  getProductSkuByIdReadDefinition,
} from "../operationAdmission/domains/u3_inventoryCatalog_readDefinitions";
import type { OperationActionCtx } from "../operationAdmission/rail";
import type {
  OperationMutationCtx,
  OperationQueryCtx,
} from "../operationAdmission/types";
import {
  upsertProductSkuSearchProjection,
  upsertProductSkuSearchProjections,
} from "./skuSearch";

async function syncProductSkuSearchProjectionsByStore(
  ctx: Parameters<typeof upsertProductSkuSearchProjections>[0],
  skus: Array<{ _id: Id<"productSku">; storeId: Id<"store"> }>,
) {
  const skuIdsByStore = new Map<Id<"store">, Array<Id<"productSku">>>();
  for (const sku of skus) {
    const skuIds = skuIdsByStore.get(sku.storeId) ?? [];
    skuIds.push(sku._id);
    skuIdsByStore.set(sku.storeId, skuIds);
  }
  await Promise.all(
    Array.from(skuIdsByStore, ([storeId, skuIds]) =>
      upsertProductSkuSearchProjections(ctx, skuIds, storeId),
    ),
  );
}
export const generateUploadUrl = mutation({
  args: {},
  handler: admitPublicMutation(
    generateProductSkuUploadUrlOperationDefinition,
    async (ctx: OperationMutationCtx) => {
      await requireAuthenticatedAthenaUserWithCtx(ctx);
      return await ctx.storage.generateUploadUrl();
    },
  ),
});

export const getById = query({
  args: { id: v.id("productSku") },
  handler: admitPublicQuery(
    getProductSkuByIdReadDefinition,
    async (ctx: OperationQueryCtx, args: { id: Id<"productSku"> }) => {
    const s = await ctx.db.get("productSku", args.id);
    if (!s) return null;

    // Fetch related product
    const product = await ctx.db.get("product", s.productId);
    // Fetch color (if present)
    const color = s.color ? await ctx.db.get("color", s.color) : null;
    // Fetch subcategory (from product)
    const subcategory = product?.subcategoryId
      ? await ctx.db.get("subcategory", product.subcategoryId)
      : null;
    // Fetch category (from product)
    const category = product?.categoryId
      ? await ctx.db.get("category", product.categoryId)
      : null;

    return {
      ...s,
      productName: product?.name,
      product,
      colorName: color?.name,
      color,
      productSubcategory: subcategory?.name,
      subcategory,
      productCategory: category?.name,
      category,
    };
    },
  ),
});

export const retrieve = internalQuery({
  args: { id: v.id("productSku") },
  handler: async (ctx, args) => {
    const s = await ctx.db.get("productSku", args.id);
    if (!s) return null;

    const product = await ctx.db.get("product", s.productId);
    const color = s.color ? await ctx.db.get("color", s.color) : null;
    const subcategory = product?.subcategoryId
      ? await ctx.db.get("subcategory", product.subcategoryId)
      : null;
    const category = product?.categoryId
      ? await ctx.db.get("category", product.categoryId)
      : null;

    return {
      ...s,
      productName: product?.name,
      product,
      colorName: color?.name,
      color,
      productSubcategory: subcategory?.name,
      subcategory,
      productCategory: category?.name,
      category,
    };
  },
});

async function getInventoryBySkuIdsWithCtx(
  ctx: QueryCtx,
  args: { skuIds: Id<"productSku">[] },
) {
  // Fetch all SKUs in parallel
  const skus = await Promise.all(
    args.skuIds.map((skuId) => ctx.db.get("productSku", skuId))
  );

  // Filter out nulls and return only inventory fields
  return skus
    .filter((sku): sku is NonNullable<typeof sku> => sku !== null)
    .map((sku) => ({
      _id: sku._id,
      inventoryCount: sku.inventoryCount,
      quantityAvailable: sku.quantityAvailable,
    }));
}

const inventoryBySkuIdsValidator = v.array(
  v.object({
    _id: v.id("productSku"),
    inventoryCount: v.number(),
    quantityAvailable: v.number(),
  })
);

export const getInventoryBySkuIds = query({
  args: { skuIds: v.array(v.id("productSku")) },
  returns: inventoryBySkuIdsValidator,
  handler: admitPublicQuery(
    getInventoryBySkuIdsReadDefinition,
    async (ctx: OperationQueryCtx, args: { skuIds: Id<"productSku">[] }) =>
      getInventoryBySkuIdsWithCtx(ctx, args),
  ),
});

/**
 * Internal sibling for the anonymous `POST /storefront/inventory/batch` route.
 * The public export stays until wave B2 flips the route to this reference.
 */
export const getInventoryBySkuIdsInternal = internalQuery({
  args: { skuIds: v.array(v.id("productSku")) },
  returns: inventoryBySkuIdsValidator,
  handler: async (ctx, args) => getInventoryBySkuIdsWithCtx(ctx, args),
});

export const update = mutation({
  args: { id: v.id("productSku"), update: v.record(v.string(), v.any()) },
  handler: admitPublicMutation(
    updateProductSkuOperationDefinition,
    async (
      ctx: OperationMutationCtx,
      args: { id: Id<"productSku">; update: Record<string, any> },
    ) => {
      await requireAuthenticatedAthenaUserWithCtx(ctx);
      if (args.update.images) {
        const sku = await ctx.db.get("productSku", args.id);
        if (!sku) return;

        await ctx.db.patch("productSku", args.id, {
          images: args.update.images,
        });
        await upsertProductSkuSearchProjection(ctx, args.id);
        await refreshCatalogSummaryWithCtx(ctx, sku.storeId);
      }
    },
  ),
});

export const uploadImages = action({
  args: {
    images: v.array(v.bytes()),
    storeId: v.id("store"),
    productId: v.id("product"),
  },
  handler: admitPublicAction(
    uploadProductSkuImagesOperationDefinition,
    async (
      _ctx: OperationActionCtx,
      args: {
        images: ArrayBuffer[];
        storeId: Id<"store">;
        productId: Id<"product">;
      },
    ) => {
      const uploadPromises = args.images.map(async (imgBuffer) => {
        return uploadFileToR2(
          imgBuffer,
          `stores/${args.storeId}/products/${args.productId}/${crypto.randomUUID()}.webp`
        );
      });
      const images = (await Promise.all(uploadPromises)).filter(
        (url) => url !== undefined
      );

      return { success: true, images };
    },
  ),
});

export const deleteImages = action({
  args: {
    imageUrls: v.array(v.string()),
  },
  handler: admitPublicAction(
    deleteProductSkuImagesOperationDefinition,
    async (_ctx: OperationActionCtx, args: { imageUrls: string[] }) => {
      const deletePromises = args.imageUrls.map(async (url) => {
        return deleteFileInR2(url);
      });

      await Promise.all(deletePromises);

      return { success: true };
    },
  ),
});

export const nukeProblematicImages = mutation({
  args: {},
  handler: admitPublicMutation(
    nukeProblematicImagesOperationDefinition,
    async (ctx: OperationMutationCtx) => {
    await requireAuthenticatedAthenaUserWithCtx(ctx);
    const productSkus = await ctx.db.query("productSku").collect();
    const publicUrl = process.env.R2_PUBLIC_URL;

    if (!publicUrl) throw new Error("Missing R2_PUBLIC_URL env var");

    const updates = productSkus.flatMap((sku) => {
      if (!Array.isArray(sku.images)) return [];

      const validImages = sku.images.filter(
        (img) => typeof img === "string" && img.includes(publicUrl)
      );

      if (validImages.length === sku.images.length) return [];

      return [
        ctx.db.patch("productSku", sku._id, { images: validImages }).then(() => {
          console.log(
            `✅ SKU ${sku._id}: removed ${sku.images.length - validImages.length} invalid images`
          );
        }),
      ];
    });

    await Promise.allSettled(updates);
    await syncProductSkuSearchProjectionsByStore(
      ctx,
      productSkus.filter(
        (sku) =>
          Array.isArray(sku.images) &&
          sku.images.some(
            (image) =>
              typeof image !== "string" || !image.includes(publicUrl),
          ),
      ),
    );

    return { success: true };
    },
  ),
});

export const makeAllProductsVisible = mutation({
  args: {},
  handler: admitPublicMutation(
    makeAllProductsVisibleOperationDefinition,
    async (ctx: OperationMutationCtx) => {
    await requireAuthenticatedAthenaUserWithCtx(ctx);
    const productSkus = await ctx.db.query("product").collect();

    const updates = productSkus.map(async (sku) => {
      return ctx.db.patch("product", sku._id, { isVisible: true }).then(() => {
        console.log(`✅ SKU ${sku._id}: set isVisible to true`);
      });
    });

    await Promise.allSettled(updates);
    const skus = await ctx.db.query("productSku").collect();
    await syncProductSkuSearchProjectionsByStore(ctx, skus);

    return { success: true, updatedCount: productSkus.length };
    },
  ),
});

export const backfillUndefinedSkuVisibilityFromProducts = mutation({
  args: {},
  handler: admitPublicMutation(
    backfillUndefinedSkuVisibilityOperationDefinition,
    async (ctx: OperationMutationCtx) => {
    await requireAuthenticatedAthenaUserWithCtx(ctx);
    const productSkus = await ctx.db.query("productSku").collect();
    const updatedSkus: typeof productSkus = [];
    let updatedCount = 0;
    let skippedMissingProductCount = 0;
    let skippedParentWithoutVisibilityCount = 0;

    for (const sku of productSkus) {
      if (sku.isVisible !== undefined) continue;

      const product = await ctx.db.get("product", sku.productId);

      if (!product) {
        skippedMissingProductCount += 1;
        continue;
      }

      if (typeof product.isVisible !== "boolean") {
        skippedParentWithoutVisibilityCount += 1;
        continue;
      }

      await ctx.db.patch("productSku", sku._id, {
        isVisible: product.isVisible,
      });
      updatedSkus.push(sku);
      updatedCount += 1;
    }

    await syncProductSkuSearchProjectionsByStore(ctx, updatedSkus);

    return {
      success: true,
      scannedCount: productSkus.length,
      updatedCount,
      skippedMissingProductCount,
      skippedParentWithoutVisibilityCount,
    };
    },
  ),
});
