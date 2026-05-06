import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  CUSTOMER_MESSAGE_CHANNEL_WHATSAPP_BUSINESS,
  CUSTOMER_MESSAGE_INTENT_POS_RECEIPT_LINK,
  CUSTOMER_MESSAGE_SUBJECT_POS_TRANSACTION,
  type CustomerMessageDeliveryStatus,
  type ReceiptRecipient,
} from "./domain";
import { createReceiptShareToken, hashReceiptShareToken } from "./token";

const RECEIPT_SHARE_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export async function createOrReuseReceiptShareToken(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    transactionId: Id<"posTransaction">;
    actorStaffProfileId?: Id<"staffProfile">;
    now?: number;
  },
) {
  const now = args.now ?? Date.now();
  const existing = await ctx.db
    .query("receiptShareToken")
    .withIndex("by_transactionId_status", (q) =>
      q.eq("transactionId", args.transactionId).eq("status", "active"),
    )
    .first();

  const token = createReceiptShareToken();
  const tokenHash = await hashReceiptShareToken(token);
  const tokenId = await ctx.db.insert("receiptShareToken", {
    storeId: args.storeId,
    transactionId: args.transactionId,
    tokenHash,
    status: "active",
    createdByStaffProfileId: args.actorStaffProfileId,
    createdAt: now,
    expiresAt: now + RECEIPT_SHARE_TTL_MS,
  });

  return { token, tokenId, reused: Boolean(existing) };
}

export async function resolveReceiptShareToken(
  ctx: QueryCtx,
  args: {
    token: string;
    now?: number;
  },
) {
  const tokenHash = await hashReceiptShareToken(args.token);
  const shareToken = await ctx.db
    .query("receiptShareToken")
    .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
    .first();
  const now = args.now ?? Date.now();

  if (!shareToken || shareToken.status !== "active" || shareToken.expiresAt <= now) {
    return null;
  }

  return shareToken;
}

export async function createReceiptDeliveryAttempt(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    transactionId: Id<"posTransaction">;
    receiptShareTokenId: Id<"receiptShareToken">;
    recipient: ReceiptRecipient;
    actorStaffProfileId?: Id<"staffProfile">;
    now?: number;
  },
) {
  const now = args.now ?? Date.now();

  return ctx.db.insert("customerMessageDelivery", {
    storeId: args.storeId,
    subjectType: CUSTOMER_MESSAGE_SUBJECT_POS_TRANSACTION,
    subjectId: args.transactionId,
    intent: CUSTOMER_MESSAGE_INTENT_POS_RECEIPT_LINK,
    channel: CUSTOMER_MESSAGE_CHANNEL_WHATSAPP_BUSINESS,
    receiptShareTokenId: args.receiptShareTokenId,
    recipientSource: args.recipient.source,
    recipientDisplay: args.recipient.display,
    recipientPhone:
      args.recipient.source === "one_time_override"
        ? args.recipient.phone
        : undefined,
    status: "pending",
    actorStaffProfileId: args.actorStaffProfileId,
    createdAt: now,
    updatedAt: now,
  });
}

export async function markReceiptDeliveryProviderAccepted(
  ctx: MutationCtx,
  args: {
    deliveryId: Id<"customerMessageDelivery">;
    providerMessageId: string;
    now?: number;
  },
) {
  const now = args.now ?? Date.now();
  await ctx.db.patch("customerMessageDelivery", args.deliveryId, {
    providerMessageId: args.providerMessageId,
    providerStatus: "accepted",
    status: "sent",
    sentAt: now,
    updatedAt: now,
  });
}

export async function markReceiptDeliveryFailed(
  ctx: MutationCtx,
  args: {
    deliveryId: Id<"customerMessageDelivery">;
    failureCategory: string;
    failureMessage: string;
    now?: number;
  },
) {
  const now = args.now ?? Date.now();
  await ctx.db.patch("customerMessageDelivery", args.deliveryId, {
    status: "failed",
    providerStatus: "failed",
    failureCategory: args.failureCategory,
    failureMessage: args.failureMessage,
    failedAt: now,
    updatedAt: now,
  });
}

export async function updateDeliveryByProviderMessageId(
  ctx: MutationCtx,
  args: {
    providerMessageId: string;
    status: CustomerMessageDeliveryStatus;
    providerStatus?: string;
    now?: number;
  },
) {
  const delivery = await ctx.db
    .query("customerMessageDelivery")
    .withIndex("by_providerMessageId", (q) =>
      q.eq("providerMessageId", args.providerMessageId),
    )
    .first();

  if (!delivery) {
    return null;
  }

  const now = args.now ?? Date.now();
  await ctx.db.patch("customerMessageDelivery", delivery._id, {
    status: args.status,
    providerStatus: args.providerStatus ?? args.status,
    deliveredAt: args.status === "delivered" ? now : delivery.deliveredAt,
    readAt: args.status === "read" ? now : delivery.readAt,
    failedAt: args.status === "failed" ? now : delivery.failedAt,
    updatedAt: now,
  });

  return delivery._id;
}

export async function listReceiptDeliveriesForTransaction(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    transactionId: Id<"posTransaction">;
  },
) {
  // eslint-disable-next-line @convex-dev/no-collect-in-query -- Transaction detail renders the compact delivery history for one receipt subject.
  const deliveries = await ctx.db
    .query("customerMessageDelivery")
    .withIndex("by_storeId_subject", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("subjectType", CUSTOMER_MESSAGE_SUBJECT_POS_TRANSACTION)
        .eq("subjectId", args.transactionId),
    )
    .collect();

  return deliveries
    .filter(
      (delivery) =>
        delivery.intent === CUSTOMER_MESSAGE_INTENT_POS_RECEIPT_LINK &&
        delivery.channel === CUSTOMER_MESSAGE_CHANNEL_WHATSAPP_BUSINESS,
    )
    .sort((a, b) => b.createdAt - a.createdAt);
}
