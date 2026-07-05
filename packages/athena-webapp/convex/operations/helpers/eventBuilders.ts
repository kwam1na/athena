export function buildOperationalEventMessage(args: {
  eventType: string;
  subjectType: string;
  subjectLabel?: string;
}) {
  const subject = args.subjectLabel?.trim() || args.subjectType;
  const onlineOrderMessage = buildOnlineOrderOperationalEventMessage({
    eventType: args.eventType,
    subject,
  });

  if (onlineOrderMessage) {
    return onlineOrderMessage;
  }

  const stockAdjustmentMessage = buildStockAdjustmentOperationalEventMessage({
    eventType: args.eventType,
    subject,
  });

  if (stockAdjustmentMessage) {
    return stockAdjustmentMessage;
  }

  return `${args.eventType} on ${subject}`;
}

const ONLINE_ORDER_EVENT_MESSAGE_TEMPLATES: Record<
  string,
  (orderLabel: string) => string
> = {
  online_order_cancelled: (orderLabel) => `Online order ${orderLabel} cancelled.`,
  online_order_created: (orderLabel) => `Online order ${orderLabel} created.`,
  online_order_delivered: (orderLabel) => `Online order ${orderLabel} delivered.`,
  online_order_exchange_balance_collection: (orderLabel) =>
    `Exchange balance collected for online order ${orderLabel}.`,
  online_order_exchange_processed: (orderLabel) =>
    `Exchange processed for online order ${orderLabel}.`,
  online_order_item_restocked: (orderLabel) =>
    `Returned item restocked for online order ${orderLabel}.`,
  online_order_out_for_delivery: (orderLabel) =>
    `Online order ${orderLabel} out for delivery.`,
  online_order_payment_collected: (orderLabel) =>
    `Payment collected for online order ${orderLabel}.`,
  online_order_payment_verified: (orderLabel) =>
    `Payment verified for online order ${orderLabel}.`,
  online_order_picked_up: (orderLabel) => `Online order ${orderLabel} picked up.`,
  online_order_pickup_exception: (orderLabel) =>
    `Pickup exception recorded for online order ${orderLabel}.`,
  online_order_ready_for_delivery: (orderLabel) =>
    `Online order ${orderLabel} ready for delivery.`,
  online_order_ready_for_pickup: (orderLabel) =>
    `Online order ${orderLabel} ready for pickup.`,
  online_order_refund_submitted: (orderLabel) =>
    `Refund submitted for online order ${orderLabel}.`,
  online_order_reservation_released: (orderLabel) =>
    `Reservation released for online order ${orderLabel}.`,
  online_order_return_approval_requested: (orderLabel) =>
    `Return or exchange for online order ${orderLabel} sent for approval.`,
  online_order_return_processed: (orderLabel) =>
    `Return processed for online order ${orderLabel}.`,
  online_order_return_refund: (orderLabel) =>
    `Refund recorded for online order ${orderLabel}.`,
  online_order_status_changed: (orderLabel) =>
    `Online order ${orderLabel} status changed.`,
};

export function buildOnlineOrderOperationalEventMessage(args: {
  eventType: string;
  subject: string;
}) {
  const template = ONLINE_ORDER_EVENT_MESSAGE_TEMPLATES[args.eventType];

  if (!template) {
    return null;
  }

  return template(formatOnlineOrderLabel(args.subject));
}

const STOCK_ADJUSTMENT_EVENT_MESSAGE_TEMPLATES: Record<
  string,
  (subjectDetail: string) => string
> = {
  stock_adjustment_approved: (subjectDetail) =>
    `Stock adjustment approved${subjectDetail}.`,
  stock_adjustment_cancelled: (subjectDetail) =>
    `Stock adjustment cancelled${subjectDetail}.`,
  stock_adjustment_rejected: (subjectDetail) =>
    `Stock adjustment rejected${subjectDetail}.`,
};

export function buildStockAdjustmentOperationalEventMessage(args: {
  eventType: string;
  subject: string;
}) {
  const template = STOCK_ADJUSTMENT_EVENT_MESSAGE_TEMPLATES[args.eventType];

  if (!template) {
    return null;
  }

  return template(formatStockAdjustmentSubjectDetail(args.subject));
}

function formatStockAdjustmentSubjectDetail(subject: string) {
  const [, detail] = subject.split("·").map((part) => part.trim());

  return detail ? ` for ${detail}` : "";
}

function formatOnlineOrderLabel(subject: string) {
  const trimmed = subject.trim();

  if (!trimmed) {
    return "order";
  }

  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}
