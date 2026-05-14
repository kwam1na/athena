import { Id } from "../_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  MutationCtx,
} from "../_generated/server";
import { v } from "convex/values";
import {
  recordSkuActivityEventWithCtx,
  type RecordSkuActivityEventArgs,
} from "./skuActivity";

export type RecordInventoryMovementArgs = {
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
};

export type RecordSkuActivityForMovementArgs = RecordInventoryMovementArgs & {
  inventoryMovementId: Id<"inventoryMovement">;
};

function getSkuActivityTypeForMovement(movementType: string) {
  const activityTypes: Record<string, string> = {
    adjustment: "stock_adjustment",
    cycle_count: "stock_cycle_count",
    exchange: "stock_exchange",
    fulfillment: "stock_fulfillment",
    receipt: "stock_receipt",
    restock: "stock_restock",
    sale: "stock_sale",
    service_item_received: "stock_service_item_received",
    service_material_consumed: "stock_service_material_consumed",
    service_material_returned: "stock_service_material_returned",
  };

  return activityTypes[movementType] ?? `stock_${movementType}`;
}

export function buildSkuActivityForInventoryMovement(
  args: RecordSkuActivityForMovementArgs,
): RecordSkuActivityEventArgs | null {
  if (!args.productSkuId) {
    return null;
  }

  return {
    actorStaffProfileId: args.actorStaffProfileId,
    actorUserId: args.actorUserId,
    activityType: getSkuActivityTypeForMovement(args.movementType),
    customerProfileId: args.customerProfileId,
    idempotencyKey: `inventoryMovement:${args.inventoryMovementId}`,
    inventoryMovementId: args.inventoryMovementId,
    metadata: {
      movementType: args.movementType,
      notes: args.notes,
      reasonCode: args.reasonCode,
    },
    occurredAt: Date.now(),
    onlineOrderId: args.onlineOrderId,
    organizationId: args.organizationId,
    posTransactionId: args.posTransactionId,
    productId: args.productId,
    productSkuId: args.productSkuId,
    registerSessionId: args.registerSessionId,
    sourceId: args.sourceId,
    sourceType: args.sourceType,
    status: "committed",
    stockQuantityDelta: args.quantityDelta,
    storeId: args.storeId,
    workItemId: args.workItemId,
  };
}

export async function recordSkuActivityForInventoryMovementWithCtx(
  ctx: MutationCtx,
  args: RecordSkuActivityForMovementArgs,
) {
  const activityArgs = buildSkuActivityForInventoryMovement(args);

  if (!activityArgs) {
    return null;
  }

  return recordSkuActivityEventWithCtx(ctx, activityArgs);
}

export function buildInventoryMovement(args: RecordInventoryMovementArgs) {
  if (args.quantityDelta === 0) {
    throw new Error("Inventory movement requires a non-zero quantity delta");
  }

  return {
    ...args,
    createdAt: Date.now(),
  };
}

export function summarizeInventoryMovements(
  movements: Array<Pick<{ quantityDelta: number }, "quantityDelta">>,
) {
  return movements.reduce(
    (summary, movement) => {
      const nextNet = summary.netDelta + movement.quantityDelta;
      return {
        movementCount: summary.movementCount + 1,
        netDelta: nextNet,
      };
    },
    { movementCount: 0, netDelta: 0 },
  );
}

function matchesExistingMovement(
  existingMovement: {
    movementType: string;
    quantityDelta: number;
    productId?: Id<"product">;
    productSkuId?: Id<"productSku">;
    reasonCode?: string;
  },
  args: RecordInventoryMovementArgs,
) {
  return (
    existingMovement.movementType === args.movementType &&
    existingMovement.quantityDelta === args.quantityDelta &&
    existingMovement.productId === args.productId &&
    existingMovement.productSkuId === args.productSkuId &&
    existingMovement.reasonCode === args.reasonCode
  );
}

export async function recordInventoryMovementWithCtx(
  ctx: MutationCtx,
  args: RecordInventoryMovementArgs,
) {
  // eslint-disable-next-line @convex-dev/no-collect-in-query -- Source-scoped dedupe needs the full indexed set for this source, which is bounded by the originating operation's line items.
  const existingMovements = await ctx.db
    .query("inventoryMovement")
    .withIndex("by_storeId_source", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("sourceType", args.sourceType)
        .eq("sourceId", args.sourceId),
    )
    .collect();

  const existingMovement = existingMovements.find((movement) =>
    matchesExistingMovement(movement, args),
  );

  if (existingMovement) {
    await recordSkuActivityForInventoryMovementWithCtx(ctx, {
      ...args,
      inventoryMovementId: existingMovement._id,
    });
    return existingMovement;
  }

  const movementId = await ctx.db.insert(
    "inventoryMovement",
    buildInventoryMovement(args),
  );
  const movement = await ctx.db.get("inventoryMovement", movementId);

  if (movement) {
    await recordSkuActivityForInventoryMovementWithCtx(ctx, {
      ...args,
      inventoryMovementId: movement._id,
    });
  }

  return movement;
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
  handler: (ctx, args) => recordInventoryMovementWithCtx(ctx, args),
});

export const listInventoryMovementsForProductSku = internalQuery({
  args: {
    storeId: v.id("store"),
    productSkuId: v.id("productSku"),
  },
  handler: async (ctx, args) =>
    // eslint-disable-next-line @convex-dev/no-collect-in-query -- This audit helper intentionally returns the full indexed history for one SKU; adding a limit here would silently truncate callers.
    ctx.db
      .query("inventoryMovement")
      .withIndex("by_storeId_productSkuId", (q) =>
        q.eq("storeId", args.storeId).eq("productSkuId", args.productSkuId),
      )
      .collect(),
});
