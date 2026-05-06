import { v } from "convex/values";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { action, query } from "../_generated/server";
import { commandResultValidator } from "../lib/commandResultValidators";
import { ok, userError } from "../../shared/commandResult";
import { getTransactionById as getTransactionByIdQuery } from "../pos/application/queries/getTransactions";
import { buildReceiptShareUrl, getWhatsAppReceiptConfig } from "./whatsappConfig";
import { sendWhatsAppReceiptTemplate } from "./whatsappClient";
import { maskReceiptPhone, normalizeReceiptPhone } from "./domain";
import { resolveReceiptShareToken } from "./repository";

const customerMessagingInternal = (internal as any).customerMessaging.internal;

type PosReceiptTransaction = NonNullable<
  Awaited<ReturnType<typeof getTransactionByIdQuery>>
>;
type PosReceiptMessagingContext = {
  transactionId: Id<"posTransaction">;
  storeId: Id<"store">;
  storeName: string;
  transactionNumber: string;
  status: string;
  customerProfilePhone?: string;
  saleCustomerPhone?: string;
};

export function toPublicReceiptTransaction(transaction: PosReceiptTransaction) {
  return {
    transactionNumber: transaction.transactionNumber,
    subtotal: transaction.subtotal,
    tax: transaction.tax,
    total: transaction.total,
    registerNumber: transaction.registerNumber,
    paymentMethod: transaction.paymentMethod,
    payments: transaction.payments,
    totalPaid: transaction.totalPaid,
    changeGiven: transaction.changeGiven,
    status: transaction.status,
    completedAt: transaction.completedAt,
    cashier: null,
    items: transaction.items.map((item) => ({
      productName: item.productName,
      productSku: item.productSku,
      barcode: item.barcode,
      image: item.image,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      totalPrice: item.totalPrice,
      discount: item.discount,
      discountReason: item.discountReason,
    })),
  };
}

function resolveRecipient(args: {
  overridePhone?: string;
  customerProfilePhone?: string;
  saleCustomerPhone?: string;
}) {
  const overridePhone = normalizeReceiptPhone(args.overridePhone);
  if (overridePhone) {
    return {
      source: "one_time_override" as const,
      phone: overridePhone,
      display: maskReceiptPhone(overridePhone),
    };
  }

  const customerProfilePhone = normalizeReceiptPhone(args.customerProfilePhone);
  if (customerProfilePhone) {
    return {
      source: "customer_profile" as const,
      phone: customerProfilePhone,
      display: maskReceiptPhone(customerProfilePhone),
    };
  }

  const saleCustomerPhone = normalizeReceiptPhone(args.saleCustomerPhone);
  if (saleCustomerPhone) {
    return {
      source: "sale_customer_info" as const,
      phone: saleCustomerPhone,
      display: maskReceiptPhone(saleCustomerPhone),
    };
  }

  return null;
}

export const getReceiptByShareToken = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const shareToken = await resolveReceiptShareToken(ctx, args);
    if (!shareToken) {
      return null;
    }

    const transaction = await getTransactionByIdQuery(ctx, {
      transactionId: shareToken.transactionId,
    });

    return transaction ? toPublicReceiptTransaction(transaction) : null;
  },
});

export const sendPosReceiptLink = action({
  args: {
    transactionId: v.id("posTransaction"),
    recipientPhone: v.optional(v.string()),
    actorStaffProfileId: v.optional(v.id("staffProfile")),
  },
  returns: commandResultValidator(
    v.object({
      deliveryId: v.id("customerMessageDelivery"),
      receiptShareTokenId: v.id("receiptShareToken"),
      recipientDisplay: v.string(),
      providerMessageId: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const overrideRecipientPhone = args.recipientPhone?.trim()
      ? args.recipientPhone
      : undefined;
    let context: PosReceiptMessagingContext | null;
    try {
      context = await ctx.runQuery(
        customerMessagingInternal.getPosReceiptMessagingContext,
        {
          transactionId: args.transactionId,
          actorStaffProfileId: args.actorStaffProfileId,
        },
      ) as PosReceiptMessagingContext | null;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "You cannot send this receipt.";
      const authenticationFailed = message.includes("Sign in");

      return userError({
        code: authenticationFailed
          ? "authentication_failed"
          : "authorization_failed",
        message,
      });
    }

    if (!context) {
      return userError({
        code: "not_found",
        message: "Transaction not found.",
      });
    }

    if (context.status !== "completed") {
      return userError({
        code: "precondition_failed",
        message: "Only completed transactions can have receipt links sent.",
      });
    }

    const recipient = resolveRecipient({
      overridePhone: overrideRecipientPhone,
      customerProfilePhone: context.customerProfilePhone,
      saleCustomerPhone: context.saleCustomerPhone,
    });

    if (!recipient) {
      return userError({
        code: "validation_failed",
        message: "Add a WhatsApp number before sending this receipt.",
      });
    }

    let config;
    try {
      config = getWhatsAppReceiptConfig();
    } catch {
      return userError({
        code: "unavailable",
        message: "WhatsApp receipt sending is not configured.",
      });
    }

    const share = await ctx.runMutation(
      customerMessagingInternal.createReceiptShare,
      {
        storeId: context.storeId,
        transactionId: context.transactionId,
        actorStaffProfileId: args.actorStaffProfileId,
      },
    ) as {
      token: string;
      tokenId: Id<"receiptShareToken">;
      reused: boolean;
    };

    const deliveryId = await ctx.runMutation(
      customerMessagingInternal.createDeliveryAttempt,
      {
        storeId: context.storeId,
        transactionId: context.transactionId,
        receiptShareTokenId: share.tokenId,
        recipientSource: recipient.source,
        recipientPhone: recipient.phone,
        recipientDisplay: recipient.display,
        actorStaffProfileId: args.actorStaffProfileId,
      },
    ) as Id<"customerMessageDelivery">;
    const receiptUrl = buildReceiptShareUrl(config, share.token);
    let providerResult;
    try {
      providerResult = await sendWhatsAppReceiptTemplate(config, {
        to: recipient.phone,
        storeName: context.storeName,
        transactionNumber: context.transactionNumber,
        receiptUrl,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "WhatsApp receipt sending failed.";
      await ctx.runMutation(
        customerMessagingInternal.markDeliveryFailed,
        {
          deliveryId,
          failureCategory: "provider",
          failureMessage: message,
        },
      );

      return userError({
        code: "unavailable",
        message,
        retryable: true,
      });
    }

    if (!providerResult.ok) {
      await ctx.runMutation(
        customerMessagingInternal.markDeliveryFailed,
        {
          deliveryId,
          failureCategory: providerResult.category,
          failureMessage: providerResult.message,
        },
      );

      return userError({
        code: providerResult.category === "rate_limited" ? "rate_limited" : "unavailable",
        message: providerResult.message,
        retryable:
          providerResult.category === "rate_limited" ||
          providerResult.category === "provider",
      });
    }

    await ctx.runMutation(customerMessagingInternal.markDeliverySent, {
      deliveryId,
      providerMessageId: providerResult.providerMessageId,
    });

    return ok({
      deliveryId,
      receiptShareTokenId: share.tokenId,
      recipientDisplay: recipient.display,
      providerMessageId: providerResult.providerMessageId,
    });
  },
});
