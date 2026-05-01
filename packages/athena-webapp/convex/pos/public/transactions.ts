import { v } from "convex/values";

import { mutation, query } from "../../_generated/server";
import {
  commandResultValidator,
} from "../../lib/commandResultValidators";
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

const correctTransactionPaymentMethodResultValidator = commandResultValidator(
  v.object({
    approvalProofId: v.id("approvalProof"),
    approvalOperationalEventId: v.optional(v.id("operationalEvent")),
    approverStaffProfileId: v.id("staffProfile"),
    transactionId: v.id("posTransaction"),
    previousPaymentMethod: v.string(),
    paymentMethod: v.string(),
    paymentAllocationId: v.id("paymentAllocation"),
    operationalEventId: v.optional(v.id("operationalEvent")),
  }),
);

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
    message === "Only single-payment transactions can be corrected." ||
    message === "Only same-amount payment method corrections are supported." ||
    message === "Payment allocation must be a same-amount single payment." ||
    message === "Manager approval proof is required." ||
    message === "Manager approval proof is invalid or expired." ||
    message === "Approval proof validation is not available." ||
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
  handler: async (ctx, args) => updateInventoryCommand(ctx, args),
});

export const completeTransaction = mutation({
  args: {
    storeId: v.id("store"),
    items: v.array(
      v.object({
        skuId: v.id("productSku"),
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
  handler: async (ctx, args) => completeTransactionCommand(ctx, args),
});

export const getTransaction = query({
  args: {
    transactionId: v.id("posTransaction"),
  },
  handler: async (ctx, args) => getTransactionQuery(ctx, args),
});

export const getTransactionsByStore = query({
  args: {
    storeId: v.id("store"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => getTransactionsByStoreQuery(ctx, args),
});

export const getCompletedTransactions = query({
  args: {
    storeId: v.id("store"),
    registerSessionId: v.optional(v.id("registerSession")),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("posTransaction"),
      transactionNumber: v.string(),
      total: v.number(),
      paymentMethod: v.union(v.string(), v.null()),
      hasMultiplePaymentMethods: v.boolean(),
      completedAt: v.number(),
      hasTrace: v.boolean(),
      sessionTraceId: v.union(v.string(), v.null()),
      cashierName: v.union(v.string(), v.null()),
      customerProfileId: v.optional(v.id("customerProfile")),
      customerName: v.union(v.string(), v.null()),
      itemCount: v.number(),
    }),
  ),
  handler: async (ctx, args) => getCompletedTransactionsQuery(ctx, args),
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
      paymentMethod: v.optional(v.string()),
      payments: v.array(paymentValidator),
      totalPaid: v.number(),
      changeGiven: v.optional(v.number()),
      status: v.string(),
      completedAt: v.number(),
      notes: v.optional(v.string()),
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
      items: v.array(
        v.object({
          _id: v.id("posTransactionItem"),
          productId: v.id("product"),
          productSkuId: v.id("productSku"),
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
  handler: async (ctx, args) => getTransactionByIdQuery(ctx, args),
});

export const voidTransaction = mutation({
  args: {
    transactionId: v.id("posTransaction"),
    reason: v.string(),
    staffProfileId: v.optional(v.id("staffProfile")),
  },
  handler: async (ctx, args) => voidTransactionCommand(ctx, args),
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
  handler: async (ctx, args) => createTransactionFromSessionHandler(ctx, args),
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
      return ok(await correctTransactionCustomerCommand(ctx, args));
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
    approvalProofId: v.optional(v.id("approvalProof")),
    transactionId: v.id("posTransaction"),
    paymentMethod: v.string(),
    reason: v.string(),
    actorUserId: v.optional(v.id("athenaUser")),
    actorStaffProfileId: v.optional(v.id("staffProfile")),
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
      const result = await correctTransactionPaymentMethodCommand(ctx, args);

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
  handler: async (ctx, args) => getRecentTransactionsWithCustomersQuery(ctx, args),
});

export const getTodaySummary = query({
  args: {
    storeId: v.id("store"),
  },
  returns: v.object({
    totalTransactions: v.number(),
    totalSales: v.number(),
    totalItemsSold: v.number(),
    averageTransaction: v.number(),
    date: v.string(),
  }),
  handler: async (ctx, args) => getTodaySummaryQuery(ctx, args),
});
