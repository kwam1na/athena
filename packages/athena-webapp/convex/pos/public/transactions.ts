import { v } from "convex/values";

import { mutation, query, type MutationCtx, type QueryCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { commandResultValidator } from "../../lib/commandResultValidators";
import {
  requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx,
} from "../../lib/athenaUserAuth";
import {
  approvalRequired,
  ok,
  userError,
  type CommandResult,
} from "../../../shared/commandResult";
import {
  correctTransactionCustomer as correctTransactionCustomerCommand,
  correctTransactionPaymentMethod as correctTransactionPaymentMethodCommand,
} from "../application/commands/correctTransaction";
import { adjustTransactionItems as adjustTransactionItemsCommand } from "../application/commands/adjustTransactionItems";
import { hashPosLocalStaffProofToken } from "../application/sync/staffProof";
import {
  completeTransaction as completeTransactionCommand,
  createTransactionFromSessionHandler,
  updateInventory as updateInventoryCommand,
  voidTransaction as voidTransactionCommand,
} from "../application/commands/completeTransaction";
import {
  getCompletedTransactions as getCompletedTransactionsQuery,
  getRecentTransactionsWithCustomers as getRecentTransactionsWithCustomersQuery,
  getTodaySummary as getTodaySummaryQuery,
  getTransaction as getTransactionQuery,
  getTransactionById as getTransactionByIdQuery,
  getTransactionsByStore as getTransactionsByStoreQuery,
} from "../application/queries/getTransactions";

async function requirePosTransactionStoreAccess(
  ctx: MutationCtx | QueryCtx,
  args: {
    storeId: Id<"store">;
    failureMessage: string;
  },
) {
  const store = await ctx.db.get("store", args.storeId);
  if (!store) {
    return userError({
      code: "not_found",
      message: "Store not found.",
    });
  }

  const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
  const membership = await requireOrganizationMemberRoleWithCtx(ctx, {
    allowedRoles: ["full_admin", "pos_only"],
    failureMessage: args.failureMessage,
    organizationId: store.organizationId,
    userId: athenaUser._id,
  });

  return { athenaUser, membership, store };
}

async function requirePosTransactionAccess(
  ctx: MutationCtx | QueryCtx,
  args: {
    transactionId: Id<"posTransaction">;
    failureMessage: string;
  },
) {
  const transaction = await getTransactionQuery(ctx, {
    transactionId: args.transactionId,
  });
  if (!transaction) {
    return userError({
      code: "not_found",
      message: "Transaction not found.",
    });
  }

  const access = await requirePosTransactionStoreAccess(ctx, {
    failureMessage: args.failureMessage,
    storeId: transaction.storeId,
  });
  if ("kind" in access) {
    return access;
  }

  return { ...access, transaction };
}

const paymentValidator = v.object({
  method: v.string(),
  amount: v.number(),
  timestamp: v.number(),
});

const customerInfoValidator = v.object({
  name: v.optional(v.string()),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
});

const transactionServiceLineValidator = v.object({
  id: v.string(),
  name: v.string(),
  quantity: v.number(),
  serviceCaseId: v.union(v.id("serviceCase"), v.null()),
  serviceCaseTitle: v.union(v.string(), v.null()),
  serviceCaseUnavailable: v.boolean(),
  serviceMode: v.union(v.string(), v.null()),
  servicePaymentStatus: v.union(v.string(), v.null()),
  serviceStatus: v.union(v.string(), v.null()),
  totalPrice: v.number(),
  unitPrice: v.number(),
});

const adjustmentLineItemValidator = v.object({
  adjustedQuantity: v.optional(v.number()),
  originalQuantity: v.optional(v.number()),
  productName: v.string(),
  productSku: v.optional(v.string()),
  quantityDelta: v.optional(v.number()),
  totalDelta: v.optional(v.number()),
  unitPrice: v.optional(v.number()),
});

const transactionAdjustmentSummaryValidator = v.object({
  _id: v.union(v.id("approvalRequest"), v.id("operationalEvent")),
  actorStaffName: v.union(v.string(), v.null()),
  adjustedTotal: v.number(),
  appliedAt: v.optional(v.number()),
  approvalRequestId: v.optional(v.id("approvalRequest")),
  createdAt: v.number(),
  lineItems: v.array(adjustmentLineItemValidator),
  originalTotal: v.number(),
  reason: v.optional(v.string()),
  settlementAmount: v.number(),
  settlementDirection: v.string(),
  settlementMethod: v.optional(v.string()),
  status: v.string(),
  totalDelta: v.optional(v.number()),
});

const correctTransactionPaymentMethodResultValidator = commandResultValidator(
  v.object({
    approvalProofId: v.id("approvalProof"),
    approvalOperationalEventId: v.optional(v.id("operationalEvent")),
    approvalRequestId: v.optional(v.id("approvalRequest")),
    approverStaffProfileId: v.id("staffProfile"),
    transactionId: v.id("posTransaction"),
    previousPaymentMethod: v.string(),
    paymentMethod: v.string(),
    paymentAllocationId: v.id("paymentAllocation"),
    operationalEventId: v.optional(v.id("operationalEvent")),
  }),
);

const transactionItemAdjustmentPayloadValidator = v.object({
  originalTotal: v.number(),
  correctedTotal: v.number(),
  settlementAmount: v.number(),
  settlementDirection: v.union(
    v.literal("collect"),
    v.literal("refund"),
    v.literal("none"),
  ),
  settlementMethod: v.optional(v.string()),
  lines: v.array(
    v.object({
      originalTransactionItemId: v.optional(v.id("posTransactionItem")),
      productId: v.id("product"),
      productSkuId: v.id("productSku"),
      productName: v.string(),
      productSku: v.string(),
      originalQuantity: v.number(),
      adjustedQuantity: v.number(),
      unitPrice: v.number(),
      inventoryDelta: v.number(),
    }),
  ),
});

const adjustTransactionItemsResultValidator = commandResultValidator(
  v.object({
    adjustmentId: v.id("posTransactionAdjustment"),
    approvalProofId: v.optional(v.id("approvalProof")),
    approvalRequestId: v.optional(v.id("approvalRequest")),
    approverStaffProfileId: v.optional(v.id("staffProfile")),
    decisionApprovalProofId: v.optional(v.id("approvalProof")),
    decisionApprovedByStaffProfileId: v.optional(v.id("staffProfile")),
    inventoryMovementIds: v.array(v.id("inventoryMovement")),
    lineIds: v.array(v.id("posTransactionAdjustmentLine")),
    operationalEventId: v.optional(v.id("operationalEvent")),
    paymentAllocationId: v.optional(v.id("paymentAllocation")),
    payloadFingerprint: v.string(),
    settlementAmount: v.number(),
    settlementDirection: v.union(
      v.literal("collect"),
      v.literal("refund"),
      v.literal("none"),
    ),
    transactionId: v.id("posTransaction"),
  }),
);

const voidTransactionResultValidator = commandResultValidator(
  v.object({
    transactionId: v.id("posTransaction"),
    transactionNumber: v.string(),
    voidedAt: v.number(),
    paymentAllocationIds: v.array(v.id("paymentAllocation")),
    inventoryMovementIds: v.array(v.id("inventoryMovement")),
    operationalEventId: v.optional(v.id("operationalEvent")),
    approvalProofId: v.optional(v.id("approvalProof")),
    approvalRequestId: v.optional(v.id("approvalRequest")),
    approverStaffProfileId: v.optional(v.id("staffProfile")),
    decisionApprovalProofId: v.optional(v.id("approvalProof")),
  }),
);

const posOperatorSnapshotValidator = v.object({
  busiestHour: v.union(
    v.object({
      hour: v.number(),
      label: v.string(),
      totalSales: v.number(),
      transactionCount: v.number(),
    }),
    v.null(),
  ),
  comparison: v.object({
    averageTransactionDeltaPercent: v.number(),
    currentAverageTransaction: v.number(),
    currentItemsSold: v.number(),
    currentSales: v.number(),
    currentTransactions: v.number(),
    itemsSoldDeltaPercent: v.number(),
    salesDeltaPercent: v.number(),
    transactionDeltaPercent: v.number(),
    yesterdayAverageTransaction: v.number(),
    yesterdayItemsSold: v.number(),
    yesterdaySales: v.number(),
    yesterdayTransactions: v.number(),
  }),
  historyDays: v.number(),
  isLimited: v.boolean(),
  paymentMix: v.array(
    v.object({
      count: v.number(),
      label: v.string(),
      method: v.string(),
      share: v.number(),
      total: v.number(),
    }),
  ),
  topItems: v.array(
    v.object({
      name: v.string(),
      productSku: v.union(v.string(), v.null()),
      quantity: v.number(),
      totalSales: v.number(),
    }),
  ),
  trend: v.array(
    v.object({
      averageTransaction: v.number(),
      date: v.string(),
      label: v.string(),
      totalItemsSold: v.number(),
      totalSales: v.number(),
      transactionCount: v.number(),
    }),
  ),
  usableHistoryDays: v.number(),
});

function redactPosPulseSummary(
  summary: Awaited<ReturnType<typeof getTodaySummaryQuery>>,
): Awaited<ReturnType<typeof getTodaySummaryQuery>> {
  return {
    ...summary,
    averageTransaction: 0,
    operatorSnapshot: {
      ...summary.operatorSnapshot,
      busiestHour: null,
      comparison: {
        ...summary.operatorSnapshot.comparison,
        averageTransactionDeltaPercent: 0,
        currentAverageTransaction: 0,
        currentItemsSold: summary.totalItemsSold,
        currentSales: 0,
        currentTransactions: summary.totalTransactions,
        itemsSoldDeltaPercent: 0,
        salesDeltaPercent: 0,
        transactionDeltaPercent: 0,
        yesterdayAverageTransaction: 0,
        yesterdayItemsSold: 0,
        yesterdaySales: 0,
        yesterdayTransactions: 0,
      },
      paymentMix: [],
      topItems: [],
      trend: [],
    },
    totalSales: 0,
  };
}

function mapCorrectionError(error: unknown): CommandResult<never> | null {
  const message = error instanceof Error ? error.message : "";

  if (message === "Transaction not found.") {
    return userError({ code: "not_found", message });
  }

  if (message === "Customer profile not found.") {
    return userError({ code: "not_found", message });
  }

  if (
    message === "Only completed transactions can be corrected." ||
    message === "Only completed transactions can be adjusted." ||
    message === "Only single-payment transactions can be corrected." ||
    message === "Only same-amount payment method corrections are supported." ||
    message === "Customer profile is not available for this store." ||
    message === "Payment allocation must be a same-amount single payment." ||
    message === "Manager approval proof is required." ||
    message === "Manager approval proof is invalid or expired." ||
    message === "Approval proof validation is not available." ||
    message === "Payment method approval request not found." ||
    message === "Item adjustment approval request not found." ||
    message === "Payment method approval request has already been decided." ||
    message === "Payment method approval request does not match this store." ||
    message === "Payment method approval request does not match this correction." ||
    message === "Payment method approval request is missing correction details." ||
    message === "Item adjustment approval request has already been decided." ||
    message === "Item adjustment approval request does not match this store." ||
    message === "Item adjustment approval request does not match this payload." ||
    message === "Item adjustment approval request is missing adjustment details." ||
    message === "Item adjustment payload is stale for this transaction." ||
    message === "Item adjustment settlement does not match corrected totals." ||
    message === "Item adjustment cannot reduce inventory below zero." ||
    message === "Item adjustment SKU not found for this store." ||
    message === "Item adjustment staff proof is invalid or expired." ||
    message === "Item adjustment staff profile is not active for this store." ||
    message === "Settlement method is required for item adjustments." ||
    message === "Item adjustment must include at least one changed line." ||
    message === "Item adjustment quantities must be whole numbers." ||
    message === "This transaction already has an item adjustment waiting for approval." ||
    message === "This transaction already has an item adjustment applied." ||
    message === "Register closeout is under review. Reopen the register before updating adjustment settlement." ||
    message === "Register session expected cash cannot be negative." ||
    message.startsWith("Approval proof ")
  ) {
    return userError({ code: "precondition_failed", message });
  }

  return null;
}

export const updateInventory = mutation({
  args: {
    skuId: v.id("productSku"),
    quantityToSubtract: v.number(),
  },
  handler: async (ctx, args) => {
    const sku = await ctx.db.get("productSku", args.skuId);
    if (!sku) {
      return userError({
        code: "not_found",
        message: "SKU not found.",
      });
    }

    const store = await ctx.db.get("store", sku.storeId);
    if (!store) {
      return userError({
        code: "not_found",
        message: "Store not found.",
      });
    }

    const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
    await requireOrganizationMemberRoleWithCtx(ctx, {
      allowedRoles: ["full_admin", "pos_only"],
      failureMessage: "You cannot update POS inventory for this store.",
      organizationId: store.organizationId,
      userId: athenaUser._id,
    });

    return updateInventoryCommand(ctx, args);
  },
});

export const completeTransaction = mutation({
  args: {
    storeId: v.id("store"),
    items: v.array(
      v.object({
        skuId: v.id("productSku"),
        inventoryImportProvisionalSkuId: v.optional(
          v.id("inventoryImportProvisionalSku"),
        ),
        quantity: v.number(),
        price: v.number(),
        name: v.string(),
        barcode: v.optional(v.string()),
        sku: v.string(),
        image: v.optional(v.string()),
      }),
    ),
    payments: v.array(paymentValidator),
    subtotal: v.number(),
    tax: v.number(),
    total: v.number(),
    customerProfileId: v.optional(v.id("customerProfile")),
    customerInfo: v.optional(customerInfoValidator),
    registerNumber: v.optional(v.string()),
    terminalId: v.optional(v.id("posTerminal")),
    staffProfileId: v.optional(v.id("staffProfile")),
    registerSessionId: v.optional(v.id("registerSession")),
  },
  returns: commandResultValidator(
    v.object({
      transactionId: v.id("posTransaction"),
      transactionNumber: v.string(),
      transactionItems: v.array(v.id("posTransactionItem")),
    }),
  ),
  handler: async (ctx, args) => {
    const store = await ctx.db.get("store", args.storeId);
    if (!store) {
      return userError({
        code: "not_found",
        message: "Store not found.",
      });
    }

    const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
    await requireOrganizationMemberRoleWithCtx(ctx, {
      allowedRoles: ["full_admin"],
      failureMessage: "You cannot complete this POS sale.",
      organizationId: store.organizationId,
      userId: athenaUser._id,
    });

    if (!args.staffProfileId || !args.terminalId || !args.registerSessionId) {
      return userError({
        code: "validation_failed",
        message:
          "Complete POS sales from an active register session with staff and terminal context.",
      });
    }

    return completeTransactionCommand(ctx, args);
  },
});

export const getTransaction = query({
  args: {
    transactionId: v.id("posTransaction"),
  },
  handler: async (ctx, args) => {
    const access = await requirePosTransactionAccess(ctx, {
      transactionId: args.transactionId,
      failureMessage: "You cannot view this transaction.",
    });
    if ("kind" in access) {
      return null;
    }

    return access.transaction;
  },
});

export const getTransactionsByStore = query({
  args: {
    storeId: v.id("store"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const access = await requirePosTransactionStoreAccess(ctx, {
      storeId: args.storeId,
      failureMessage: "You cannot view POS transactions for this store.",
    });
    if ("kind" in access) {
      return [];
    }

    return getTransactionsByStoreQuery(ctx, args);
  },
});

export const getCompletedTransactions = query({
  args: {
    storeId: v.id("store"),
    completedFrom: v.optional(v.number()),
    registerSessionId: v.optional(v.id("registerSession")),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("posTransaction"),
      transactionNumber: v.string(),
      total: v.number(),
      paymentMethod: v.union(v.string(), v.null()),
      paymentMethods: v.array(v.string()),
      hasMultiplePaymentMethods: v.boolean(),
      status: v.string(),
      completedAt: v.number(),
      voidedAt: v.optional(v.number()),
      voidReason: v.optional(v.string()),
      voidApprovalRequestId: v.optional(v.id("approvalRequest")),
      voidApprovalProofId: v.optional(v.id("approvalProof")),
      voidDecisionApprovalProofId: v.optional(v.id("approvalProof")),
      hasTrace: v.boolean(),
      sessionTraceId: v.union(v.string(), v.null()),
      cashierName: v.union(v.string(), v.null()),
      customerProfileId: v.optional(v.id("customerProfile")),
      customerName: v.union(v.string(), v.null()),
      itemCount: v.number(),
      serviceLineCount: v.number(),
      servicePaymentTotal: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const access = await requirePosTransactionStoreAccess(ctx, {
      storeId: args.storeId,
      failureMessage: "You cannot view POS transactions for this store.",
    });
    if ("kind" in access) {
      return [];
    }

    return getCompletedTransactionsQuery(ctx, args);
  },
});

export const getTransactionById = query({
  args: {
    transactionId: v.id("posTransaction"),
  },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("posTransaction"),
      transactionNumber: v.string(),
      subtotal: v.number(),
      tax: v.number(),
      total: v.number(),
      hasTrace: v.boolean(),
      sessionTraceId: v.union(v.string(), v.null()),
      registerNumber: v.optional(v.string()),
      registerSessionId: v.optional(v.id("registerSession")),
      registerSessionStatus: v.optional(v.string()),
      terminalId: v.optional(v.id("posTerminal")),
      terminalName: v.optional(v.string()),
      paymentMethod: v.optional(v.string()),
      payments: v.array(paymentValidator),
      totalPaid: v.number(),
      changeGiven: v.optional(v.number()),
      originalTotal: v.number(),
      effectiveNetTotal: v.number(),
      totalAppliedAdjustmentDelta: v.number(),
      adjustmentSummary: v.object({
        appliedCount: v.number(),
        effectiveNetTotal: v.number(),
        hasAdjustments: v.boolean(),
        originalTotal: v.number(),
        pendingCount: v.number(),
        totalAppliedAdjustmentDelta: v.number(),
      }),
      adjustments: v.array(transactionAdjustmentSummaryValidator),
      status: v.string(),
      completedAt: v.number(),
      notes: v.optional(v.string()),
      voidedAt: v.optional(v.number()),
      voidReason: v.optional(v.string()),
      voidedByStaffProfileId: v.optional(v.id("staffProfile")),
      voidApprovalRequestId: v.optional(v.id("approvalRequest")),
      voidApprovalProofId: v.optional(v.id("approvalProof")),
      voidDecisionApprovalProofId: v.optional(v.id("approvalProof")),
      voidApprovedByStaffProfileId: v.optional(v.id("staffProfile")),
      voidOperationalEventId: v.optional(v.id("operationalEvent")),
      pendingVoidApprovalRequest: v.union(
        v.null(),
        v.object({
          _id: v.id("approvalRequest"),
          createdAt: v.number(),
          requestedByStaffProfileId: v.optional(v.id("staffProfile")),
        }),
      ),
      cashier: v.union(
        v.null(),
        v.object({
          _id: v.id("staffProfile"),
          firstName: v.string(),
          lastName: v.string(),
        }),
      ),
      customer: v.union(
        v.null(),
        v.object({
          customerProfileId: v.optional(v.id("customerProfile")),
          name: v.optional(v.string()),
          email: v.optional(v.string()),
          phone: v.optional(v.string()),
        }),
      ),
      customerInfo: v.optional(customerInfoValidator),
      correctionHistory: v.array(
        v.object({
          _id: v.id("operationalEvent"),
          eventType: v.string(),
          message: v.string(),
          reason: v.optional(v.string()),
          metadata: v.optional(v.record(v.string(), v.any())),
          createdAt: v.number(),
          actorUserId: v.optional(v.id("athenaUser")),
          actorStaffProfileId: v.optional(v.id("staffProfile")),
          actorStaffName: v.union(v.string(), v.null()),
        }),
      ),
      receiptDeliveryHistory: v.array(
        v.object({
          _id: v.id("customerMessageDelivery"),
          status: v.string(),
          providerStatus: v.optional(v.string()),
          recipientSource: v.string(),
          recipientDisplay: v.string(),
          actorStaffProfileId: v.optional(v.id("staffProfile")),
          actorStaffName: v.union(v.string(), v.null()),
          createdAt: v.number(),
          updatedAt: v.number(),
          sentAt: v.optional(v.number()),
          deliveredAt: v.optional(v.number()),
          readAt: v.optional(v.number()),
          failedAt: v.optional(v.number()),
          failureCategory: v.optional(v.string()),
          failureMessage: v.optional(v.string()),
          retryable: v.boolean(),
        }),
      ),
      serviceLines: v.array(transactionServiceLineValidator),
      serviceLineCount: v.number(),
      servicePaymentTotal: v.number(),
      items: v.array(
        v.object({
          _id: v.id("posTransactionItem"),
          productId: v.id("product"),
          productSkuId: v.id("productSku"),
          pendingCheckoutItemId: v.optional(v.id("posPendingCheckoutItem")),
          inventoryImportProvisionalSkuId: v.optional(
            v.id("inventoryImportProvisionalSku"),
          ),
          productName: v.string(),
          productSku: v.string(),
          barcode: v.optional(v.string()),
          image: v.optional(v.string()),
          quantity: v.number(),
          unitPrice: v.number(),
          totalPrice: v.number(),
          discount: v.optional(v.number()),
          discountReason: v.optional(v.string()),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const transaction = await getTransactionQuery(ctx, args);
    if (!transaction) {
      return null;
    }

    const store = await ctx.db.get("store", transaction.storeId);
    if (!store) {
      return null;
    }

    const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
    await requireOrganizationMemberRoleWithCtx(ctx, {
      allowedRoles: ["full_admin", "pos_only"],
      failureMessage: "You cannot view this transaction.",
      organizationId: store.organizationId,
      userId: athenaUser._id,
    });

    return getTransactionByIdQuery(ctx, args);
  },
});

export const voidTransaction = mutation({
  args: {
    approvalRequestId: v.optional(v.id("approvalRequest")),
    approvalProofId: v.optional(v.id("approvalProof")),
    transactionId: v.id("posTransaction"),
    reason: v.optional(v.string()),
    staffProfileId: v.optional(v.id("staffProfile")),
    actorStaffProfileId: v.optional(v.id("staffProfile")),
    staffProofToken: v.string(),
  },
  returns: voidTransactionResultValidator,
  handler: async (ctx, args) => {
    const actorStaffProfileId = args.actorStaffProfileId ?? args.staffProfileId;
    const reason = args.reason?.trim();

    if (!actorStaffProfileId) {
      return userError({
        code: "authentication_failed",
        message: "Staff sign-in is required before voiding a completed sale.",
      });
    }

    if (!reason) {
      return userError({
        code: "validation_failed",
        message: "Reason is required before voiding a completed sale.",
      });
    }

    const transaction = await getTransactionQuery(ctx, {
      transactionId: args.transactionId,
    });
    if (!transaction) {
      return userError({
        code: "not_found",
        message: "Transaction not found.",
      });
    }

    const store = await ctx.db.get("store", transaction.storeId);
    if (!store) {
      return userError({
        code: "not_found",
        message: "Store not found.",
      });
    }

    const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
    await requireOrganizationMemberRoleWithCtx(ctx, {
      allowedRoles: ["full_admin", "pos_only"],
      failureMessage: "You cannot void this transaction.",
      organizationId: store.organizationId,
      userId: athenaUser._id,
    });

    const staffProfile = await ctx.db.get("staffProfile", actorStaffProfileId);
    if (
      !staffProfile ||
      staffProfile.status !== "active" ||
      staffProfile.storeId !== transaction.storeId
    ) {
      return userError({
        code: "authentication_failed",
        message: "Void staff profile is not active for this store.",
      });
    }

    const staffProofTokenHash = await hashPosLocalStaffProofToken(
      args.staffProofToken,
    );
    const proof = await ctx.db
      .query("posLocalStaffProof")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", staffProofTokenHash))
      .unique();
    if (
      !proof ||
      proof.status !== "active" ||
      proof.staffProfileId !== actorStaffProfileId ||
      proof.storeId !== transaction.storeId ||
      proof.expiresAt <= Date.now()
    ) {
      return userError({
        code: "authentication_failed",
        message: "Void staff proof is invalid or expired.",
      });
    }

    if (transaction.terminalId && proof.terminalId !== transaction.terminalId) {
      return userError({
        code: "authentication_failed",
        message: "Void staff proof is invalid for this terminal.",
      });
    }

    const credential = await ctx.db.get("staffCredential", proof.credentialId);
    if (
      !credential ||
      credential.status !== "active" ||
      credential.staffProfileId !== actorStaffProfileId ||
      credential.storeId !== transaction.storeId ||
      credential.localVerifierVersion !== proof.credentialVersion
    ) {
      return userError({
        code: "authentication_failed",
        message: "Void staff proof is invalid or expired.",
      });
    }

    await ctx.db.patch("posLocalStaffProof", proof._id, {
      lastUsedAt: Date.now(),
    });

    const { staffProofToken: _staffProofToken, ...commandArgs } = args;
    const result = await voidTransactionCommand(ctx, {
      ...commandArgs,
      actorStaffProfileId,
      actorUserId: athenaUser._id,
      reason,
    });

    if (result.kind === "approval_required") {
      return result;
    }

    return result;
  },
});

export const markReceiptPrinted = mutation({
  args: {
    transactionId: v.id("posTransaction"),
  },
  returns: commandResultValidator(v.null()),
  handler: async (ctx, args) => {
    const access = await requirePosTransactionAccess(ctx, {
      transactionId: args.transactionId,
      failureMessage: "You cannot update this transaction.",
    });
    if ("kind" in access) {
      return access;
    }

    if (access.transaction.receiptPrinted === true) {
      return ok(null);
    }

    await ctx.db.patch("posTransaction", args.transactionId, {
      receiptPrinted: true,
    });

    return ok(null);
  },
});

export const createTransactionFromSession = mutation({
  args: {
    sessionId: v.id("posSession"),
    staffProfileId: v.id("staffProfile"),
    payments: v.array(paymentValidator),
    registerSessionId: v.optional(v.id("registerSession")),
    notes: v.optional(v.string()),
  },
  returns: commandResultValidator(
    v.object({
      transactionId: v.id("posTransaction"),
      transactionNumber: v.string(),
      transactionItems: v.array(v.id("posTransactionItem")),
    }),
  ),
  handler: async (ctx, args) => {
    const session = await ctx.db.get("posSession", args.sessionId);
    if (!session) {
      return userError({
        code: "not_found",
        message: "POS session not found.",
      });
    }

    const store = await ctx.db.get("store", session.storeId);
    if (!store) {
      return userError({
        code: "not_found",
        message: "Store not found.",
      });
    }

    const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
    await requireOrganizationMemberRoleWithCtx(ctx, {
      allowedRoles: ["full_admin", "pos_only"],
      failureMessage: "You cannot complete this POS sale.",
      organizationId: store.organizationId,
      userId: athenaUser._id,
    });

    return createTransactionFromSessionHandler(ctx, args);
  },
});

export const correctTransactionCustomer = mutation({
  args: {
    transactionId: v.id("posTransaction"),
    customerProfileId: v.optional(v.id("customerProfile")),
    reason: v.string(),
    actorUserId: v.optional(v.id("athenaUser")),
    actorStaffProfileId: v.optional(v.id("staffProfile")),
  },
  returns: commandResultValidator(
    v.object({
      transactionId: v.id("posTransaction"),
      previousCustomerProfileId: v.optional(v.id("customerProfile")),
      customerProfileId: v.optional(v.id("customerProfile")),
      operationalEventId: v.optional(v.id("operationalEvent")),
    }),
  ),
  handler: async (ctx, args) => {
    if (!args.actorStaffProfileId) {
      return userError({
        code: "authentication_failed",
        message: "Staff sign-in is required before correcting customer attribution.",
      });
    }

    if (!args.reason.trim()) {
      return userError({
        code: "validation_failed",
        message: "Reason is required to correct customer attribution.",
      });
    }

    try {
      const access = await requirePosTransactionAccess(ctx, {
        transactionId: args.transactionId,
        failureMessage: "You cannot correct this transaction.",
      });
      if ("kind" in access) {
        return access;
      }

      const staffProfile = await ctx.db.get(
        "staffProfile",
        args.actorStaffProfileId,
      );
      if (
        !staffProfile ||
        staffProfile.status !== "active" ||
        staffProfile.storeId !== access.transaction.storeId
      ) {
        return userError({
          code: "authentication_failed",
          message:
            "Customer correction staff profile is not active for this store.",
        });
      }

      if (args.customerProfileId) {
        const customerProfile = await ctx.db.get(
          "customerProfile",
          args.customerProfileId,
        );
        if (!customerProfile) {
          return userError({
            code: "not_found",
            message: "Customer profile not found.",
          });
        }
        if (
          customerProfile.storeId &&
          customerProfile.storeId !== access.transaction.storeId
        ) {
          return userError({
            code: "precondition_failed",
            message: "Customer profile is not available for this store.",
          });
        }
      }

      return ok(
        await correctTransactionCustomerCommand(ctx, {
          ...args,
          actorUserId: access.athenaUser._id,
        }),
      );
    } catch (error) {
      const mappedError = mapCorrectionError(error);
      if (mappedError) {
        return mappedError;
      }
      throw error;
    }
  },
});

export const correctTransactionPaymentMethod = mutation({
  args: {
    approvalRequestId: v.optional(v.id("approvalRequest")),
    approvalProofId: v.optional(v.id("approvalProof")),
    transactionId: v.id("posTransaction"),
    paymentMethod: v.string(),
    reason: v.string(),
    actorUserId: v.optional(v.id("athenaUser")),
    actorStaffProfileId: v.optional(v.id("staffProfile")),
    staffProofToken: v.optional(v.string()),
  },
  returns: correctTransactionPaymentMethodResultValidator,
  handler: async (ctx, args) => {
    if (!args.reason.trim()) {
      return userError({
        code: "validation_failed",
        message: "Reason is required to correct payment method.",
      });
    }

    try {
      const access = await requirePosTransactionAccess(ctx, {
        transactionId: args.transactionId,
        failureMessage: "You cannot correct this transaction.",
      });
      if ("kind" in access) {
        return access;
      }

      if (!args.actorStaffProfileId) {
        return userError({
          code: "authentication_failed",
          message: "Staff sign-in is required before correcting payment method.",
        });
      }

      if (!args.staffProofToken) {
        return userError({
          code: "authentication_failed",
          message:
            "Payment correction staff proof is required for requester attribution.",
        });
      }

      const staffProfile = await ctx.db.get(
        "staffProfile",
        args.actorStaffProfileId,
      );
      if (
        !staffProfile ||
        staffProfile.status !== "active" ||
        staffProfile.storeId !== access.transaction.storeId
      ) {
        return userError({
          code: "authentication_failed",
          message:
            "Payment correction staff profile is not active for this store.",
        });
      }

      const staffProofTokenHash = await hashPosLocalStaffProofToken(
        args.staffProofToken,
      );
      const proof = await ctx.db
        .query("posLocalStaffProof")
        .withIndex("by_tokenHash", (q) =>
          q.eq("tokenHash", staffProofTokenHash),
        )
        .unique();
      if (
        !proof ||
        proof.status !== "active" ||
        proof.staffProfileId !== args.actorStaffProfileId ||
        proof.storeId !== access.transaction.storeId ||
        proof.expiresAt <= Date.now()
      ) {
        return userError({
          code: "authentication_failed",
          message: "Payment correction staff proof is invalid or expired.",
        });
      }

      if (
        access.transaction.terminalId &&
        proof.terminalId !== access.transaction.terminalId
      ) {
        return userError({
          code: "authentication_failed",
          message: "Payment correction staff proof is invalid for this terminal.",
        });
      }

      const credential = await ctx.db.get(
        "staffCredential",
        proof.credentialId,
      );
      if (
        !credential ||
        credential.status !== "active" ||
        credential.staffProfileId !== args.actorStaffProfileId ||
        credential.storeId !== access.transaction.storeId ||
        credential.localVerifierVersion !== proof.credentialVersion
      ) {
        return userError({
          code: "authentication_failed",
          message: "Payment correction staff proof is invalid or expired.",
        });
      }

      await ctx.db.patch("posLocalStaffProof", proof._id, {
        lastUsedAt: Date.now(),
      });

      const { staffProofToken: _staffProofToken, ...commandArgs } = args;
      const result = await correctTransactionPaymentMethodCommand(ctx, {
        ...commandArgs,
        actorUserId: access.athenaUser._id,
      });

      if ("action" in result && result.action === "approval_required") {
        return approvalRequired(result.approval);
      }

      return ok(result);
    } catch (error) {
      const mappedError = mapCorrectionError(error);
      if (mappedError) {
        return mappedError;
      }
      throw error;
    }
  },
});

export const adjustTransactionItems = mutation({
  args: {
    approvalRequestId: v.optional(v.id("approvalRequest")),
    approvalProofId: v.optional(v.id("approvalProof")),
    transactionId: v.id("posTransaction"),
    payload: transactionItemAdjustmentPayloadValidator,
    reason: v.string(),
    actorStaffProfileId: v.optional(v.id("staffProfile")),
    staffProofToken: v.string(),
  },
  returns: adjustTransactionItemsResultValidator,
  handler: async (ctx, args) => {
    if (!args.actorStaffProfileId) {
      return userError({
        code: "authentication_failed",
        message: "Staff sign-in is required before adjusting transaction items.",
      });
    }

    if (!args.reason.trim()) {
      return userError({
        code: "validation_failed",
        message: "Reason is required to adjust transaction items.",
      });
    }

    try {
      const transaction = await getTransactionQuery(ctx, {
        transactionId: args.transactionId,
      });
      if (!transaction) {
        return userError({
          code: "not_found",
          message: "Transaction not found.",
        });
      }

      const store = await ctx.db.get("store", transaction.storeId);
      if (!store) {
        return userError({
          code: "not_found",
          message: "Store not found.",
        });
      }

      const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
      await requireOrganizationMemberRoleWithCtx(ctx, {
        allowedRoles: ["full_admin", "pos_only"],
        failureMessage: "You cannot adjust transaction items.",
        organizationId: store.organizationId,
        userId: athenaUser._id,
      });

      const staffProfile = await ctx.db.get(
        "staffProfile",
        args.actorStaffProfileId,
      );
      if (
        !staffProfile ||
        staffProfile.status !== "active" ||
        staffProfile.storeId !== transaction.storeId
      ) {
        return userError({
          code: "authentication_failed",
          message: "Item adjustment staff profile is not active for this store.",
        });
      }

      const staffProofTokenHash = await hashPosLocalStaffProofToken(
        args.staffProofToken,
      );
      const proof = await ctx.db
        .query("posLocalStaffProof")
        .withIndex("by_tokenHash", (q) =>
          q.eq("tokenHash", staffProofTokenHash),
        )
        .unique();
      if (
        !proof ||
        proof.status !== "active" ||
        proof.staffProfileId !== args.actorStaffProfileId ||
        proof.storeId !== transaction.storeId ||
        proof.expiresAt <= Date.now()
      ) {
        return userError({
          code: "authentication_failed",
          message: "Item adjustment staff proof is invalid or expired.",
        });
      }

      const credential = await ctx.db.get(
        "staffCredential",
        proof.credentialId,
      );
      if (
        !credential ||
        credential.status !== "active" ||
        credential.staffProfileId !== args.actorStaffProfileId ||
        credential.storeId !== transaction.storeId ||
        credential.localVerifierVersion !== proof.credentialVersion
      ) {
        return userError({
          code: "authentication_failed",
          message: "Item adjustment staff proof is invalid or expired.",
        });
      }

      await ctx.db.patch("posLocalStaffProof", proof._id, {
        lastUsedAt: Date.now(),
      });

      const {
        staffProofToken: _staffProofToken,
        ...commandArgs
      } = args;
      const result = await adjustTransactionItemsCommand(ctx, {
        ...commandArgs,
        actorUserId: athenaUser._id,
      });

      if ("action" in result && result.action === "approval_required") {
        return approvalRequired(result.approval);
      }

      return ok(result);
    } catch (error) {
      const mappedError = mapCorrectionError(error);
      if (mappedError) {
        return mappedError;
      }
      throw error;
    }
  },
});

export const getRecentTransactionsWithCustomers = query({
  args: {
    storeId: v.id("store"),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("posTransaction"),
      transactionNumber: v.string(),
      total: v.number(),
      status: v.string(),
      completedAt: v.number(),
      customerProfileId: v.optional(v.id("customerProfile")),
      customerInfo: v.optional(customerInfoValidator),
      customerName: v.union(v.string(), v.null()),
      hasCustomerLink: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const access = await requirePosTransactionStoreAccess(ctx, {
      storeId: args.storeId,
      failureMessage: "You cannot view POS transactions for this store.",
    });
    if ("kind" in access) {
      return [];
    }

    return getRecentTransactionsWithCustomersQuery(ctx, args);
  },
});

export const getTodaySummary = query({
  args: {
    pulseWindow: v.optional(
      v.union(
        v.literal("today"),
        v.literal("yesterday"),
        v.literal("this_week"),
        v.literal("this_month"),
        v.literal("all_time"),
        v.literal("last_week"),
        v.literal("last_month"),
      ),
    ),
    storeId: v.id("store"),
  },
  returns: v.object({
    totalTransactions: v.number(),
    totalSales: v.number(),
    totalItemsSold: v.number(),
    averageTransaction: v.number(),
    date: v.string(),
    operatorSnapshot: posOperatorSnapshotValidator,
  }),
  handler: async (ctx, args) => {
    const access = await requirePosTransactionStoreAccess(ctx, {
      storeId: args.storeId,
      failureMessage: "You cannot view POS summaries for this store.",
    });
    if ("kind" in access) {
      return {
        averageTransaction: 0,
        date: new Date().toISOString().split("T")[0],
        operatorSnapshot: {
          busiestHour: null,
          comparison: {
            averageTransactionDeltaPercent: 0,
            currentAverageTransaction: 0,
            currentItemsSold: 0,
            currentSales: 0,
            currentTransactions: 0,
            itemsSoldDeltaPercent: 0,
            salesDeltaPercent: 0,
            transactionDeltaPercent: 0,
            yesterdayAverageTransaction: 0,
            yesterdayItemsSold: 0,
            yesterdaySales: 0,
            yesterdayTransactions: 0,
          },
          historyDays: 14,
          isLimited: false,
          paymentMix: [],
          topItems: [],
          trend: [],
          usableHistoryDays: 0,
        },
        totalItemsSold: 0,
        totalSales: 0,
        totalTransactions: 0,
      };
    }

    const hasFullAdminAccess = access.membership.role === "full_admin";
    const summary = await getTodaySummaryQuery(ctx, {
      ...args,
      pulseWindow: hasFullAdminAccess ? args.pulseWindow : "today",
    });

    return hasFullAdminAccess ? summary : redactPosPulseSummary(summary);
  },
});
