import { v } from "convex/values";

import { internalMutation, internalQuery } from "../_generated/server";
import {
  createOrReuseReceiptShareToken,
  createReceiptDeliveryAttempt,
  markReceiptDeliveryFailed,
  markReceiptDeliveryProviderAccepted,
  updateDeliveryByProviderMessageId,
} from "./repository";
import {
  requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx,
} from "../lib/athenaUserAuth";

export const getPosReceiptMessagingContext = internalQuery({
  args: {
    transactionId: v.id("posTransaction"),
    actorStaffProfileId: v.optional(v.id("staffProfile")),
  },
  handler: async (ctx, args) => {
    const transaction = await ctx.db.get("posTransaction", args.transactionId);
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
      failureMessage: "You do not have access to send receipts for this store.",
      organizationId: store.organizationId,
      userId: athenaUser._id,
    });

    if (args.actorStaffProfileId) {
      const actorStaffProfile = await ctx.db.get(
        "staffProfile",
        args.actorStaffProfileId,
      );

      if (
        !actorStaffProfile ||
        actorStaffProfile.storeId !== transaction.storeId ||
        actorStaffProfile.status !== "active"
      ) {
        throw new Error("Select an active staff profile before sending receipts.");
      }
    }

    const customerProfile = transaction.customerProfileId
      ? await ctx.db.get("customerProfile", transaction.customerProfileId)
      : null;

    return {
      transactionId: transaction._id,
      storeId: transaction.storeId,
      storeName: store.name,
      transactionNumber: transaction.transactionNumber,
      status: transaction.status,
      customerProfilePhone: customerProfile?.phoneNumber,
      saleCustomerPhone: transaction.customerInfo?.phone,
    };
  },
});

export const createReceiptShare = internalMutation({
  args: {
    storeId: v.id("store"),
    transactionId: v.id("posTransaction"),
    actorStaffProfileId: v.optional(v.id("staffProfile")),
  },
  handler: async (ctx, args) => createOrReuseReceiptShareToken(ctx, args),
});

export const createDeliveryAttempt = internalMutation({
  args: {
    storeId: v.id("store"),
    transactionId: v.id("posTransaction"),
    receiptShareTokenId: v.id("receiptShareToken"),
    recipientSource: v.union(
      v.literal("customer_profile"),
      v.literal("sale_customer_info"),
      v.literal("one_time_override"),
    ),
    recipientPhone: v.string(),
    recipientDisplay: v.string(),
    actorStaffProfileId: v.optional(v.id("staffProfile")),
  },
  handler: async (ctx, args) =>
    createReceiptDeliveryAttempt(ctx, {
      storeId: args.storeId,
      transactionId: args.transactionId,
      receiptShareTokenId: args.receiptShareTokenId,
      recipient: {
        source: args.recipientSource,
        phone: args.recipientPhone,
        display: args.recipientDisplay,
      },
      actorStaffProfileId: args.actorStaffProfileId,
    }),
});

export const markDeliverySent = internalMutation({
  args: {
    deliveryId: v.id("customerMessageDelivery"),
    providerMessageId: v.string(),
  },
  handler: async (ctx, args) =>
    markReceiptDeliveryProviderAccepted(ctx, args),
});

export const markDeliveryFailed = internalMutation({
  args: {
    deliveryId: v.id("customerMessageDelivery"),
    failureCategory: v.string(),
    failureMessage: v.string(),
  },
  handler: async (ctx, args) => markReceiptDeliveryFailed(ctx, args),
});

export const updateWebhookStatus = internalMutation({
  args: {
    providerMessageId: v.string(),
    status: v.union(
      v.literal("sent"),
      v.literal("delivered"),
      v.literal("read"),
      v.literal("failed"),
      v.literal("unknown"),
    ),
    providerStatus: v.optional(v.string()),
  },
  handler: async (ctx, args) => updateDeliveryByProviderMessageId(ctx, args),
});
