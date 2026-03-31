// convex/migrations/migrateAmountsToPesewas.ts
import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { toPesewas } from "../lib/currency";

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
        amount: toPesewas(order.amount),
      };
      if (order.deliveryFee !== null && order.deliveryFee !== undefined) {
        updates.deliveryFee = toPesewas(order.deliveryFee);
      }
      if (order.paymentDue !== undefined) {
        updates.paymentDue = toPesewas(order.paymentDue);
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
