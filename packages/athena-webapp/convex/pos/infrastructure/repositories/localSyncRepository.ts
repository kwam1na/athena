import type { Id, TableNames } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import { isRegisterSessionConflictBlockingStatus } from "../../../../shared/registerSessionStatus";
import {
  consumeInventoryHoldsForSession as consumeInventoryHoldsForSessionHelper,
  readActiveInventoryHoldQuantitiesForSession,
} from "../../../inventory/helpers/inventoryHolds";
import type {
  LocalSyncCursorRecord,
  LocalSyncMappingRecord,
  LocalSyncRepository,
  PosSyncOperationalRole,
} from "../../application/sync/types";
import { hashPosLocalStaffProofToken } from "../../application/sync/staffProof";

export function createConvexLocalSyncRepository(
  ctx: MutationCtx,
): LocalSyncRepository {
  const normalizeCloudId = <TableName extends TableNames>(
    tableName: TableName,
    value: string,
  ): Id<TableName> | null => {
    const normalizeId = (
      ctx.db as unknown as {
        normalizeId?: (tableName: string, value: string) => unknown;
      }
    ).normalizeId;
    if (typeof normalizeId !== "function") return null;
    const normalized = normalizeId.call(ctx.db, tableName, value);
    return typeof normalized === "string"
      ? (normalized as Id<TableName>)
      : null;
  };

  return {
    getTerminal(terminalId) {
      return ctx.db.get("posTerminal", terminalId);
    },
    getStaffProfile(staffProfileId) {
      return ctx.db.get("staffProfile", staffProfileId);
    },
    async hasActivePosRole(args) {
      const assignments = await ctx.db
        .query("staffRoleAssignment")
        .withIndex("by_staffProfileId", (q) =>
          q.eq("staffProfileId", args.staffProfileId),
        )
        .filter((q) =>
          q.and(
            q.eq(q.field("storeId"), args.storeId),
            q.eq(q.field("status"), "active"),
          ),
        )
        .take(50);
      return assignments.some((assignment: { role?: string }) =>
        args.allowedRoles.includes(assignment.role as PosSyncOperationalRole),
      );
    },
    async validateLocalStaffProof(args) {
      const tokenHash = await hashPosLocalStaffProofToken(args.token);
      const proof = await ctx.db
        .query("posLocalStaffProof")
        .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
        .unique();
      if (
        !proof ||
        proof.status !== "active" ||
        proof.staffProfileId !== args.staffProfileId ||
        proof.storeId !== args.storeId ||
        proof.terminalId !== args.terminalId ||
        proof.expiresAt <= args.now
      ) {
        return false;
      }

      const credential = await ctx.db.get("staffCredential", proof.credentialId);
      if (
        !credential ||
        credential.status !== "active" ||
        credential.staffProfileId !== args.staffProfileId ||
        credential.storeId !== args.storeId
      ) {
        return false;
      }

      await ctx.db.patch("posLocalStaffProof", proof._id, {
        lastUsedAt: args.now,
      });
      return true;
    },
    getStore(storeId) {
      return ctx.db.get("store", storeId);
    },
    getCustomerProfile(customerProfileId) {
      return ctx.db.get("customerProfile", customerProfileId);
    },
    getProduct(productId) {
      return ctx.db.get("product", productId);
    },
    getProductSku(productSkuId) {
      return ctx.db.get("productSku", productSkuId);
    },
    getRegisterSession(registerSessionId) {
      return ctx.db.get("registerSession", registerSessionId);
    },
    async getActiveHeldQuantity(args) {
      const holds = await ctx.db
        .query("inventoryHold")
        .withIndex("by_storeId_productSkuId_status_expiresAt", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("productSkuId", args.productSkuId)
            .eq("status", "active")
            .gt("expiresAt", args.now),
        )
        .take(501);
      if (holds.length > 500) return Number.POSITIVE_INFINITY;
      return holds.reduce(
        (sum: number, hold: { quantity: number; sourceSessionId?: Id<"posSession"> }) =>
          args.excludeSessionId !== undefined &&
          hold.sourceSessionId === args.excludeSessionId
            ? sum
            : sum + hold.quantity,
        0,
      );
    },
    readActiveInventoryHoldQuantitiesForSession(args) {
      return readActiveInventoryHoldQuantitiesForSession(ctx.db, args);
    },
    consumeInventoryHoldsForSession(args) {
      return consumeInventoryHoldsForSessionHelper(ctx.db, {
        sessionId: args.sessionId,
        items: args.items.map((item) => ({
          skuId: item.productSkuId,
          quantity: item.quantity,
        })),
        now: args.now,
      });
    },
    async findEvent(args) {
      return (
        (await ctx.db
          .query("posLocalSyncEvent")
          .withIndex("by_store_terminal_localEvent", (q) =>
            q
              .eq("storeId", args.storeId)
              .eq("terminalId", args.terminalId)
              .eq("localEventId", args.localEventId),
          )
          .unique()) ?? null
      );
    },
    async getAcceptedThroughSequence(args) {
      const cursor = (await ctx.db
        .query("posLocalSyncCursor")
        .withIndex("by_store_terminal_register", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("terminalId", args.terminalId)
            .eq("localRegisterSessionId", args.localRegisterSessionId),
        )
        .unique()) as LocalSyncCursorRecord | null;
      return cursor?.acceptedThroughSequence ?? 0;
    },
    async updateAcceptedThroughSequence(args) {
      const existing = (await ctx.db
        .query("posLocalSyncCursor")
        .withIndex("by_store_terminal_register", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("terminalId", args.terminalId)
            .eq("localRegisterSessionId", args.localRegisterSessionId),
        )
        .unique()) as LocalSyncCursorRecord | null;
      if (existing) {
        await ctx.db.patch("posLocalSyncCursor", existing._id as Id<"posLocalSyncCursor">, {
          acceptedThroughSequence: args.acceptedThroughSequence,
          updatedAt: args.updatedAt,
        });
        return;
      }

      await ctx.db.insert("posLocalSyncCursor", {
        storeId: args.storeId,
        terminalId: args.terminalId,
        localRegisterSessionId: args.localRegisterSessionId,
        acceptedThroughSequence: args.acceptedThroughSequence,
        updatedAt: args.updatedAt,
      });
    },
    normalizeCloudId(tableName, value) {
      return normalizeCloudId(tableName, value);
    },
    async createEvent(input) {
      const id = await ctx.db.insert("posLocalSyncEvent", input);
      return { _id: id, ...input };
    },
    async patchEvent(eventId, patch) {
      await ctx.db.patch("posLocalSyncEvent", eventId as Id<"posLocalSyncEvent">, patch);
    },
    async findMapping(args) {
      return ctx.db
        .query("posLocalSyncMapping")
        .withIndex("by_store_terminal_local", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("terminalId", args.terminalId)
            .eq("localRegisterSessionId", args.localRegisterSessionId)
            .eq("localIdKind", args.localIdKind)
            .eq("localId", args.localId),
        )
        .unique();
    },
    async findMappingForTerminal(args) {
      return ctx.db
        .query("posLocalSyncMapping")
        .withIndex("by_store_terminal_localKindId", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("terminalId", args.terminalId)
            .eq("localIdKind", args.localIdKind)
            .eq("localId", args.localId),
        )
        .unique();
    },
    async createMapping(input) {
      const existing =
        (await ctx.db
          .query("posLocalSyncMapping")
          .withIndex("by_store_terminal_local", (q) =>
            q
              .eq("storeId", input.storeId)
              .eq("terminalId", input.terminalId)
              .eq("localRegisterSessionId", input.localRegisterSessionId)
              .eq("localIdKind", input.localIdKind)
              .eq("localId", input.localId),
          )
          .unique()) ?? null;
      if (existing) {
        if (
          existing.localEventId === input.localEventId &&
          existing.cloudTable === input.cloudTable &&
          existing.cloudId === input.cloudId
        ) {
          return existing;
        }

        throw new Error("POS local sync mapping already belongs to another projection.");
      }

      const id = await ctx.db.insert("posLocalSyncMapping", input);
      return { _id: id, ...input } as LocalSyncMappingRecord;
    },
    async listMappingsForEvent(args) {
      const mappings = await ctx.db
        .query("posLocalSyncMapping")
        .withIndex("by_store_terminal_localEvent", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("terminalId", args.terminalId)
            .eq("localEventId", args.localEventId),
        )
        .take(100);
      return mappings;
    },
    async createConflict(input) {
      const id = await ctx.db.insert("posLocalSyncConflict", input);
      return { _id: id, ...input };
    },
    async listConflictsForEvent(args) {
      return ctx.db
        .query("posLocalSyncConflict")
        .withIndex("by_store_terminal_localEvent", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("terminalId", args.terminalId)
            .eq("localEventId", args.localEventId),
        )
        .take(100);
    },
    async createRegisterSession(input) {
      return ctx.db.insert("registerSession", {
        storeId: input.storeId,
        organizationId: input.organizationId,
        terminalId: input.terminalId,
        registerNumber: input.registerNumber,
        status: "active",
        openedByStaffProfileId: input.openedByStaffProfileId,
        openedAt: input.openedAt,
        openingFloat: input.openingFloat,
        expectedCash: input.expectedCash,
        notes: input.notes,
      });
    },
    async findBlockingRegisterSession(args) {
      const latestByTerminal = await ctx.db
        .query("registerSession")
        .withIndex("by_terminalId", (q) => q.eq("terminalId", args.terminalId))
        .order("desc")
        .first();
      if (
        latestByTerminal &&
        isRegisterSessionConflictBlockingStatus(latestByTerminal.status)
      ) {
        return latestByTerminal;
      }

      if (!args.registerNumber) {
        return null;
      }

      const latestByRegisterNumber = await ctx.db
        .query("registerSession")
        .withIndex("by_storeId_registerNumber", (q) =>
          q.eq("storeId", args.storeId).eq("registerNumber", args.registerNumber),
        )
        .order("desc")
        .first();
      return latestByRegisterNumber &&
        isRegisterSessionConflictBlockingStatus(latestByRegisterNumber.status)
        ? latestByRegisterNumber
        : null;
    },
    async getRegisterSessionByLocalId(args) {
      const mapping = await ctx.db
        .query("posLocalSyncMapping")
        .withIndex("by_store_terminal_local", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("terminalId", args.terminalId)
            .eq("localRegisterSessionId", args.localRegisterSessionId)
            .eq("localIdKind", "registerSession")
            .eq("localId", args.localRegisterSessionId),
        )
        .first();
      if (mapping?.localIdKind === "registerSession") {
        const mappedRegisterSessionId = normalizeCloudId(
          "registerSession",
          mapping.cloudId,
        );
        return mappedRegisterSessionId
          ? ctx.db.get("registerSession", mappedRegisterSessionId)
          : null;
      }

      const registerSessionId = normalizeCloudId(
        "registerSession",
        args.localRegisterSessionId,
      );
      if (!registerSessionId) {
        return null;
      }
      const registerSession = await ctx.db.get("registerSession", registerSessionId);
      return registerSession &&
        registerSession.storeId === args.storeId &&
        registerSession.terminalId === args.terminalId
        ? registerSession
        : null;
    },
    async getPosSessionByLocalId(args) {
      const mapping = await ctx.db
        .query("posLocalSyncMapping")
        .withIndex("by_store_terminal_local", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("terminalId", args.terminalId)
            .eq("localRegisterSessionId", args.localRegisterSessionId)
            .eq("localIdKind", "posSession")
            .eq("localId", args.localPosSessionId),
        )
        .first();
      if (!mapping) {
        const localPosSessionId = normalizeCloudId(
          "posSession",
          args.localPosSessionId,
        );
        if (!localPosSessionId) {
          return null;
        }
        const posSession = await ctx.db.get("posSession", localPosSessionId);
        return posSession &&
          posSession.storeId === args.storeId &&
          posSession.terminalId === args.terminalId &&
          posSession.registerSessionId === args.registerSessionId
          ? posSession
          : null;
      }
      if (mapping.localIdKind !== "posSession") {
        return null;
      }
      const mappedPosSessionId = normalizeCloudId(
        "posSession",
        mapping.cloudId,
      );
      if (!mappedPosSessionId) {
        return null;
      }
      const posSession = await ctx.db.get("posSession", mappedPosSessionId);
      return posSession?.registerSessionId === args.registerSessionId
        ? posSession
        : null;
    },
    async patchRegisterSession(registerSessionId, patch) {
      await ctx.db.patch("registerSession", registerSessionId, patch);
    },
    async createPosSession(input) {
      return ctx.db.insert("posSession", {
        sessionNumber: input.sessionNumber,
        storeId: input.storeId,
        staffProfileId: input.staffProfileId,
        registerNumber: input.registerNumber,
        registerSessionId: input.registerSessionId,
        status: "completed",
        terminalId: input.terminalId,
        transactionId: input.transactionId,
        inventoryHoldMode: "ledger",
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
        expiresAt: input.updatedAt,
      });
    },
    async patchPosSession(posSessionId, patch) {
      await ctx.db.patch("posSession", posSessionId, patch);
    },
    async createPosSessionItem(input) {
      return ctx.db.insert("posSessionItem", input);
    },
    async createTransaction(input) {
      return ctx.db.insert("posTransaction", {
        transactionNumber: input.transactionNumber,
        storeId: input.storeId,
        sessionId: input.sessionId,
        registerSessionId: input.registerSessionId,
        staffProfileId: input.staffProfileId,
        registerNumber: input.registerNumber,
        terminalId: input.terminalId,
        subtotal: input.subtotal,
        tax: input.tax,
        total: input.total,
        customerProfileId: input.customerProfileId,
        payments: input.payments,
        totalPaid: input.totalPaid,
        changeGiven: input.changeGiven,
        paymentMethod: input.paymentMethod,
        status: "completed",
        completedAt: input.completedAt,
        customerInfo: input.customerInfo,
        receiptPrinted: false,
      });
    },
    async createTransactionItem(input) {
      return ctx.db.insert("posTransactionItem", input);
    },
    async patchProductSku(productSkuId, patch) {
      await ctx.db.patch("productSku", productSkuId, patch);
    },
    async createPaymentAllocation(input) {
      return ctx.db.insert("paymentAllocation", input);
    },
    async createOperationalEvent(input) {
      return ctx.db.insert("operationalEvent", input);
    },
  };
}
