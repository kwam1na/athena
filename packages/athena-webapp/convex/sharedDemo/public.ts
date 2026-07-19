import { v } from "convex/values";

import { mutation, query } from "../_generated/server";
import { requireSharedDemoActorWithCtx } from "./actor";
import {
  assertSharedDemoWriteEpoch,
  beginRestoreLeaseWithCtx,
  requireCurrentSharedDemoBaseline,
} from "./restore";
import { bindSharedDemoRegisterBaselineWithCtx } from "./registerBaseline";
import { hashPosTerminalSyncSecret } from "../pos/application/sync/terminalSyncSecret";
import {
  SHARED_DEMO_CASHIER_STAFF_CODE,
  SHARED_DEMO_REGISTER_NUMBER,
} from "./config";

export function selectSharedDemoRegisterBootstrapRecords<
  TStaffProfile extends {
    staffCode?: string;
    status: string;
    storeId: string;
  },
  TTerminal extends {
    registerNumber?: string;
    status: string;
    storeId: string;
  },
>({
  staffProfiles,
  storeId,
  terminals,
}: {
  staffProfiles: TStaffProfile[];
  storeId: string;
  terminals: TTerminal[];
}) {
  const staffProfile = staffProfiles.find(
    (candidate) =>
      candidate.storeId === storeId &&
      candidate.staffCode === SHARED_DEMO_CASHIER_STAFF_CODE &&
      candidate.status === "active",
  );
  const terminal = terminals.find(
    (candidate) =>
      candidate.storeId === storeId &&
      candidate.registerNumber === SHARED_DEMO_REGISTER_NUMBER &&
      candidate.status === "active",
  );
  return staffProfile && terminal ? { staffProfile, terminal } : null;
}

const contextResult = v.union(
  v.null(),
  v.object({
    baselineVersion: v.number(),
    kind: v.literal("shared_demo"),
    nextHourlyRestoreAt: v.number(),
    restore: v.object({
      completedAt: v.optional(v.number()),
      epoch: v.number(),
      failureCode: v.optional(v.string()),
      startedAt: v.optional(v.number()),
      status: v.union(
        v.literal("ready"),
        v.literal("restoring"),
        v.literal("failed"),
      ),
    }),
    storeId: v.id("store"),
  }),
);

export const getContext = query({
  args: {},
  returns: contextResult,
  handler: async (ctx) => {
    let actor;
    try {
      actor = await requireSharedDemoActorWithCtx(ctx);
    } catch {
      return null;
    }
    const state = await ctx.db
      .query("sharedDemoRestoreState")
      .withIndex("by_storeId", (q) => q.eq("storeId", actor.storeId))
      .unique();
    if (!state) return null;
    const hour = 3_600_000;
    return {
      baselineVersion: state.baselineVersion,
      kind: "shared_demo" as const,
      nextHourlyRestoreAt: (Math.floor(Date.now() / hour) + 1) * hour,
      restore: {
        completedAt: state.completedAt,
        epoch: state.epoch,
        failureCode: state.failureCode,
        startedAt: state.startedAt,
        status: state.status,
      },
      storeId: actor.storeId,
    };
  },
});

export const getRegisterBootstrap = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      kind: v.literal("shared_demo"),
      storeId: v.id("store"),
      staff: v.object({
        activeRoles: v.array(v.string()),
        displayName: v.string(),
        staffProfileId: v.id("staffProfile"),
      }),
      terminal: v.object({
        _id: v.id("posTerminal"),
        displayName: v.string(),
        loginMode: v.optional(
          v.union(v.literal("standard"), v.literal("pos_only")),
        ),
        registerNumber: v.optional(v.string()),
        status: v.string(),
        transactionCapability: v.optional(
          v.union(
            v.literal("products_and_services"),
            v.literal("products_only"),
            v.literal("services_only"),
          ),
        ),
      }),
    }),
  ),
  handler: async (ctx) => {
    let actor;
    try {
      actor = await requireSharedDemoActorWithCtx(ctx);
    } catch {
      return null;
    }

    const [terminals, staffProfiles] = await Promise.all([
      ctx.db
        .query("posTerminal")
        .withIndex("by_storeId", (q) => q.eq("storeId", actor.storeId))
        .take(50),
      ctx.db
        .query("staffProfile")
        .withIndex("by_storeId", (q) => q.eq("storeId", actor.storeId))
        .take(50),
    ]);
    const records = selectSharedDemoRegisterBootstrapRecords({
      staffProfiles,
      storeId: actor.storeId,
      terminals,
    });
    if (!records) return null;
    const { staffProfile, terminal } = records;

    return {
      kind: "shared_demo" as const,
      storeId: actor.storeId,
      staff: {
        activeRoles: ["cashier"],
        displayName: staffProfile.fullName,
        staffProfileId: staffProfile._id,
      },
      terminal: {
        _id: terminal._id,
        displayName: terminal.displayName,
        loginMode: terminal.loginMode,
        registerNumber: terminal.registerNumber,
        status: terminal.status,
        transactionCapability: terminal.transactionCapability,
      },
    };
  },
});

export const requestManualRestore = mutation({
  args: { idempotencyKey: v.string() },
  returns: v.object({
    baselineVersion: v.number(),
    epoch: v.number(),
    kind: v.union(
      v.literal("started"),
      v.literal("already_running"),
      v.literal("rate_limited"),
    ),
  }),
  handler: async (ctx, args) => {
    const actor = await requireSharedDemoActorWithCtx(ctx);
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(args.idempotencyKey))
      throw new Error("Restore request is invalid.");
    const latest = await ctx.db
      .query("sharedDemoRestoreAudit")
      .withIndex("by_storeId_occurredAt", (q) => q.eq("storeId", actor.storeId))
      .order("desc")
      .first();
    if (
      latest?.source === "manual" &&
      latest.occurredAt > Date.now() - 60_000
    ) {
      const state = await ctx.db
        .query("sharedDemoRestoreState")
        .withIndex("by_storeId", (q) => q.eq("storeId", actor.storeId))
        .unique();
      return {
        baselineVersion: state?.baselineVersion ?? 1,
        epoch: state?.epoch ?? 0,
        kind: "rate_limited" as const,
      };
    }
    const result = await beginRestoreLeaseWithCtx(ctx, {
      idempotencyKey: args.idempotencyKey,
      source: "manual",
      storeId: actor.storeId,
    });
    return {
      baselineVersion: result.baselineVersion,
      epoch: result.epoch,
      kind:
        result.kind === "started"
          ? ("started" as const)
          : ("already_running" as const),
    };
  },
});

export const resetBrowserExperience = mutation({
  args: {
    syncSecretHash: v.optional(v.string()),
    terminalId: v.optional(v.id("posTerminal")),
  },
  returns: v.object({
    baselineVersion: v.number(),
    epoch: v.number(),
    terminalDeleted: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const actor = await requireSharedDemoActorWithCtx(ctx);
    if (Boolean(args.terminalId) !== Boolean(args.syncSecretHash)) {
      throw new Error("The demo browser terminal proof is incomplete.");
    }

    let terminalCleanupRequested = false;
    if (args.terminalId && args.syncSecretHash) {
      const terminal = await ctx.db.get("posTerminal", args.terminalId);
      if (terminal) {
        const submittedSecret = await hashPosTerminalSyncSecret(
          args.syncSecretHash,
        );
        if (
          terminal.storeId !== actor.storeId ||
          terminal.registerNumber === SHARED_DEMO_REGISTER_NUMBER ||
          !terminal.syncSecretHash ||
          terminal.syncSecretHash !== submittedSecret
        ) {
          throw new Error("The demo browser terminal could not be verified.");
        }
        terminalCleanupRequested = true;
      }
    }

    const result = await beginRestoreLeaseWithCtx(ctx, {
      cleanupTerminalId: terminalCleanupRequested ? args.terminalId : undefined,
      idempotencyKey: crypto.randomUUID(),
      source: "manual",
      storeId: actor.storeId,
    });

    return {
      baselineVersion: result.baselineVersion,
      epoch: result.epoch,
      terminalDeleted: false,
    };
  },
});

export const bindRegisterBaselineToTerminal = mutation({
  args: { expectedEpoch: v.number(), terminalId: v.id("posTerminal") },
  returns: v.object({
    bootstrap: v.object({
      cloudRegisterSessionId: v.id("registerSession"),
      expectedCash: v.number(),
      localRegisterSessionId: v.string(),
      openedAt: v.number(),
      openingFloat: v.number(),
      registerNumber: v.optional(v.string()),
      staffProfileId: v.id("staffProfile"),
      status: v.union(v.literal("active"), v.literal("open")),
    }),
    managerDisplayName: v.string(),
    openedAt: v.number(),
    operatingDate: v.string(),
    registerNumber: v.string(),
    terminalId: v.id("posTerminal"),
    timezone: v.string(),
  }),
  handler: async (ctx, args) => {
    const actor = await requireSharedDemoActorWithCtx(ctx);
    const restoreState = await ctx.db
      .query("sharedDemoRestoreState")
      .withIndex("by_storeId", (q) => q.eq("storeId", actor.storeId))
      .unique();
    assertSharedDemoWriteEpoch(
      requireCurrentSharedDemoBaseline(restoreState),
      args.expectedEpoch,
    );
    const terminal = await ctx.db.get("posTerminal", args.terminalId);
    if (!terminal || terminal.storeId !== actor.storeId) {
      throw new Error("The demo register is unavailable on this browser.");
    }
    return bindSharedDemoRegisterBaselineWithCtx(ctx, {
      actorUserId: actor.athenaUserId,
      now: Date.now(),
      storeId: actor.storeId,
      terminal,
    });
  },
});
