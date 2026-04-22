import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

import { normalizeWorkflowTraceLookupValue } from "../../shared/workflowTrace";

type WorkflowTraceReaderCtx = MutationCtx | QueryCtx;
type WorkflowTraceInput = Omit<Doc<"workflowTrace">, "_id" | "_creationTime">;
type WorkflowTraceLookupInput = Omit<
  Doc<"workflowTraceLookup">,
  "_id" | "_creationTime"
>;
type WorkflowTraceEventInput = Omit<
  Doc<"workflowTraceEvent">,
  "_id" | "_creationTime" | "sequence"
>;

export async function getWorkflowTraceByIdWithCtx(
  ctx: WorkflowTraceReaderCtx,
  input: {
    storeId: Id<"store">;
    traceId: string;
  }
) {
  return ctx.db
    .query("workflowTrace")
    .withIndex("by_storeId_traceId", (q) =>
      q.eq("storeId", input.storeId).eq("traceId", input.traceId)
    )
    .unique();
}

export async function getWorkflowTraceByLookupWithCtx(
  ctx: WorkflowTraceReaderCtx,
  input: {
    storeId: Id<"store">;
    workflowType: string;
    lookupType: string;
    lookupValue: string;
  }
) {
  const lookup = await ctx.db
    .query("workflowTraceLookup")
    .withIndex("by_storeId_workflowType_lookup", (q) =>
      q
        .eq("storeId", input.storeId)
        .eq("workflowType", input.workflowType)
        .eq("lookupType", input.lookupType)
        .eq(
          "lookupValue",
          normalizeWorkflowTraceLookupValue(input.lookupValue)
        )
    )
    .unique();

  if (!lookup) {
    return null;
  }

  return getWorkflowTraceByIdWithCtx(ctx, {
    storeId: input.storeId,
    traceId: lookup.traceId,
  });
}

export async function listWorkflowTraceEventsWithCtx(
  ctx: WorkflowTraceReaderCtx,
  input: {
    traceId: string;
  }
) {
  return ctx.db
    .query("workflowTraceEvent")
    .withIndex("by_traceId_sequence", (q) => q.eq("traceId", input.traceId))
    .collect();
}

export async function createWorkflowTraceWithCtx(
  ctx: MutationCtx,
  input: WorkflowTraceInput
) {
  const normalizedTrace = {
    ...input,
    primaryLookupValue: normalizeWorkflowTraceLookupValue(
      input.primaryLookupValue
    ),
  };
  const existing = await getWorkflowTraceByIdWithCtx(ctx, {
    storeId: normalizedTrace.storeId,
    traceId: normalizedTrace.traceId,
  });

  if (existing) {
    await ctx.db.patch(existing._id, normalizedTrace);
    return existing._id;
  }

  return ctx.db.insert("workflowTrace", normalizedTrace);
}

export async function registerWorkflowTraceLookupWithCtx(
  ctx: MutationCtx,
  input: WorkflowTraceLookupInput
) {
  const normalizedLookup = {
    ...input,
    lookupValue: normalizeWorkflowTraceLookupValue(input.lookupValue),
  };
  const existing = await ctx.db
    .query("workflowTraceLookup")
    .withIndex("by_storeId_workflowType_lookup", (q) =>
      q
        .eq("storeId", normalizedLookup.storeId)
        .eq("workflowType", normalizedLookup.workflowType)
        .eq("lookupType", normalizedLookup.lookupType)
        .eq("lookupValue", normalizedLookup.lookupValue)
    )
    .unique();

  if (existing) {
    if (existing.traceId !== normalizedLookup.traceId) {
      await ctx.db.patch(existing._id, normalizedLookup);
    }

    return existing._id;
  }

  return ctx.db.insert("workflowTraceLookup", normalizedLookup);
}

export async function appendWorkflowTraceEventWithCtx(
  ctx: MutationCtx,
  input: WorkflowTraceEventInput
) {
  const latest = await ctx.db
    .query("workflowTraceEvent")
    .withIndex("by_traceId_sequence", (q) => q.eq("traceId", input.traceId))
    .order("desc")
    .first();

  return ctx.db.insert("workflowTraceEvent", {
    ...input,
    sequence: (latest?.sequence ?? 0) + 1,
  });
}
