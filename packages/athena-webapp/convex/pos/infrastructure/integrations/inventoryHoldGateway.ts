import type { Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import {
  acquireInventoryHold,
  adjustInventoryHold,
  releaseInventoryHold,
} from "../../../inventory/helpers/inventoryHolds";

export interface InventoryHoldGatewayResult {
  success: boolean;
  message?: string;
  available?: number;
}

export interface PosInventoryHoldGateway {
  acquireHold(
    ...args:
      | [
          {
            storeId: Id<"store">;
            sessionId: Id<"posSession">;
            skuId: Id<"productSku">;
            quantity: number;
            expiresAt: number;
            now?: number;
          },
        ]
      | [skuId: Id<"productSku">, quantity: number]
  ): Promise<InventoryHoldGatewayResult>;
  adjustHold(
    ...args:
      | [
          {
            storeId: Id<"store">;
            sessionId: Id<"posSession">;
            skuId: Id<"productSku">;
            oldQuantity: number;
            newQuantity: number;
            expiresAt: number;
            now?: number;
          },
        ]
      | [
          skuId: Id<"productSku">,
          oldQuantity: number,
          newQuantity: number,
        ]
  ): Promise<InventoryHoldGatewayResult>;
  releaseHold(
    ...args:
      | [
          {
            sessionId: Id<"posSession">;
            skuId: Id<"productSku">;
            quantity: number;
            now?: number;
          },
        ]
      | [skuId: Id<"productSku">, quantity: number]
  ): Promise<InventoryHoldGatewayResult>;
}

export function createInventoryHoldGateway(
  ctx: MutationCtx,
): PosInventoryHoldGateway {
  return {
    acquireHold(...args) {
      if (typeof args[0] === "string") {
        return acquireLegacyQuantityPatchHold(ctx, args[0], args[1]!);
      }

      return acquireInventoryHold(ctx.db, args[0]);
    },
    adjustHold(...args) {
      if (typeof args[0] === "string") {
        return adjustLegacyQuantityPatchHold(ctx, args[0], args[1]!, args[2]!);
      }

      return adjustInventoryHold(ctx.db, args[0]);
    },
    releaseHold(...args) {
      if (typeof args[0] === "string") {
        return releaseLegacyQuantityPatchHold(ctx, args[0], args[1]!);
      }

      return releaseInventoryHold(ctx.db, args[0]);
    },
  };
}

async function acquireLegacyQuantityPatchHold(
  ctx: MutationCtx,
  skuId: Id<"productSku">,
  quantity: number,
): Promise<InventoryHoldGatewayResult> {
  const sku = await ctx.db.get("productSku", skuId);
  if (!sku || typeof sku.quantityAvailable !== "number") {
    return { success: false, message: "Product not found" };
  }

  if (sku.quantityAvailable < quantity) {
    return {
      success: false,
      message: `Only ${sku.quantityAvailable} unit${sku.quantityAvailable !== 1 ? "s" : ""} available`,
      available: sku.quantityAvailable,
    };
  }

  await ctx.db.patch("productSku", skuId, {
    quantityAvailable: sku.quantityAvailable - quantity,
  });
  return { success: true };
}

async function releaseLegacyQuantityPatchHold(
  ctx: MutationCtx,
  skuId: Id<"productSku">,
  quantity: number,
): Promise<InventoryHoldGatewayResult> {
  const sku = await ctx.db.get("productSku", skuId);
  if (!sku || typeof sku.quantityAvailable !== "number") {
    return { success: true };
  }

  await ctx.db.patch("productSku", skuId, {
    quantityAvailable: sku.quantityAvailable + quantity,
  });
  return { success: true };
}

async function adjustLegacyQuantityPatchHold(
  ctx: MutationCtx,
  skuId: Id<"productSku">,
  oldQuantity: number,
  newQuantity: number,
): Promise<InventoryHoldGatewayResult> {
  const quantityChange = newQuantity - oldQuantity;
  if (quantityChange === 0) {
    return { success: true };
  }

  if (quantityChange > 0) {
    return acquireLegacyQuantityPatchHold(ctx, skuId, quantityChange);
  }

  return releaseLegacyQuantityPatchHold(ctx, skuId, Math.abs(quantityChange));
}
