import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import {
  getMissingStoreScheduleContext,
  resolveStoreOperatingRangeForDate,
  resolveStoreScheduleContext,
} from "../lib/storeScheduleTime";

/**
 * Store-schedule reads with no ingress and no admission.
 *
 * `inventory/storeSchedule.ts` is an ingress module: it imports the admission
 * composition root, which pulls in the shared-demo adapters, which reach
 * `sharedDemo/openingBaseline.ts`. Since `openingBaseline` needs schedule
 * context too, importing it from the ingress module would close a cycle back
 * through the composition root and leave the wrappers undefined at module
 * evaluation time. These helpers therefore live here, below the rail: this
 * module imports only `_generated/**` and the pure schedule-time library, so
 * anything may depend on it.
 */

export const STORE_SCHEDULE_VERSION_READ_LIMIT = 100;

const entity = "storeSchedule";

type ScheduleReadCtx = Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">;

export async function listActiveSchedulesForStore(
  ctx: ScheduleReadCtx,
  storeId: Id<"store">,
): Promise<Array<Doc<"storeSchedule">>> {
  return await ctx.db
    .query(entity)
    .withIndex("by_storeId_status_effectiveFrom", (schedule) =>
      schedule.eq("storeId", storeId).eq("status", "active"),
    )
    .take(STORE_SCHEDULE_VERSION_READ_LIMIT);
}

export async function findActiveScheduleForStoreAt(
  ctx: ScheduleReadCtx,
  args: { storeId: Id<"store">; at: number },
): Promise<Doc<"storeSchedule"> | null> {
  const schedules = await ctx.db
    .query(entity)
    .withIndex("by_storeId_status_effectiveFrom", (schedule) =>
      schedule
        .eq("storeId", args.storeId)
        .eq("status", "active")
        .lte("effectiveFrom", args.at),
    )
    .order("desc")
    .take(STORE_SCHEDULE_VERSION_READ_LIMIT);

  return (
    schedules
      .filter(
        (schedule) =>
          schedule.effectiveFrom <= args.at &&
          (schedule.effectiveTo === undefined ||
            args.at < schedule.effectiveTo),
      )
      .sort((left, right) => right.effectiveFrom - left.effectiveFrom)[0] ??
    null
  );
}

export async function getStoreScheduleContextForStoreAtWithCtx(
  ctx: ScheduleReadCtx,
  args: { storeId: Id<"store">; at: number },
) {
  const schedule = await findActiveScheduleForStoreAt(ctx, args);

  return {
    schedule,
    context: schedule
      ? resolveStoreScheduleContext({ schedule, at: args.at })
      : getMissingStoreScheduleContext({ at: args.at }),
  };
}

export async function resolveStoreOperatingRangeForDateWithCtx(
  ctx: ScheduleReadCtx,
  args: { storeId: Id<"store">; operatingDate: string },
) {
  const effectiveAt = Date.parse(`${args.operatingDate}T12:00:00.000Z`);
  const schedule = Number.isFinite(effectiveAt)
    ? await findActiveScheduleForStoreAt(ctx, {
        storeId: args.storeId,
        at: effectiveAt,
      })
    : null;

  return {
    schedule,
    range: resolveStoreOperatingRangeForDate({
      schedule,
      operatingDate: args.operatingDate,
    }),
  };
}
