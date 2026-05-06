import {
  CUSTOMER_MESSAGE_CHANNEL_WHATSAPP_BUSINESS,
  CUSTOMER_MESSAGE_INTENT_POS_RECEIPT_LINK,
  type CustomerMessageChannel,
  type CustomerMessageIntent,
} from "./domain";

export function assertSupportedCustomerMessagePolicy(args: {
  intent: CustomerMessageIntent;
  channel: CustomerMessageChannel;
}) {
  if (
    args.intent !== CUSTOMER_MESSAGE_INTENT_POS_RECEIPT_LINK ||
    args.channel !== CUSTOMER_MESSAGE_CHANNEL_WHATSAPP_BUSINESS
  ) {
    throw new Error("Unsupported customer message intent or channel.");
  }
}
