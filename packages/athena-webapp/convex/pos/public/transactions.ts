import { v } from "convex/values";

import { mutation, query } from "../../_generated/server";
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
    customerId: v.optional(v.id("posCustomer")),
    customerInfo: v.optional(customerInfoValidator),
    registerNumber: v.optional(v.string()),
    terminalId: v.optional(v.id("posTerminal")),
    cashierId: v.optional(v.id("cashier")),
    registerSessionId: v.optional(v.id("registerSession")),
  },
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
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("posTransaction"),
      transactionNumber: v.string(),
      total: v.number(),
      paymentMethod: v.union(v.string(), v.null()),
      completedAt: v.number(),
      cashierName: v.union(v.string(), v.null()),
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
          _id: v.id("cashier"),
          firstName: v.string(),
          lastName: v.string(),
        }),
      ),
      customer: v.union(
        v.null(),
        v.object({
          _id: v.optional(v.id("posCustomer")),
          name: v.optional(v.string()),
          email: v.optional(v.string()),
          phone: v.optional(v.string()),
        }),
      ),
      customerInfo: v.optional(customerInfoValidator),
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
    cashierId: v.optional(v.id("cashier")),
  },
  handler: async (ctx, args) => voidTransactionCommand(ctx, args),
});

export const createTransactionFromSession = mutation({
  args: {
    sessionId: v.id("posSession"),
    payments: v.array(paymentValidator),
    registerSessionId: v.optional(v.id("registerSession")),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => createTransactionFromSessionHandler(ctx, args),
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
      customerId: v.optional(v.id("posCustomer")),
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
