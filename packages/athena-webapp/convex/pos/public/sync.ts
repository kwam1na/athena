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
  syncScope: v.optional(v.union(v.literal("pos"), v.literal("expense"))),
  localRegisterSessionId: v.string(),
  localExpenseSessionId: v.optional(v.string()),
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
  resolvedByUserId: v.optional(v.id("athenaUser")),
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

const MAX_LOCAL_SYNC_EVENTS_PER_REQUEST = 250;
const MAX_PENDING_CHECKOUT_DEFINITIONS_PER_REQUEST = 50;

const posLocalSyncEventBaseValidator = {
  syncScope: v.optional(v.literal("pos")),
  localEventId: v.string(),
  localRegisterSessionId: v.string(),
  sequence: v.number(),
  occurredAt: v.number(),
  staffProfileId: v.id("staffProfile"),
  staffProofToken: v.optional(v.string()),
};

const posLocalSyncProductLineValidator = v.object({
  localTransactionItemId: v.optional(v.string()),
  productId: v.string(),
  productSkuId: v.string(),
  pendingCheckoutItemId: v.optional(v.string()),
  inventoryImportProvisionalSkuId: v.optional(v.string()),
  productName: v.string(),
  productSku: v.string(),
  barcode: v.optional(v.string()),
  quantity: v.number(),
  unitPrice: v.number(),
  image: v.optional(v.string()),
});

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
      items: v.array(posLocalSyncProductLineValidator),
      serviceLines: v.optional(
        v.array(
          v.object({
            localServiceLineId: v.optional(v.string()),
            localServiceCaseId: v.optional(v.string()),
            existingServiceCaseId: v.optional(v.string()),
            serviceCatalogId: v.string(),
            serviceCatalogName: v.string(),
            serviceMode: v.union(
              v.literal("same_day"),
              v.literal("consultation"),
              v.literal("repair"),
              v.literal("revamp"),
            ),
            pricingModel: v.union(
              v.literal("fixed"),
              v.literal("starting_at"),
              v.literal("quote_after_consultation"),
            ),
            quantity: v.number(),
            unitPrice: v.number(),
            totalPrice: v.number(),
            catalogUpdatedAt: v.optional(v.number()),
            customerProfileId: v.optional(v.string()),
          }),
        ),
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
    eventType: v.literal("pending_checkout_item_defined"),
    payload: v.object({
      localPendingCheckoutItemId: v.string(),
      name: v.string(),
      lookupCode: v.optional(v.string()),
      searchContext: v.optional(
        v.object({
          query: v.optional(v.string()),
          source: v.optional(
            v.union(
              v.literal("barcode"),
              v.literal("lookup_code"),
              v.literal("manual"),
              v.literal("catalog_search"),
              v.literal("unknown"),
            ),
          ),
          matched: v.optional(
            v.union(
              v.literal("existing_product"),
              v.literal("pending_checkout_item"),
              v.literal("none"),
              v.literal("unknown"),
            ),
          ),
        }),
      ),
      price: v.number(),
      quantitySold: v.number(),
      localMetadata: v.optional(
        v.object({
          schema: v.literal("pos_pending_checkout_item_local_metadata_v1"),
          source: v.optional(
            v.union(
              v.literal("offline_search"),
              v.literal("online_search"),
              v.literal("manual_entry"),
              v.literal("unknown"),
            ),
          ),
          reusedExistingPendingItem: v.optional(v.boolean()),
          createdOffline: v.optional(v.boolean()),
          appSessionValidation: v.optional(
            v.union(v.literal("supported"), v.literal("unverified")),
          ),
          cloudValidation: v.optional(v.literal("uncertain")),
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
  v.object({
    syncScope: v.literal("expense"),
    localEventId: v.string(),
    localExpenseSessionId: v.string(),
    sequence: v.number(),
    eventType: v.literal("expense_recorded"),
    occurredAt: v.number(),
    staffProfileId: v.id("staffProfile"),
    staffProofToken: v.optional(v.string()),
    payload: v.object({
      localExpenseSessionId: v.string(),
      localExpenseEventId: v.string(),
      reason: v.optional(v.string()),
      notes: v.optional(v.string()),
      totals: v.object({
        subtotal: v.number(),
        tax: v.number(),
        total: v.number(),
      }),
      items: v.array(posLocalSyncProductLineValidator),
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
    if (args.events.length > MAX_LOCAL_SYNC_EVENTS_PER_REQUEST) {
      return userError({
        code: "validation_failed",
        message: `Sync uploads can include at most ${MAX_LOCAL_SYNC_EVENTS_PER_REQUEST} events.`,
      });
    }

    const pendingDefinitionCount = args.events.filter(
      (event) => event.eventType === "pending_checkout_item_defined",
    ).length;
    if (
      pendingDefinitionCount > MAX_PENDING_CHECKOUT_DEFINITIONS_PER_REQUEST
    ) {
      return userError({
        code: "validation_failed",
        message: `Sync uploads can include at most ${MAX_PENDING_CHECKOUT_DEFINITIONS_PER_REQUEST} pending checkout items.`,
      });
    }

    const store = await ctx.db.get("store", args.storeId);
    if (!store) {
      return userError({
        code: "not_found",
        message: "Store not found.",
      });
    }

    let athenaUser;
    try {
      athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
      await requireOrganizationMemberRoleWithCtx(ctx, {
        allowedRoles: ["full_admin", "pos_only"],
        failureMessage: "You do not have access to sync this POS terminal.",
        organizationId: store.organizationId,
        userId: athenaUser._id,
      });
    } catch {
      return userError({
        code: "authorization_failed",
        message: "You do not have access to sync this POS terminal.",
      });
    }
    const terminal = await ctx.db.get("posTerminal", args.terminalId);
    const submittedSyncSecretHash = await hashPosTerminalSyncSecret(
      args.syncSecretHash,
    );
    if (
      !terminal ||
      terminal.storeId !== args.storeId ||
      terminal.status !== "active" ||
      !terminal.syncSecretHash ||
      terminal.syncSecretHash !== submittedSyncSecretHash
    ) {
      return userError({
        code: "authorization_failed",
        message: "You do not have access to sync this POS terminal.",
        metadata: { terminalAuthorizationFailure: true },
      });
    }

    return ingestLocalEventsWithCtx(ctx, {
      ...args,
      submittedByUserId: athenaUser._id,
      submittedAt: args.submittedAt ?? Date.now(),
    });
  },
});
