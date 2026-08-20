import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { query } from "../_generated/server";
import { normalizeWorkflowTraceLookupValue } from "../../shared/workflowTrace";
import { requireStoreFullAdminAccess } from "../stockOps/access";
import { getAuthenticatedAthenaUserWithCtx } from "../lib/athenaUserAuth";
import { getActiveManagerElevationWithCtx } from "../operations/managerElevations";
import { listWorkflowTraceEventsWithCtx } from "./core";
import { buildWorkflowTraceViewModel } from "./presentation";
import { denySharedDemoAction } from "../sharedDemo/policy";
import { admitPublicQuery } from "../platform/operationAdmission";
import {
  getWorkflowTraceByLookupReadDefinition,
  getWorkflowTraceViewByIdReadDefinition,
} from "../operationAdmission/readDefinitions";
import type { OperationQueryCtx } from "../operationAdmission/types";
import { MAX_WORKFLOW_TRACE_EVENTS } from "../../shared/operationalEvidenceLimits";

const SHARED_DEMO_READABLE_WORKFLOW_TYPES = new Set([
  "register_session",
  "online_order",
]);

export function selectWorkflowTraceEventWindow<TraceEvent>(
  events: TraceEvent[],
) {
  return {
    events: events.slice(0, MAX_WORKFLOW_TRACE_EVENTS),
    eventsTruncated: events.length > MAX_WORKFLOW_TRACE_EVENTS,
  };
}

export type WorkflowTraceAccessAuthorizer = (
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    terminalId?: Id<"posTerminal">;
    trace: {
      traceId: string;
      workflowType: string;
      primarySubjectType?: string;
      primarySubjectId?: string;
    };
  },
) => Promise<boolean> | boolean;

export type WorkflowTraceAccessAuthorizers = Record<
  string,
  WorkflowTraceAccessAuthorizer
>;

const requireAdminWorkflowTraceAccess: WorkflowTraceAccessAuthorizer = async (
  ctx,
  args,
) => {
  await requireFullAdminOrManagerElevationTraceAccess(ctx, args);
  return true;
};

async function requireFullAdminOrManagerElevationTraceAccess(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    terminalId?: Id<"posTerminal">;
  },
) {
  try {
    await requireStoreFullAdminAccess(ctx, args.storeId);
    return;
  } catch (error) {
    if (!args.terminalId) {
      throw error;
    }

    const account = await getAuthenticatedAthenaUserWithCtx(ctx);
    if (!account) {
      throw error;
    }

    const elevation = await getActiveManagerElevationWithCtx(ctx, {
      accountId: account._id,
      storeId: args.storeId,
      terminalId: args.terminalId,
    });

    if (!elevation) {
      throw error;
    }
  }
}

async function assertWorkflowTraceAccess(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    terminalId?: Id<"posTerminal">;
    trace: {
      traceId: string;
      workflowType: string;
      primarySubjectType?: string;
      primarySubjectId?: string;
    };
    accessAuthorizers?: WorkflowTraceAccessAuthorizers;
  },
) {
  const authorizer =
    args.accessAuthorizers?.[args.trace.workflowType] ??
    requireAdminWorkflowTraceAccess;
  const isAuthorized = await authorizer(ctx, {
    storeId: args.storeId,
    terminalId: args.terminalId,
    trace: args.trace,
  });

  if (!isAuthorized) {
    throw new Error("Workflow trace access denied.");
  }
}

async function assertDefaultWorkflowTraceAccess(
  ctx: QueryCtx,
  args: {
    accessAuthorizers?: WorkflowTraceAccessAuthorizers;
    storeId: Id<"store">;
    terminalId?: Id<"posTerminal">;
  },
) {
  if (args.accessAuthorizers) {
    return;
  }

  await requireFullAdminOrManagerElevationTraceAccess(ctx, args);
}

async function getRegisterSessionTraceIdentity(
  ctx: QueryCtx,
  trace: Pick<
    Doc<"workflowTrace">,
    | "storeId"
    | "workflowType"
    | "primaryLookupType"
    | "primaryLookupValue"
    | "primarySubjectType"
    | "primarySubjectId"
  >,
) {
  if (trace.workflowType !== "register_session") {
    return null;
  }

  const registerSessionIds: string[] = [];
  if (
    trace.primarySubjectType === "register_session" &&
    trace.primarySubjectId
  ) {
    registerSessionIds.push(trace.primarySubjectId);
  }
  if (
    trace.primaryLookupType === "register_session_id" &&
    !registerSessionIds.includes(trace.primaryLookupValue)
  ) {
    registerSessionIds.push(trace.primaryLookupValue);
  }

  for (const registerSessionId of registerSessionIds) {
    const normalizedRegisterSessionId = ctx.db.normalizeId(
      "registerSession",
      registerSessionId,
    );
    if (!normalizedRegisterSessionId) {
      continue;
    }

    const registerSession = await ctx.db.get(
      "registerSession",
      normalizedRegisterSessionId,
    );
    if (!registerSession || registerSession.storeId !== trace.storeId) {
      continue;
    }

    const [terminal, openedByStaff, closedByStaff] = await Promise.all([
      registerSession.terminalId
        ? ctx.db.get("posTerminal", registerSession.terminalId)
        : null,
      registerSession.openedByStaffProfileId
        ? ctx.db.get("staffProfile", registerSession.openedByStaffProfileId)
        : null,
      registerSession.closedByStaffProfileId
        ? ctx.db.get("staffProfile", registerSession.closedByStaffProfileId)
        : null,
    ]);

    return {
      _id: registerSession._id,
      closedAt: registerSession.closedAt ?? null,
      closedByName:
        closedByStaff?.storeId === trace.storeId
          ? closedByStaff.fullName
          : null,
      openedAt: registerSession.openedAt,
      openedByName:
        openedByStaff?.storeId === trace.storeId
          ? openedByStaff.fullName
          : null,
      openingFloat: registerSession.openingFloat,
      registerNumber: registerSession.registerNumber ?? null,
      terminalName:
        terminal?.storeId === trace.storeId
          ? terminal.displayName.trim() || null
          : null,
    };
  }

  return null;
}

export async function getWorkflowTraceViewByIdWithCtx(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    terminalId?: Id<"posTerminal">;
    traceId: string;
    accessAuthorizers?: WorkflowTraceAccessAuthorizers;
  },
) {
  const admittedActor = (ctx as Partial<OperationQueryCtx>).operationAdmission
    ?.actor;
  if (admittedActor?.kind !== "shared_demo") {
    await assertDefaultWorkflowTraceAccess(ctx, args);
  }

  const trace = await ctx.db
    .query("workflowTrace")
    .withIndex("by_storeId_traceId", (q) =>
      q.eq("storeId", args.storeId).eq("traceId", args.traceId),
    )
    .unique();

  if (!trace) {
    return null;
  }

  if (admittedActor?.kind === "shared_demo") {
    if (!SHARED_DEMO_READABLE_WORKFLOW_TYPES.has(trace.workflowType)) {
      denySharedDemoAction();
    }
  } else {
    await assertWorkflowTraceAccess(ctx, {
      storeId: args.storeId,
      terminalId: args.terminalId,
      trace,
      accessAuthorizers: args.accessAuthorizers,
    });
  }

  const [eventCandidates, registerSession, store] = await Promise.all([
    listWorkflowTraceEventsWithCtx(ctx as never, {
      limit: MAX_WORKFLOW_TRACE_EVENTS + 1,
      storeId: args.storeId,
      traceId: trace.traceId,
    }),
    getRegisterSessionTraceIdentity(ctx, trace),
    ctx.db.get("store", args.storeId),
  ]);
  const { events, eventsTruncated } =
    selectWorkflowTraceEventWindow(eventCandidates);
  const actorStaffProfileIds = Array.from(
    new Set(
      events
        .flatMap((event) => [
          event.actorRefs?.actorStaffProfileId,
          event.subjectRefs?.approvedByStaffProfileId,
        ])
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const actorStaffProfiles = await Promise.all(
    actorStaffProfileIds.map(async (staffProfileId) => {
      const normalizedId = ctx.db.normalizeId("staffProfile", staffProfileId);
      if (!normalizedId) return null;
      const profile = await ctx.db.get("staffProfile", normalizedId);
      return profile?.storeId === args.storeId ? profile : null;
    }),
  );
  const actorNamesByStaffProfileId = new Map(
    actorStaffProfiles
      .filter((profile) => profile !== null)
      .map((profile) => [String(profile._id), profile.fullName]),
  );
  const view = buildWorkflowTraceViewModel({ trace, events });
  const contextualEvents = view.events.map((event) => {
    if (!registerSession) return event;

    const actorStaffProfileId = event.actorRefs?.actorStaffProfileId;
    const actorName = actorStaffProfileId
      ? actorNamesByStaffProfileId.get(actorStaffProfileId)
      : undefined;
    const approvedByStaffProfileId =
      event.subjectRefs?.approvedByStaffProfileId;
    const approvedByName = approvedByStaffProfileId
      ? actorNamesByStaffProfileId.get(approvedByStaffProfileId)
      : undefined;

    if (event.step === "register_session_opened") {
      return {
        ...event,
        details: {
          ...event.details,
          openingFloat: registerSession.openingFloat,
          openedBy: registerSession.openedByName,
          registerNumber: registerSession.registerNumber,
          terminal: registerSession.terminalName,
        },
      };
    }

    if (
      event.step === "register_session_closed" ||
      event.step === "register_session_closeout_approved"
    ) {
      return {
        ...event,
        details: {
          ...event.details,
          closedBy: registerSession.closedByName,
          registerNumber: registerSession.registerNumber,
        },
      };
    }

    if (
      event.step === "register_session_sale_recorded" ||
      event.step === "register_session_void_recorded" ||
      event.step === "register_session_closeout_submitted"
    ) {
      return {
        ...event,
        details: {
          ...event.details,
          actorName,
          approvedByName,
          registerNumber: registerSession.registerNumber,
        },
      };
    }

    return event;
  });

  return {
    ...view,
    currency: store?.currency?.trim() || "GHS",
    events: contextualEvents,
    eventLimit: MAX_WORKFLOW_TRACE_EVENTS,
    eventsTruncated,
    header: {
      ...view.header,
      registerSession,
    },
  };
}

export const getWorkflowTraceViewById = query({
  args: {
    storeId: v.id("store"),
    terminalId: v.optional(v.id("posTerminal")),
    traceId: v.string(),
  },
  handler: admitPublicQuery(
    getWorkflowTraceViewByIdReadDefinition,
    async (
      ctx: OperationQueryCtx,
      args: {
        storeId: Id<"store">;
        terminalId?: Id<"posTerminal">;
        traceId: string;
      },
    ) => getWorkflowTraceViewByIdWithCtx(ctx, args),
  ),
});

export async function getWorkflowTraceViewByLookupWithCtx(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    terminalId?: Id<"posTerminal">;
    workflowType: string;
    lookupType: string;
    lookupValue: string;
    accessAuthorizers?: WorkflowTraceAccessAuthorizers;
  },
) {
  const admittedActor = (ctx as Partial<OperationQueryCtx>).operationAdmission
    ?.actor;
  if (
    admittedActor?.kind === "shared_demo" &&
    !SHARED_DEMO_READABLE_WORKFLOW_TYPES.has(args.workflowType)
  ) {
    denySharedDemoAction();
  }
  if (admittedActor?.kind !== "shared_demo") {
    await assertDefaultWorkflowTraceAccess(ctx, args);
  }

  const lookup = await ctx.db
    .query("workflowTraceLookup")
    .withIndex("by_storeId_workflowType_lookup", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("workflowType", args.workflowType)
        .eq("lookupType", args.lookupType)
        .eq("lookupValue", normalizeWorkflowTraceLookupValue(args.lookupValue)),
    )
    .unique();

  if (!lookup) {
    return null;
  }

  return getWorkflowTraceViewByIdWithCtx(ctx as never, {
    storeId: args.storeId,
    terminalId: args.terminalId,
    traceId: lookup.traceId,
    accessAuthorizers: args.accessAuthorizers,
  });
}

export const getWorkflowTraceByLookup = query({
  args: {
    storeId: v.id("store"),
    terminalId: v.optional(v.id("posTerminal")),
    workflowType: v.string(),
    lookupType: v.string(),
    lookupValue: v.string(),
  },
  handler: admitPublicQuery(
    getWorkflowTraceByLookupReadDefinition,
    async (
      ctx: OperationQueryCtx,
      args: {
        lookupType: string;
        lookupValue: string;
        storeId: Id<"store">;
        terminalId?: Id<"posTerminal">;
        workflowType: string;
      },
    ) => getWorkflowTraceViewByLookupWithCtx(ctx, args),
  ),
});
