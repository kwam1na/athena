export function reconcileDailyClose(input: {
  acceptedCloseId: string;
  acceptedCloseVersion?: number;
  acceptedNetRevenueMinor: number;
  acceptedSourceComplete?: boolean;
  currentNetRevenueMinor: number;
  supersedesCloseId: string | null;
}) {
  if (
    !Number.isSafeInteger(input.acceptedNetRevenueMinor) ||
    !Number.isSafeInteger(input.currentNetRevenueMinor)
  ) {
    throw new Error("Daily Close values must use minor-unit safe integers");
  }
  if (
    input.acceptedCloseVersion !== undefined &&
    (!Number.isSafeInteger(input.acceptedCloseVersion) ||
      input.acceptedCloseVersion < 1)
  ) {
    throw new Error("Daily Close version must be a positive safe integer");
  }
  return {
    ...input,
    ...(input.acceptedSourceComplete === undefined
      ? {}
      : {
          acceptedCompleteness: input.acceptedSourceComplete
            ? ("complete" as const)
            : ("partial" as const),
        }),
    postCloseDeltaMinor:
      input.currentNetRevenueMinor - input.acceptedNetRevenueMinor,
  };
}

export function buildDailyCloseSnapshot(input: {
  acceptedCloseId: string;
  acceptedCloseVersion: number;
  acceptedCompleteness: "complete" | "provisional" | "partial" | "stale" | "unavailable";
  acceptedDeficitAdjustmentMinor: number;
  acceptedNetSalesMinor: number;
  acceptedRefundsMinor: number;
  currentDeficitAdjustmentMinor: number;
  currentNetSalesMinor: number;
  currentRefundsMinor: number;
  supersedesCloseId: string | null;
}) {
  for (const value of [
    input.acceptedDeficitAdjustmentMinor,
    input.acceptedNetSalesMinor,
    input.acceptedRefundsMinor,
    input.currentDeficitAdjustmentMinor,
    input.currentNetSalesMinor,
    input.currentRefundsMinor,
  ]) {
    if (!Number.isSafeInteger(value)) {
      throw new Error("Daily Close values must use minor-unit safe integers");
    }
  }
  if (!Number.isSafeInteger(input.acceptedCloseVersion) || input.acceptedCloseVersion < 1) {
    throw new Error("Daily Close version must be a positive safe integer");
  }
  const postCloseDeficitAdjustmentDeltaMinor =
    input.currentDeficitAdjustmentMinor - input.acceptedDeficitAdjustmentMinor;
  return {
    ...input,
    postCloseDeficitAdjustmentDeltaMinor,
    postCloseKnownCogsDeltaMinor: postCloseDeficitAdjustmentDeltaMinor,
    postCloseGrossProfitDeltaMinor: -postCloseDeficitAdjustmentDeltaMinor,
    postCloseNetSalesDeltaMinor:
      input.currentNetSalesMinor - input.acceptedNetSalesMinor,
    postCloseRefundsDeltaMinor:
      input.currentRefundsMinor - input.acceptedRefundsMinor,
  };
}

function worstCompleteness(
  left: Doc<"reportingDailyCloseProjection">["completeness"],
  right: Doc<"reportingFact">["completeness"],
) {
  const rank = {
    complete: 0,
    provisional: 1,
    partial: 2,
    stale: 3,
    unavailable: 4,
  } as const;
  return rank[left] >= rank[right] ? left : right;
}

function closeSourceId(businessEventKey: string) {
  return /^daily_close:([^:]+):/.exec(businessEventKey)?.[1] ?? null;
}

export function decideDailyCloseLineage(input: {
  incomingSnapshotVersion: number;
  incomingSupersedesCloseId?: string;
  latestBusinessEventKey?: string;
  latestSnapshotVersion?: number;
}) {
  if (!Number.isSafeInteger(input.incomingSnapshotVersion) || input.incomingSnapshotVersion < 1) {
    throw new Error("Daily Close snapshot version must be a positive safe integer");
  }
  if (input.latestSnapshotVersion === undefined) {
    if (input.incomingSnapshotVersion !== 1) {
      throw new Error("Daily Close predecessor is unavailable");
    }
    return { action: "insert" as const };
  }
  if (input.incomingSnapshotVersion <= input.latestSnapshotVersion) {
    return { action: "ignore_older_or_replayed" as const };
  }
  if (input.incomingSnapshotVersion !== input.latestSnapshotVersion + 1) {
    throw new Error("Daily Close snapshot version is not contiguous");
  }
  const latestSourceId = input.latestBusinessEventKey
    ? closeSourceId(input.latestBusinessEventKey)
    : null;
  if (!latestSourceId || input.incomingSupersedesCloseId !== latestSourceId) {
    throw new Error("Daily Close supersedes lineage does not match the current close");
  }
  return { action: "insert" as const };
}

export async function applyDailyCloseFactWithCtx(
  ctx: MutationCtx,
  generation: Doc<"reportingProjectionGeneration">,
  fact: Doc<"reportingFact">,
) {
  if (generation.projectionKind !== "store_day") return null;
  const latest = await ctx.db
    .query("reportingDailyCloseProjection")
    .withIndex("by_generationId_operatingDate_acceptedCloseVersion", (q) =>
      q.eq("generationId", generation._id).eq("operatingDate", fact.operatingDate),
    )
    .order("desc")
    .first();
  const now = Date.now();
  if (fact.factType === "close_snapshot") {
    if (!fact.closeSnapshot) {
      throw new Error("Daily Close canonical snapshot payload is unavailable");
    }
    const lineage = decideDailyCloseLineage({
      incomingSnapshotVersion: fact.closeSnapshot.snapshotVersion,
      incomingSupersedesCloseId: fact.closeSnapshot.supersedesCloseId,
      latestBusinessEventKey: latest?.acceptedCloseBusinessEventKey,
      latestSnapshotVersion: latest?.acceptedCloseVersion,
    });
    if (lineage.action === "ignore_older_or_replayed") return null;
    const acceptedNetSalesMinor = fact.closeSnapshot.acceptedNetSalesMinor;
    const acceptedRefundsMinor = fact.closeSnapshot.acceptedRefundsMinor;
    const acceptedDeficitAdjustmentMinor =
      fact.closeSnapshot.acceptedDeficitAdjustmentMinor;
    const snapshot = buildDailyCloseSnapshot({
      acceptedCloseId: fact.businessEventKey,
      acceptedCloseVersion: fact.closeSnapshot.snapshotVersion,
      acceptedCompleteness: fact.closeSnapshot.completeness,
      acceptedDeficitAdjustmentMinor,
      acceptedNetSalesMinor,
      acceptedRefundsMinor,
      currentDeficitAdjustmentMinor: acceptedDeficitAdjustmentMinor,
      currentNetSalesMinor: acceptedNetSalesMinor,
      currentRefundsMinor: acceptedRefundsMinor,
      supersedesCloseId: fact.closeSnapshot.supersedesCloseId ?? null,
    });
    return ctx.db.insert("reportingDailyCloseProjection", {
      acceptedAt: fact.acceptedAt,
      acceptedCloseBusinessEventKey: fact.businessEventKey,
      acceptedCloseFactId: fact._id,
      acceptedCloseVersion: snapshot.acceptedCloseVersion,
      acceptedDeficitAdjustmentMinor: snapshot.acceptedDeficitAdjustmentMinor,
      acceptedNetSalesMinor: snapshot.acceptedNetSalesMinor,
      acceptedRefundsMinor: snapshot.acceptedRefundsMinor,
      completeness: snapshot.acceptedCompleteness,
      currencyCode: fact.currencyCode,
      currencyMinorUnitScale: fact.currencyMinorUnitScale,
      currentDeficitAdjustmentMinor: snapshot.currentDeficitAdjustmentMinor,
      currentNetSalesMinor: snapshot.currentNetSalesMinor,
      currentRefundsMinor: snapshot.currentRefundsMinor,
      factContractVersion: generation.factContractVersion,
      generationId: generation._id,
      limitingReason: fact.limitingReason,
      metricContractVersion: generation.metricContractVersion,
      operatingDate: fact.operatingDate,
      organizationId: fact.organizationId,
      postCloseDeficitAdjustmentDeltaMinor:
        snapshot.postCloseDeficitAdjustmentDeltaMinor,
      postCloseKnownCogsDeltaMinor: snapshot.postCloseKnownCogsDeltaMinor,
      postCloseGrossProfitDeltaMinor: snapshot.postCloseGrossProfitDeltaMinor,
      postCloseNetSalesDeltaMinor: snapshot.postCloseNetSalesDeltaMinor,
      postCloseRefundsDeltaMinor: snapshot.postCloseRefundsDeltaMinor,
      projectedAt: now,
      projectionContractVersion: generation.projectionContractVersion,
      scheduleVersionId: fact.scheduleVersionId,
      sourceWatermark: fact.acceptedAt,
      storeId: fact.storeId,
      supersedesDailyCloseProjectionId: latest?._id,
    });
  }
  if (!latest || fact.acceptedAt <= latest.acceptedAt) return null;
  const contributions = deriveFactMetricContributions(fact);
  const netSalesDelta = contributions
    .filter((item) => item.metric === "net_sales")
    .reduce((sum, item) => sum + item.value, 0);
  const refundDelta = contributions
    .filter((item) => item.metric === "refunds")
    .reduce((sum, item) => sum + item.value, 0);
  const deficitDelta =
    fact.factType === "post_close_adjustment"
      ? fact.adjustmentKind === "deficit_cogs_revaluation"
        ? fact.cogsKnownMinor ?? 0
        : fact.amountMinor ?? 0
      : 0;
  if (netSalesDelta === 0 && refundDelta === 0 && deficitDelta === 0) return null;
  if (
    latest.currencyCode &&
    fact.currencyCode &&
    latest.currencyCode !== fact.currencyCode
  ) {
    await ctx.db.patch("reportingDailyCloseProjection", latest._id, {
      completeness: "unavailable",
      limitingReason: "mixed_currency",
      projectedAt: now,
      sourceWatermark: Math.max(latest.sourceWatermark, fact.acceptedAt),
    });
    return latest._id;
  }
  const snapshot = buildDailyCloseSnapshot({
    acceptedCloseId: latest.acceptedCloseBusinessEventKey,
    acceptedCloseVersion: latest.acceptedCloseVersion,
    acceptedCompleteness: latest.completeness,
    acceptedDeficitAdjustmentMinor: latest.acceptedDeficitAdjustmentMinor,
    acceptedNetSalesMinor: latest.acceptedNetSalesMinor,
    acceptedRefundsMinor: latest.acceptedRefundsMinor,
    currentDeficitAdjustmentMinor:
      latest.currentDeficitAdjustmentMinor + deficitDelta,
    currentNetSalesMinor: latest.currentNetSalesMinor + netSalesDelta,
    currentRefundsMinor: latest.currentRefundsMinor + refundDelta,
    supersedesCloseId: latest.supersedesDailyCloseProjectionId
      ? String(latest.supersedesDailyCloseProjectionId)
      : null,
  });
  await ctx.db.patch("reportingDailyCloseProjection", latest._id, {
    completeness: worstCompleteness(latest.completeness, fact.completeness),
    currentDeficitAdjustmentMinor: snapshot.currentDeficitAdjustmentMinor,
    currentNetSalesMinor: snapshot.currentNetSalesMinor,
    currentRefundsMinor: snapshot.currentRefundsMinor,
    limitingReason: fact.limitingReason ?? latest.limitingReason,
    postCloseDeficitAdjustmentDeltaMinor:
      snapshot.postCloseDeficitAdjustmentDeltaMinor,
    postCloseKnownCogsDeltaMinor: snapshot.postCloseKnownCogsDeltaMinor,
    postCloseGrossProfitDeltaMinor: snapshot.postCloseGrossProfitDeltaMinor,
    postCloseNetSalesDeltaMinor: snapshot.postCloseNetSalesDeltaMinor,
    postCloseRefundsDeltaMinor: snapshot.postCloseRefundsDeltaMinor,
    projectedAt: now,
    sourceWatermark: Math.max(latest.sourceWatermark, fact.acceptedAt),
  });
  return latest._id;
}
import type { Doc } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { deriveFactMetricContributions } from "./factContributions";
