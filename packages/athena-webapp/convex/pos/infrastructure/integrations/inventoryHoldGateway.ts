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
    skuId: Id<"productSku">,
    quantity: number,
  ): Promise<InventoryHoldGatewayResult>;
  adjustHold(
    skuId: Id<"productSku">,
    oldQuantity: number,
    newQuantity: number,
  ): Promise<InventoryHoldGatewayResult>;
  releaseHold(
    skuId: Id<"productSku">,
    quantity: number,
  ): Promise<InventoryHoldGatewayResult>;
}

export function createInventoryHoldGateway(
  ctx: MutationCtx,
): PosInventoryHoldGateway {
  return {
    acquireHold(skuId, quantity) {
      return acquireInventoryHold(ctx.db, skuId, quantity);
    },
    adjustHold(skuId, oldQuantity, newQuantity) {
      return adjustInventoryHold(ctx.db, skuId, oldQuantity, newQuantity);
    },
    releaseHold(skuId, quantity) {
      return releaseInventoryHold(ctx.db, skuId, quantity);
    },
  };
}
