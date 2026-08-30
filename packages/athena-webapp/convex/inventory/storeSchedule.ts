import { v } from "convex/values";

import {
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { commandResultValidator } from "../lib/commandResultValidators";
import {
  getMissingStoreScheduleContext,
  resolveStoreOperatingRangeForDate,
  resolveStoreScheduleContext,
  nextReportingCycleBoundary,
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
import {
  findActiveScheduleForStoreAt,
  getStoreScheduleContextForStoreAtWithCtx,
  listActiveSchedulesForStore,
  resolveStoreOperatingRangeForDateWithCtx,
  STORE_SCHEDULE_VERSION_READ_LIMIT,
} from "./storeScheduleCore";
// Re-exported so the many non-ingress callers keep their import path; modules
// that the composition root itself reaches (e.g. `sharedDemo/openingBaseline`)
// must import from `./storeScheduleCore` instead, or they close a cycle.
export {
  getStoreScheduleContextForStoreAtWithCtx,
  resolveStoreOperatingRangeForDateWithCtx,
};
import { requireStoreFullAdminAccess } from "../stockOps/access";
import { ensureTimezoneAuthorityForScheduleWithCtx } from "../storeTime/ensureTimezoneAuthority";
import {
  admitPublicMutation,
  admitPublicQuery,
} from "../platform/operationAdmission";
import { upsertStoreScheduleCommandOperationDefinition } from "../operationAdmission/domains/inventoryCatalog_definitions";
import {
  getStoreDayContextReadDefinition,
  getStoreScheduleForAdminReadDefinition,
  getStoreScheduleSummaryReadDefinition,
  listStoreScheduleVersionsReadDefinition,
} from "../operationAdmission/domains/inventoryCatalog_readDefinitions";
import type {
  OperationMutationCtx,
  OperationQueryCtx,
} from "../operationAdmission/types";
import { bumpAcceptedWatermarkWithCtx } from "../reports/pipelineAcceptedWatermark";
import { markWeekDirty } from "../reports/weeklyMarks";

/**
 * `upsertStoreScheduleCommand` answers with a `CommandResult`, and today an
 * unauthorized caller gets `authorization_failed` rather than a throw. Admission
 * is therefore resolved first so a recognized denial keeps that contract; every
 * other failure still propagates.
 */
function isStoreScheduleAdmissionAuthorizationError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return (
    message === "Sign in again to continue." ||
    message === "This operation is not available for the current actor." ||
    message.includes("shared_demo_action_denied")
  );
}

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
  reportingCycleStartsOn?: number;
  effectiveFrom: number;
  effectiveTo?: number;
  status?: "active" | "superseded" | "candidate";
  source?: "admin" | "seed" | "import" | "system";
  supersedesScheduleId?: Id<"storeSchedule">;
  actorUserId?: Id<"athenaUser">;
};

const entity = "storeSchedule";

const storeScheduleInputValidator = {
  storeId: v.id("store"),
  timezone: v.string(),
  weeklyWindows: v.array(storeScheduleWindowSchema),
  weeklyClosedDays: v.array(v.number()),
  dateExceptions: v.array(storeScheduleDateExceptionSchema),
  reportingCycleStartsOn: v.optional(v.number()),
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
  reportingCycleStartsOn: v.optional(v.number()),
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
  reportingCycleStartsOn: v.number(),
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

export const getActiveStoreScheduleForEmail = internalQuery({
  args: {
    at: v.number(),
    storeId: v.id("store"),
  },
  returns: v.union(storeScheduleSummaryValidator, v.null()),
  handler: async (ctx, args) => {
    const schedule = await findActiveScheduleForStoreAt(ctx, args);
    return schedule ? toSummary(schedule) : null;
  },
});

const storeScheduleAdminResultValidator = v.object({
  adminConfirmed: v.boolean(),
  confirmationStatus: v.union(
    v.literal("candidate"),
    v.literal("admin_confirmed"),
  ),
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
  reportingCycleStartsOn: v.number(),
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
    reportingCycleStartsOn: args.reportingCycleStartsOn ?? 1,
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

function toSummary(
  schedule: Doc<"storeSchedule"> | (StoreScheduleDraft & { _id: string }),
) {
  return {
    scheduleVersionId: schedule._id,
    organizationId: schedule.organizationId,
    storeId: schedule.storeId,
    timezone: schedule.timezone,
    weeklyWindows: schedule.weeklyWindows,
    weeklyClosedDays: schedule.weeklyClosedDays,
    dateExceptions: schedule.dateExceptions,
    reportingCycleStartsOn: schedule.reportingCycleStartsOn ?? 1,
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
  context:
    | ReturnType<typeof resolveStoreScheduleContext>
    | ReturnType<typeof getMissingStoreScheduleContext>,
) {
  const weeklyHours = DAY_LABELS.slice(1)
    .concat(DAY_LABELS.slice(0, 1))
    .map((day) => {
      const dayOfWeek = DAY_LABELS.indexOf(day);
      const windows =
        schedule?.weeklyWindows
          .filter((window) => window.dayOfWeek === dayOfWeek)
          .map((window) => ({
            openTime: minutesToTimeInput(window.startMinute),
            closeTime: minutesToTimeInput(window.endMinute),
          })) ?? [];

      return {
        closed: schedule
          ? schedule.weeklyClosedDays.includes(dayOfWeek) ||
            windows.length === 0
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
    context.currentWindow?.localEndLabel ??
    context.nextWindow?.localEndLabel ??
    null;
  const timezone = schedule?.timezone ?? context.timezone ?? "America/New_York";
  const adminConfirmed =
    schedule?.status === "active" && schedule.source === "admin";

  return {
    adminConfirmed,
    confirmationStatus: adminConfirmed
      ? ("admin_confirmed" as const)
      : ("candidate" as const),
    exceptions,
    nextCloseLabel,
    nextOpenLabel,
    reportingCycleStartsOn: schedule?.reportingCycleStartsOn ?? 1,
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
  let draft = toDraft(store, { ...args, actorUserId }, now);

  if (draft.status === "active") {
    const activeSchedules = await listActiveSchedulesForStore(
      ctx,
      args.storeId,
    );
    const supersededSchedule = args.supersedesScheduleId
      ? activeSchedules.find(
          (schedule) => schedule._id === args.supersedesScheduleId,
        )
      : null;

    if (args.supersedesScheduleId && !supersededSchedule) {
      return userError({
        code: "conflict",
        message: "Store schedule version could not be superseded.",
      });
    }

    if (
      supersededSchedule &&
      (supersededSchedule.reportingCycleStartsOn ?? 1) !==
        draft.reportingCycleStartsOn
    ) {
      const effectiveFrom = nextReportingCycleBoundary({
        at: now,
        reportingCycleStartsOn: supersededSchedule.reportingCycleStartsOn,
        timezone: supersededSchedule.timezone,
      });
      if (effectiveFrom === null) {
        return userError({
          code: "validation_failed",
          message: "Store hours were not saved. Review the highlighted fields.",
          fields: {
            reportingCycleStartsOn: ["Choose a valid store timezone."],
          },
        });
      }
      draft = { ...draft, effectiveFrom };
    }

    if (
      activeSchedulesOverlap(draft, activeSchedules, args.supersedesScheduleId)
    ) {
      return userError({
        code: "conflict",
        message: "Store schedule effective dates overlap an active version.",
        fields: {
          effectiveFrom: [
            "Schedule effective dates overlap an active version.",
          ],
        },
      });
    }
  }

  const validation = validateStoreScheduleDraft(draft);
  if (!validation.ok) {
    return userError({
      code: "validation_failed",
      message: "Store hours were not saved. Review the highlighted fields.",
      fields: validation.fields,
    });
  }

  const scheduleId = await ctx.db.insert(entity, draft);

  if (args.supersedesScheduleId) {
    await ctx.db.patch(entity, args.supersedesScheduleId, {
      effectiveTo: draft.effectiveFrom,
      ...(draft.effectiveFrom <= now
        ? {
            status: "superseded" as const,
            supersededAt: now,
            supersededByScheduleId: scheduleId,
          }
        : {}),
      updatedAt: now,
      updatedByUserId: actorUserId,
    });
  }

  if (draft.status !== "candidate" || args.supersedesScheduleId) {
    await bumpAcceptedWatermarkWithCtx(ctx, args.storeId);
    await markWeekDirty(ctx, args.storeId, "day_folded", now);
  }

  const saved = await ctx.db.get(entity, scheduleId);
  if (saved && actorUserId && saved.status === "active") {
    await ensureTimezoneAuthorityForScheduleWithCtx(ctx, {
      actorUserId,
      schedule: saved,
    });
  }
  return ok(toSummary(saved ?? { ...draft, _id: scheduleId }));
}

export const upsertStoreScheduleCommand = mutation({
  args: publicStoreScheduleInputValidator,
  returns: commandResultValidator(storeScheduleSummaryValidator),
  handler: async (ctx, args) => {
    try {
      return await admitPublicMutation(
        upsertStoreScheduleCommandOperationDefinition,
        (admittedCtx: OperationMutationCtx, admittedArgs: typeof args) =>
          upsertStoreScheduleCommandWithCtx(
            admittedCtx,
            {
              ...admittedArgs,
              source: "admin",
              status: "active",
            },
            { enforceFullAdminAccess: true },
          ),
      )(ctx, args);
    } catch (error) {
      if (!isStoreScheduleAdmissionAuthorizationError(error)) {
        throw error;
      }
      return userError({
        code: "authorization_failed",
        message: "You do not have access to manage store hours.",
      });
    }
  },
});

export const getStoreDayContext = query({
  args: {
    storeId: v.id("store"),
    at: v.optional(v.number()),
  },
  returns: storeScheduleContextValidator,
  handler: admitPublicQuery(
    getStoreDayContextReadDefinition,
    async (
      ctx: OperationQueryCtx,
      args: { storeId: Id<"store">; at?: number },
    ) => {
      const at = args.at ?? Date.now();
      const { context } = await getStoreScheduleContextForStoreAtWithCtx(ctx, {
        storeId: args.storeId,
        at,
      });
      return context;
    },
  ),
});

export const getStoreScheduleSummary = query({
  args: {
    storeId: v.id("store"),
    at: v.optional(v.number()),
  },
  returns: storeScheduleSummaryResultValidator,
  handler: admitPublicQuery(
    getStoreScheduleSummaryReadDefinition,
    async (
      ctx: OperationQueryCtx,
      args: { storeId: Id<"store">; at?: number },
    ) => {
      const at = args.at ?? Date.now();
      const { schedule, context } =
        await getStoreScheduleContextForStoreAtWithCtx(ctx, {
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
  ),
});

export const listStoreScheduleVersions = query({
  args: {
    organizationId: v.id("organization"),
    storeId: v.id("store"),
    status: v.optional(storeScheduleStatusSchema),
  },
  returns: v.array(storeScheduleSummaryValidator),
  handler: admitPublicQuery(
    listStoreScheduleVersionsReadDefinition,
    async (
      ctx: OperationQueryCtx,
      args: {
        organizationId: Id<"organization">;
        storeId: Id<"store">;
        status?: "active" | "superseded" | "candidate";
      },
    ) => {
      const schedules = await ctx.db
        .query(entity)
        .withIndex("by_organizationId_storeId_status", (schedule) =>
          args.status
            ? schedule
                .eq("organizationId", args.organizationId)
                .eq("storeId", args.storeId)
                .eq("status", args.status)
            : schedule
                .eq("organizationId", args.organizationId)
                .eq("storeId", args.storeId),
        )
        .take(STORE_SCHEDULE_VERSION_READ_LIMIT);

      return schedules
        .sort((left, right) => right.effectiveFrom - left.effectiveFrom)
        .map(toSummary);
    },
  ),
});

export const getStoreScheduleForAdmin = query({
  args: {
    storeId: v.id("store"),
    at: v.optional(v.number()),
  },
  returns: storeScheduleAdminResultValidator,
  handler: admitPublicQuery(
    getStoreScheduleForAdminReadDefinition,
    async (
      ctx: OperationQueryCtx,
      args: { storeId: Id<"store">; at?: number },
    ) => {
      await requireStoreFullAdminAccess(ctx, args.storeId);
      const at = args.at ?? Date.now();
      const { schedule, context } =
        await getStoreScheduleContextForStoreAtWithCtx(ctx, {
          storeId: args.storeId,
          at,
        });

      return toAdminResult(schedule, context);
    },
  ),
});
