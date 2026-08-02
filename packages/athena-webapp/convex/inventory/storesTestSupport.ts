import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

const NOW = Date.parse("2026-08-01T12:00:00.000Z");
const metrics = {
  grossSalesMinor: 100,
  netSalesMinor: 100,
  refundsMinor: 0,
  unitsSold: 1,
  unitsReturned: 0,
  uncostedRevenueMinor: 0,
  grossProfitMinor: 50,
  paymentsCollectedMinor: 100,
  paymentsRefundedMinor: 0,
  paymentAllocatedMinor: 100,
  paymentUnsettledMinor: 0,
  paymentAllocationCoverage: "complete" as const,
};

function cycleDate(offsetDays: number): string {
  return new Date(Date.UTC(2024, 0, 1 + offsetDays))
    .toISOString()
    .slice(0, 10);
}

export async function seedWeeklyRowsForDeletionTest(
  ctx: MutationCtx,
  storeId: Id<"store">,
  organizationId: Id<"organization">,
  acceptedCount = 1,
): Promise<void> {
  const closeId = await ctx.db.insert("dailyClose", {
    storeId,
    organizationId,
    operatingDate: "2026-08-01",
    status: "completed",
    lifecycleStatus: "active",
    isCurrent: true,
    readiness: {
      status: "ready",
      blockerCount: 0,
      reviewCount: 0,
      carryForwardCount: 0,
      readyCount: 0,
    },
    summary: {},
    sourceSubjects: [],
    carryForwardWorkItemIds: [],
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: NOW,
  });
  await ctx.db.insert("reportWeekCurrent", {
    storeId,
    cycleStartDate: "2026-07-27",
    cycleEndDate: "2026-08-02",
    currency: "GHS",
    metricVersion: 1,
    materializedAt: NOW,
    included: metrics,
    outsideSchedule: {
      ...metrics,
      grossSalesMinor: 0,
      netSalesMinor: 0,
      unitsSold: 0,
    },
    scheduleLineage: [],
    completeness: { complete: true, reason: "complete" },
  });
  for (let index = 0; index < acceptedCount; index += 1) {
    await ctx.db.insert("reportWeekAccepted", {
      storeId,
      cycleStartDate: cycleDate(index * 7),
      cycleEndDate: cycleDate(index * 7 + 6),
      currency: "GHS",
      metricVersion: 1,
      acceptedAt: NOW + index,
      cutoffObservedAt: NOW + index,
      closeId,
      baselineFingerprint: `baseline-${String(storeId)}-${String(index)}`,
      included: metrics,
      outsideSchedule: {
        ...metrics,
        grossSalesMinor: 0,
        netSalesMinor: 0,
        unitsSold: 0,
      },
      scheduleLineage: [],
      completeness: { complete: true, reason: "complete" },
    });
  }
  await ctx.db.insert("reportDirtyWeek", {
    storeId,
    reason: "day_folded",
    markedAt: NOW,
  });
}
