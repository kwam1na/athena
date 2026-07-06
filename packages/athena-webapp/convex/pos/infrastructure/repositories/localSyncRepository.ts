import type { Id, TableNames } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import { isRegisterSessionConflictBlockingStatus } from "../../../../shared/registerSessionStatus";
import { buildApprovalRequest } from "../../../operations/approvalRequestHelpers";
import { areRegisterSessionCloseoutReviewFactsEquivalent } from "../../../operations/registerSessionCloseoutGate";
import { recordRegisterSessionTraceBestEffort } from "../../../operations/registerSessionTracing";
import {
  buildRegisterSessionDateDerivationPatch,
  resolveRegisterSessionOperatingDateContext,
} from "../../../operations/registerSessions";
import { buildOperationalWorkItem } from "../../../operations/operationalWorkItems";
import { normalizeOperationalEventTraceFields } from "../../../operations/operationalEvents";
import {
  buildServiceCase,
  buildServiceCaseLineItem,
} from "../../../serviceOps/serviceCases";
import { summarizePaymentAllocations } from "../../../operations/paymentAllocations";
import { recordInventoryMovementWithDispositionWithCtx } from "../../../operations/inventoryMovements";
import { markCatalogSummaryNeedsRefresh } from "../../../inventory/catalogSummary";
import { createPosSessionTraceRecorder } from "../../application/commands/posSessionTracing";
import {
  createOrReusePendingCheckoutItem,
  recordPendingCheckoutItemSaleEvidence,
} from "../../application/commands/createOrReusePendingCheckoutItem";
import {
  consumeInventoryHoldsForSession as consumeInventoryHoldsForSessionHelper,
  readActiveInventoryHoldQuantitiesForSession,
  releaseActiveInventoryHoldsForSession as releaseActiveInventoryHoldsForSessionHelper,
} from "../../../inventory/helpers/inventoryHolds";
import type {
  LocalSyncCursorRecord,
  LocalSyncMappingRecord,
  LocalSyncRepository,
  PosSyncOperationalRole,
} from "../../application/sync/types";
import { listRegisterSessionCloseoutHolds } from "../../application/sync/registerSessionCloseoutHolds";
import { validatePosLocalStaffProofWithCtx } from "../../application/sync/staffProofValidation";

function omitUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as T;
}

function areConflictDetailsEquivalent(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right) return false;
  if (left === null || right === null) return left === right;

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;
    return left.every((leftItem, index) =>
      areConflictDetailsEquivalent(leftItem, right[index]),
    );
  }

  if (typeof left !== "object" || typeof right !== "object") {
    return false;
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  if (leftKeys.length !== rightKeys.length) return false;

  return leftKeys.every(
    (key, index) =>
      key === rightKeys[index] &&
      areConflictDetailsEquivalent(leftRecord[key], rightRecord[key]),
  );
}

function trimOptional(value?: string | null) {
  const nextValue = value?.trim();
  return nextValue ? nextValue : undefined;
}

export function createConvexLocalSyncRepository(
  ctx: MutationCtx,
): LocalSyncRepository {
  const catalogSummaryDirtyStoreIds = new Set<Id<"store">>();
  const markCatalogSummaryDirtyForSkuPatch = async (
    productSkuId: Id<"productSku">,
    patch: Partial<Record<string, unknown>>,
  ) => {
    if (
      patch.inventoryCount === undefined &&
      patch.images === undefined &&
      patch.price === undefined
    ) {
      return;
    }

    const sku = await ctx.db.get("productSku", productSkuId);
    if (sku) catalogSummaryDirtyStoreIds.add(sku.storeId);
  };

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
  const findLocalSyncCursor = async (args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    cursor: {
      syncScope: "pos" | "expense";
      localSyncCursorId: string;
    };
  }): Promise<LocalSyncCursorRecord | null> => {
    const scoped = (await ctx.db
      .query("posLocalSyncCursor")
      .withIndex("by_store_terminal_scope_cursor", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("terminalId", args.terminalId)
          .eq("syncScope", args.cursor.syncScope)
          .eq("localSyncCursorId", args.cursor.localSyncCursorId),
      )
      .unique()) as LocalSyncCursorRecord | null;
    if (scoped) return scoped;
    if (args.cursor.syncScope !== "pos") return null;

    const legacy = (await ctx.db
      .query("posLocalSyncCursor")
      .withIndex("by_store_terminal_register", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("terminalId", args.terminalId)
          .eq("localRegisterSessionId", args.cursor.localSyncCursorId),
      )
      .unique()) as LocalSyncCursorRecord | null;
    return legacy && legacy.syncScope === undefined ? legacy : null;
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
      const validation = await validatePosLocalStaffProofWithCtx(ctx, args);
      return validation.kind === "ok";
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
    getPendingCheckoutItem(pendingCheckoutItemId) {
      return ctx.db.get("posPendingCheckoutItem", pendingCheckoutItemId);
    },
    async getInventoryImportProvisionalSku(inventoryImportProvisionalSkuId) {
      const normalizeId = (
        ctx.db as unknown as {
          normalizeId?: (tableName: string, value: string) => unknown;
        }
      ).normalizeId;
      const normalized =
        typeof normalizeId === "function"
          ? normalizeId.call(
              ctx.db,
              "inventoryImportProvisionalSku",
              inventoryImportProvisionalSkuId,
            )
          : null;
      if (typeof normalized !== "string") return null;

      const db = ctx.db as unknown as {
        get(
          tableName: string,
          id: string,
        ): Promise<{
          _id: string;
          storeId: Id<"store">;
          status: "active" | "finalized" | "rejected" | "closed";
          posExposureStatus?: "available" | "hidden";
          productId: Id<"product">;
          productSkuId: Id<"productSku">;
          importedBarcode?: string;
          importedPrice: number;
          finalizedAt?: number;
          closedAt?: number;
        } | null>;
      };
      return db.get("inventoryImportProvisionalSku", normalized);
    },
    getServiceCatalog(serviceCatalogId) {
      return ctx.db.get("serviceCatalog", serviceCatalogId);
    },
    getServiceCase(serviceCaseId) {
      return ctx.db.get("serviceCase", serviceCaseId);
    },
    getRegisterSession(registerSessionId) {
      return ctx.db.get("registerSession", registerSessionId);
    },
    async listCloseoutHoldsForRegisterSession(args) {
      return listRegisterSessionCloseoutHolds(ctx, args);
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
        (
          sum: number,
          hold: { quantity: number; sourceSessionId?: Id<"posSession"> },
        ) =>
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
    releaseActiveInventoryHoldsForSession(args) {
      return releaseActiveInventoryHoldsForSessionHelper(ctx.db, args);
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
      const cursor = await findLocalSyncCursor(args);
      return cursor?.acceptedThroughSequence ?? 0;
    },
    async updateAcceptedThroughSequence(args) {
      const existing = await findLocalSyncCursor(args);
      if (existing) {
        await ctx.db.patch(
          "posLocalSyncCursor",
          existing._id as Id<"posLocalSyncCursor">,
          {
            syncScope: args.cursor.syncScope,
            localSyncCursorId: args.cursor.localSyncCursorId,
            localRegisterSessionId:
              args.cursor.localRegisterSessionId ??
              args.cursor.localSyncCursorId,
            localExpenseSessionId: args.cursor.localExpenseSessionId,
            acceptedThroughSequence: args.acceptedThroughSequence,
            updatedAt: args.updatedAt,
          },
        );
        return;
      }

      await ctx.db.insert("posLocalSyncCursor", {
        storeId: args.storeId,
        terminalId: args.terminalId,
        syncScope: args.cursor.syncScope,
        localSyncCursorId: args.cursor.localSyncCursorId,
        localRegisterSessionId:
          args.cursor.localRegisterSessionId ?? args.cursor.localSyncCursorId,
        localExpenseSessionId: args.cursor.localExpenseSessionId,
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
      await ctx.db.patch(
        "posLocalSyncEvent",
        eventId as Id<"posLocalSyncEvent">,
        patch,
      );
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

        throw new Error(
          "POS local sync mapping already belongs to another projection.",
        );
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
      const activeConflicts = await ctx.db
        .query("posLocalSyncConflict")
        .withIndex("by_store_terminal_localEvent", (q) =>
          q
            .eq("storeId", input.storeId)
            .eq("terminalId", input.terminalId)
            .eq("localEventId", input.localEventId),
        )
        .take(500);
      const existing = activeConflicts.find(
        (conflict) =>
          conflict.status === "needs_review" &&
          conflict.localRegisterSessionId === input.localRegisterSessionId &&
          conflict.sequence === input.sequence &&
          conflict.conflictType === input.conflictType &&
          conflict.summary === input.summary &&
          areConflictDetailsEquivalent(conflict.details, input.details),
      );
      if (existing) return existing;

      const id = await ctx.db.insert("posLocalSyncConflict", input);
      return { _id: id, ...input };
    },
    async resolveConflictsForEvent(args) {
      const conflicts = await ctx.db
        .query("posLocalSyncConflict")
        .withIndex("by_store_terminal_localEvent", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("terminalId", args.terminalId)
            .eq("localEventId", args.localEventId),
        )
        .take(100);

      await Promise.all(
        conflicts
          .filter((conflict) => conflict.status === "needs_review")
          .map((conflict) =>
            ctx.db.patch("posLocalSyncConflict", conflict._id, {
              status: "resolved",
              resolvedAt: args.resolvedAt,
            }),
          ),
      );
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
      const openedContext = await resolveRegisterSessionOperatingDateContext(
        ctx,
        {
          at: input.openedAt,
          storeId: input.storeId,
        },
      );
      return ctx.db.insert(
        "registerSession",
        omitUndefined({
          storeId: input.storeId,
          organizationId: input.organizationId,
          terminalId: input.terminalId,
          registerNumber: input.registerNumber,
          status: "active",
          openedByStaffProfileId: input.openedByStaffProfileId,
          openedAt: input.openedAt,
          ...buildRegisterSessionDateDerivationPatch({
            openedAt: input.openedAt,
            openedContext,
          }),
          openingFloat: input.openingFloat,
          expectedCash: input.expectedCash,
          notes: input.notes,
        }),
      );
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
          q
            .eq("storeId", args.storeId)
            .eq("registerNumber", args.registerNumber),
        )
        .order("desc")
        .first();
      return latestByRegisterNumber &&
        isRegisterSessionConflictBlockingStatus(latestByRegisterNumber.status)
        ? latestByRegisterNumber
        : null;
    },
    async listOpenRegisterReviewConflictFacts(args) {
      const registerSessionMappings = await ctx.db
        .query("posLocalSyncMapping")
        .withIndex("by_store_terminal_cloud", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("terminalId", args.terminalId)
            .eq("cloudTable", "registerSession")
            .eq("cloudId", args.registerSessionId),
        )
        .take(100);
      const registerSessionMappingByLocalId = new Map(
        registerSessionMappings.map((mapping) => [
          mapping.localRegisterSessionId,
          mapping,
        ]),
      );
      const localRegisterSessionIds = new Set<string>([
        args.registerSessionId,
        ...registerSessionMappings.map(
          (mapping) => mapping.localRegisterSessionId,
        ),
      ]);

      const facts = [];
      for (const localRegisterSessionId of localRegisterSessionIds) {
        const conflicts = await ctx.db
          .query("posLocalSyncConflict")
          .withIndex("by_store_terminal_register_status_type", (q) =>
            q
              .eq("storeId", args.storeId)
              .eq("terminalId", args.terminalId)
              .eq("localRegisterSessionId", localRegisterSessionId)
              .eq("status", "needs_review")
              .eq("conflictType", "permission"),
          )
          .take(100);

        for (const conflict of conflicts) {
          if (!conflict.localRegisterSessionId) {
            continue;
          }

          const registerSessionMapping = registerSessionMappingByLocalId.get(
            conflict.localRegisterSessionId,
          );
          const directRegisterSessionId = normalizeCloudId(
            "registerSession",
            conflict.localRegisterSessionId,
          );
          const directRegisterSession = directRegisterSessionId
            ? await ctx.db.get("registerSession", directRegisterSessionId)
            : null;
          facts.push({
            conflict,
            directRegisterSession:
              directRegisterSession &&
              directRegisterSession.storeId === args.storeId &&
              directRegisterSession.terminalId === args.terminalId
                ? {
                    _id: directRegisterSession._id,
                    storeId: directRegisterSession.storeId,
                    terminalId: directRegisterSession.terminalId,
                  }
                : null,
            registerSessionMapping:
              registerSessionMapping?.cloudTable === "registerSession"
                ? registerSessionMapping
                : null,
          });
        }
      }

      return facts;
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
      const registerSession = await ctx.db.get(
        "registerSession",
        registerSessionId,
      );
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
      let datePatch = {};

      const closeoutOwnedAt =
        typeof patch.closeoutOwnedAt === "number"
          ? patch.closeoutOwnedAt
          : patch.status === "closed" && typeof patch.closedAt === "number"
            ? patch.closedAt
            : undefined;
      const closeoutOwnershipSource =
        patch.closeoutOwnershipSource ??
        (patch.status === "closed" && typeof patch.closedAt === "number"
          ? "closed_record"
          : undefined);

      if (closeoutOwnedAt !== undefined && closeoutOwnershipSource) {
        const storeId =
          patch.storeId ??
          (await ctx.db.get("registerSession", registerSessionId))?.storeId;

        if (storeId) {
          datePatch = buildRegisterSessionDateDerivationPatch({
            closeoutContext: await resolveRegisterSessionOperatingDateContext(
              ctx,
              {
                at: closeoutOwnedAt,
                storeId,
              },
            ),
            closeoutOwnedAt,
            closeoutOwnershipSource,
          });
        }
      }

      await ctx.db.patch("registerSession", registerSessionId, {
        ...patch,
        ...datePatch,
      });
    },
    async getApprovalRequest(approvalRequestId) {
      return ctx.db.get("approvalRequest", approvalRequestId);
    },
    async createOrReuseRegisterSessionVarianceReview(input) {
      const notes = trimOptional(input.notes);
      const pendingVarianceReviews = await ctx.db
        .query("approvalRequest")
        .withIndex("by_registerSessionId_status_requestType", (q) =>
          q
            .eq("registerSessionId", input.registerSessionId)
            .eq("status", "pending")
            .eq("requestType", "variance_review"),
        )
        .take(2);
      if (pendingVarianceReviews.length > 1) {
        return {
          details: {
            existingApprovalRequestIds: pendingVarianceReviews.map(
              (approvalRequest) => approvalRequest._id,
            ),
            localEventId: input.localEventId,
            registerSessionId: input.registerSessionId,
          },
          status: "conflict" as const,
          summary:
            "Register closeout already has multiple pending variance reviews.",
        };
      }
      const matchingApprovalRequest = pendingVarianceReviews.find(
        (approvalRequest) =>
          areRegisterSessionCloseoutReviewFactsEquivalent(
            approvalRequest.metadata,
            {
              countedCash: input.countedCash,
              expectedCash: input.expectedCash,
              localEventId: input.localEventId,
              localRegisterSessionId: input.localRegisterSessionId,
              notes,
              terminalId: input.terminalId,
              variance: input.variance,
            },
          ),
      );

      if (matchingApprovalRequest) {
        return {
          approvalRequest: matchingApprovalRequest,
          created: false,
          status: "ready" as const,
        };
      }

      const conflictingApprovalRequest = pendingVarianceReviews[0];
      if (conflictingApprovalRequest) {
        return {
          details: {
            existingApprovalRequestId: conflictingApprovalRequest._id,
            localEventId: input.localEventId,
            registerSessionId: input.registerSessionId,
          },
          status: "conflict" as const,
          summary:
            "Register closeout already has a pending variance review with different closeout facts.",
        };
      }

      const approvalRequestId = await ctx.db.insert(
        "approvalRequest",
        buildApprovalRequest({
          metadata: {
            countedCash: input.countedCash,
            expectedCash: input.expectedCash,
            gateDecision: "approval_required",
            gateDecisionReason: input.gateDecisionReason,
            localEventId: input.localEventId,
            localRegisterSessionId: input.localRegisterSessionId,
            notes,
            closeoutOccurredAt: input.closeoutOccurredAt,
            syncOrigin: "local_sync",
            terminalId: input.terminalId,
            variance: input.variance,
          },
          notes,
          organizationId: input.organizationId,
          reason: input.gateDecisionReason,
          registerSessionId: input.registerSessionId,
          requestType: "variance_review",
          requestedByStaffProfileId: input.requestedByStaffProfileId,
          requestedByUserId: input.requestedByUserId,
          storeId: input.storeId,
          subjectId: input.registerSessionId,
          subjectType: "register_session",
        }),
      );
      const approvalRequest = await ctx.db.get(
        "approvalRequest",
        approvalRequestId,
      );
      if (!approvalRequest) {
        throw new Error("Created approval request could not be read.");
      }

      await this.patchRegisterSession(input.registerSessionId, {
        countedCash: input.countedCash,
        variance: input.variance,
        notes,
        status: "closing",
        managerApprovalRequestId: approvalRequestId,
        closeoutOwnedAt: input.closeoutOccurredAt,
        closeoutOwnershipSource: "approval_request",
      });

      return {
        approvalRequest,
        created: true,
        status: "ready" as const,
      };
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
      return ctx.db.insert("posSessionItem", input as never);
    },
    async createOrReusePendingCheckoutItem(input) {
      const result = await createOrReusePendingCheckoutItem(ctx, input);
      catalogSummaryDirtyStoreIds.add(input.storeId);
      return result;
    },
    async recordPendingCheckoutItemSaleEvidence(input) {
      return recordPendingCheckoutItemSaleEvidence(ctx, input);
    },
    async recordInventoryImportProvisionalSkuSaleEvidence(input) {
      const db = ctx.db as unknown as {
        get(
          tableName: string,
          id: string,
        ): Promise<{
          saleEvidence?: {
            saleCount?: number;
            totalQuantitySold?: number;
            lastSoldAt?: number;
            lastPosTransactionId?: Id<"posTransaction">;
            lastRegisterSessionId?: Id<"registerSession">;
          };
        } | null>;
        patch(
          tableName: string,
          id: string,
          patch: Record<string, unknown>,
        ): Promise<void>;
      };
      const provisionalSku = await db.get(
        "inventoryImportProvisionalSku",
        input.inventoryImportProvisionalSkuId,
      );
      if (!provisionalSku) return;

      const previousEvidence = provisionalSku.saleEvidence ?? {};
      await db.patch(
        "inventoryImportProvisionalSku",
        input.inventoryImportProvisionalSkuId,
        {
          saleEvidence: {
            saleCount: (previousEvidence.saleCount ?? 0) + 1,
            totalQuantitySold:
              (previousEvidence.totalQuantitySold ?? 0) + input.quantitySold,
            lastSoldAt: input.timestamp,
            lastPosTransactionId: input.posTransactionId,
            ...(input.registerSessionId
              ? { lastRegisterSessionId: input.registerSessionId }
              : {}),
          },
          updatedAt: input.timestamp,
        },
      );
    },
    async createServiceWorkItem(input) {
      return ctx.db.insert(
        "operationalWorkItem",
        buildOperationalWorkItem(input),
      );
    },
    async createServiceCase(input) {
      return ctx.db.insert("serviceCase", buildServiceCase(input));
    },
    async createServiceCaseLineItem(input) {
      const lineItem = buildServiceCaseLineItem(input);
      if (lineItem.kind === "user_error") {
        throw new Error(lineItem.error.message);
      }
      return ctx.db.insert("serviceCaseLineItem", lineItem.data);
    },
    async syncServiceCaseFinancials(serviceCaseId) {
      const serviceCase = await ctx.db.get("serviceCase", serviceCaseId);
      if (!serviceCase) return;
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- Service-case financial sync runs inside local sync ingestion, where Convex forbids paginated-query fanout; this read is scoped to one service case.
      const lineItems = await ctx.db
        .query("serviceCaseLineItem")
        .withIndex("by_serviceCaseId", (q) =>
          q.eq("serviceCaseId", serviceCaseId),
        )
        .collect();
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- Service-case payment allocations are scoped to one service case and cannot use pagination inside local sync ingestion.
      const paymentAllocations = await ctx.db
        .query("paymentAllocation")
        .withIndex("by_storeId_target", (q) =>
          q
            .eq("storeId", serviceCase.storeId)
            .eq("targetType", "service_case")
            .eq("targetId", serviceCaseId),
        )
        .collect();
      const totalAmount =
        lineItems.length > 0
          ? lineItems.reduce((sum, lineItem) => sum + lineItem.amount, 0)
          : (serviceCase.quotedAmount ?? 0);
      const summary = summarizePaymentAllocations(paymentAllocations);
      const balanceDueAmount = Math.max(totalAmount - summary.netAmount, 0);
      const paymentStatus =
        summary.totalOut > 0 && summary.totalOut >= summary.totalIn
          ? "refunded"
          : summary.totalIn <= 0
            ? "unpaid"
            : totalAmount <= 0
              ? "deposit_paid"
              : summary.totalIn >= totalAmount
                ? "paid"
                : "partially_paid";
      await ctx.db.patch("serviceCase", serviceCaseId, {
        balanceDueAmount,
        paymentStatus,
        totalAmount,
        updatedAt: Date.now(),
      });
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
      return ctx.db.insert("posTransactionItem", input as never);
    },
    async getExpenseSessionByLocalId(args) {
      const mapping = await ctx.db
        .query("posLocalSyncMapping")
        .withIndex("by_store_terminal_localKindId", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("terminalId", args.terminalId)
            .eq("localIdKind", "expenseSession")
            .eq("localId", args.localExpenseSessionId),
        )
        .unique();
      if (!mapping) return null;
      return ctx.db.get(
        "expenseSession",
        mapping.cloudId as Id<"expenseSession">,
      );
    },
    async createExpenseSession(input) {
      return ctx.db.insert("expenseSession", {
        sessionNumber: input.sessionNumber,
        storeId: input.storeId,
        staffProfileId: input.staffProfileId,
        terminalId: input.terminalId,
        registerNumber: input.registerNumber,
        status: input.completedAt ? "completed" : "active",
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
        expiresAt: input.expiresAt,
        completedAt: input.completedAt,
        notes: input.notes,
      });
    },
    async createExpenseSessionItem(input) {
      return ctx.db.insert("expenseSessionItem", input);
    },
    async createExpenseTransaction(input) {
      return ctx.db.insert("expenseTransaction", {
        transactionNumber: input.transactionNumber,
        storeId: input.storeId,
        sessionId: input.sessionId,
        staffProfileId: input.staffProfileId,
        registerNumber: input.registerNumber,
        totalValue: input.totalValue,
        status: "completed",
        completedAt: input.completedAt,
        notes: input.notes,
      });
    },
    async createExpenseTransactionItem(input) {
      return ctx.db.insert("expenseTransactionItem", input);
    },
    async createTransactionServiceLine(input) {
      return ctx.db.insert("posTransactionServiceLine", input);
    },
    async patchProductSku(productSkuId, patch) {
      await markCatalogSummaryDirtyForSkuPatch(productSkuId, patch);
      await ctx.db.patch("productSku", productSkuId, patch);
    },
    async flushCatalogSummaryRefreshes() {
      for (const storeId of catalogSummaryDirtyStoreIds) {
        await markCatalogSummaryNeedsRefresh(ctx, storeId);
      }
      catalogSummaryDirtyStoreIds.clear();
    },
    async recordSaleInventoryMovement(input) {
      const result = await recordInventoryMovementWithDispositionWithCtx(ctx, {
        actorStaffProfileId: input.staffProfileId,
        customerProfileId: input.customerProfileId,
        movementType: "sale",
        notes: `POS sale ${input.transactionNumber}`,
        organizationId: input.organizationId,
        posTransactionId: input.posTransactionId,
        productId: input.productId,
        productSkuId: input.productSkuId,
        quantityDelta: -input.quantity,
        reasonCode: "pos_sale",
        registerSessionId: input.registerSessionId,
        sourceId: input.posTransactionId,
        sourceType: "posTransaction",
        storeId: input.storeId,
      });
      return result.disposition;
    },
    async createPaymentAllocation(input) {
      return ctx.db.insert("paymentAllocation", input);
    },
    async createOperationalEvent(input) {
      return ctx.db.insert(
        "operationalEvent",
        normalizeOperationalEventTraceFields(input),
      );
    },
    recordPosSessionWorkflowTrace(input) {
      return createPosSessionTraceRecorder(ctx).record(input);
    },
    recordRegisterSessionWorkflowTrace(input) {
      return recordRegisterSessionTraceBestEffort(ctx, input);
    },
  };
}
