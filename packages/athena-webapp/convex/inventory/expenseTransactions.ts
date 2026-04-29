import {
  mutation,
  query,
  internalMutation,
  type MutationCtx,
} from "../_generated/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { capitalizeWords, generateTransactionNumber } from "../utils";
import { commandResultValidator } from "../lib/commandResultValidators";
import { ok, userError } from "../../shared/commandResult";

const expenseTransactionCreationValidator = v.object({
  transactionId: v.id("expenseTransaction"),
  transactionNumber: v.string(),
});

const expenseTransactionIdValidator = v.object({
  transactionId: v.id("expenseTransaction"),
});

function expenseTransactionError(
  message: string,
  code:
    | "not_found"
    | "conflict"
    | "precondition_failed"
    | "validation_failed" = "precondition_failed",
) {
  return userError({
    code,
    message,
  });
}

export function formatExpenseStaffProfileName(
  staffProfile:
    | {
        firstName?: string;
        lastName?: string;
        fullName?: string;
      }
    | null
    | undefined,
) {
  if (!staffProfile) return null;

  if (staffProfile.firstName && staffProfile.lastName) {
    return `${staffProfile.firstName} ${staffProfile.lastName.charAt(0)}.`;
  }

  const fullNameParts = staffProfile.fullName?.trim().split(/\s+/) ?? [];
  if (fullNameParts.length >= 2) {
    const firstName = fullNameParts[0];
    const lastName = fullNameParts.at(-1);

    return `${firstName} ${lastName?.charAt(0)}.`;
  }

  return staffProfile.fullName?.trim() || null;
}

export async function createExpenseTransactionFromSessionHandler(
  ctx: MutationCtx,
  args: {
    sessionId: Id<"expenseSession">;
    notes?: string;
  },
) {
  const session = await ctx.db.get("expenseSession", args.sessionId);
  if (!session) {
    return expenseTransactionError("Expense session not found", "not_found");
  }

  // Query all items for this session from expenseSessionItem table
  // Expense session carts stay small enough to read in full for a single completion.
  // eslint-disable-next-line @convex-dev/no-collect-in-query
  const items = await ctx.db
    .query("expenseSessionItem")
    .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
    .collect();

  if (items.length === 0) {
    return expenseTransactionError(
      "Cannot complete expense session with no items",
      "precondition_failed",
    );
  }

  // Aggregate quantities by SKU to handle multiple items of the same product
  const skuQuantityMap = new Map<Id<"productSku">, number>();
  for (const item of items) {
    const currentQuantity = skuQuantityMap.get(item.productSkuId) || 0;
    skuQuantityMap.set(item.productSkuId, currentQuantity + item.quantity);
  }

  // Validate SKUs exist and update inventory
  for (const [skuId, totalQuantity] of skuQuantityMap) {
    const sku = await ctx.db.get("productSku", skuId);
    if (!sku) {
      return expenseTransactionError(
        `Product SKU ${skuId} not found`,
        "not_found",
      );
    }

    // Type guard to ensure we have a productSku
    if (!("inventoryCount" in sku) || !("sku" in sku)) {
      return expenseTransactionError(
        `Invalid product SKU data for ${skuId}`,
        "validation_failed",
      );
    }

    // Check inventoryCount (actual stock) is sufficient
    if (sku.inventoryCount < totalQuantity) {
      const item = items.find((entry) => entry.productSkuId === skuId);
      const itemName = item?.productName || "Unknown Product";
      return expenseTransactionError(
        `Insufficient inventory for ${capitalizeWords(itemName)} (${sku.sku}). In Stock: ${sku.inventoryCount}, Needed: ${totalQuantity}`,
        "conflict",
      );
    }

    // Update inventory
    // Note: quantityAvailable was already reduced when item was added to session (hold)
    // Now we only need to reduce inventoryCount (actual stock)
    await ctx.db.patch("productSku", skuId, {
      inventoryCount: Math.max(0, sku.inventoryCount - totalQuantity),
    });
  }

  // Calculate total value from items (cost price * quantity)
  const totalValue = items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );

  // Generate transaction number
  const transactionNumber = generateTransactionNumber();

  // Create the expense transaction
  const transactionId = await ctx.db.insert("expenseTransaction", {
    transactionNumber,
    storeId: session.storeId,
    sessionId: args.sessionId,
    staffProfileId: session.staffProfileId,
    registerNumber: session.registerNumber,
    totalValue,
    status: "completed",
    completedAt: Date.now(),
    notes: args.notes,
  });

  // Create transaction items
  await Promise.all(
    items.map(async (item) => {
      // Get product details for image and color
      const sku = await ctx.db.get("productSku", item.productSkuId);
      const image = item.image ?? sku?.images?.[0];

      // Get color from SKU if available
      let colorName: string | undefined;
      if (sku?.color) {
        const color = await ctx.db.get("color", sku.color);
        colorName = color?.name;
      }
      // Fallback to color from session item if available
      const color = colorName ?? item.color;

      await ctx.db.insert("expenseTransactionItem", {
        transactionId,
        productId: item.productId,
        productSkuId: item.productSkuId,
        productName: item.productName,
        productSku: item.productSku ?? "",
        quantity: item.quantity,
        costPrice: item.price,
        ...(image ? { image } : {}),
        ...(item.size ? { size: item.size } : {}),
        ...(item.length ? { length: item.length } : {}),
        ...(color ? { color } : {}),
      });
    }),
  );

  return ok({
    transactionId,
    transactionNumber,
  });
}

// Create expense transaction from expense session
export const createTransactionFromSession = internalMutation({
  args: {
    sessionId: v.id("expenseSession"),
    notes: v.optional(v.string()),
  },
  returns: commandResultValidator(expenseTransactionCreationValidator),
  handler: async (ctx, args) =>
    createExpenseTransactionFromSessionHandler(ctx, args),
});

// Get expense transactions for a store
export const getExpenseTransactions = query({
  args: {
    storeId: v.id("store"),
    staffProfileId: v.optional(v.id("staffProfile")),
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("expenseTransaction"),
      _creationTime: v.number(),
      transactionNumber: v.string(),
      storeId: v.id("store"),
      sessionId: v.id("expenseSession"),
      staffProfileId: v.id("staffProfile"),
      staffProfileName: v.union(v.string(), v.null()),
      registerNumber: v.optional(v.string()),
      totalValue: v.number(),
      status: v.string(),
      completedAt: v.number(),
      notes: v.optional(v.string()),
      voidedAt: v.optional(v.number()),
      itemCount: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const { storeId, status, limit = 50 } = args;

    let transactionsQuery = ctx.db
      .query("expenseTransaction")
      .withIndex("by_storeId", (q) => q.eq("storeId", storeId));

    if (status) {
      transactionsQuery = ctx.db
        .query("expenseTransaction")
        .withIndex("by_status", (q) => q.eq("status", status));
    }

    let transactions = await transactionsQuery.order("desc").take(limit);

    if (args.staffProfileId) {
      transactions = transactions.filter(
        (transaction) => transaction.staffProfileId === args.staffProfileId,
      );
    }

    // Enrich with staff profile name and item count
    const enrichedTransactions = await Promise.all(
      transactions.map(async (transaction) => {
        const staffProfile = await ctx.db.get(
          "staffProfile",
          transaction.staffProfileId,
        );
        const staffProfileName = formatExpenseStaffProfileName(staffProfile);

        // Individual transactions have a bounded item count, so reading all items is safe here.
        // eslint-disable-next-line @convex-dev/no-collect-in-query
        const items = await ctx.db
          .query("expenseTransactionItem")
          .withIndex("by_transactionId", (q) =>
            q.eq("transactionId", transaction._id),
          )
          .collect();

        const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);

        return {
          ...transaction,
          staffProfileName,
          itemCount,
        };
      }),
    );

    return enrichedTransactions;
  },
});

// Get a specific expense transaction by ID
export const getExpenseTransactionById = query({
  args: { transactionId: v.id("expenseTransaction") },
  returns: v.union(
    v.object({
      _id: v.id("expenseTransaction"),
      _creationTime: v.number(),
      transactionNumber: v.string(),
      storeId: v.id("store"),
      sessionId: v.id("expenseSession"),
      staffProfileId: v.id("staffProfile"),
      staffProfile: v.union(
        v.null(),
        v.object({
          _id: v.id("staffProfile"),
          fullName: v.string(),
          firstName: v.optional(v.string()),
          lastName: v.optional(v.string()),
        }),
      ),
      registerNumber: v.optional(v.string()),
      totalValue: v.number(),
      status: v.string(),
      completedAt: v.number(),
      notes: v.optional(v.string()),
      voidedAt: v.optional(v.number()),
      items: v.array(v.any()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const transaction = await ctx.db.get(
      "expenseTransaction",
      args.transactionId,
    );
    if (!transaction) return null;

    // Get staff profile information
    const staffProfile = await ctx.db.get(
      "staffProfile",
      transaction.staffProfileId,
    );

    // Get transaction items
    // Individual transactions have a bounded item count, so reading all items is safe here.
    // eslint-disable-next-line @convex-dev/no-collect-in-query
    const items = await ctx.db
      .query("expenseTransactionItem")
      .withIndex("by_transactionId", (q) =>
        q.eq("transactionId", transaction._id),
      )
      .collect();

    return {
      ...transaction,
      staffProfile: staffProfile
        ? {
            _id: staffProfile._id,
            fullName: staffProfile.fullName,
            firstName: staffProfile.firstName,
            lastName: staffProfile.lastName,
          }
        : null,
      items,
    };
  },
});

// Void an expense transaction
export const voidExpenseTransaction = mutation({
  args: {
    transactionId: v.id("expenseTransaction"),
    voidReason: v.optional(v.string()),
  },
  returns: commandResultValidator(expenseTransactionIdValidator),
  handler: async (ctx, args) => {
    const transaction = await ctx.db.get(
      "expenseTransaction",
      args.transactionId,
    );
    if (!transaction) {
      return expenseTransactionError("Transaction not found", "not_found");
    }

    if (transaction.status !== "completed") {
      return expenseTransactionError(
        "Can only void completed transactions",
        "precondition_failed",
      );
    }

    // Get transaction items to restore inventory
    // Individual transactions have a bounded item count, so reading all items is safe here.
    // eslint-disable-next-line @convex-dev/no-collect-in-query
    const items = await ctx.db
      .query("expenseTransactionItem")
      .withIndex("by_transactionId", (q) =>
        q.eq("transactionId", transaction._id),
      )
      .collect();

    // Restore inventory for each item
    for (const item of items) {
      const sku = await ctx.db.get("productSku", item.productSkuId);
      if (sku) {
        await ctx.db.patch("productSku", item.productSkuId, {
          inventoryCount: (sku.inventoryCount || 0) + item.quantity,
          quantityAvailable: (sku.quantityAvailable || 0) + item.quantity,
        });
      }
    }

    // Mark transaction as void
    await ctx.db.patch("expenseTransaction", args.transactionId, {
      status: "void",
      voidedAt: Date.now(),
      notes: args.voidReason,
    });

    return ok({ transactionId: args.transactionId });
  },
});
