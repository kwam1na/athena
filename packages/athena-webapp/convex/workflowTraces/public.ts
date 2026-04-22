import { v } from "convex/values";

import { query } from "../_generated/server";
import { normalizeWorkflowTraceLookupValue } from "../../shared/workflowTrace";
import { buildWorkflowTraceViewModel } from "./presentation";

export const getWorkflowTraceViewById = query({
  args: {
    storeId: v.id("store"),
    traceId: v.string(),
  },
  handler: async (ctx, args) => {
    const trace = await ctx.db
      .query("workflowTrace")
      .withIndex("by_storeId_traceId", (q) =>
        q.eq("storeId", args.storeId).eq("traceId", args.traceId)
      )
      .unique();

    if (!trace) {
      return null;
    }

    const events = await ctx.db
      .query("workflowTraceEvent")
      .withIndex("by_traceId_sequence", (q) => q.eq("traceId", trace.traceId))
      .collect();

    return buildWorkflowTraceViewModel({ trace, events });
  },
});

export const getWorkflowTraceByLookup = query({
  args: {
    storeId: v.id("store"),
    workflowType: v.string(),
    lookupType: v.string(),
    lookupValue: v.string(),
  },
  handler: async (ctx, args) => {
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

    const trace = await ctx.db
      .query("workflowTrace")
      .withIndex("by_storeId_traceId", (q) =>
        q.eq("storeId", args.storeId).eq("traceId", lookup.traceId)
      )
      .unique();

    if (!trace) {
      return null;
    }

    const events = await ctx.db
      .query("workflowTraceEvent")
      .withIndex("by_traceId_sequence", (q) => q.eq("traceId", trace.traceId))
      .collect();

    return buildWorkflowTraceViewModel({ trace, events });
  },
});
