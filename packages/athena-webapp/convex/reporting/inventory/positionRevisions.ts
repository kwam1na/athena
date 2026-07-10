import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";

export async function recordInventoryPositionRevisionWithCtx(
  ctx: MutationCtx,
  input: {
    baselineId?: Id<"reportingCutoverBaseline">;
    effectId?: Id<"reportingInventoryEffect">;
    organizationId: Id<"organization">;
    positionId: Id<"reportingInventoryPosition">;
    productSkuId: Id<"productSku">;
    recordedAt: number;
    revisionKind: "effect_applied" | "baseline_applied" | "rebuild_applied";
    storeId: Id<"store">;
  },
) {
  return ctx.db.insert("reportingInventoryPositionRevision", input);
}
