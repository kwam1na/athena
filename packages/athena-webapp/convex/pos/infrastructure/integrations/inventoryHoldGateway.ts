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

type AcquireHoldArgs = Parameters<typeof acquireInventoryHold>[1];
type AdjustHoldArgs = Parameters<typeof adjustInventoryHold>[1];
type ReleaseHoldArgs = Parameters<typeof releaseInventoryHold>[1];

export interface PosInventoryHoldGateway {
  acquireHold(args: AcquireHoldArgs): Promise<InventoryHoldGatewayResult>;
  adjustHold(args: AdjustHoldArgs): Promise<InventoryHoldGatewayResult>;
  releaseHold(args: ReleaseHoldArgs): Promise<InventoryHoldGatewayResult>;
}

export function createInventoryHoldGateway(
  ctx: MutationCtx,
): PosInventoryHoldGateway {
  return {
    acquireHold(args) {
      assertObjectShapedHoldArgs(args);
      return acquireInventoryHold(ctx.db, args);
    },
    adjustHold(args) {
      assertObjectShapedHoldArgs(args);
      return adjustInventoryHold(ctx.db, args);
    },
    releaseHold(args) {
      assertObjectShapedHoldArgs(args);
      return releaseInventoryHold(ctx.db, args);
    },
  };
}

function assertObjectShapedHoldArgs(args: unknown): asserts args is object {
  if (typeof args !== "object" || args === null) {
    throw new TypeError(
      "POS inventory hold gateway requires object-shaped inventory hold arguments",
    );
  }
}
