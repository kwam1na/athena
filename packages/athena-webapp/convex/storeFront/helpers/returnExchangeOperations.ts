import { Doc, Id } from "../../_generated/dataModel";

type ReturnExchangeOrder = Pick<
  Doc<"onlineOrder">,
  "_id" | "amount" | "orderNumber" | "status"
>;

type ReturnExchangeOrderItem = Pick<
  Doc<"onlineOrderItem">,
  | "_id"
  | "isReady"
  | "isRefunded"
  | "isRestocked"
  | "price"
  | "productId"
  | "productName"
  | "productSku"
  | "productSkuId"
  | "quantity"
>;

export type ReturnExchangeReplacementInput = {
  inventoryCount: number;
  productId: Id<"product">;
  productName?: string;
  productSkuId: Id<"productSku">;
  quantity: number;
  quantityAvailable: number;
  skuLabel?: string;
  unitPrice: number;
};

type ReturnExchangeMovement = {
  orderItemId?: Id<"onlineOrderItem">;
  productId: Id<"product">;
  productName?: string;
  productSkuId: Id<"productSku">;
  quantity: number;
  quantityDelta: number;
  reasonCode: string;
  skuLabel?: string;
};

type ReturnExchangePaymentAllocation = {
  allocationType:
    | "online_order_exchange_balance_collection"
    | "online_order_return_refund";
  amount: number;
  direction: "in" | "out";
};

export type OnlineOrderReturnExchangePlan = {
  approvalReason: string | null;
  balanceDueAmount: number;
  eventMessage: string;
  eventType:
    | "online_order_exchange_processed"
    | "online_order_return_approval_requested"
    | "online_order_return_processed";
  exchangeMovements: ReturnExchangeMovement[];
  kind: "exchange" | "full_return" | "partial_return";
  paymentAllocation: ReturnExchangePaymentAllocation | null;
  refundAmount: number;
  replacementItems: ReturnExchangeReplacementInput[];
  requiresApproval: boolean;
  returnMovements: ReturnExchangeMovement[];
  selectedItems: ReturnExchangeOrderItem[];
};

function getLineRefundAmount(item: ReturnExchangeOrderItem) {
  return item.price * item.quantity * 100;
}

function getKind(args: {
  replacementItems: ReturnExchangeReplacementInput[];
  selectedCount: number;
  totalRefundableCount: number;
}): OnlineOrderReturnExchangePlan["kind"] {
  if (args.replacementItems.length > 0) {
    return "exchange";
  }

  if (args.selectedCount === args.totalRefundableCount) {
    return "full_return";
  }

  return "partial_return";
}

function getApprovalReason(args: {
  replacementItems: ReturnExchangeReplacementInput[];
  restockReturnedItems: boolean;
  selectedItems: ReturnExchangeOrderItem[];
}) {
  if (
    args.restockReturnedItems &&
    args.selectedItems.some((item) => item.isReady !== true)
  ) {
    return "Return requires inspection and approval before stock can be restored.";
  }

  if (
    args.replacementItems.some(
      (item) =>
        item.inventoryCount < item.quantity ||
        item.quantityAvailable < item.quantity,
    )
  ) {
    return "Exchange requires approval because the replacement inventory cannot self-resolve.";
  }

  return null;
}

export function buildOnlineOrderReturnExchangePlan(args: {
  order: ReturnExchangeOrder;
  orderItems: ReturnExchangeOrderItem[];
  replacementItems?: ReturnExchangeReplacementInput[];
  restockReturnedItems: boolean;
  returnItemIds: Array<Id<"onlineOrderItem">>;
}): OnlineOrderReturnExchangePlan {
  const returnItemIdSet = new Set(args.returnItemIds);
  const selectedItems = args.orderItems.filter((item) =>
    returnItemIdSet.has(item._id),
  );

  if (selectedItems.length === 0) {
    throw new Error("Select at least one order line to return or exchange.");
  }

  if (selectedItems.some((item) => item.isRefunded || item.isRestocked)) {
    throw new Error("Selected items have already been returned.");
  }

  const replacementItems = args.replacementItems ?? [];

  if (replacementItems.length > 0 && replacementItems.some((item) => item.quantity <= 0)) {
    throw new Error("Replacement quantities must be greater than zero.");
  }

  const totalRefundableCount = args.orderItems.filter(
    (item) => !item.isRefunded && !item.isRestocked,
  ).length;
  const kind = getKind({
    replacementItems,
    selectedCount: selectedItems.length,
    totalRefundableCount,
  });
  const returnSubtotal = selectedItems.reduce(
    (sum, item) => sum + getLineRefundAmount(item),
    0,
  );
  const replacementSubtotal = replacementItems.reduce(
    (sum, item) => sum + item.unitPrice * item.quantity,
    0,
  );
  const approvalReason = getApprovalReason({
    replacementItems,
    restockReturnedItems: args.restockReturnedItems,
    selectedItems,
  });

  if (approvalReason) {
    return {
      approvalReason,
      balanceDueAmount: 0,
      eventMessage: approvalReason,
      eventType: "online_order_return_approval_requested",
      exchangeMovements: [],
      kind,
      paymentAllocation: null,
      refundAmount: 0,
      replacementItems,
      requiresApproval: true,
      returnMovements: [],
      selectedItems,
    };
  }

  const refundAmount = Math.max(returnSubtotal - replacementSubtotal, 0);
  const balanceDueAmount = Math.max(replacementSubtotal - returnSubtotal, 0);

  return {
    approvalReason: null,
    balanceDueAmount,
    eventMessage:
      kind === "exchange"
        ? `Processed exchange for order #${args.order.orderNumber}.`
        : `Processed ${kind.replaceAll("_", " ")} for order #${args.order.orderNumber}.`,
    eventType:
      kind === "exchange"
        ? "online_order_exchange_processed"
        : "online_order_return_processed",
    exchangeMovements: replacementItems.map((item) => ({
      productId: item.productId,
      productName: item.productName,
      productSkuId: item.productSkuId,
      quantity: item.quantity,
      quantityDelta: -item.quantity,
      reasonCode: "online_order_exchange_issued",
      skuLabel: item.skuLabel,
    })),
    kind,
    paymentAllocation:
      refundAmount > 0
        ? {
            allocationType: "online_order_return_refund",
            amount: refundAmount,
            direction: "out",
          }
        : balanceDueAmount > 0
          ? {
              allocationType: "online_order_exchange_balance_collection",
              amount: balanceDueAmount,
              direction: "in",
            }
          : null,
    refundAmount,
    replacementItems,
    requiresApproval: false,
    returnMovements: args.restockReturnedItems
      ? selectedItems.map((item) => ({
          orderItemId: item._id,
          productId: item.productId,
          productName: item.productName,
          productSkuId: item.productSkuId,
          quantity: item.quantity,
          quantityDelta: item.quantity,
          reasonCode: "online_order_return_restocked",
          skuLabel: item.productSku,
        }))
      : [],
    selectedItems,
  };
}
