import type { Doc } from "../_generated/dataModel";
import {
  ATHENA_CAPABILITY_CATALOG,
  type AthenaCapability,
} from "../platform/capabilityCatalog";
import { isDynamicOperationCapability } from "./capabilities";
import { validateOperationTarget } from "./resourceGuards";
import type { OperationDefinition } from "./types";
import {
  defineOperation,
  orderStoreWriteOperation,
  storeWriteOperation,
  transactionStoreWriteOperation,
} from "./domains/_shapes";
import { POS_DEFINITIONS } from "./domains/pos_definitions";
import { INVENTORY_CATALOG_DEFINITIONS } from "./domains/inventoryCatalog_definitions";
import { INVENTORY_IDENTITY_DEFINITIONS } from "./domains/inventoryIdentity_definitions";
import { OPERATIONS_DEFINITIONS } from "./domains/operations_definitions";
import { STOREFRONT_CUSTOMER_DEFINITIONS } from "./domains/storefrontCustomer_definitions";
import { STOREFRONT_OPERATOR_DEFINITIONS } from "./domains/storefrontOperator_definitions";
import { REPORTS_DEFINITIONS } from "./domains/reports_definitions";
import { PLATFORM_DEFINITIONS } from "./domains/platform_definitions";
import { HTTP_CUSTOMER_DEFINITIONS } from "./domains/httpCustomer_definitions";
import { HTTP_CORE_DEFINITIONS } from "./domains/httpCore_definitions";

export { defineOperation };

const KNOWN_CAPABILITIES = new Set<AthenaCapability>(
  ATHENA_CAPABILITY_CATALOG.map(({ id }) => id),
);

export const resolveSyncedSaleInventoryReviewGroupOperationDefinition =
  defineOperation({
    kind: "mutation" as const,
    functionName:
      "operations/openWorkInventoryReviews:resolveSyncedSaleInventoryReviewGroup",
    operationId:
      "operations/openWorkInventoryReviews.resolveSyncedSaleInventoryReviewGroup",
    capability: "daily_operations.write",
    scope: { kind: "store", storeIdArg: "storeId" },
    readiness: {
      kind: "store_write",
      expectedEpochArg: "expectedDemoRestoreEpoch",
    },
    effects: { mode: "none" },
    actors: {
    normalUser: "admit",
    sharedDemo: "admit",
    public: "deny",
  },
  });

export const decideApprovalRequestOperationDefinition = defineOperation({
    kind: "mutation" as const,
  functionName: "operations/approvalRequests:decideApprovalRequest",
  operationId: "operations/approvalRequests.decideApprovalRequest",
  capability: "approvals.manage",
  scope: {
    kind: "store",
    resolve: async (ctx, args) => {
      const approvalRequestId = args.approvalRequestId;
      if (typeof approvalRequestId !== "string") return {};
      const approvalRequest = await ctx.db.get(
        "approvalRequest",
        approvalRequestId as never,
      );
      if (!approvalRequest) return {};
      return {
        organizationId: approvalRequest.organizationId,
        storeId: approvalRequest.storeId,
      };
    },
  },
  readiness: { kind: "store_write" },
  effects: { mode: "none" },
  actors: {
    normalUser: "admit",
    sharedDemo: "admit",
    public: "deny",
  },
});

export const requestManualRestoreOperationDefinition = defineOperation({
    kind: "mutation" as const,
  functionName: "sharedDemo/public:requestManualRestore",
  operationId: "sharedDemo/public.requestManualRestore",
  capability: "demo.lifecycle",
  scope: { kind: "none" },
  readiness: { kind: "none" },
  effects: { mode: "none" },
  actors: {
    normalUser: "deny",
    sharedDemo: "admit",
    public: "deny",
  },
});

export const resetBrowserExperienceOperationDefinition = defineOperation({
    kind: "mutation" as const,
  functionName: "sharedDemo/public:resetBrowserExperience",
  operationId: "sharedDemo/public.resetBrowserExperience",
  capability: "demo.lifecycle",
  scope: {
    kind: "store",
    resolve: async (ctx, args) => {
      const terminalId = args.terminalId;
      if (typeof terminalId !== "string") return {};
      const terminal = await ctx.db.get("posTerminal", terminalId as never);
      return terminal ? { storeId: terminal.storeId } : {};
    },
  },
  readiness: { kind: "none" },
  effects: { mode: "none" },
  actors: {
    normalUser: "deny",
    sharedDemo: "admit",
    public: "deny",
  },
});

export const bindRegisterBaselineToTerminalOperationDefinition =
  defineOperation({
    kind: "mutation" as const,
    functionName: "sharedDemo/public:bindRegisterBaselineToTerminal",
    operationId: "sharedDemo/public.bindRegisterBaselineToTerminal",
    capability: "demo.lifecycle",
    scope: {
      kind: "store",
      resolve: async (ctx, args) => {
        const terminalId = args.terminalId;
        if (typeof terminalId !== "string") return {};
        const terminal = await ctx.db.get("posTerminal", terminalId as never);
        return terminal ? { storeId: terminal.storeId } : {};
      },
    },
    readiness: {
      kind: "store_write",
      expectedEpochArg: "expectedEpoch",
    },
    effects: { mode: "none" },
    actors: {
    normalUser: "deny",
    sharedDemo: "admit",
    public: "deny",
  },
  });

export const completeTransactionOperationDefinition = storeWriteOperation({
  functionName: "pos/public/transactions:completeTransaction",
  operationId: "pos/public/transactions.completeTransaction",
  capability: "pos.sale.complete",
});

export const markReceiptPrintedOperationDefinition =
  transactionStoreWriteOperation({
    functionName: "pos/public/transactions:markReceiptPrinted",
    operationId: "pos/public/transactions.markReceiptPrinted",
    capability: "pos.transaction.correct",
  });

export const correctTransactionCustomerOperationDefinition =
  transactionStoreWriteOperation({
    functionName: "pos/public/transactions:correctTransactionCustomer",
    operationId: "pos/public/transactions.correctTransactionCustomer",
    capability: "pos.transaction.correct",
  });

export const correctTransactionPaymentMethodOperationDefinition =
  transactionStoreWriteOperation({
    functionName: "pos/public/transactions:correctTransactionPaymentMethod",
    operationId: "pos/public/transactions.correctTransactionPaymentMethod",
    capability: "pos.transaction.correct",
  });

export const adjustTransactionItemsOperationDefinition =
  transactionStoreWriteOperation({
    functionName: "pos/public/transactions:adjustTransactionItems",
    operationId: "pos/public/transactions.adjustTransactionItems",
    capability: "pos.transaction.correct",
  });

export const voidTransactionOperationDefinition =
  transactionStoreWriteOperation({
    functionName: "pos/public/transactions:voidTransaction",
    operationId: "pos/public/transactions.voidTransaction",
    capability: "pos.transaction.void",
  });

export const quickAddSkuOperationDefinition = storeWriteOperation({
  functionName: "pos/public/catalog:quickAddSku",
  operationId: "pos/public/catalog.quickAddSku",
  capability: "catalog.quick_add",
});

export const repairCatalogSummaryOperationDefinition = storeWriteOperation({
  functionName: "inventory/products:repairCatalogSummary",
  operationId: "inventory/products.repairCatalogSummary",
  capability: "catalog.maintain",
});

/**
 * The capability each local-sync event type requires.
 *
 * This is the single source of truth: `pos/public/sync.ts` re-exposes it as
 * `sharedDemoCapabilityForSyncEvent`. It lives here rather than there because
 * the definition must classify the batch at admission time, and a definitions
 * module may not import a function module.
 */
export const POS_LOCAL_SYNC_EVENT_CAPABILITIES = {
  register_opened: "cash.control.write",
  register_closed: "cash.control.write",
  register_reopened: "cash.control.write",
  store_day_started: "daily_operations.write",
  pending_checkout_item_defined: "pos.sale.complete",
  sale_completed: "pos.sale.complete",
  sale_cleared: "pos.sale.complete",
  expense_recorded: "expense.manage",
} as const satisfies Record<
  Doc<"posLocalSyncEvent">["eventType"],
  AthenaCapability
>;

/**
 * Batch-valued capability with all-of semantics: an upload that mixes a
 * granted and an ungranted event type requires both, so it is denied whole at
 * admission rather than partially applied. An unrecognized event type resolves
 * to `undefined`, which falls outside `candidates` and therefore denies.
 */
export const ingestLocalEventsOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "pos/public/sync:ingestLocalEvents",
  operationId: "pos/public/sync.ingestLocalEvents",
  capability: {
    kind: "dynamic" as const,
    candidates: [
      "cash.control.write",
      "daily_operations.write",
      "pos.sale.complete",
      "expense.manage",
    ] as const,
    resolve: (args: Record<string, unknown>) => [
      ...new Set(
        (
          (args.events as
            | readonly { eventType: Doc<"posLocalSyncEvent">["eventType"] }[]
            | undefined) ?? []
        ).map((event) => POS_LOCAL_SYNC_EVENT_CAPABILITIES[event.eventType]),
      ),
    ],
  },
  scope: { kind: "store" as const, storeIdArg: "storeId" },
  readiness: {
    kind: "store_write" as const,
    expectedEpochArg: "expectedDemoEpoch",
  },
  effects: { mode: "none" as const },
  actors: {
    normalUser: "admit" as const,
    sharedDemo: "admit" as const,
    public: "deny" as const,
  },
});

export const reportLocalSyncDeadLetterOperationDefinition =
  storeWriteOperation({
    functionName: "pos/public/sync:reportLocalSyncDeadLetter",
    operationId: "pos/public/sync.reportLocalSyncDeadLetter",
    capability: "pos.sync.write",
    expectedEpochArg: "expectedDemoEpoch",
  });

export const ingestRegisterSessionActivityOperationDefinition =
  storeWriteOperation({
    functionName: "pos/public/sync:ingestRegisterSessionActivity",
    operationId: "pos/public/sync.ingestRegisterSessionActivity",
    capability: "cash.control.write",
    expectedEpochArg: "expectedDemoEpoch",
  });

export const registerTerminalOperationDefinition = storeWriteOperation({
  functionName: "pos/public/terminals:registerTerminal",
  operationId: "pos/public/terminals.registerTerminal",
  capability: "daily_operations.write",
});

export const recordRegisterSessionDepositOperationDefinition =
  storeWriteOperation({
    functionName: "cashControls/deposits:recordRegisterSessionDeposit",
    operationId: "cashControls/deposits.recordRegisterSessionDeposit",
    capability: "cash.control.write",
  });

export const resolveRegisterSessionSyncReviewOperationDefinition =
  storeWriteOperation({
    functionName: "cashControls/deposits:resolveRegisterSessionSyncReview",
    operationId: "cashControls/deposits.resolveRegisterSessionSyncReview",
    capability: "cash.control.write",
  });

export const submitRegisterSessionCloseoutOperationDefinition =
  storeWriteOperation({
    functionName: "cashControls/closeouts:submitRegisterSessionCloseout",
    operationId: "cashControls/closeouts.submitRegisterSessionCloseout",
    capability: "cash.control.write",
  });

export const reopenRegisterSessionCloseoutOperationDefinition =
  storeWriteOperation({
    functionName: "cashControls/closeouts:reopenRegisterSessionCloseout",
    operationId: "cashControls/closeouts.reopenRegisterSessionCloseout",
    capability: "cash.control.write",
  });

export const correctRegisterSessionOpeningFloatOperationDefinition =
  storeWriteOperation({
    functionName: "cashControls/closeouts:correctRegisterSessionOpeningFloat",
    operationId: "cashControls/closeouts.correctRegisterSessionOpeningFloat",
    capability: "cash.control.write",
  });

export const reviewRegisterSessionCloseoutOperationDefinition =
  storeWriteOperation({
    functionName: "cashControls/closeouts:reviewRegisterSessionCloseout",
    operationId: "cashControls/closeouts.reviewRegisterSessionCloseout",
    capability: "cash.control.write",
  });

export const startStoreDayOperationDefinition = storeWriteOperation({
  functionName: "operations/dailyOpening:startStoreDay",
  operationId: "operations/dailyOpening.startStoreDay",
  capability: "daily_operations.write",
});

export const authenticateStaffCredentialOperationDefinition =
  storeWriteOperation({
    functionName: "operations/staffCredentials:authenticateStaffCredential",
    operationId: "operations/staffCredentials.authenticateStaffCredential",
    capability: "staff.authenticate",
  });

export const authenticateStaffCredentialForTerminalOperationDefinition =
  storeWriteOperation({
    functionName:
      "operations/staffCredentials:authenticateStaffCredentialForTerminal",
    operationId:
      "operations/staffCredentials.authenticateStaffCredentialForTerminal",
    capability: "staff.authenticate",
  });

export const validateRestoredPosLocalStaffProofOperationDefinition =
  storeWriteOperation({
    functionName:
      "operations/staffCredentials:validateRestoredPosLocalStaffProof",
    operationId:
      "operations/staffCredentials.validateRestoredPosLocalStaffProof",
    capability: "staff.authenticate",
  });

export const refreshTerminalStaffAuthorityOperationDefinition =
  storeWriteOperation({
    functionName: "operations/staffCredentials:refreshTerminalStaffAuthority",
    operationId: "operations/staffCredentials.refreshTerminalStaffAuthority",
    capability: "staff.authenticate",
  });

export const authenticateStaffCredentialForApprovalOperationDefinition =
  storeWriteOperation({
    functionName:
      "operations/staffCredentials:authenticateStaffCredentialForApproval",
    operationId:
      "operations/staffCredentials.authenticateStaffCredentialForApproval",
    capability: "staff.authenticate",
  });

export const postStaffMessageOperationDefinition = storeWriteOperation({
  functionName: "operations/staffMessages:postStaffMessage",
  operationId: "operations/staffMessages.postStaffMessage",
  capability: "staff.communication.write",
  expectedEpochArg: "expectedDemoRestoreEpoch",
});

export const submitStockAdjustmentBatchOperationDefinition =
  storeWriteOperation({
    functionName: "stockOps/adjustments:submitStockAdjustmentBatch",
    operationId: "stockOps/adjustments.submitStockAdjustmentBatch",
    capability: "inventory.adjust",
  });

function cycleCountDraftStoreWriteOperation(args: {
  functionName: string;
  operationId: string;
  storeIdArg?: string;
}) {
  return defineOperation({
    kind: "mutation" as const,
    functionName: args.functionName,
    operationId: args.operationId,
    capability: "inventory.adjust",
    scope: args.storeIdArg
      ? { kind: "store" as const, storeIdArg: args.storeIdArg }
      : {
          kind: "store" as const,
          resolve: async (ctx, operationArgs) => {
            const draftId = operationArgs.draftId;
            if (typeof draftId !== "string") return {};
            const draft = await ctx.db.get("cycleCountDraft", draftId as never);
            return draft ? { storeId: draft.storeId } : {};
          },
        },
    readiness: { kind: "store_write" as const },
    effects: { mode: "none" as const },
    actors: {
      normalUser: "admit" as const,
      sharedDemo: "admit" as const,
      public: "deny" as const,
    },
  });
}

export const ensureCycleCountDraftOperationDefinition =
  cycleCountDraftStoreWriteOperation({
    functionName: "stockOps/cycleCountDrafts:ensureCycleCountDraft",
    operationId: "stockOps/cycleCountDrafts.ensureCycleCountDraft",
    storeIdArg: "storeId",
  });

export const saveCycleCountDraftLineOperationDefinition =
  cycleCountDraftStoreWriteOperation({
    functionName: "stockOps/cycleCountDrafts:saveCycleCountDraftLine",
    operationId: "stockOps/cycleCountDrafts.saveCycleCountDraftLine",
  });

export const discardCycleCountDraftOperationDefinition =
  cycleCountDraftStoreWriteOperation({
    functionName: "stockOps/cycleCountDrafts:discardCycleCountDraft",
    operationId: "stockOps/cycleCountDrafts.discardCycleCountDraft",
  });

export const refreshCycleCountDraftLineBaselineOperationDefinition =
  cycleCountDraftStoreWriteOperation({
    functionName:
      "stockOps/cycleCountDrafts:refreshCycleCountDraftLineBaseline",
    operationId: "stockOps/cycleCountDrafts.refreshCycleCountDraftLineBaseline",
    storeIdArg: "storeId",
  });

export const submitCycleCountDraftOperationDefinition =
  cycleCountDraftStoreWriteOperation({
    functionName: "stockOps/cycleCountDrafts:submitCycleCountDraft",
    operationId: "stockOps/cycleCountDrafts.submitCycleCountDraft",
  });

export const submitActiveCycleCountDraftsOperationDefinition =
  cycleCountDraftStoreWriteOperation({
    functionName: "stockOps/cycleCountDrafts:submitActiveCycleCountDrafts",
    operationId: "stockOps/cycleCountDrafts.submitActiveCycleCountDrafts",
    storeIdArg: "storeId",
  });

// Anonymous storefront + Paystack webhook drive order status/refund updates
// post-checkout with no signed-in user, so this write opts public in. The
// handler already short-circuits store-access checks for non-normal_user
// actors, preserving the pre-admission-rails anonymous behavior.
export const updateOnlineOrderOperationDefinition = orderStoreWriteOperation({
  functionName: "storeFront/onlineOrder:update",
  operationId: "storeFront/onlineOrder.update",
  capability: "orders.fulfill",
  effects: { mode: "protected", gateways: ["order_notification.send"] },
  publicAccess: "admit",
});

export const processReturnExchangeOperationDefinition =
  orderStoreWriteOperation({
    functionName: "storeFront/onlineOrder:processReturnExchange",
    operationId: "storeFront/onlineOrder.processReturnExchange",
    capability: "payments.refund",
    effects: { mode: "protected", gateways: ["payment.refund"] },
  });

// Returning stock is scoped by the order the caller names, never by a
// caller-supplied store: `returnAllItemsToStock` resolves from its `orderId`,
// and `returnItemsToStock` resolves from the order behind its external
// transaction reference. Both stay demo-writable — restocking a cancelled
// order is real shared-store inventory work with no external effect.
export const returnAllItemsToStockOperationDefinition =
  orderStoreWriteOperation({
    functionName: "storeFront/onlineOrder:returnAllItemsToStock",
    operationId: "storeFront/onlineOrder.returnAllItemsToStock",
    capability: "orders.return",
  });

export const returnItemsToStockOperationDefinition = defineOperation({
    kind: "mutation" as const,
  functionName: "storeFront/onlineOrder:returnItemsToStock",
  operationId: "storeFront/onlineOrder.returnItemsToStock",
  capability: "orders.return",
  scope: {
    kind: "store",
    resolve: async (ctx, operationArgs) => {
      const externalTransactionId = operationArgs.externalTransactionId;
      if (typeof externalTransactionId !== "string") return {};
      const order = await ctx.db
        .query("onlineOrder")
        .withIndex("by_externalTransactionId", (q) =>
          q.eq("externalTransactionId", externalTransactionId),
        )
        .first();
      return order ? { storeId: order.storeId } : {};
    },
  },
  readiness: { kind: "store_write" },
  effects: { mode: "none" },
  actors: {
    normalUser: "admit",
    sharedDemo: "admit",
    public: "deny",
  },
});

// Customer-email actions. These are Convex actions, not mutations, so they
// enter the rail through the registered admission mutation rather than
// `admitPublicMutation`. An action is not transactional, so it cannot claim
// `store_write` semantics: it declares `store_ready`, the admission-time
// restore fence, and any demo-reachable write it performs re-applies the
// write fence inside the internal mutation that performs it. Both declare a
// protected gateway so the demo adapter simulates the send instead of denying
// the operation outright.
export const sendOrderUpdateEmailOperationDefinition = orderStoreWriteOperation({
  kind: "action",
  functionName: "storeFront/onlineOrderUtilFns:sendOrderUpdateEmail",
  operationId: "storeFront/onlineOrderUtilFns.sendOrderUpdateEmail",
  capability: "customer.messaging.send",
  effects: { mode: "protected", gateways: ["order_notification.send"] },
  readiness: { kind: "store_ready" },
});

export const sendFeedbackRequestOperationDefinition = orderStoreWriteOperation({
  kind: "action",
  functionName: "storeFront/reviews:sendFeedbackRequest",
  operationId: "storeFront/reviews.sendFeedbackRequest",
  capability: "reviews.manage",
  effects: { mode: "protected", gateways: ["customer_message.send"] },
  readiness: { kind: "store_ready" },
});

// Line-item edits resolve their store through the item's own order, so the
// admitted scope is the row's store rather than anything the caller names.
export const updateOnlineOrderItemOperationDefinition = defineOperation({
    kind: "mutation" as const,
  functionName: "storeFront/onlineOrderItem:update",
  operationId: "storeFront/onlineOrderItem.update",
  capability: "orders.manage",
  scope: {
    kind: "store",
    resolve: async (ctx, operationArgs) => {
      const id = operationArgs.id;
      if (typeof id !== "string") return {};
      const orderItem = await ctx.db.get("onlineOrderItem", id as never);
      if (!orderItem) return {};
      const order = await ctx.db.get("onlineOrder", orderItem.orderId);
      return order ? { storeId: order.storeId } : {};
    },
  },
  readiness: { kind: "store_write" },
  effects: { mode: "none" },
  actors: {
    normalUser: "admit",
    sharedDemo: "admit",
    public: "deny",
  },
});

function inventoryImportReviewPayloadWriteOperation(
  functionName:
    | "stageInventoryImportReviewVersionPayloadChunk"
    | "finalizeInventoryImportReviewVersionPayload",
) {
  return defineOperation({
    kind: "mutation" as const,
    functionName: `inventory/catalogImport:${functionName}`,
    operationId: `inventory.catalogImport.${functionName}`,
    capability: "inventory.import",
    scope: { kind: "store" as const, storeIdArg: "storeId" },
    readiness: { kind: "store_write" as const },
    effects: { mode: "none" as const },
    actors: {
      normalUser: "admit" as const,
      sharedDemo: "deny" as const,
      public: "deny" as const,
    },
  });
}

export const stageInventoryImportReviewVersionPayloadChunkOperationDefinition =
  inventoryImportReviewPayloadWriteOperation(
    "stageInventoryImportReviewVersionPayloadChunk",
  );
export const finalizeInventoryImportReviewVersionPayloadOperationDefinition =
  inventoryImportReviewPayloadWriteOperation(
    "finalizeInventoryImportReviewVersionPayload",
  );

function costOverlayStoreWriteOperation(
  functionName:
    | "createCostOverlayRun"
    | "updateCostOverlayDecision"
    | "updateCostOverlayDecisionsBulk"
    | "prepareCostOverlayRun"
    | "confirmCostOverlayApply"
    | "retryCostOverlayWork"
    | "requestCostOverlayUndo"
    | "refreshCostOverlayUndoPreview"
    | "reopenCostOverlayRun"
    | "abandonCostOverlayRun",
) {
  return defineOperation({
    kind: "mutation" as const,
    functionName: `inventory/inventoryImportCostOverlay:${functionName}`,
    operationId: `inventory.inventoryImportCostOverlay.${functionName}`,
    capability: "inventory.import",
    scope: { kind: "store" as const, storeIdArg: "storeId" },
    readiness: { kind: "store_write" as const },
    effects: { mode: "none" as const },
    actors: {
      normalUser: "admit" as const,
      sharedDemo: "deny" as const,
      public: "deny" as const,
    },
  });
}

export const createCostOverlayRunOperationDefinition =
  costOverlayStoreWriteOperation("createCostOverlayRun");
export const updateCostOverlayDecisionOperationDefinition =
  costOverlayStoreWriteOperation("updateCostOverlayDecision");
export const updateCostOverlayDecisionsBulkOperationDefinition =
  costOverlayStoreWriteOperation("updateCostOverlayDecisionsBulk");
export const prepareCostOverlayRunOperationDefinition =
  costOverlayStoreWriteOperation("prepareCostOverlayRun");
export const confirmCostOverlayApplyOperationDefinition =
  costOverlayStoreWriteOperation("confirmCostOverlayApply");
export const retryCostOverlayWorkOperationDefinition =
  costOverlayStoreWriteOperation("retryCostOverlayWork");
export const requestCostOverlayUndoOperationDefinition =
  costOverlayStoreWriteOperation("requestCostOverlayUndo");
export const refreshCostOverlayUndoPreviewOperationDefinition =
  costOverlayStoreWriteOperation("refreshCostOverlayUndoPreview");
export const reopenCostOverlayRunOperationDefinition =
  costOverlayStoreWriteOperation("reopenCostOverlayRun");
export const abandonCostOverlayRunOperationDefinition =
  costOverlayStoreWriteOperation("abandonCostOverlayRun");

// Notification subscription writes are org-scoped configuration. Shared demo
// is denied: audience management edits real recipient email lists. The
// setEnabled/remove scope resolves from the TARGET ROW's own organizationId,
// never a caller-supplied org, and the handlers re-authorize against the same
// row-derived org.
export const addNotificationSubscriptionOperationDefinition = defineOperation({
    kind: "mutation" as const,
  functionName: "notifications/subscriptions:addSubscription",
  operationId: "notifications/subscriptions.addSubscription",
  capability: "organization.manage",
  scope: { kind: "organization", organizationIdArg: "organizationId" },
  readiness: { kind: "none" },
  effects: { mode: "none" },
  // Runs for EVERY actor, including a normal full admin: demo foundation rows
  // are not editable from the product surface. Re-expresses the retired
  // `requireNonDemoFoundationMutation({ organizationId: args.organizationId })`.
  target: {
    protectDemoFoundation: { organizationIdArg: "organizationId" },
  },
  actors: {
    normalUser: "admit",
    sharedDemo: "deny",
    public: "deny",
  },
});

function notificationSubscriptionRowWriteOperation(
  functionName: "setSubscriptionEnabled" | "removeSubscription",
) {
  return defineOperation({
    kind: "mutation" as const,
    functionName: `notifications/subscriptions:${functionName}`,
    operationId: `notifications/subscriptions.${functionName}`,
    capability: "organization.manage",
    scope: {
      kind: "organization",
      resolve: async (ctx, args) => {
        const subscriptionId = args.subscriptionId;
        if (typeof subscriptionId !== "string") return {};
        const subscription = await ctx.db.get(
          "notificationSubscription",
          subscriptionId as never,
        );
        return subscription
          ? { organizationId: subscription.organizationId }
          : {};
      },
    },
    readiness: { kind: "none" },
    effects: { mode: "none" },
    // `true` guards the RESOLVED scope constraints, and the scope above
    // resolves `organizationId` from the target row itself — so this is the
    // row-derived org, never a caller-supplied one, and it costs no extra
    // read. Re-expresses the retired `requireNonDemoFoundationMutation({
    // organizationId: subscription.organizationId })`.
    target: { protectDemoFoundation: true },
    actors: {
    normalUser: "admit",
    sharedDemo: "deny",
    public: "deny",
  },
  });
}

export const setNotificationSubscriptionEnabledOperationDefinition =
  notificationSubscriptionRowWriteOperation("setSubscriptionEnabled");

export const removeNotificationSubscriptionOperationDefinition =
  notificationSubscriptionRowWriteOperation("removeSubscription");

const OPERATION_ADMISSION_BASE_DEFINITIONS = [
  resolveSyncedSaleInventoryReviewGroupOperationDefinition,
  decideApprovalRequestOperationDefinition,
  requestManualRestoreOperationDefinition,
  resetBrowserExperienceOperationDefinition,
  bindRegisterBaselineToTerminalOperationDefinition,
  completeTransactionOperationDefinition,
  markReceiptPrintedOperationDefinition,
  correctTransactionCustomerOperationDefinition,
  correctTransactionPaymentMethodOperationDefinition,
  adjustTransactionItemsOperationDefinition,
  voidTransactionOperationDefinition,
  quickAddSkuOperationDefinition,
  repairCatalogSummaryOperationDefinition,
  ingestLocalEventsOperationDefinition,
  reportLocalSyncDeadLetterOperationDefinition,
  ingestRegisterSessionActivityOperationDefinition,
  registerTerminalOperationDefinition,
  recordRegisterSessionDepositOperationDefinition,
  resolveRegisterSessionSyncReviewOperationDefinition,
  submitRegisterSessionCloseoutOperationDefinition,
  reopenRegisterSessionCloseoutOperationDefinition,
  correctRegisterSessionOpeningFloatOperationDefinition,
  reviewRegisterSessionCloseoutOperationDefinition,
  startStoreDayOperationDefinition,
  authenticateStaffCredentialOperationDefinition,
  authenticateStaffCredentialForTerminalOperationDefinition,
  validateRestoredPosLocalStaffProofOperationDefinition,
  refreshTerminalStaffAuthorityOperationDefinition,
  authenticateStaffCredentialForApprovalOperationDefinition,
  postStaffMessageOperationDefinition,
  submitStockAdjustmentBatchOperationDefinition,
  ensureCycleCountDraftOperationDefinition,
  saveCycleCountDraftLineOperationDefinition,
  discardCycleCountDraftOperationDefinition,
  refreshCycleCountDraftLineBaselineOperationDefinition,
  submitCycleCountDraftOperationDefinition,
  submitActiveCycleCountDraftsOperationDefinition,
  updateOnlineOrderOperationDefinition,
  processReturnExchangeOperationDefinition,
  returnAllItemsToStockOperationDefinition,
  returnItemsToStockOperationDefinition,
  updateOnlineOrderItemOperationDefinition,
  sendOrderUpdateEmailOperationDefinition,
  sendFeedbackRequestOperationDefinition,
  stageInventoryImportReviewVersionPayloadChunkOperationDefinition,
  finalizeInventoryImportReviewVersionPayloadOperationDefinition,
  createCostOverlayRunOperationDefinition,
  updateCostOverlayDecisionOperationDefinition,
  updateCostOverlayDecisionsBulkOperationDefinition,
  prepareCostOverlayRunOperationDefinition,
  confirmCostOverlayApplyOperationDefinition,
  retryCostOverlayWorkOperationDefinition,
  requestCostOverlayUndoOperationDefinition,
  refreshCostOverlayUndoPreviewOperationDefinition,
  reopenCostOverlayRunOperationDefinition,
  abandonCostOverlayRunOperationDefinition,
  addNotificationSubscriptionOperationDefinition,
  setNotificationSubscriptionEnabledOperationDefinition,
  removeNotificationSubscriptionOperationDefinition,
] as const satisfies readonly OperationDefinition[];

/**
 * Every write/action/http definition in the backend.
 *
 * Per-unit domain modules are composed here once (U1a) so no Phase B unit ever
 * edits this file: an owning unit fills its own `domains/<domain>_definitions.ts`
 * array and nothing else.
 */
/**
 * The write registry. Frozen, like the definitions inside it.
 *
 * `defineOperation` deep-freezes each definition so a handler cannot mutate the
 * policy it was admitted under; freezing the array closes the matching hole one
 * level up, where a module could otherwise `push` an operation into the
 * registry at import time and have it treated as declared. The checker compares
 * definition IDENTITY against this array, so an entry appended after discovery
 * would be a definition nobody reviewed.
 */
export const OPERATION_ADMISSION_DEFINITIONS: readonly OperationDefinition[] = Object.freeze([
  ...OPERATION_ADMISSION_BASE_DEFINITIONS,
  ...POS_DEFINITIONS,
  ...INVENTORY_CATALOG_DEFINITIONS,
  ...INVENTORY_IDENTITY_DEFINITIONS,
  ...OPERATIONS_DEFINITIONS,
  ...STOREFRONT_CUSTOMER_DEFINITIONS,
  ...STOREFRONT_OPERATOR_DEFINITIONS,
  ...REPORTS_DEFINITIONS,
  ...PLATFORM_DEFINITIONS,
  ...HTTP_CUSTOMER_DEFINITIONS,
  ...HTTP_CORE_DEFINITIONS,
] as const);

export function validateOperationDefinition(
  definition: OperationDefinition,
): string[] {
  const errors: string[] = [];

  if (!definition.operationId.trim()) {
    errors.push("Operation id is required.");
  }

  if (isDynamicOperationCapability(definition.capability)) {
    if (definition.capability.candidates.length === 0) {
      errors.push("Dynamic capability must declare at least one candidate.");
    }
    for (const candidate of definition.capability.candidates) {
      if (!KNOWN_CAPABILITIES.has(candidate)) {
        errors.push(`Unknown operation capability: ${candidate}`);
      }
    }
    if (typeof definition.capability.resolve !== "function") {
      errors.push("Dynamic capability must declare a resolver.");
    }
  } else if (!KNOWN_CAPABILITIES.has(definition.capability)) {
    errors.push(`Unknown operation capability: ${definition.capability}`);
  }

  if (definition.scope.kind === "store") {
    if (!definition.scope.storeIdArg && !definition.scope.resolve) {
      errors.push("Store scope must declare storeIdArg or resolve.");
    }
  }
  if (definition.scope.kind === "organization") {
    if (!definition.scope.organizationIdArg && !definition.scope.resolve) {
      errors.push(
        "Organization scope must declare organizationIdArg or resolve.",
      );
    }
  }

  if (definition.actors.public === undefined) {
    errors.push("Operation must declare actors.public.");
  }

  const isHttpKind = definition.kind === "http";
  const isTransactional = definition.kind === "mutation";

  // An action or HTTP body is not transactional, so it cannot claim write
  // semantics at admission time. It declares the restore fence instead, and
  // the internal mutation that performs the write re-applies store_write.
  if (!isTransactional && definition.readiness.kind === "store_write") {
    errors.push(
      `Readiness store_write is only valid on mutation kinds (${definition.kind} declared it).`,
    );
  }
  if (isTransactional && definition.readiness.kind === "store_ready") {
    errors.push(
      "Readiness store_ready is only valid on action and http kinds.",
    );
  }
  if (
    definition.actors.sharedDemo === "admit" &&
    definition.capability !== "demo.lifecycle" &&
    ((isTransactional && definition.readiness.kind !== "store_write") ||
      (!isTransactional && definition.readiness.kind !== "store_ready"))
  ) {
    errors.push(
      isTransactional
        ? "Shared-demo writable operations must declare store_write readiness."
        : "Shared-demo admitted action and http operations must declare store_ready readiness.",
    );
  }

  if (
    definition.effects.mode === "protected" &&
    definition.effects.gateways.length === 0
  ) {
    errors.push("Protected effects must declare at least one gateway.");
  }

  if (definition.actors.storefrontCustomer === "admit") {
    if (!isHttpKind) {
      errors.push(
        "actors.storefrontCustomer is only valid on http and http_read kinds.",
      );
    }
    if (definition.scope.kind !== "store") {
      errors.push(
        "Storefront-customer operations must declare a store scope.",
      );
    }
    // A cookieless request to a customer write route is a terminal denial, not
    // an anonymous admission: the two actors cannot both be admitted there.
    if (isHttpKind && definition.actors.public === "admit") {
      errors.push(
        "An http write may not admit both storefrontCustomer and public.",
      );
    }
    if (
      isHttpKind &&
      definition.ingressVerification?.kind !== "origin_allowlist"
    ) {
      errors.push(
        "Storefront-customer http writes must declare ingressVerification origin_allowlist.",
      );
    }
  }

  if (isHttpKind) {
    if (definition.actors.storefrontCustomer === undefined) {
      errors.push("http definitions must declare actors.storefrontCustomer.");
    }
    // Public webhook ingress has no identity at all: its only boundary is the
    // declared verifier, so it may not be omitted.
    if (
      definition.actors.public === "admit" &&
      definition.ingressVerification === undefined
    ) {
      errors.push(
        "Public http definitions must declare ingressVerification.",
      );
    }
  } else if (definition.ingressVerification !== undefined) {
    errors.push(
      "ingressVerification is only valid on http and http_read kinds.",
    );
  }

  errors.push(...validateOperationTarget(definition));

  return errors;
}
