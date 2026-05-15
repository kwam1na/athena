import { v } from "convex/values";

import { mutation } from "../../_generated/server";
import { commandResultValidator } from "../../lib/commandResultValidators";
import {
  requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx,
} from "../../lib/athenaUserAuth";
import { userError } from "../../../shared/commandResult";
import { ingestLocalEventsWithCtx } from "../application/sync/ingestLocalEvents";
import { hashPosTerminalSyncSecret } from "../application/sync/terminalSyncSecret";
import { posLocalSyncMappingKindValidator } from "../../schemas/pos/posLocalSyncMapping";
import {
  posLocalSyncConflictStatusValidator,
  posLocalSyncConflictTypeValidator,
} from "../../schemas/pos/posLocalSyncConflict";
import {
  posLocalSyncEventStatusValidator,
} from "../../schemas/pos/posLocalSyncEvent";

const localSyncMappingValidator = v.object({
  _id: v.string(),
  storeId: v.id("store"),
  terminalId: v.id("posTerminal"),
  localRegisterSessionId: v.string(),
  localEventId: v.string(),
  localIdKind: posLocalSyncMappingKindValidator,
  localId: v.string(),
  cloudTable: v.string(),
  cloudId: v.string(),
  createdAt: v.number(),
});

const localSyncConflictValidator = v.object({
  _id: v.string(),
  storeId: v.id("store"),
  terminalId: v.id("posTerminal"),
  localRegisterSessionId: v.string(),
  localEventId: v.string(),
  sequence: v.number(),
  conflictType: posLocalSyncConflictTypeValidator,
  status: posLocalSyncConflictStatusValidator,
  summary: v.string(),
  details: v.record(v.string(), v.any()),
  createdAt: v.number(),
  resolvedAt: v.optional(v.number()),
  resolvedByStaffProfileId: v.optional(v.id("staffProfile")),
});

const localSyncResultValidator = commandResultValidator(
  v.object({
    accepted: v.array(
      v.object({
        localEventId: v.string(),
        sequence: v.number(),
        status: posLocalSyncEventStatusValidator,
      }),
    ),
    held: v.array(
      v.object({
        localEventId: v.string(),
        sequence: v.number(),
        code: v.literal("out_of_order"),
        message: v.string(),
      }),
    ),
    mappings: v.array(localSyncMappingValidator),
    conflicts: v.array(localSyncConflictValidator),
    syncCursor: v.object({
      localRegisterSessionId: v.union(v.string(), v.null()),
      acceptedThroughSequence: v.number(),
    }),
  }),
);

const posLocalSyncEventBaseValidator = {
  localEventId: v.string(),
  localRegisterSessionId: v.string(),
  sequence: v.number(),
  occurredAt: v.number(),
  staffProfileId: v.id("staffProfile"),
  staffProofToken: v.string(),
};

const posLocalSyncUploadEventValidator = v.union(
  v.object({
    ...posLocalSyncEventBaseValidator,
    eventType: v.literal("register_opened"),
    payload: v.object({
      openingFloat: v.number(),
      registerNumber: v.optional(v.string()),
      notes: v.optional(v.string()),
    }),
  }),
  v.object({
    ...posLocalSyncEventBaseValidator,
    eventType: v.literal("sale_completed"),
    payload: v.object({
      localPosSessionId: v.string(),
      localTransactionId: v.string(),
      localReceiptNumber: v.string(),
      receiptNumber: v.string(),
      registerNumber: v.optional(v.string()),
      customerProfileId: v.optional(v.string()),
      customerInfo: v.optional(
        v.object({
          name: v.optional(v.string()),
          email: v.optional(v.string()),
          phone: v.optional(v.string()),
        }),
      ),
      totals: v.object({
        subtotal: v.number(),
        tax: v.number(),
        total: v.number(),
      }),
      items: v.array(
        v.object({
          localTransactionItemId: v.optional(v.string()),
          productId: v.string(),
          productSkuId: v.string(),
          productName: v.string(),
          productSku: v.string(),
          barcode: v.optional(v.string()),
          quantity: v.number(),
          unitPrice: v.number(),
          image: v.optional(v.string()),
        }),
      ),
      payments: v.array(
        v.object({
          localPaymentId: v.optional(v.string()),
          method: v.string(),
          amount: v.number(),
          timestamp: v.number(),
        }),
      ),
    }),
  }),
  v.object({
    ...posLocalSyncEventBaseValidator,
    eventType: v.literal("register_closed"),
    payload: v.object({
      countedCash: v.optional(v.number()),
      notes: v.optional(v.string()),
    }),
  }),
  v.object({
    ...posLocalSyncEventBaseValidator,
    eventType: v.literal("sale_cleared"),
    payload: v.object({
      localPosSessionId: v.string(),
      reason: v.optional(v.string()),
    }),
  }),
  v.object({
    ...posLocalSyncEventBaseValidator,
    eventType: v.literal("register_reopened"),
    payload: v.object({
      reason: v.optional(v.string()),
    }),
  }),
);

export const ingestLocalEvents = mutation({
  args: {
    storeId: v.id("store"),
    terminalId: v.id("posTerminal"),
    syncSecretHash: v.string(),
    submittedAt: v.optional(v.number()),
    events: v.array(posLocalSyncUploadEventValidator),
  },
  returns: localSyncResultValidator,
  handler: async (ctx, args) => {
    const store = await ctx.db.get("store", args.storeId);
    if (!store) {
      return userError({
        code: "not_found",
        message: "Store not found.",
      });
    }

    let submittedByUserId;
    try {
      const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
      submittedByUserId = athenaUser._id;
      await requireOrganizationMemberRoleWithCtx(ctx, {
        allowedRoles: ["full_admin", "pos_only"],
        failureMessage: "You do not have access to sync this POS terminal.",
        organizationId: store.organizationId,
        userId: athenaUser._id,
      });
      const terminal = await ctx.db.get("posTerminal", args.terminalId);
      const submittedSyncSecretHash = await hashPosTerminalSyncSecret(
        args.syncSecretHash,
      );
      if (
        !terminal ||
        terminal.storeId !== args.storeId ||
        terminal.status !== "active" ||
        terminal.registeredByUserId !== athenaUser._id ||
        !terminal.syncSecretHash ||
        terminal.syncSecretHash !== submittedSyncSecretHash
      ) {
        throw new Error("Terminal is not bound to the signed-in user.");
      }
    } catch {
      return userError({
        code: "authorization_failed",
        message: "You do not have access to sync this POS terminal.",
      });
    }

    return ingestLocalEventsWithCtx(ctx, {
      ...args,
      submittedByUserId,
      submittedAt: args.submittedAt ?? Date.now(),
    });
  },
});
