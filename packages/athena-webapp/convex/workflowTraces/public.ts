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
import { requireSharedDemoStoreReadIfApplicable } from "../sharedDemo/actor";
import { SHARED_DEMO_UNAVAILABLE } from "../sharedDemo/policy";

const SHARED_DEMO_READABLE_WORKFLOW_TYPES = new Set([
  "register_session",
  "online_order",
]);

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

    const terminal = registerSession.terminalId
      ? await ctx.db.get("posTerminal", registerSession.terminalId)
      : null;

    return {
      _id: registerSession._id,
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
  const demoActor = await requireSharedDemoStoreReadIfApplicable(
    ctx,
    args.storeId,
  );
  if (!demoActor) {
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

  if (demoActor) {
    if (!SHARED_DEMO_READABLE_WORKFLOW_TYPES.has(trace.workflowType)) {
      throw new Error(SHARED_DEMO_UNAVAILABLE);
    }
  } else {
    await assertWorkflowTraceAccess(ctx, {
      storeId: args.storeId,
      terminalId: args.terminalId,
      trace,
      accessAuthorizers: args.accessAuthorizers,
    });
  }

  const [events, registerSession] = await Promise.all([
    listWorkflowTraceEventsWithCtx(ctx as never, {
      storeId: args.storeId,
      traceId: trace.traceId,
    }),
    getRegisterSessionTraceIdentity(ctx, trace),
  ]);
  const view = buildWorkflowTraceViewModel({ trace, events });

  return {
    ...view,
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
  handler: (ctx, args) => getWorkflowTraceViewByIdWithCtx(ctx, args),
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
  const demoActor = await requireSharedDemoStoreReadIfApplicable(
    ctx,
    args.storeId,
  );
  if (
    demoActor &&
    !SHARED_DEMO_READABLE_WORKFLOW_TYPES.has(args.workflowType)
  ) {
    throw new Error(SHARED_DEMO_UNAVAILABLE);
  }
  if (!demoActor) {
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
  handler: (ctx, args) => getWorkflowTraceViewByLookupWithCtx(ctx, args),
});
