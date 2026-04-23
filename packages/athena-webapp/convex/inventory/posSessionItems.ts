import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import {
  runRemoveSessionItemCommand,
  runUpsertSessionItemCommand,
} from "../pos/application/commands/sessionCommands";
import { collectSessionItemsFromPages } from "../pos/infrastructure/repositories/sessionCommandRepository";
import { commandResultValidator } from "../lib/commandResultValidators";
import { ok, userError } from "../../shared/commandResult";

const SESSION_ITEMS_PAGE_SIZE = 200;

const itemOperationDataValidator = v.object({
  itemId: v.id("posSessionItem"),
  expiresAt: v.number(),
});

const operationDataValidator = v.object({
  expiresAt: v.number(),
});

function userErrorFromSessionItemFailure(result: { status: string; message: string }) {
  switch (result.status) {
    case "notFound":
      return userError({
        code: "not_found",
        message: result.message,
      });
    case "inventoryUnavailable":
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

// Get all items for a session
export const getSessionItems = query({
  args: { sessionId: v.id("posSession") },
  returns: v.array(
    v.object({
      _id: v.id("posSessionItem"),
      _creationTime: v.number(),
      sessionId: v.id("posSession"),
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
      areProcessingFeesAbsorbed: v.optional(v.boolean()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const items = await collectSessionItemsFromPages((cursor) =>
      ctx.db
        .query("posSessionItem")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
        .paginate({
          cursor,
          numItems: SESSION_ITEMS_PAGE_SIZE,
        }),
    );

    return items;
  },
});

// Add or update an item in the session
export const addOrUpdateItem = mutation({
  args: {
    sessionId: v.id("posSession"),
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
    areProcessingFeesAbsorbed: v.optional(v.boolean()),
  },
  returns: commandResultValidator(itemOperationDataValidator),
  handler: async (ctx, args) => {
    const result = await runUpsertSessionItemCommand(ctx, args);

    if (result.status === "ok") {
      return ok(result.data);
    }

    return userErrorFromSessionItemFailure(result);
  },
});

// Remove an item from the session
export const removeItem = mutation({
  args: {
    sessionId: v.id("posSession"),
    staffProfileId: v.id("staffProfile"),
    itemId: v.id("posSessionItem"),
  },
  returns: commandResultValidator(operationDataValidator),
  handler: async (ctx, args) => {
    const result = await runRemoveSessionItemCommand(ctx, args);

    if (result.status === "ok") {
      return ok(result.data);
    }

    return userErrorFromSessionItemFailure(result);
  },
});
