import type { Id } from "../_generated/dataModel";

export const CUSTOMER_MESSAGE_INTENT_POS_RECEIPT_LINK = "pos_receipt_link";
export const CUSTOMER_MESSAGE_CHANNEL_WHATSAPP_BUSINESS = "whatsapp_business";
export const CUSTOMER_MESSAGE_SUBJECT_POS_TRANSACTION = "pos_transaction";

export type CustomerMessageIntent =
  typeof CUSTOMER_MESSAGE_INTENT_POS_RECEIPT_LINK;
export type CustomerMessageChannel =
  typeof CUSTOMER_MESSAGE_CHANNEL_WHATSAPP_BUSINESS;
export type CustomerMessageSubjectType =
  typeof CUSTOMER_MESSAGE_SUBJECT_POS_TRANSACTION;

export type CustomerMessageDeliveryStatus =
  | "pending"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "unknown";

export type ReceiptRecipientSource =
  | "customer_profile"
  | "sale_customer_info"
  | "one_time_override";

export type ReceiptRecipient = {
  source: ReceiptRecipientSource;
  phone: string;
  display: string;
};

export type ReceiptDeliverySummary = {
  _id: Id<"customerMessageDelivery">;
  status: CustomerMessageDeliveryStatus;
  providerStatus?: string;
  recipientSource: ReceiptRecipientSource;
  recipientDisplay: string;
  actorStaffProfileId?: Id<"staffProfile">;
  actorStaffName: string | null;
  createdAt: number;
  updatedAt: number;
  sentAt?: number;
  deliveredAt?: number;
  readAt?: number;
  failedAt?: number;
  failureCategory?: string;
  failureMessage?: string;
  retryable: boolean;
};

export function normalizeReceiptPhone(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) {
    return null;
  }

  return hasPlus ? `+${digits}` : digits;
}

export function maskReceiptPhone(value: string) {
  const normalized = normalizeReceiptPhone(value) ?? value;
  const prefix = normalized.startsWith("+") ? "+" : "";
  const digits = normalized.replace(/\D/g, "");

  if (digits.length <= 4) {
    return `${prefix}${digits}`;
  }

  return `${prefix}${"*".repeat(Math.max(digits.length - 4, 0))}${digits.slice(-4)}`;
}

export function statusIsRetryable(status: CustomerMessageDeliveryStatus) {
  return status === "failed" || status === "unknown";
}
