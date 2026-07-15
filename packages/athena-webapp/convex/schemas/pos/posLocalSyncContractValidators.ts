import { v } from "convex/values";

import {
  POS_LOCAL_SYNC_EVENT_CONTRACT,
  type PosLocalSyncEventType,
} from "../../../shared/posLocalSyncContract";

type ConvexValidator = any;

function unionFromValidators(validators: ConvexValidator[]): ConvexValidator {
  if (validators.length < 2) {
    throw new Error("Convex unions require at least two validators.");
  }

  return v.union(
    ...(validators as [
      ConvexValidator,
      ConvexValidator,
      ...ConvexValidator[],
    ]),
  ) as ConvexValidator;
}

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
  pendingCheckoutAliasState: v.optional(v.literal("linked_to_catalog")),
  inventoryImportProvisionalSkuId: v.optional(v.string()),
  productName: v.string(),
  productSku: v.string(),
  barcode: v.optional(v.string()),
  quantity: v.number(),
  unitPrice: v.number(),
  image: v.optional(v.string()),
});

const posLocalSyncPayloadValidators = {
  register_opened: v.object({
    openingFloat: v.number(),
    registerNumber: v.optional(v.string()),
    notes: v.optional(v.string()),
  }),
  store_day_started: v.object({
    operatingDate: v.string(),
    startAt: v.number(),
    endAt: v.number(),
  }),
  pending_checkout_item_defined: v.object({
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
  sale_completed: v.object({
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
  register_closed: v.object({
    countedCash: v.optional(v.number()),
    notes: v.optional(v.string()),
  }),
  register_reopened: v.object({
    reason: v.optional(v.string()),
  }),
  sale_cleared: v.object({
    localPosSessionId: v.string(),
    reason: v.optional(v.string()),
  }),
  expense_recorded: v.object({
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
} satisfies Record<PosLocalSyncEventType, ConvexValidator>;

export const posLocalSyncUploadEventValidator = unionFromValidators(
  POS_LOCAL_SYNC_EVENT_CONTRACT.map((contract) => {
    const payload = posLocalSyncPayloadValidators[contract.eventType];
    if (contract.syncScope === "expense") {
      return v.object({
        syncScope: v.literal("expense"),
        localEventId: v.string(),
        localExpenseSessionId: v.string(),
        sequence: v.number(),
        eventType: v.literal(contract.eventType),
        occurredAt: v.number(),
        staffProfileId: v.id("staffProfile"),
        staffProofToken: v.optional(v.string()),
        payload,
      });
    }

    return v.object({
      ...posLocalSyncEventBaseValidator,
      eventType: v.literal(contract.eventType),
      payload,
    });
  }),
);
