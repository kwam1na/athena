import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  insertRegisterSessionWithAuthority,
  patchRegisterSessionWithAuthority,
} from "../operations/registerSessionAuthorityRevision";
import {
  calculateSharedDemoExpectedCash,
  SHARED_DEMO_CASH_SEED,
  SHARED_DEMO_MANAGER_STAFF_CODE,
  SHARED_DEMO_TIME_ZONE,
} from "./config";
import {
  buildSharedDemoOpeningBaseline,
  buildSharedDemoStoreDayEvent,
  sharedDemoOperatingDateRange,
} from "./openingBaseline";
const REGISTER_OPEN_LOOKBACK_MS = 4 * 60 * 60 * 1_000;
const BROWSER_SESSION_NOTE_PREFIX = "shared-demo:browser-register:";

export type SharedDemoRegisterAllocation = "reuse" | "clone";

export function planSharedDemoRegisterAllocation(args: {
  hasExistingTerminalSession: boolean;
}): SharedDemoRegisterAllocation {
  return args.hasExistingTerminalSession ? "reuse" : "clone";
}

export function buildSharedDemoRegisterCashBaseline() {
  return {
    expectedCash: calculateSharedDemoExpectedCash(SHARED_DEMO_CASH_SEED),
    openingFloat: SHARED_DEMO_CASH_SEED.openingFloat,
  };
}

function browserSessionNote(terminalId: Id<"posTerminal">) {
  return `${BROWSER_SESSION_NOTE_PREFIX}${terminalId}`;
}

export function buildSharedDemoRegisterNarrative(args: {
  now: number;
  registerNumber: string;
  schedule?: Doc<"storeSchedule"> | null;
  terminalId: Id<"posTerminal">;
}) {
  const range = sharedDemoOperatingDateRange(args.now, args.schedule);
  const openedAt = Math.max(
    range.startAt,
    args.now - REGISTER_OPEN_LOOKBACK_MS,
  );
  return {
    openedAt,
    openedOperatingDate: range.operatingDate,
    openedOperatingDateEndAt: range.endAt,
    openedOperatingDateStartAt: range.startAt,
    registerNumber: args.registerNumber,
    terminalId: args.terminalId,
  };
}

export function buildSharedDemoStoreSchedule(args: {
  actorUserId: Id<"athenaUser">;
  now: number;
  organizationId: Id<"organization">;
  storeId: Id<"store">;
}) {
  return {
    createdAt: args.now,
    createdByUserId: args.actorUserId,
    dateExceptions: [],
    effectiveFrom: 0,
    organizationId: args.organizationId,
    source: "seed" as const,
    status: "active" as const,
    storeId: args.storeId,
    timezone: SHARED_DEMO_TIME_ZONE,
    updatedAt: args.now,
    updatedByUserId: args.actorUserId,
    weeklyClosedDays: [],
    weeklyWindows: Array.from({ length: 7 }, (_, dayOfWeek) => ({
      dayOfWeek,
      endMinute: 24 * 60,
      label: "Demo hours",
      startMinute: 0,
    })),
  };
}

async function ensureSharedDemoStoreScheduleWithCtx(
  ctx: MutationCtx,
  args: {
    actorUserId: Id<"athenaUser">;
    now: number;
    organizationId: Id<"organization">;
    storeId: Id<"store">;
  },
) {
  const activeSchedules = await ctx.db
    .query("storeSchedule")
    .withIndex("by_storeId_status_effectiveFrom", (q) =>
      q.eq("storeId", args.storeId).eq("status", "active"),
    )
    .take(20);
  const existing = activeSchedules.find(
    (schedule) => schedule.source === "seed",
  );
  const scheduleDocument = buildSharedDemoStoreSchedule(args);
  if (existing) {
    await ctx.db.replace("storeSchedule", existing._id, scheduleDocument);
    const updated = await ctx.db.get("storeSchedule", existing._id);
    if (!updated) throw new Error("Demo store hours are missing.");
    return updated;
  }
  const scheduleId = await ctx.db.insert("storeSchedule", scheduleDocument);
  const schedule = await ctx.db.get("storeSchedule", scheduleId);
  if (!schedule) throw new Error("Demo store hours are missing.");
  return schedule;
}

export async function bindSharedDemoRegisterBaselineWithCtx(
  ctx: MutationCtx,
  args: {
    actorUserId: Id<"athenaUser">;
    now: number;
    storeId: Id<"store">;
    terminal: Doc<"posTerminal">;
  },
) {
  if (
    args.terminal.storeId !== args.storeId ||
    args.terminal.status !== "active" ||
    !args.terminal.registerNumber
  ) {
    throw new Error("The demo register is unavailable on this browser.");
  }

  const [staffProfiles, terminalSessions] = await Promise.all([
    ctx.db
      .query("staffProfile")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .take(100),
    ctx.db
      .query("registerSession")
      .withIndex("by_terminalId", (q) => q.eq("terminalId", args.terminal._id))
      .take(20),
  ]);
  const manager = staffProfiles.find(
    (profile) =>
      profile.staffCode === SHARED_DEMO_MANAGER_STAFF_CODE &&
      profile.status === "active",
  );
  if (!manager) throw new Error("Demo manager is missing.");
  const store = await ctx.db.get("store", args.storeId);
  if (!store) throw new Error("Demo store is missing.");
  const schedule = await ensureSharedDemoStoreScheduleWithCtx(ctx, {
    actorUserId: args.actorUserId,
    now: args.now,
    organizationId: store.organizationId,
    storeId: args.storeId,
  });
  await ctx.db.patch("store", args.storeId, {
    config: { ...store.config, timeZone: SHARED_DEMO_TIME_ZONE },
  });

  const expectedBrowserNote = browserSessionNote(args.terminal._id);
  const existingSession = terminalSessions.find(
    (candidate) =>
      candidate.storeId === args.storeId &&
      candidate.notes === expectedBrowserNote &&
      (candidate.status === "active" || candidate.status === "open"),
  );
  const allocation = planSharedDemoRegisterAllocation({
    hasExistingTerminalSession:
      existingSession?.storeId === args.storeId &&
      existingSession.terminalId === args.terminal._id,
  });

  const narrative = buildSharedDemoRegisterNarrative({
    now: args.now,
    registerNumber: args.terminal.registerNumber,
    schedule,
    terminalId: args.terminal._id,
  });
  const cashBaseline = buildSharedDemoRegisterCashBaseline();
  let allocatedSession = existingSession;
  if (allocation === "clone") {
    const registerSessionId = await insertRegisterSessionWithAuthority(ctx, {
      expectedCash: cashBaseline.expectedCash,
      notes: expectedBrowserNote,
      openedAt: narrative.openedAt,
      openedByStaffProfileId: manager._id,
      openedByUserId: args.actorUserId,
      openedOperatingDate: narrative.openedOperatingDate,
      openedOperatingDateEndAt: narrative.openedOperatingDateEndAt,
      openedOperatingDateStartAt: narrative.openedOperatingDateStartAt,
      openingFloat: cashBaseline.openingFloat,
      organizationId: store.organizationId,
      registerNumber: narrative.registerNumber,
      status: "active",
      storeId: args.storeId,
      terminalId: narrative.terminalId,
    });
    const createdSession = await ctx.db.get("registerSession", registerSessionId);
    if (!createdSession) {
      throw new Error("The demo register session could not be allocated.");
    }
    allocatedSession = createdSession;
  }

  if (!allocatedSession) {
    throw new Error("The demo register session could not be allocated.");
  }
  if (
    allocatedSession.status !== "active" &&
    allocatedSession.status !== "open"
  ) {
    throw new Error("The demo register session is not open.");
  }
  if (
    allocatedSession.openingFloat !== cashBaseline.openingFloat ||
    allocatedSession.expectedCash !== cashBaseline.expectedCash
  ) {
    await patchRegisterSessionWithAuthority(
      ctx,
      allocatedSession._id,
      cashBaseline,
    );
    allocatedSession = { ...allocatedSession, ...cashBaseline };
  }

  const openings = await ctx.db
    .query("dailyOpening")
    .withIndex("by_storeId_operatingDate", (q) => q.eq("storeId", args.storeId))
    .take(20);
  if (openings.length !== 1) {
    throw new Error("Demo Opening Handoff baseline is incomplete.");
  }
  const openingDocument = buildSharedDemoOpeningBaseline({
    actorStaffProfileId: manager._id,
    actorUserId: args.actorUserId,
    now: args.now,
    organizationId: store.organizationId,
    schedule,
    storeId: args.storeId,
  });
  await ctx.db.replace("dailyOpening", openings[0]._id, openingDocument);

  const events = await ctx.db
    .query("operationalEvent")
    .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
    .take(500);
  const storeDayEvent = events.find(
    (event) =>
      event.eventType === "daily_opening_acknowledged" ||
      event.eventType === "demo.store_day_started",
  );
  if (!storeDayEvent)
    throw new Error("Demo store-day narrative is incomplete.");
  await ctx.db.replace(
    "operationalEvent",
    storeDayEvent._id,
    buildSharedDemoStoreDayEvent({
      actorStaffProfileId: manager._id,
      actorUserId: args.actorUserId,
      dailyOpeningId: openings[0]._id,
      now: args.now,
      organizationId: store.organizationId,
      schedule,
      storeId: args.storeId,
    }),
  );

  return {
    bootstrap: {
      cloudRegisterSessionId: allocatedSession._id,
      expectedCash: allocatedSession.expectedCash,
      localRegisterSessionId: String(allocatedSession._id),
      openedAt: allocatedSession.openedAt,
      openingFloat: allocatedSession.openingFloat,
      ...(allocatedSession.registerNumber
        ? { registerNumber: allocatedSession.registerNumber }
        : {}),
      staffProfileId: allocatedSession.openedByStaffProfileId ?? manager._id,
      status:
        allocatedSession.status === "active"
          ? ("active" as const)
          : ("open" as const),
    },
    managerDisplayName: manager.fullName,
    openedAt: allocatedSession.openedAt,
    operatingDate:
      allocatedSession.openedOperatingDate ?? narrative.openedOperatingDate,
    registerNumber: narrative.registerNumber,
    terminalId: narrative.terminalId,
    timezone: SHARED_DEMO_TIME_ZONE,
  };
}
