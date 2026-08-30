import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { enqueueReportWork } from "./pipelineWork";
import { UNAVAILABLE_WEEKLY_INVENTORY_ATTENTION } from "./weeklyInventory";

type FinancialFrame = { storeId: Id<"store"> } & (
  | { availability: "unavailable"; unavailableReason: string }
  | {
      availability?: "available";
      cycleStartDate: string;
      cycleEndDate: string;
      scheduleLineage: Array<{
        localDate: string;
        included: boolean;
        scheduleVersionId: Id<"storeSchedule"> | null;
      }>;
      completeness?: { reason: string };
    }
);

export function isInventoryFinancialFrameUnavailable(
  doc: FinancialFrame,
): boolean {
  return (
    doc.availability === "unavailable" ||
    ["missing_timezone", "missing_schedule", "schedule_history_cap"].includes(
      doc.completeness?.reason ?? "",
    )
  );
}

/** Identity only: excludes financial metrics, day status and refresh timestamps. */
export function financialFrameKey(doc: FinancialFrame): string {
  return doc.availability === "unavailable"
    ? JSON.stringify([
        String(doc.storeId),
        "unavailable",
        doc.unavailableReason,
      ])
    : JSON.stringify([
        String(doc.storeId),
        doc.cycleStartDate,
        doc.cycleEndDate,
        doc.scheduleLineage
          .map((day) => [day.localDate, day.included, day.scheduleVersionId])
          .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
        isInventoryFinancialFrameUnavailable(doc)
          ? doc.completeness?.reason
          : null,
      ]);
}

/** Called in the financial publication transaction even when Open Work is quiet. */
export async function enqueueWeeklyInventoryFrameWithCtx(
  ctx: MutationCtx,
  args: { storeId: Id<"store">; now: number },
) {
  return enqueueReportWork(
    ctx,
    { storeId: args.storeId, kind: "inventory" },
    args.now,
  );
}

/** Read-only composition: an older frame can never be presented as current. */
export async function readCurrentWeeklyInventoryWithCtx(
  ctx: QueryCtx,
  doc: Doc<"reportWeekCurrent">,
) {
  if (isInventoryFinancialFrameUnavailable(doc))
    return UNAVAILABLE_WEEKLY_INVENTORY_ATTENTION;
  const pending = await ctx.db
    .query("reportPipelineWork")
    .withIndex("by_storeId_kind_createdAt", (q) =>
      q.eq("storeId", doc.storeId).eq("kind", "inventory"),
    )
    .first();
  if (pending) return UNAVAILABLE_WEEKLY_INVENTORY_ATTENTION;
  const companion = await ctx.db
    .query("reportWeekInventory")
    .withIndex("by_storeId", (q) => q.eq("storeId", doc.storeId))
    .unique();
  return companion?.storeId === doc.storeId &&
    companion.frameKey === financialFrameKey(doc)
    ? companion.attention
    : UNAVAILABLE_WEEKLY_INVENTORY_ATTENTION;
}
