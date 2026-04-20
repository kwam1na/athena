import { internalMutation, internalQuery } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { v } from "convex/values";

export function buildRegisterSession(args: {
  storeId: Id<"store">;
  organizationId?: Id<"organization">;
  terminalId?: Id<"posTerminal">;
  registerNumber?: string;
  openedByUserId?: Id<"athenaUser">;
  openedByStaffProfileId?: Id<"staffProfile">;
  openingFloat: number;
  expectedCash?: number;
  notes?: string;
}) {
  return {
    ...args,
    status: "open" as const,
    openedAt: Date.now(),
    expectedCash: args.expectedCash ?? 0,
  };
}

export const openRegisterSession = internalMutation({
  args: {
    storeId: v.id("store"),
    organizationId: v.optional(v.id("organization")),
    terminalId: v.optional(v.id("posTerminal")),
    registerNumber: v.optional(v.string()),
    openedByUserId: v.optional(v.id("athenaUser")),
    openedByStaffProfileId: v.optional(v.id("staffProfile")),
    openingFloat: v.number(),
    expectedCash: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const sessionId = await ctx.db.insert("registerSession", buildRegisterSession(args));
    return ctx.db.get(sessionId);
  },
});

export const getOpenRegisterSession = internalQuery({
  args: {
    storeId: v.id("store"),
    registerNumber: v.optional(v.string()),
    terminalId: v.optional(v.id("posTerminal")),
  },
  handler: async (ctx, args) => {
    if (args.registerNumber) {
      const byRegister = await ctx.db
        .query("registerSession")
        .withIndex("by_storeId_registerNumber", (q) =>
          q.eq("storeId", args.storeId).eq("registerNumber", args.registerNumber!)
        )
        .collect();

      return byRegister.find((session) => session.status !== "closed") ?? null;
    }

    if (!args.terminalId) {
      return null;
    }

    const byTerminal = await ctx.db
      .query("registerSession")
      .withIndex("by_terminalId", (q) => q.eq("terminalId", args.terminalId!))
      .collect();

    return byTerminal.find((session) => session.status !== "closed") ?? null;
  },
});
