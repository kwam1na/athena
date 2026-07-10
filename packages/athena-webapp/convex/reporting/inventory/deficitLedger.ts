import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";

export async function ensureActiveDeficitLedgerWithCtx(
  ctx: MutationCtx,
  input: {
    position: Doc<"reportingInventoryPosition">;
    recordedAt: number;
  },
) {
  if (input.position.deficitLedgerId) {
    const ledger = await ctx.db.get(
      "reportingInventoryDeficitLedger",
      input.position.deficitLedgerId,
    );
    if (
      !ledger ||
      ledger.positionId !== input.position._id ||
      ledger.status !== "active"
    ) {
      throw new Error("Inventory position deficit ledger is invalid");
    }
    return ledger._id;
  }
  const active = await ctx.db
    .query("reportingInventoryDeficitLedger")
    .withIndex("by_positionId_status", (query) =>
      query.eq("positionId", input.position._id).eq("status", "active"),
    )
    .take(2);
  if (active.length > 1) {
    throw new Error("Inventory position has multiple active deficit ledgers");
  }
  const ledgerId =
    active[0]?._id ??
    (await ctx.db.insert("reportingInventoryDeficitLedger", {
      activatedAt: input.recordedAt,
      createdAt: input.recordedAt,
      organizationId: input.position.organizationId,
      positionId: input.position._id,
      productSkuId: input.position.productSkuId,
      status: "active",
      storeId: input.position.storeId,
    }));
  const legacyLots = await ctx.db
    .query("reportingInventoryDeficitLot")
    .withIndex("by_positionId_status_occurredAt", (query) =>
      query.eq("positionId", input.position._id).eq("status", "open"),
    )
    .take(101);
  if (legacyLots.length > 100) {
    throw new Error("Legacy deficit ledger requires bounded migration");
  }
  for (const lot of legacyLots) {
    if (lot.ledgerId && lot.ledgerId !== ledgerId) {
      throw new Error("Legacy deficit lot belongs to another ledger");
    }
    await ctx.db.patch("reportingInventoryDeficitLot", lot._id, { ledgerId });
  }
  await ctx.db.patch("reportingInventoryPosition", input.position._id, {
    deficitLedgerId: ledgerId,
  });
  return ledgerId;
}

export async function createCandidateDeficitLedgerWithCtx(
  ctx: MutationCtx,
  input: {
    organizationId: Id<"organization">;
    positionId: Id<"reportingInventoryPosition">;
    productSkuId: Id<"productSku">;
    recordedAt: number;
    replayId?: Id<"reportingInventoryOccurrenceReplay">;
    storeId: Id<"store">;
  },
) {
  return ctx.db.insert("reportingInventoryDeficitLedger", {
    createdAt: input.recordedAt,
    organizationId: input.organizationId,
    positionId: input.positionId,
    productSkuId: input.productSkuId,
    replayId: input.replayId,
    status: "candidate",
    storeId: input.storeId,
  });
}
