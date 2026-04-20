import { internalMutation, internalQuery } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { v } from "convex/values";

export function buildInventoryMovement(args: {
  storeId: Id<"store">;
  organizationId?: Id<"organization">;
  movementType: string;
  sourceType: string;
  sourceId: string;
  quantityDelta: number;
  productId?: Id<"product">;
  productSkuId?: Id<"productSku">;
  actorUserId?: Id<"athenaUser">;
  actorStaffProfileId?: Id<"staffProfile">;
  customerProfileId?: Id<"customerProfile">;
  workItemId?: Id<"operationalWorkItem">;
  registerSessionId?: Id<"registerSession">;
  onlineOrderId?: Id<"onlineOrder">;
  posTransactionId?: Id<"posTransaction">;
  reasonCode?: string;
  notes?: string;
}) {
  if (args.quantityDelta === 0) {
    throw new Error("Inventory movement requires a non-zero quantity delta");
  }

  return {
    ...args,
    createdAt: Date.now(),
  };
}

export function summarizeInventoryMovements(
  movements: Array<Pick<{ quantityDelta: number }, "quantityDelta">>
) {
  return movements.reduce(
    (summary, movement) => {
      const nextNet = summary.netDelta + movement.quantityDelta;
      return {
        movementCount: summary.movementCount + 1,
        netDelta: nextNet,
      };
    },
    { movementCount: 0, netDelta: 0 }
  );
}

export const recordInventoryMovement = internalMutation({
  args: {
    storeId: v.id("store"),
    organizationId: v.optional(v.id("organization")),
    movementType: v.string(),
    sourceType: v.string(),
    sourceId: v.string(),
    quantityDelta: v.number(),
    productId: v.optional(v.id("product")),
    productSkuId: v.optional(v.id("productSku")),
    actorUserId: v.optional(v.id("athenaUser")),
    actorStaffProfileId: v.optional(v.id("staffProfile")),
    customerProfileId: v.optional(v.id("customerProfile")),
    workItemId: v.optional(v.id("operationalWorkItem")),
    registerSessionId: v.optional(v.id("registerSession")),
    onlineOrderId: v.optional(v.id("onlineOrder")),
    posTransactionId: v.optional(v.id("posTransaction")),
    reasonCode: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const movementId = await ctx.db.insert("inventoryMovement", buildInventoryMovement(args));
    return ctx.db.get(movementId);
  },
});

export const listInventoryMovementsForProductSku = internalQuery({
  args: {
    storeId: v.id("store"),
    productSkuId: v.id("productSku"),
  },
  handler: async (ctx, args) =>
    ctx.db
      .query("inventoryMovement")
      .withIndex("by_storeId_productSkuId", (q) =>
        q.eq("storeId", args.storeId).eq("productSkuId", args.productSkuId)
      )
      .collect(),
});
