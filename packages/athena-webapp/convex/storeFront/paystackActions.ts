import { v } from "convex/values";
import { action } from "../_generated/server";
import { listTransactions, verifyTransaction } from "../paystack";
import {
  checkTransactionStatusOperationDefinition,
  findOrderTransactionsOperationDefinition,
  getAllTransactionsOperationDefinition,
} from "../operationAdmission/domains/storefrontCustomer_definitions";
import { admitPublicAction } from "../platform/operationAdmission";

/**
 * All three actions read the live Paystack ledger.
 *
 * Each carried `requireAuthenticatedNonDemoEffect` as its first statement —
 * "an identity is required and a demo principal is refused". The successor is
 * the definition: `normalUser: "admit"` with `public: "deny"` demands the
 * identity, `sharedDemo: "deny"` refuses the demo, and the declared
 * `payment.collect` gateway states why. Admission now runs before the provider
 * call rather than inside the handler after it.
 */

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
  handler: admitPublicAction(
    getAllTransactionsOperationDefinition,
    async (
      _ctx,
      args: {
        perPage?: number;
        page?: number;
        status?: "failed" | "success" | "abandoned" | "pending";
        from?: string;
        to?: string;
        customerEmail?: string;
        createdAfter?: number;
        sameDay?: number;
      },
    ) => {
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
  ),
});

/**
 * Action to verify a transaction status
 */
export const checkTransactionStatus = action({
  args: {
    reference: v.string(),
  },
  handler: admitPublicAction(
    checkTransactionStatusOperationDefinition,
    async (_ctx, args: { reference: string }) => {
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
  ),
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
  handler: admitPublicAction(
    findOrderTransactionsOperationDefinition,
    async (
      _ctx,
      args: {
        customerEmail: string;
        orderCreatedAt: number;
        timeBuffer?: number;
      },
    ) => {
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
  ),
});
