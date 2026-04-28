import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import {
  runRemoveExpenseSessionItemCommand,
  runUpsertExpenseSessionItemCommand,
} from "../pos/application/commands/expenseSessionCommands";
import {
  expenseItemOperationResultValidator,
  operationResultValidator,
} from "./helpers/resultTypes";
import { commandResultValidator } from "../lib/commandResultValidators";
import { ok, userError } from "../../shared/commandResult";

function userErrorFromExpenseItemCommandFailure(result: {
  status: string;
  message: string;
}) {
  switch (result.status) {
    case "notFound":
      return userError({
        code: "not_found",
        message: result.message,
      });
    case "cashierMismatch":
      return userError({
        code: "authorization_failed",
        message: result.message,
      });
    case "inventoryUnavailable":
    case "terminalUnavailable":
      return userError({
        code: "conflict",
        message: result.message,
      });
    case "validationFailed":
      return userError({
        code: "validation_failed",
        message: result.message,
      });
    default:
      return userError({
        code: "precondition_failed",
        message: result.message,
      });
  }
}

// Get all items for an expense session
export const getExpenseSessionItems = query({
  args: { sessionId: v.id("expenseSession") },
  returns: v.array(
    v.object({
      _id: v.id("expenseSessionItem"),
      _creationTime: v.number(),
      sessionId: v.id("expenseSession"),
      storeId: v.id("store"),
      productId: v.id("product"),
      productSkuId: v.id("productSku"),
      productSku: v.string(),
      barcode: v.optional(v.string()),
      productName: v.string(),
      price: v.number(),
      quantity: v.number(),
      image: v.optional(v.string()),
      size: v.optional(v.string()),
      length: v.optional(v.number()),
      color: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    // Expense session carts stay small enough to read in full for a single session.
    // eslint-disable-next-line @convex-dev/no-collect-in-query
    const items = await ctx.db
      .query("expenseSessionItem")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    return items;
  },
});

// Add or update an item in the expense session
export const addOrUpdateExpenseItem = mutation({
  args: {
    sessionId: v.id("expenseSession"),
    productId: v.id("product"),
    productSkuId: v.id("productSku"),
    staffProfileId: v.id("staffProfile"),
    productSku: v.string(),
    barcode: v.optional(v.string()),
    productName: v.string(),
    price: v.number(),
    quantity: v.number(),
    image: v.optional(v.string()),
    size: v.optional(v.string()),
    length: v.optional(v.number()),
    color: v.optional(v.string()),
  },
  returns: commandResultValidator(expenseItemOperationResultValidator),
  handler: async (ctx, args) => {
    const result = await runUpsertExpenseSessionItemCommand(ctx, args);

    if (result.status === "ok") {
      return ok(result.data);
    }

    return userErrorFromExpenseItemCommandFailure(result);
  },
});

// Remove an item from the expense session
export const removeExpenseItem = mutation({
  args: {
    sessionId: v.id("expenseSession"),
    staffProfileId: v.id("staffProfile"),
    itemId: v.id("expenseSessionItem"),
  },
  returns: commandResultValidator(operationResultValidator),
  handler: async (ctx, args) => {
    const result = await runRemoveExpenseSessionItemCommand(ctx, args);

    if (result.status === "ok") {
      return ok(result.data);
    }

    return userErrorFromExpenseItemCommandFailure(result);
  },
});
