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
import type { Id } from "../_generated/dataModel";
import {
  admitPublicMutation,
  admitPublicQuery,
} from "../platform/operationAdmission";
import {
  addOrUpdateExpenseItemOperationDefinition,
  removeExpenseItemOperationDefinition,
} from "../operationAdmission/domains/u4_inventoryIdentity_definitions";
import { getExpenseSessionItemsReadDefinition } from "../operationAdmission/domains/u4_inventoryIdentity_readDefinitions";
import type {
  OperationMutationCtx,
  OperationQueryCtx,
} from "../operationAdmission/types";

type UpsertExpenseItemArgs = {
  sessionId: Id<"expenseSession">;
  productId: Id<"product">;
  productSkuId: Id<"productSku">;
  pendingCheckoutItemId?: Id<"posPendingCheckoutItem">;
  inventoryImportProvisionalSkuId?: Id<"inventoryImportProvisionalSku">;
  staffProfileId: Id<"staffProfile">;
  productSku: string;
  barcode?: string;
  productName: string;
  price: number;
  quantity: number;
  image?: string;
  size?: string;
  length?: number;
  color?: string;
};

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
      pendingCheckoutItemId: v.optional(v.id("posPendingCheckoutItem")),
      inventoryImportProvisionalSkuId: v.optional(
        v.id("inventoryImportProvisionalSku"),
      ),
      inventoryHoldApplied: v.optional(v.boolean()),
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
  handler: admitPublicQuery(
    getExpenseSessionItemsReadDefinition,
    async (
      ctx: OperationQueryCtx,
      args: { sessionId: Id<"expenseSession"> },
    ) => {
      // Expense session carts stay small enough to read in full for a single session.
      // eslint-disable-next-line @convex-dev/no-collect-in-query
      const items = await ctx.db
        .query("expenseSessionItem")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
        .collect();

      return items;
    },
  ),
});

// Add or update an item in the expense session
export const addOrUpdateExpenseItem = mutation({
  args: {
    sessionId: v.id("expenseSession"),
    productId: v.id("product"),
    productSkuId: v.id("productSku"),
    pendingCheckoutItemId: v.optional(v.id("posPendingCheckoutItem")),
    inventoryImportProvisionalSkuId: v.optional(
      v.id("inventoryImportProvisionalSku"),
    ),
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
  handler: admitPublicMutation(
    addOrUpdateExpenseItemOperationDefinition,
    async (ctx: OperationMutationCtx, args: UpsertExpenseItemArgs) => {
      const result = await runUpsertExpenseSessionItemCommand(ctx, args);

      if (result.status === "ok") {
        return ok(result.data);
      }

      return userErrorFromExpenseItemCommandFailure(result);
    },
  ),
});

// Remove an item from the expense session
export const removeExpenseItem = mutation({
  args: {
    sessionId: v.id("expenseSession"),
    staffProfileId: v.id("staffProfile"),
    itemId: v.id("expenseSessionItem"),
  },
  returns: commandResultValidator(operationResultValidator),
  handler: admitPublicMutation(
    removeExpenseItemOperationDefinition,
    async (
      ctx: OperationMutationCtx,
      args: {
        sessionId: Id<"expenseSession">;
        staffProfileId: Id<"staffProfile">;
        itemId: Id<"expenseSessionItem">;
      },
    ) => {
      const result = await runRemoveExpenseSessionItemCommand(ctx, args);

      if (result.status === "ok") {
        return ok(result.data);
      }

      return userErrorFromExpenseItemCommandFailure(result);
    },
  ),
});
