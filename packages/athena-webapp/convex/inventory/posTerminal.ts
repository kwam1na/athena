import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";

const statusValidator = v.union(
  v.literal("active"),
  v.literal("revoked"),
  v.literal("lost")
);

const browserInfoValidator = v.object({
  userAgent: v.string(),
  platform: v.optional(v.string()),
  language: v.optional(v.string()),
  vendor: v.optional(v.string()),
  screenResolution: v.optional(v.string()),
  colorDepth: v.optional(v.number()),
});

const terminalReturnValidator = v.object({
  _id: v.id("posTerminal"),
  _creationTime: v.number(),
  storeId: v.id("store"),
  fingerprintHash: v.string(),
  displayName: v.string(),
  registeredByUserId: v.id("athenaUser"),
  browserInfo: browserInfoValidator,
  registeredAt: v.number(),
  status: statusValidator,
});

export const listTerminals = query({
  args: {
    storeId: v.id("store"),
  },
  returns: v.array(terminalReturnValidator),
  handler: async (ctx, args) => {
    const terminals = await ctx.db
      .query("posTerminal")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .collect();

    return terminals.map((terminal) => ({
      _id: terminal._id,
      _creationTime: terminal._creationTime,
      storeId: terminal.storeId,
      fingerprintHash: terminal.fingerprintHash,
      displayName: terminal.displayName,
      registeredByUserId: terminal.registeredByUserId,
      browserInfo: terminal.browserInfo,
      registeredAt: terminal.registeredAt,
      status: terminal.status,
    }));
  },
});

export const registerTerminal = mutation({
  args: {
    storeId: v.id("store"),
    fingerprintHash: v.string(),
    displayName: v.string(),
    registeredByUserId: v.id("athenaUser"),
    browserInfo: browserInfoValidator,
  },
  returns: terminalReturnValidator,
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("posTerminal")
      .withIndex("by_storeId_and_fingerprintHash", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("fingerprintHash", args.fingerprintHash)
      )
      .first();

    if (existing) {
      const updates: Partial<Doc<"posTerminal">> = {
        displayName: args.displayName,
        registeredByUserId: args.registeredByUserId,
        browserInfo: args.browserInfo,
        status: "active",
      };

      await ctx.db.patch(existing._id, updates);
      const updated = await ctx.db.get(existing._id);

      return {
        _id: updated!._id,
        _creationTime: updated!._creationTime,
        storeId: updated!.storeId,
        fingerprintHash: updated!.fingerprintHash,
        displayName: updated!.displayName,
        registeredByUserId: updated!.registeredByUserId,
        browserInfo: updated!.browserInfo,
        registeredAt: updated!.registeredAt,
        status: updated!.status,
      };
    }

    const registeredAt = Date.now();
    const terminalId = await ctx.db.insert("posTerminal", {
      storeId: args.storeId,
      fingerprintHash: args.fingerprintHash,
      displayName: args.displayName,
      registeredByUserId: args.registeredByUserId,
      browserInfo: args.browserInfo,
      registeredAt,
      status: "active",
    });

    const terminal = await ctx.db.get(terminalId);

    return {
      _id: terminal!._id,
      _creationTime: terminal!._creationTime,
      storeId: terminal!.storeId,
      fingerprintHash: terminal!.fingerprintHash,
      displayName: terminal!.displayName,
      registeredByUserId: terminal!.registeredByUserId,
      browserInfo: terminal!.browserInfo,
      registeredAt: terminal!.registeredAt,
      status: terminal!.status,
    };
  },
});

export const updateTerminal = mutation({
  args: {
    terminalId: v.id("posTerminal"),
    displayName: v.optional(v.string()),
    status: v.optional(statusValidator),
    browserInfo: v.optional(browserInfoValidator),
  },
  returns: terminalReturnValidator,
  handler: async (ctx, args) => {
    const terminal = await ctx.db.get(args.terminalId);
    if (!terminal) {
      throw new Error("Terminal not found");
    }

    const updates: Partial<Doc<"posTerminal">> = {};

    if (args.displayName !== undefined) {
      updates.displayName = args.displayName;
    }

    if (args.status !== undefined) {
      updates.status = args.status;
    }

    if (args.browserInfo !== undefined) {
      updates.browserInfo = args.browserInfo;
    }

    if (Object.keys(updates).length === 0) {
      return {
        _id: terminal._id,
        _creationTime: terminal._creationTime,
        storeId: terminal.storeId,
        fingerprintHash: terminal.fingerprintHash,
        displayName: terminal.displayName,
        registeredByUserId: terminal.registeredByUserId,
        browserInfo: terminal.browserInfo,
        registeredAt: terminal.registeredAt,
        status: terminal.status,
      };
    }

    await ctx.db.patch(args.terminalId, updates);
    const updated = await ctx.db.get(args.terminalId);

    return {
      _id: updated!._id,
      _creationTime: updated!._creationTime,
      storeId: updated!.storeId,
      fingerprintHash: updated!.fingerprintHash,
      displayName: updated!.displayName,
      registeredByUserId: updated!.registeredByUserId,
      browserInfo: updated!.browserInfo,
      registeredAt: updated!.registeredAt,
      status: updated!.status,
    };
  },
});

export const deleteTerminal = mutation({
  args: {
    terminalId: v.id("posTerminal"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.delete(args.terminalId);
    return null;
  },
});
