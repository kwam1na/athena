import {
  ATHENA_CAPABILITY_CATALOG,
  type AthenaCapability,
} from "../platform/capabilityCatalog";
import type { OperationDefinition } from "./types";

const KNOWN_CAPABILITIES = new Set<AthenaCapability>(
  ATHENA_CAPABILITY_CATALOG.map(({ id }) => id),
);

export function defineOperation<T extends OperationDefinition>(
  definition: T,
): T {
  return definition;
}

export const resolveSyncedSaleInventoryReviewGroupOperationDefinition =
  defineOperation({
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
    actors: { normalUser: "admit", sharedDemo: "admit" },
  });

export const decideApprovalRequestOperationDefinition = defineOperation({
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
  actors: { normalUser: "admit", sharedDemo: "admit" },
});

export const requestManualRestoreOperationDefinition = defineOperation({
  functionName: "sharedDemo/public:requestManualRestore",
  operationId: "sharedDemo/public.requestManualRestore",
  capability: "demo.lifecycle",
  scope: { kind: "none" },
  readiness: { kind: "none" },
  effects: { mode: "none" },
  actors: { normalUser: "deny", sharedDemo: "admit" },
});

export const resetBrowserExperienceOperationDefinition = defineOperation({
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
  actors: { normalUser: "deny", sharedDemo: "admit" },
});

export const bindRegisterBaselineToTerminalOperationDefinition =
  defineOperation({
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
    actors: { normalUser: "deny", sharedDemo: "admit" },
  });

function storeWriteOperation(args: {
  capability: AthenaCapability;
  expectedEpochArg?: string;
  functionName: string;
  operationId: string;
}) {
  return defineOperation({
    functionName: args.functionName,
    operationId: args.operationId,
    capability: args.capability,
    scope: { kind: "store" as const, storeIdArg: "storeId" },
    readiness: {
      kind: "store_write" as const,
      expectedEpochArg: args.expectedEpochArg,
    },
    effects: { mode: "none" as const },
    actors: { normalUser: "admit" as const, sharedDemo: "admit" as const },
  });
}

function transactionStoreWriteOperation(args: {
  capability: AthenaCapability;
  functionName: string;
  operationId: string;
}) {
  return defineOperation({
    functionName: args.functionName,
    operationId: args.operationId,
    capability: args.capability,
    scope: {
      kind: "store",
      resolve: async (ctx, operationArgs) => {
        const transactionId = operationArgs.transactionId;
        if (typeof transactionId !== "string") return {};
        const transaction = await ctx.db.get("posTransaction", transactionId as never);
        return transaction ? { storeId: transaction.storeId } : {};
      },
    },
    readiness: { kind: "store_write" },
    effects: { mode: "none" },
    actors: { normalUser: "admit", sharedDemo: "admit" },
  });
}

function orderStoreWriteOperation(args: {
  capability: AthenaCapability;
  effects?: { mode: "protected"; gateways: readonly string[] } | { mode: "none" };
  functionName: string;
  operationId: string;
}) {
  return defineOperation({
    functionName: args.functionName,
    operationId: args.operationId,
    capability: args.capability,
    scope: {
      kind: "store",
      resolve: async (ctx, operationArgs) => {
        const orderId = operationArgs.orderId;
        if (typeof orderId === "string") {
          const order = await ctx.db.get("onlineOrder", orderId as never);
          return order ? { storeId: order.storeId } : {};
        }
        const externalReference = operationArgs.externalReference;
        if (typeof externalReference === "string") {
          const order = await ctx.db
            .query("onlineOrder")
            .withIndex("by_externalReference", (q) =>
              q.eq("externalReference", externalReference),
            )
            .first();
          return order ? { storeId: order.storeId } : {};
        }
        return {};
      },
    },
    readiness: { kind: "store_write" },
    effects: args.effects ?? { mode: "none" },
    actors: { normalUser: "admit", sharedDemo: "admit" },
  });
}

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

export const quickAddSkuOperationDefinition = storeWriteOperation({
  functionName: "pos/public/catalog:quickAddSku",
  operationId: "pos/public/catalog.quickAddSku",
  capability: "catalog.quick_add",
});

export const ingestLocalEventsOperationDefinition = storeWriteOperation({
  functionName: "pos/public/sync:ingestLocalEvents",
  operationId: "pos/public/sync.ingestLocalEvents",
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
    actors: { normalUser: "admit" as const, sharedDemo: "admit" as const },
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
    functionName: "stockOps/cycleCountDrafts:refreshCycleCountDraftLineBaseline",
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

export const updateOnlineOrderOperationDefinition = orderStoreWriteOperation({
  functionName: "storeFront/onlineOrder:update",
  operationId: "storeFront/onlineOrder.update",
  capability: "orders.fulfill",
  effects: { mode: "protected", gateways: ["order_notification.send"] },
});

export const processReturnExchangeOperationDefinition = orderStoreWriteOperation({
  functionName: "storeFront/onlineOrder:processReturnExchange",
  operationId: "storeFront/onlineOrder.processReturnExchange",
  capability: "payments.refund",
  effects: { mode: "protected", gateways: ["payment.refund"] },
});

export const OPERATION_ADMISSION_DEFINITIONS = [
  resolveSyncedSaleInventoryReviewGroupOperationDefinition,
  decideApprovalRequestOperationDefinition,
  requestManualRestoreOperationDefinition,
  resetBrowserExperienceOperationDefinition,
  bindRegisterBaselineToTerminalOperationDefinition,
  completeTransactionOperationDefinition,
  markReceiptPrintedOperationDefinition,
  correctTransactionCustomerOperationDefinition,
  correctTransactionPaymentMethodOperationDefinition,
  quickAddSkuOperationDefinition,
  ingestLocalEventsOperationDefinition,
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
] as const satisfies readonly OperationDefinition[];

export function validateOperationDefinition(
  definition: OperationDefinition,
): string[] {
  const errors: string[] = [];

  if (!definition.operationId.trim()) {
    errors.push("Operation id is required.");
  }
  if (!KNOWN_CAPABILITIES.has(definition.capability)) {
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
  if (
    definition.actors.sharedDemo === "admit" &&
    definition.capability !== "demo.lifecycle" &&
    definition.readiness.kind !== "store_write"
  ) {
    errors.push(
      "Shared-demo writable operations must declare store_write readiness.",
    );
  }
  if (
    definition.effects.mode === "protected" &&
    definition.effects.gateways.length === 0
  ) {
    errors.push("Protected effects must declare at least one gateway.");
  }

  return errors;
}
