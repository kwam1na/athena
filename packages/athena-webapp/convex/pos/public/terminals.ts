import { v } from "convex/values";

import { mutation, query } from "../../_generated/server";
import { commandResultValidator } from "../../lib/commandResultValidators";
import {
  deleteTerminal as deleteTerminalCommand,
  registerTerminal as registerTerminalCommand,
  updateTerminal as updateTerminalCommand,
} from "../application/commands/terminals";
import {
  getTerminalByFingerprint as getTerminalByFingerprintQuery,
  listTerminals as listTerminalsQuery,
} from "../application/queries/terminals";

const statusValidator = v.union(
  v.literal("active"),
  v.literal("revoked"),
  v.literal("lost"),
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
  registerNumber: v.optional(v.string()),
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
  handler: async (ctx, args) => listTerminalsQuery(ctx, args),
});

export const getTerminalByFingerprint = query({
  args: {
    storeId: v.id("store"),
    fingerprintHash: v.string(),
  },
  returns: v.union(terminalReturnValidator, v.null()),
  handler: async (ctx, args) => getTerminalByFingerprintQuery(ctx, args),
});

export const registerTerminal = mutation({
  args: {
    storeId: v.id("store"),
    fingerprintHash: v.string(),
    displayName: v.string(),
    registerNumber: v.string(),
    registeredByUserId: v.id("athenaUser"),
    browserInfo: browserInfoValidator,
  },
  returns: commandResultValidator(terminalReturnValidator),
  handler: async (ctx, args) => registerTerminalCommand(ctx, args),
});

export const updateTerminal = mutation({
  args: {
    terminalId: v.id("posTerminal"),
    displayName: v.optional(v.string()),
    status: v.optional(statusValidator),
    browserInfo: v.optional(browserInfoValidator),
  },
  returns: terminalReturnValidator,
  handler: async (ctx, args) => updateTerminalCommand(ctx, args),
});

export const deleteTerminal = mutation({
  args: {
    terminalId: v.id("posTerminal"),
  },
  returns: v.null(),
  handler: async (ctx, args) => deleteTerminalCommand(ctx, args),
});
