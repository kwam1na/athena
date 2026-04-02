// convex/migrations/migrateAmountsToPesewas.ts
import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { toDisplayAmount, toPesewas } from "../lib/currency";
import { toV2Config } from "../inventory/storeConfigV2";

// Set this to the deployment timestamp BEFORE deploying the code changes.
// Records created after this timestamp will already have pesewas amounts.
// To get the cutoff: run `Date.now()` just before deploying.

export const migrateOnlineOrders = internalMutation({
  args: {
    cutoffTimestamp: v.number(), // Only migrate records created before this
  },
  handler: async (ctx, args) => {
    const orders = await ctx.db.query("onlineOrder").collect();
    let migrated = 0;
    let skipped = 0;

    for (const order of orders) {
      // Only migrate records created before the deployment
      if (order._creationTime >= args.cutoffTimestamp) {
        skipped++;
        continue;
      }

      const updates: Record<string, any> = {
        // amount: toDisplayAmount(order.amount),
      };
      if (order.deliveryFee !== null && order.deliveryFee !== undefined) {
        updates.deliveryFee = toPesewas(order.deliveryFee);
      }
      if (order.paymentDue !== undefined) {
        // updates.paymentDue = toDisplayAmount(order.paymentDue);
      }
      await ctx.db.patch(order._id, updates);
      migrated++;
    }

    console.log(
      `Migrated ${migrated} orders, skipped ${skipped} (post-deployment)`,
    );
    return { migrated, skipped, total: orders.length };
  },
});

export const migrateCheckoutSessions = internalMutation({
  args: {
    cutoffTimestamp: v.number(),
  },
  handler: async (ctx, args) => {
    const sessions = await ctx.db.query("checkoutSession").collect();
    let migrated = 0;
    let skipped = 0;

    for (const session of sessions) {
      if (session._creationTime >= args.cutoffTimestamp) {
        skipped++;
        continue;
      }

      const updates: Record<string, any> = {
        amount: toPesewas(session.amount),
      };
      if (session.deliveryFee !== null && session.deliveryFee !== undefined) {
        updates.deliveryFee = toPesewas(session.deliveryFee);
      }
      await ctx.db.patch(session._id, updates);
      migrated++;
    }

    console.log(
      `Migrated ${migrated} sessions, skipped ${skipped} (post-deployment)`,
    );
    return { migrated, skipped, total: sessions.length };
  },
});

// --- Phase 2: Normalize all amounts to pesewas ---

export const migrateStoreConfigs = internalMutation({
  args: {},
  handler: async (ctx) => {
    const stores = await ctx.db.query("store").collect();
    let migrated = 0;

    for (const store of stores) {
      const config = store.config as Record<string, any> | undefined;
      if (!config) continue;

      const v2 = toV2Config(config);
      const fees = v2.commerce.deliveryFees;
      const waive = v2.commerce.waiveDeliveryFees;

      const nextFees = {
        ...fees,
        ...(fees.withinAccra !== undefined && {
          withinAccra: toPesewas(fees.withinAccra),
        }),
        ...(fees.otherRegions !== undefined && {
          otherRegions: toPesewas(fees.otherRegions),
        }),
        ...(fees.international !== undefined && {
          international: toPesewas(fees.international),
        }),
      };

      let nextWaive = waive;
      if (typeof waive === "object" && waive.minimumOrderAmount) {
        nextWaive = {
          ...waive,
          minimumOrderAmount: toPesewas(waive.minimumOrderAmount),
        };
      }

      const nextConfig = {
        ...config,
        commerce: {
          ...((config as any).commerce || {}),
          deliveryFees: nextFees,
          waiveDeliveryFees: nextWaive,
        },
      };

      await ctx.db.patch(store._id, { config: nextConfig });
      migrated++;

      console.log(
        `Store ${store._id}: deliveryFees ${JSON.stringify(fees)} → ${JSON.stringify(nextFees)}`,
      );
    }

    console.log(`Migrated ${migrated} store configs`);
    return { migrated };
  },
});

export const migrateProductSkuPrices = internalMutation({
  args: {
    cutoffTimestamp: v.number(),
  },
  handler: async (ctx, args) => {
    const skus = await ctx.db.query("productSku").collect();
    let migrated = 0;
    let skipped = 0;

    for (const sku of skus) {
      if (sku._creationTime >= args.cutoffTimestamp) {
        skipped++;
        continue;
      }

      // Safety check: skip if price looks like it's already in pesewas
      if (sku.price < 10_000) {
        skipped++;
        continue;
      }

      const updates: Record<string, any> = {
        price: toPesewas(sku.price),
      };
      if (sku.netPrice !== undefined) {
        updates.netPrice = toPesewas(sku.netPrice);
      }
      if (sku.unitCost !== undefined) {
        updates.unitCost = toPesewas(sku.unitCost);
      }

      await ctx.db.patch(sku._id, updates);
      migrated++;
    }

    console.log(`Migrated ${migrated} SKU prices, skipped ${skipped}`);
    return { migrated, skipped, total: skus.length };
  },
});

export const migrateBagAndSessionItems = internalMutation({
  args: {
    cutoffTimestamp: v.number(),
  },
  handler: async (ctx, args) => {
    const results: Record<string, { migrated: number; skipped: number }> = {};

    // Migrate bag items
    const bagItems = await ctx.db.query("bagItem").collect();
    let migrated = 0;
    let skipped = 0;
    for (const item of bagItems) {
      if (item._creationTime >= args.cutoffTimestamp) {
        skipped++;
        continue;
      }
      if (item.price !== undefined && item.price !== null) {
        await ctx.db.patch(item._id, { price: toPesewas(item.price) });
        migrated++;
      }
    }
    results.bagItem = { migrated, skipped };

    // Migrate checkout session items
    const sessionItems = await ctx.db.query("checkoutSessionItem").collect();
    migrated = 0;
    skipped = 0;
    for (const item of sessionItems) {
      if (item._creationTime >= args.cutoffTimestamp) {
        skipped++;
        continue;
      }
      if (item.price !== undefined) {
        await ctx.db.patch(item._id, { price: toPesewas(item.price) });
        migrated++;
      }
    }
    results.checkoutSessionItem = { migrated, skipped };

    // Migrate online order items
    const orderItems = await ctx.db.query("onlineOrderItem").collect();
    migrated = 0;
    skipped = 0;
    for (const item of orderItems) {
      if (item._creationTime >= args.cutoffTimestamp) {
        skipped++;
        continue;
      }
      if (item.price !== undefined) {
        await ctx.db.patch(item._id, { price: toPesewas(item.price) });
        migrated++;
      }
    }
    results.onlineOrderItem = { migrated, skipped };

    console.log("Migration results:", JSON.stringify(results));
    return results;
  },
});
