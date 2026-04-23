import { v } from "convex/values";

import { mutation, query } from "../../_generated/server";
import { getRegisterState } from "../application/queries/getRegisterState";
import { openDrawer as openDrawerCommand } from "../application/commands/register";

const registerSessionSummaryValidator = v.object({
  _id: v.id("registerSession"),
  status: v.union(
    v.literal("open"),
    v.literal("active"),
    v.literal("closing"),
    v.literal("closed"),
  ),
  terminalId: v.optional(v.id("posTerminal")),
  registerNumber: v.optional(v.string()),
  openingFloat: v.number(),
  expectedCash: v.number(),
  openedAt: v.number(),
  notes: v.optional(v.string()),
  workflowTraceId: v.optional(v.string()),
});

const userErrorValidator = v.object({
  code: v.union(
    v.literal("validation_failed"),
    v.literal("authentication_failed"),
    v.literal("authorization_failed"),
    v.literal("not_found"),
    v.literal("conflict"),
    v.literal("precondition_failed"),
    v.literal("rate_limited"),
    v.literal("unavailable"),
  ),
  title: v.optional(v.string()),
  message: v.string(),
  fields: v.optional(v.record(v.string(), v.array(v.string()))),
  retryable: v.optional(v.boolean()),
  traceId: v.optional(v.string()),
  metadata: v.optional(v.record(v.string(), v.any())),
});

const registerSessionCommandResultValidator = v.union(
  v.object({
    kind: v.literal("ok"),
    data: v.union(v.null(), registerSessionSummaryValidator),
  }),
  v.object({
    kind: v.literal("user_error"),
    error: userErrorValidator,
  }),
);

export const getState = query({
  args: {
    storeId: v.id("store"),
    terminalId: v.optional(v.id("posTerminal")),
    staffProfileId: v.optional(v.id("staffProfile")),
    registerNumber: v.optional(v.string()),
  },
  handler: async (ctx, args) => getRegisterState(ctx, args),
});

export const openDrawer = mutation({
  args: {
    storeId: v.id("store"),
    terminalId: v.optional(v.id("posTerminal")),
    registerNumber: v.optional(v.string()),
    openingFloat: v.number(),
    notes: v.optional(v.string()),
  },
  returns: registerSessionCommandResultValidator,
  handler: async (ctx, args) => openDrawerCommand(ctx, args),
});
