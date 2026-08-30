import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { readPipelineControl } from "./pipelineControl";

/** Atomic with the baseline insert or set-once correction, never a job. */
export async function bumpAcceptedWatermarkWithCtx(
  ctx: Pick<MutationCtx, "db">,
  storeId: Id<"store">,
) {
  const control = await readPipelineControl(ctx, storeId);
  if (!control) return;
  const previous = control.acceptedWatermark ?? 0;
  if (
    !Number.isSafeInteger(previous) ||
    previous < 0 ||
    previous >= Number.MAX_SAFE_INTEGER
  )
    throw new Error("accepted_watermark_exhausted");
  await ctx.db.patch("reportPipelineControl", control._id, {
    acceptedWatermark: previous + 1,
  });
}

type AcceptedScheduleSource = Pick<
  Doc<"storeSchedule">,
  | "storeId"
  | "timezone"
  | "weeklyClosedDays"
  | "dateExceptions"
  | "reportingCycleStartsOn"
  | "effectiveFrom"
  | "effectiveTo"
  | "status"
>;

/** Exactly the schedule fields used by the frozen-cohort parity resolver. */
export function acceptedScheduleProofChanged(
  before: AcceptedScheduleSource | null,
  after: AcceptedScheduleSource | null,
) {
  const key = (schedule: AcceptedScheduleSource | null) =>
    !schedule || schedule.status === "candidate"
      ? null
      : JSON.stringify({
          storeId: schedule.storeId,
          timezone: schedule.timezone,
          effectiveFrom: schedule.effectiveFrom,
          effectiveTo: schedule.effectiveTo,
          reportingCycleStartsOn: schedule.reportingCycleStartsOn ?? 1,
          weeklyClosedDays: [...new Set(schedule.weeklyClosedDays)].sort(
            (a, b) => a - b,
          ),
          dateExceptions: schedule.dateExceptions.map(
            ({ localDate, closed }) => ({ localDate, closed }),
          ),
        });
  return key(before) !== key(after);
}
