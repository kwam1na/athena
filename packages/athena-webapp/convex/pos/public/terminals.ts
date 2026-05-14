import { v } from "convex/values";

import { mutation, query, type MutationCtx, type QueryCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { commandResultValidator } from "../../lib/commandResultValidators";
import {
  requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx,
} from "../../lib/athenaUserAuth";
import { userError } from "../../../shared/commandResult";
import {
  deleteTerminal as deleteTerminalCommand,
  registerTerminal as registerTerminalCommand,
  updateTerminal as updateTerminalCommand,
} from "../application/commands/terminals";
import {
  getTerminalByFingerprint as getTerminalByFingerprintQuery,
  listTerminals as listTerminalsQuery,
} from "../application/queries/terminals";
import { hashPosTerminalSyncSecret } from "../application/sync/terminalSyncSecret";

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

const terminalProvisioningReturnValidator = v.object({
  _id: v.id("posTerminal"),
  _creationTime: v.number(),
  storeId: v.id("store"),
  fingerprintHash: v.string(),
  syncSecretHash: v.optional(v.string()),
  displayName: v.string(),
  registerNumber: v.optional(v.string()),
  registeredByUserId: v.id("athenaUser"),
  browserInfo: browserInfoValidator,
  registeredAt: v.number(),
  status: statusValidator,
});

type TerminalRecord = {
  syncSecretHash?: string;
};

function stripTerminalSyncSecret<T extends TerminalRecord>(terminal: T) {
  const { syncSecretHash: _syncSecretHash, ...publicTerminal } = terminal;
  return publicTerminal;
}

async function requireTerminalStoreAccess(
  ctx: Pick<QueryCtx, "auth" | "db"> | Pick<MutationCtx, "auth" | "db">,
  args: {
    allowedRoles: ["full_admin"] | ["full_admin", "pos_only"];
    failureMessage: string;
    storeId: Id<"store">;
    userId: Id<"athenaUser">;
  },
) {
  const store = await ctx.db.get("store", args.storeId);
  if (!store) {
    throw new Error("Store not found.");
  }

  await requireOrganizationMemberRoleWithCtx(ctx, {
    allowedRoles: args.allowedRoles,
    failureMessage: args.failureMessage,
    organizationId: store.organizationId,
    userId: args.userId,
  });
}

export const listTerminals = query({
  args: {
    storeId: v.id("store"),
  },
  returns: v.array(terminalReturnValidator),
  handler: async (ctx, args) => {
    const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
    await requireTerminalStoreAccess(ctx, {
      allowedRoles: ["full_admin", "pos_only"],
      failureMessage: "You do not have access to view POS terminals.",
      storeId: args.storeId,
      userId: athenaUser._id,
    });
	    const terminals = await listTerminalsQuery(ctx, args);
	    return terminals.map(stripTerminalSyncSecret);
  },
});

export const getTerminalByFingerprint = query({
  args: {
    storeId: v.id("store"),
    fingerprintHash: v.string(),
  },
  returns: v.union(terminalReturnValidator, v.null()),
  handler: async (ctx, args) => {
    const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
    await requireTerminalStoreAccess(ctx, {
      allowedRoles: ["full_admin", "pos_only"],
      failureMessage: "You do not have access to view POS terminals.",
      storeId: args.storeId,
      userId: athenaUser._id,
    });
	    const terminal = await getTerminalByFingerprintQuery(ctx, args);
	    return terminal ? stripTerminalSyncSecret(terminal) : null;
  },
});

export const registerTerminal = mutation({
  args: {
    storeId: v.id("store"),
    fingerprintHash: v.string(),
    syncSecretHash: v.string(),
    displayName: v.string(),
    registerNumber: v.string(),
    browserInfo: browserInfoValidator,
  },
  returns: commandResultValidator(terminalProvisioningReturnValidator),
  handler: async (ctx, args) => {
    try {
      const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
      await requireTerminalStoreAccess(ctx, {
        allowedRoles: ["full_admin"],
        failureMessage: "You do not have access to register this POS terminal.",
        storeId: args.storeId,
        userId: athenaUser._id,
      });
      const result = await registerTerminalCommand(ctx, {
        ...args,
        syncSecretHash: await hashPosTerminalSyncSecret(args.syncSecretHash),
        registeredByUserId: athenaUser._id,
      });
      return result.kind === "ok"
        ? {
            ...result,
            data: {
              ...result.data,
              syncSecretHash: args.syncSecretHash,
            },
          }
        : result;
    } catch {
      return userError({
        code: "authorization_failed",
        message: "You do not have access to register this POS terminal.",
      });
    }
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
    const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
    const terminal = await ctx.db.get("posTerminal", args.terminalId);
    if (!terminal) {
      throw new Error("Terminal not found");
    }

    await requireTerminalStoreAccess(ctx, {
      allowedRoles: ["full_admin"],
      failureMessage: "You do not have access to update this POS terminal.",
      storeId: terminal.storeId,
      userId: athenaUser._id,
    });
	    const updatedTerminal = await updateTerminalCommand(ctx, args);
	    return stripTerminalSyncSecret(updatedTerminal);
  },
});

export const deleteTerminal = mutation({
  args: {
    terminalId: v.id("posTerminal"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
    const terminal = await ctx.db.get("posTerminal", args.terminalId);
    if (!terminal) {
      return null;
    }

    await requireTerminalStoreAccess(ctx, {
      allowedRoles: ["full_admin"],
      failureMessage: "You do not have access to delete this POS terminal.",
      storeId: terminal.storeId,
      userId: athenaUser._id,
    });
    return deleteTerminalCommand(ctx, args);
  },
});
