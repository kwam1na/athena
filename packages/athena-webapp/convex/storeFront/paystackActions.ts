import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { listTransactions, verifyTransaction } from "../paystack";

/**
 * Action to fetch all transactions from Paystack
 */
export const getAllTransactions = action({
  args: {
    perPage: v.optional(v.number()),
    page: v.optional(v.number()),
    status: v.optional(
      v.union(
        v.literal("failed"),
        v.literal("success"),
        v.literal("abandoned"),
        v.literal("pending")
      )
    ),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    customerEmail: v.optional(v.string()),
    createdAfter: v.optional(v.number()),
    sameDay: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    try {
      const transactions = await listTransactions({
        perPage: args.perPage,
        page: args.page,
        status: args.status,
        from: args.from,
        to: args.to,
        customerEmail: args.customerEmail,
        createdAfter: args.createdAfter,
        sameDay: args.sameDay,
      });

      return {
        success: true,
        data: transactions.data,
        message: "Transactions fetched successfully",
      };
    } catch (error) {
      console.error("Error fetching transactions:", error);
      return {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to fetch transactions",
      };
    }
  },
});

/**
 * Action to verify a transaction status
 */
export const checkTransactionStatus = action({
  args: {
    reference: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      const verificationResult = await verifyTransaction(args.reference);

      return {
        success: true,
        data: verificationResult.data,
        message: "Transaction verification successful",
      };
    } catch (error) {
      console.error("Error verifying transaction:", error);
      return {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to verify transaction",
      };
    }
  },
});

/**
 * Action to find transactions related to an order
 */
export const findOrderTransactions = action({
  args: {
    customerEmail: v.string(),
    orderCreatedAt: v.number(),
    // Optional time buffer in milliseconds (no longer used with sameDay filtering)
    timeBuffer: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    try {
      // Now we use sameDay parameter instead of createdAfter
      const transactions = await listTransactions({
        customerEmail: args.customerEmail,
        sameDay: args.orderCreatedAt,
        status: "success",
      });

      return {
        success: true,
        data: transactions.data,
        message: "Order transactions fetched successfully",
      };
    } catch (error) {
      console.error("Error fetching order transactions:", error);
      return {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to fetch order transactions",
      };
    }
  },
});
