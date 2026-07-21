import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { getStoreScheduleContextForStoreAtWithCtx } from "../inventory/storeSchedule";
import {
  isValidStoreTimezone,
  resolveStoreCalendarRangeForDate,
  resolveStoreOperatingRangeForDate,
  resolveStoreScheduleContext,
} from "../lib/storeScheduleTime";
import {
  SHARED_DEMO_STAFF_STORY,
  sharedDemoStaffShortName,
} from "../../shared/sharedDemoStory";
import {
  SHARED_DEMO_MANAGER_STAFF_CODE,
  SHARED_DEMO_TIME_ZONE,
} from "./config";

const OPENING_LOOKBACK_MS = 4 * 60 * 60 * 1_000;

export function sharedDemoOperatingDateRange(
  now: number,
  schedule?: Doc<"storeSchedule"> | null,
) {
  const timezone = SHARED_DEMO_TIME_ZONE;
  if (!isValidStoreTimezone(timezone)) {
    throw new Error("The demo store timezone is invalid.");
  }
  const operatingDate = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).format(new Date(now));
  if (schedule?.timezone === timezone) {
    const context = resolveStoreScheduleContext({ at: now, schedule });
    const scheduledRange = resolveStoreOperatingRangeForDate({
      operatingDate: context.operatingDate,
      schedule,
    });
    if (scheduledRange.kind === "resolved") {
      return {
        endAt: scheduledRange.endAt,
        operatingDate: scheduledRange.operatingDate,
        startAt: scheduledRange.startAt,
      };
    }
  }
  const calendarRange = resolveStoreCalendarRangeForDate({
    localDate: operatingDate,
    timezone,
  });
  if (calendarRange.kind !== "resolved") {
    throw new Error("The demo operating date could not be resolved.");
  }
  return {
    endAt: calendarRange.endAt,
    operatingDate,
    startAt: calendarRange.startAt,
  };
}

export function buildSharedDemoOpeningBaseline(args: {
  actorStaffProfileId: Id<"staffProfile">;
  actorUserId: Id<"athenaUser">;
  now: number;
  organizationId: Id<"organization">;
  schedule?: Doc<"storeSchedule"> | null;
  storeId: Id<"store">;
}) {
  const range = sharedDemoOperatingDateRange(args.now, args.schedule);
  const startedAt = Math.max(range.startAt, args.now - OPENING_LOOKBACK_MS);
  return {
    acknowledgedItemKeys: [],
    actorStaffProfileId: args.actorStaffProfileId,
    actorType: "human" as const,
    actorUserId: args.actorUserId,
    carryForwardWorkItemIds: [],
    createdAt: startedAt,
    endAt: range.endAt,
    operatingDate: range.operatingDate,
    organizationId: args.organizationId,
    readiness: {
      blockerCount: 0,
      carryForwardCount: 0,
      readyCount: 1,
      reviewCount: 0,
      status: "ready" as const,
    },
    sourceSubjects: [
      {
        id: String(args.storeId),
        label: "Opening Handoff complete",
        type: "store",
      },
    ],
    startAt: range.startAt,
    startedAt,
    status: "started" as const,
    storeId: args.storeId,
    updatedAt: startedAt,
  };
}

export function buildSharedDemoStoreDayEvent(args: {
  actorStaffProfileId: Id<"staffProfile">;
  actorUserId: Id<"athenaUser">;
  dailyOpeningId: Id<"dailyOpening">;
  now: number;
  organizationId: Id<"organization">;
  schedule?: Doc<"storeSchedule"> | null;
  storeId: Id<"store">;
}) {
  const range = sharedDemoOperatingDateRange(args.now, args.schedule);
  const managerName = sharedDemoStaffShortName(SHARED_DEMO_STAFF_STORY.manager);
  return {
    actorStaffProfileId: args.actorStaffProfileId,
    actorType: "human" as const,
    actorUserId: args.actorUserId,
    createdAt: Math.max(range.startAt, args.now - OPENING_LOOKBACK_MS),
    eventType: "daily_opening_acknowledged",
    message: `Store day started by ${managerName}`,
    metadata: range,
    organizationId: args.organizationId,
    storeId: args.storeId,
    subjectId: String(args.dailyOpeningId),
    subjectLabel: `Opening ${range.operatingDate}`,
    subjectType: "daily_opening",
  };
}

export async function rollSharedDemoOpeningBaselineWithCtx(
  ctx: Pick<MutationCtx, "db">,
  args: { now: number; storeId: Id<"store"> },
) {
  const openings = await ctx.db
    .query("dailyOpening")
    .withIndex("by_storeId_operatingDate", (q) =>
      q.eq("storeId", args.storeId),
    )
    .take(2);
  if (openings.length !== 1) {
    throw new Error("Demo Opening Handoff baseline is incomplete.");
  }

  const opening = openings[0];
  if (!opening.actorStaffProfileId || !opening.actorUserId) {
    throw new Error("Demo Opening Handoff actor is incomplete.");
  }
  const manager = await ctx.db
    .query("staffProfile")
    .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
    .filter((q) => q.eq(q.field("staffCode"), SHARED_DEMO_MANAGER_STAFF_CODE))
    .unique();
  if (!manager) {
    throw new Error("Demo manager is missing.");
  }
  const { schedule } = await getStoreScheduleContextForStoreAtWithCtx(ctx, {
    at: args.now,
    storeId: args.storeId,
  });
  const openingDocument = buildSharedDemoOpeningBaseline({
    actorStaffProfileId: manager._id,
    actorUserId: opening.actorUserId,
    now: args.now,
    organizationId: opening.organizationId,
    schedule,
    storeId: args.storeId,
  });
  await ctx.db.replace("dailyOpening", opening._id, openingDocument);

  const events = await ctx.db
    .query("operationalEvent")
    .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
    .take(500);
  const storeDayEvent = events.find(
    (event) =>
      event.eventType === "daily_opening_acknowledged" ||
      event.eventType === "demo.store_day_started",
  );
  if (!storeDayEvent) {
    throw new Error("Demo store-day narrative is incomplete.");
  }
  await ctx.db.replace(
    "operationalEvent",
    storeDayEvent._id,
    buildSharedDemoStoreDayEvent({
      actorStaffProfileId: openingDocument.actorStaffProfileId,
      actorUserId: openingDocument.actorUserId,
      dailyOpeningId: opening._id,
      now: args.now,
      organizationId: openingDocument.organizationId,
      schedule,
      storeId: args.storeId,
    }),
  );
}
