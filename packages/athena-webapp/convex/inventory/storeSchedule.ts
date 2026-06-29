import { v } from "convex/values";

import { mutation, query, type MutationCtx, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { commandResultValidator } from "../lib/commandResultValidators";
import {
  getMissingStoreScheduleContext,
  resolveStoreOperatingRangeForDate,
  resolveStoreScheduleContext,
  validateNoEffectiveRangeOverlap,
  validateStoreScheduleDraft,
  type StoreScheduleDraft,
} from "../lib/storeScheduleTime";
import { ok, userError, type CommandResult } from "../../shared/commandResult";
import {
  storeScheduleDateExceptionSchema,
  storeScheduleSourceSchema,
  storeScheduleStatusSchema,
  storeScheduleWindowSchema,
} from "../schemas/inventory";
import { requireStoreFullAdminAccess } from "../stockOps/access";

type StoreScheduleInput = {
  storeId: Id<"store">;
  timezone: string;
  weeklyWindows: Array<{
    dayOfWeek: number;
    startMinute: number;
    endMinute: number;
    label?: string;
  }>;
  weeklyClosedDays: number[];
  dateExceptions: Array<{
    localDate: string;
    closed: boolean;
    windows: Array<{
      startMinute: number;
      endMinute: number;
      label?: string;
    }>;
    note?: string;
  }>;
  effectiveFrom: number;
  effectiveTo?: number;
  status?: "active" | "superseded" | "candidate";
  source?: "admin" | "seed" | "import" | "system";
  supersedesScheduleId?: Id<"storeSchedule">;
  actorUserId?: Id<"athenaUser">;
};

const entity = "storeSchedule";
const STORE_SCHEDULE_VERSION_READ_LIMIT = 100;

const storeScheduleInputValidator = {
  storeId: v.id("store"),
  timezone: v.string(),
  weeklyWindows: v.array(storeScheduleWindowSchema),
  weeklyClosedDays: v.array(v.number()),
  dateExceptions: v.array(storeScheduleDateExceptionSchema),
  effectiveFrom: v.number(),
  effectiveTo: v.optional(v.number()),
  status: v.optional(storeScheduleStatusSchema),
  source: v.optional(storeScheduleSourceSchema),
  supersedesScheduleId: v.optional(v.id("storeSchedule")),
  actorUserId: v.optional(v.id("athenaUser")),
};

const publicStoreScheduleInputValidator = {
  storeId: v.id("store"),
  timezone: v.string(),
  weeklyWindows: v.array(storeScheduleWindowSchema),
  weeklyClosedDays: v.array(v.number()),
  dateExceptions: v.array(storeScheduleDateExceptionSchema),
  effectiveFrom: v.number(),
  effectiveTo: v.optional(v.number()),
  supersedesScheduleId: v.optional(v.id("storeSchedule")),
};

const storeScheduleSummaryValidator = v.object({
  scheduleVersionId: v.id("storeSchedule"),
  organizationId: v.id("organization"),
  storeId: v.id("store"),
  timezone: v.string(),
  weeklyWindows: v.array(storeScheduleWindowSchema),
  weeklyClosedDays: v.array(v.number()),
  dateExceptions: v.array(storeScheduleDateExceptionSchema),
  effectiveFrom: v.number(),
  effectiveTo: v.union(v.number(), v.null()),
  status: storeScheduleStatusSchema,
  source: storeScheduleSourceSchema,
  createdAt: v.number(),
  updatedAt: v.number(),
});

const storeScheduleContextWindowValidator = v.object({
  localDate: v.string(),
  startMinute: v.number(),
  endMinute: v.number(),
  startsAt: v.number(),
  endsAt: v.number(),
  crossesDateBoundary: v.boolean(),
  localStartLabel: v.string(),
  localEndLabel: v.string(),
  label: v.optional(v.string()),
});

const storeScheduleContextValidator = v.union(
  v.object({
    kind: v.literal("resolved"),
    timezone: v.string(),
    operatingDate: v.string(),
    phase: v.union(
      v.literal("before_first_window"),
      v.literal("during_window"),
      v.literal("between_windows"),
      v.literal("after_last_window"),
      v.literal("closed"),
    ),
    isOpen: v.boolean(),
    scheduleVersionId: v.union(v.string(), v.null()),
    currentWindow: v.union(storeScheduleContextWindowValidator, v.null()),
    nextWindow: v.union(storeScheduleContextWindowValidator, v.null()),
  }),
  v.object({
    kind: v.literal("missing_schedule"),
    timezone: v.null(),
    operatingDate: v.string(),
    phase: v.literal("unavailable"),
    isOpen: v.literal(false),
    scheduleVersionId: v.null(),
    currentWindow: v.null(),
    nextWindow: v.null(),
  }),
);

const storeScheduleSummaryResultValidator = v.object({
  schedule: v.union(storeScheduleSummaryValidator, v.null()),
  context: storeScheduleContextValidator,
});

const storeScheduleAdminResultValidator = v.object({
  adminConfirmed: v.boolean(),
  confirmationStatus: v.union(v.literal("candidate"), v.literal("admin_confirmed")),
  exceptions: v.array(
    v.object({
      closed: v.boolean(),
      date: v.string(),
      label: v.optional(v.string()),
      windows: v.array(
        v.object({
          openTime: v.string(),
          closeTime: v.string(),
        }),
      ),
    }),
  ),
  nextCloseLabel: v.union(v.string(), v.null()),
  nextOpenLabel: v.union(v.string(), v.null()),
  source: v.string(),
  scheduleVersionId: v.union(v.id("storeSchedule"), v.null()),
  summary: v.object({
    nextCloseLabel: v.union(v.string(), v.null()),
    nextOpenLabel: v.union(v.string(), v.null()),
    todayScheduleLabel: v.string(),
    timezoneLabel: v.string(),
  }),
  timezone: v.string(),
  todayScheduleLabel: v.string(),
  weeklyHours: v.array(
    v.object({
      closed: v.boolean(),
      day: v.union(
        v.literal("monday"),
        v.literal("tuesday"),
        v.literal("wednesday"),
        v.literal("thursday"),
        v.literal("friday"),
        v.literal("saturday"),
        v.literal("sunday"),
      ),
      windows: v.array(
        v.object({
          openTime: v.string(),
          closeTime: v.string(),
        }),
      ),
    }),
  ),
});

function toDraft(
  store: Doc<"store">,
  args: StoreScheduleInput,
  now: number,
): StoreScheduleDraft {
  return {
    organizationId: store.organizationId,
    storeId: args.storeId,
    timezone: args.timezone,
    weeklyWindows: args.weeklyWindows,
    weeklyClosedDays: args.weeklyClosedDays,
    dateExceptions: args.dateExceptions,
    effectiveFrom: args.effectiveFrom,
    effectiveTo: args.effectiveTo,
    status: args.status ?? "active",
    source: args.source ?? "admin",
    createdAt: now,
    updatedAt: now,
    createdByUserId: args.actorUserId,
    updatedByUserId: args.actorUserId,
  };
}

function toSummary(schedule: Doc<"storeSchedule"> | (StoreScheduleDraft & { _id: string })) {
  return {
    scheduleVersionId: schedule._id,
    organizationId: schedule.organizationId,
    storeId: schedule.storeId,
    timezone: schedule.timezone,
    weeklyWindows: schedule.weeklyWindows,
    weeklyClosedDays: schedule.weeklyClosedDays,
    dateExceptions: schedule.dateExceptions,
    effectiveFrom: schedule.effectiveFrom,
    effectiveTo: schedule.effectiveTo ?? null,
    status: schedule.status,
    source: schedule.source,
    createdAt: schedule.createdAt,
    updatedAt: schedule.updatedAt,
  };
}

const DAY_LABELS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

function minutesToTimeInput(minute: number) {
  const normalized = ((minute % 1440) + 1440) % 1440;
  const hour = Math.floor(normalized / 60);
  const minuteOfHour = normalized % 60;
  return `${String(hour).padStart(2, "0")}:${String(minuteOfHour).padStart(2, "0")}`;
}

function toAdminResult(
  schedule: Doc<"storeSchedule"> | null,
  context: ReturnType<typeof resolveStoreScheduleContext> | ReturnType<typeof getMissingStoreScheduleContext>,
) {
  const weeklyHours = DAY_LABELS.slice(1)
    .concat(DAY_LABELS.slice(0, 1))
    .map((day) => {
      const dayOfWeek = DAY_LABELS.indexOf(day);
      const windows = schedule?.weeklyWindows
        .filter((window) => window.dayOfWeek === dayOfWeek)
        .map((window) => ({
          openTime: minutesToTimeInput(window.startMinute),
          closeTime: minutesToTimeInput(window.endMinute),
        })) ?? [];

      return {
        closed: schedule
          ? schedule.weeklyClosedDays.includes(dayOfWeek) || windows.length === 0
          : day === "sunday",
        day,
        windows,
      };
    });
  const exceptions =
    schedule?.dateExceptions.map((exception) => ({
      closed: exception.closed,
      date: exception.localDate,
      label: exception.note,
      windows: exception.windows.map((window) => ({
        openTime: minutesToTimeInput(window.startMinute),
        closeTime: minutesToTimeInput(window.endMinute),
      })),
    })) ?? [];
  const todayScheduleLabel =
    context.kind === "resolved"
      ? context.isOpen
        ? `Open until ${context.currentWindow?.localEndLabel ?? "close"}.`
        : context.phase === "closed"
          ? "Closed today."
          : context.nextWindow
            ? `Next open ${context.nextWindow.localStartLabel}.`
            : "Store hours are configured."
      : "Store hours are not configured yet.";
  const nextOpenLabel =
    context.nextWindow?.localStartLabel ??
    (context.isOpen ? context.currentWindow?.localStartLabel : null) ??
    null;
  const nextCloseLabel =
    context.currentWindow?.localEndLabel ?? context.nextWindow?.localEndLabel ?? null;
  const timezone = schedule?.timezone ?? context.timezone ?? "America/New_York";
  const adminConfirmed = schedule?.status === "active" && schedule.source === "admin";

  return {
    adminConfirmed,
    confirmationStatus: adminConfirmed ? "admin_confirmed" as const : "candidate" as const,
    exceptions,
    nextCloseLabel,
    nextOpenLabel,
    source: schedule?.source ?? "missing_schedule",
    scheduleVersionId: schedule?._id ?? null,
    summary: {
      nextCloseLabel,
      nextOpenLabel,
      todayScheduleLabel,
      timezoneLabel: timezone,
    },
    timezone,
    todayScheduleLabel,
    weeklyHours,
  };
}

async function listActiveSchedulesForStore(
  ctx: Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">,
  storeId: Id<"store">,
) {
  return await ctx.db
    .query(entity)
    .withIndex("by_storeId_status_effectiveFrom", (schedule) =>
      schedule.eq("storeId", storeId).eq("status", "active"),
    )
    .take(STORE_SCHEDULE_VERSION_READ_LIMIT);
}

async function findActiveScheduleForStoreAt(
  ctx: Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">,
  args: { storeId: Id<"store">; at: number },
) {
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
          (schedule.effectiveTo === undefined || args.at < schedule.effectiveTo),
      )
      .sort((left, right) => right.effectiveFrom - left.effectiveFrom)[0] ??
    null
  );
}

export async function getStoreScheduleContextForStoreAtWithCtx(
  ctx: Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">,
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
  ctx: Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">,
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

function activeSchedulesOverlap(
  draft: StoreScheduleDraft,
  schedules: Array<Doc<"storeSchedule">>,
  supersedesScheduleId?: Id<"storeSchedule">,
) {
  return !validateNoEffectiveRangeOverlap(
    draft,
    schedules.filter((schedule) => schedule._id !== supersedesScheduleId),
  );
}

export async function upsertStoreScheduleCommandWithCtx(
  ctx: MutationCtx,
  args: StoreScheduleInput,
  options: { enforceFullAdminAccess?: boolean } = {},
): Promise<CommandResult<ReturnType<typeof toSummary>>> {
  let store: Doc<"store"> | null;
  let actorUserId = args.actorUserId;

  if (options.enforceFullAdminAccess === true) {
    try {
      const access = await requireStoreFullAdminAccess(ctx, args.storeId);
      store = access.store;
      actorUserId = access.athenaUser._id;
    } catch (error) {
      return userError({
        code: "authorization_failed",
        message: (error as Error).message,
      });
    }
  } else {
    store = await ctx.db.get("store", args.storeId);
    if (!store) {
      return userError({
        code: "not_found",
        message: "Store not found.",
      });
    }
  }

  const now = Date.now();
  const draft = toDraft(store, { ...args, actorUserId }, now);
  const validation = validateStoreScheduleDraft(draft);

  if (!validation.ok) {
    return userError({
      code: "validation_failed",
      message: "Store hours were not saved. Review the highlighted fields.",
      fields: validation.fields,
    });
  }

  if (draft.status === "active") {
    const activeSchedules = await listActiveSchedulesForStore(ctx, args.storeId);
    const supersededSchedule = args.supersedesScheduleId
      ? activeSchedules.find((schedule) => schedule._id === args.supersedesScheduleId)
      : null;

    if (args.supersedesScheduleId && !supersededSchedule) {
      return userError({
        code: "conflict",
        message: "Store schedule version could not be superseded.",
      });
    }

    if (activeSchedulesOverlap(draft, activeSchedules, args.supersedesScheduleId)) {
      return userError({
        code: "conflict",
        message: "Store schedule effective dates overlap an active version.",
        fields: {
          effectiveFrom: ["Schedule effective dates overlap an active version."],
        },
      });
    }
  }

  const scheduleId = await ctx.db.insert(entity, draft);

  if (args.supersedesScheduleId) {
    await ctx.db.patch(entity, args.supersedesScheduleId, {
      status: "superseded",
      effectiveTo: args.effectiveFrom,
      supersededAt: now,
      supersededByScheduleId: scheduleId,
      updatedAt: now,
      updatedByUserId: actorUserId,
    });
  }

  const saved = await ctx.db.get(entity, scheduleId);
  return ok(toSummary(saved ?? { ...draft, _id: scheduleId }));
}

export const upsertStoreScheduleCommand = mutation({
  args: publicStoreScheduleInputValidator,
  returns: commandResultValidator(storeScheduleSummaryValidator),
  handler: (ctx, args) =>
    upsertStoreScheduleCommandWithCtx(
      ctx,
      {
        ...args,
        source: "admin",
        status: "active",
      },
      { enforceFullAdminAccess: true },
    ),
});

export const getStoreDayContext = query({
  args: {
    storeId: v.id("store"),
    at: v.optional(v.number()),
  },
  returns: storeScheduleContextValidator,
  handler: async (ctx, args) => {
    const at = args.at ?? Date.now();
    const { context } = await getStoreScheduleContextForStoreAtWithCtx(ctx, {
      storeId: args.storeId,
      at,
    });
    return context;
  },
});

export const getStoreScheduleSummary = query({
  args: {
    storeId: v.id("store"),
    at: v.optional(v.number()),
  },
  returns: storeScheduleSummaryResultValidator,
  handler: async (ctx, args) => {
    const at = args.at ?? Date.now();
    const { schedule, context } = await getStoreScheduleContextForStoreAtWithCtx(ctx, {
      storeId: args.storeId,
      at,
    });

    if (!schedule) {
      return {
        schedule: null,
        context,
      };
    }

    return {
      schedule: toSummary(schedule),
      context,
    };
  },
});

export const listStoreScheduleVersions = query({
  args: {
    organizationId: v.id("organization"),
    storeId: v.id("store"),
    status: v.optional(storeScheduleStatusSchema),
  },
  returns: v.array(storeScheduleSummaryValidator),
  handler: async (ctx, args) => {
    const schedules = await ctx.db
      .query(entity)
      .withIndex("by_organizationId_storeId_status", (schedule) =>
        args.status
          ? schedule
              .eq("organizationId", args.organizationId)
              .eq("storeId", args.storeId)
              .eq("status", args.status)
          : schedule.eq("organizationId", args.organizationId).eq("storeId", args.storeId),
      )
      .take(STORE_SCHEDULE_VERSION_READ_LIMIT);

    return schedules
      .sort((left, right) => right.effectiveFrom - left.effectiveFrom)
      .map(toSummary);
  },
});

export const getStoreScheduleForAdmin = query({
  args: {
    storeId: v.id("store"),
    at: v.optional(v.number()),
  },
  returns: storeScheduleAdminResultValidator,
  handler: async (ctx, args) => {
    await requireStoreFullAdminAccess(ctx, args.storeId);
    const at = args.at ?? Date.now();
    const { schedule, context } = await getStoreScheduleContextForStoreAtWithCtx(ctx, {
      storeId: args.storeId,
      at,
    });

    return toAdminResult(schedule, context);
  },
});
