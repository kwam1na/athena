import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { query } from "../_generated/server";
import { normalizeWorkflowTraceLookupValue } from "../../shared/workflowTrace";
import { listWorkflowTraceEventsWithCtx } from "./core";
import { buildWorkflowTraceViewModel } from "./presentation";

export async function getWorkflowTraceViewByIdWithCtx(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    traceId: string;
  },
) {
  const trace = await ctx.db
    .query("workflowTrace")
    .withIndex("by_storeId_traceId", (q) =>
      q.eq("storeId", args.storeId).eq("traceId", args.traceId)
    )
    .unique();

  if (!trace) {
    return null;
  }

  const events = await listWorkflowTraceEventsWithCtx(ctx as never, {
    storeId: args.storeId,
    traceId: trace.traceId,
  });

  return buildWorkflowTraceViewModel({ trace, events });
}

export const getWorkflowTraceViewById = query({
  args: {
    storeId: v.id("store"),
    traceId: v.string(),
  },
  handler: (ctx, args) => getWorkflowTraceViewByIdWithCtx(ctx, args),
});

export async function getWorkflowTraceViewByLookupWithCtx(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    workflowType: string;
    lookupType: string;
    lookupValue: string;
  },
) {
  const lookup = await ctx.db
    .query("workflowTraceLookup")
    .withIndex("by_storeId_workflowType_lookup", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("workflowType", args.workflowType)
        .eq("lookupType", args.lookupType)
        .eq("lookupValue", normalizeWorkflowTraceLookupValue(args.lookupValue))
    )
    .unique();

  if (!lookup) {
    return null;
  }

  return getWorkflowTraceViewByIdWithCtx(ctx as never, {
    storeId: args.storeId,
    traceId: lookup.traceId,
  });
}

export const getWorkflowTraceByLookup = query({
  args: {
    storeId: v.id("store"),
    workflowType: v.string(),
    lookupType: v.string(),
    lookupValue: v.string(),
  },
  handler: (ctx, args) => getWorkflowTraceViewByLookupWithCtx(ctx, args),
});
