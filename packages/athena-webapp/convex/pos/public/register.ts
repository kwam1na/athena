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

export const getState = query({
  args: {
    storeId: v.id("store"),
    terminalId: v.optional(v.id("posTerminal")),
    cashierId: v.optional(v.id("cashier")),
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
  returns: v.union(v.null(), registerSessionSummaryValidator),
  handler: async (ctx, args) => openDrawerCommand(ctx, args),
});
