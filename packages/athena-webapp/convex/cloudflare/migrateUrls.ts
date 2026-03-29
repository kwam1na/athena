import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

const OLD_PREFIX = `https://${process.env.AWS_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/`;
const NEW_PREFIX = `${process.env.IMAGES_URL}`;
const BATCH_SIZE = 100; // Stay well within Convex transaction limits

// Migrate productSku image URLs — run repeatedly until isDone: true
export const migrateProductSkuImages = internalMutation({
  args: {
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const results = await ctx.db
      .query("productSku")
      .paginate({ numItems: BATCH_SIZE, cursor: args.cursor ?? null });

    let updatedCount = 0;

    for (const sku of results.page) {
      if (!Array.isArray(sku.images)) continue;

      const hasOldUrls = sku.images.some(
        (img: string) => typeof img === "string" && img.startsWith(OLD_PREFIX),
      );

      if (!hasOldUrls) continue;

      const newImages = sku.images.map((img: string) =>
        typeof img === "string" ? img.replace(OLD_PREFIX, NEW_PREFIX) : img,
      );

      await ctx.db.patch(sku._id, { images: newImages });
      updatedCount++;
    }

    return {
      success: true,
      updatedCount,
      isDone: results.isDone,
      cursor: results.continueCursor,
    };
  },
});

// Migrate storeAsset URLs — run repeatedly until isDone: true
export const migrateStoreAssetUrls = internalMutation({
  args: {
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const results = await ctx.db
      .query("storeAsset")
      .paginate({ numItems: BATCH_SIZE, cursor: args.cursor ?? null });

    let updatedCount = 0;

    for (const asset of results.page) {
      if (typeof asset.url === "string" && asset.url.startsWith(OLD_PREFIX)) {
        await ctx.db.patch(asset._id, {
          url: asset.url.replace(OLD_PREFIX, NEW_PREFIX),
        });
        updatedCount++;
      }
    }

    return {
      success: true,
      updatedCount,
      isDone: results.isDone,
      cursor: results.continueCursor,
    };
  },
});

// Migrate store config image URLs (small table — no pagination needed)
export const migrateStoreConfigUrls = internalMutation({
  args: {},
  handler: async (ctx) => {
    const allStores = await ctx.db.query("store").collect();
    let updatedCount = 0;

    for (const store of allStores) {
      if (!store.config?.ui) continue;

      const ui = store.config.ui as Record<string, any>;
      let needsUpdate = false;
      const newUi = { ...ui };

      for (const key of [
        "fallbackImageUrl",
        "heroImageUrl",
        "shopLookImageUrl",
      ]) {
        if (
          typeof newUi[key] === "string" &&
          newUi[key].startsWith(OLD_PREFIX)
        ) {
          newUi[key] = newUi[key].replace(OLD_PREFIX, NEW_PREFIX);
          needsUpdate = true;
        }
      }

      if (needsUpdate) {
        await ctx.db.patch(store._id, {
          config: { ...store.config, ui: newUi },
        });
        updatedCount++;
      }
    }

    return { success: true, updatedCount };
  },
});
