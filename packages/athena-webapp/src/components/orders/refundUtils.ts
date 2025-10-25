import { OnlineOrder, OnlineOrderItem } from "~/types";
import { Doc, Id } from "~/convex/_generated/dataModel";

// Type for items embedded in orders (includes _id from the onlineOrderItem table)
type OrderItemWithId = NonNullable<OnlineOrder["items"]>[number] & {
  _id: Id<"onlineOrderItem">;
};

export type RefundMode = "entire-order" | "partial" | "remaining" | null;

export interface RefundState {
  mode: RefundMode;
  selectedItemIds: Set<string>;
  includeDeliveryFee: boolean;
  returnToStock: boolean;
  showModal: boolean;
}

export type RefundAction =
  | { type: "SET_MODE"; mode: RefundMode }
  | { type: "TOGGLE_ITEM"; itemId: string }
  | { type: "TOGGLE_DELIVERY_FEE" }
  | { type: "TOGGLE_RETURN_TO_STOCK" }
  | { type: "SHOW_MODAL" }
  | { type: "HIDE_MODAL" }
  | { type: "RESET" };

/**
 * Reducer for managing refund state
 */
export function refundReducer(
  state: RefundState,
  action: RefundAction
): RefundState {
  switch (action.type) {
    case "SET_MODE":
      return {
        ...state,
        mode: action.mode,
        selectedItemIds: new Set(),
        includeDeliveryFee: false,
      };

    case "TOGGLE_ITEM":
      const newSelectedIds = new Set(state.selectedItemIds);
      if (newSelectedIds.has(action.itemId)) {
        newSelectedIds.delete(action.itemId);
      } else {
        newSelectedIds.add(action.itemId);
      }
      return {
        ...state,
        selectedItemIds: newSelectedIds,
      };

    case "TOGGLE_DELIVERY_FEE":
      return {
        ...state,
        includeDeliveryFee: !state.includeDeliveryFee,
      };

    case "TOGGLE_RETURN_TO_STOCK":
      return {
        ...state,
        returnToStock: !state.returnToStock,
      };

    case "SHOW_MODAL":
      return {
        ...state,
        showModal: true,
      };

    case "HIDE_MODAL":
      return {
        ...state,
        showModal: false,
        returnToStock: false,
      };

    case "RESET":
      return {
        mode: null,
        selectedItemIds: new Set(),
        includeDeliveryFee: false,
        returnToStock: false,
        showModal: false,
      };

    default:
      return state;
  }
}

/**
 * Calculate the total amount already refunded
 */
export function getAmountRefunded(order: OnlineOrder): number {
  return order.refunds?.reduce((acc, refund) => acc + refund.amount, 0) || 0;
}

/**
 * Calculate the net amount available for refund
 * This includes the subtotal (order.amount) + delivery fee
 */
export function getNetAmount(order: OnlineOrder): number {
  const deliveryFee = order.deliveryFee ? order.deliveryFee * 100 : 0;
  const totalPaid = order.amount + deliveryFee;
  return totalPaid - getAmountRefunded(order);
}

/**
 * Get items that are available for refund (not already refunded)
 */
export function getAvailableItems(order: OnlineOrder): OrderItemWithId[] {
  if (!order.items) return [];
  return order.items.filter((item) => !item.isRefunded) as OrderItemWithId[];
}

/**
 * Calculate the refund amount based on the current mode and selections
 * All amounts are in cents (pesewas)
 */
export function calculateRefundAmount(
  order: OnlineOrder,
  mode: RefundMode,
  selectedItemIds: Set<string>,
  includeDeliveryFee: boolean = false
): number {
  const netAmount = getNetAmount(order);

  switch (mode) {
    case "entire-order":
      // Refund everything remaining
      return netAmount;

    case "remaining":
      // Refund whatever is left
      return netAmount;

    case "partial": {
      if (!order.items) return 0;

      // Sum up selected items (prices are in GHS, need to convert to cents)
      const items = order.items as OrderItemWithId[];
      let total = 0;
      for (const item of items) {
        if (selectedItemIds.has(item._id)) {
          // Convert from GHS to cents: price * quantity * 100
          total += item.price * item.quantity * 100;
        }
      }

      // Add delivery fee if requested and not already refunded
      if (
        includeDeliveryFee &&
        order.deliveryFee &&
        !order.didRefundDeliveryFee
      ) {
        // deliveryFee is in GHS, convert to cents
        total += order.deliveryFee * 100;
      }

      return Math.min(total, netAmount);
    }

    default:
      return 0;
  }
}

/**
 * Get the IDs of items to refund based on mode and selections
 */
export function getItemsToRefund(
  order: OnlineOrder,
  mode: RefundMode,
  selectedItemIds: Set<string>
): string[] {
  if (!order.items) return [];

  switch (mode) {
    case "entire-order":
    case "remaining":
      // Refund all non-refunded items
      return getAvailableItems(order).map((item) => item._id);

    case "partial":
      // Refund only selected items
      return Array.from(selectedItemIds);

    default:
      return [];
  }
}

/**
 * Validate that a refund operation is valid
 */
export function validateRefund(
  order: OnlineOrder,
  mode: RefundMode,
  selectedItemIds: Set<string>,
  includeDeliveryFee: boolean = false
): { isValid: boolean; error?: string } {
  const netAmount = getNetAmount(order);

  if (netAmount <= 0) {
    return {
      isValid: false,
      error: "This order has been fully refunded",
    };
  }

  if (!mode) {
    return {
      isValid: false,
      error: "Please select a refund option",
    };
  }

  if (mode === "partial" && selectedItemIds.size === 0 && !includeDeliveryFee) {
    return {
      isValid: false,
      error: "Please select at least one item or include delivery fee",
    };
  }

  const refundAmount = calculateRefundAmount(
    order,
    mode,
    selectedItemIds,
    includeDeliveryFee
  );

  if (refundAmount <= 0) {
    return {
      isValid: false,
      error: "Refund amount must be greater than zero",
    };
  }

  if (refundAmount > netAmount) {
    return {
      isValid: false,
      error: "Refund amount exceeds available amount",
    };
  }

  return { isValid: true };
}

/**
 * Check if return to stock option should be shown
 */
export function shouldShowReturnToStock(
  mode: RefundMode,
  order: OnlineOrder
): boolean {
  if (!mode || mode === null) return false;

  // Only show if we're refunding items (not just nothing)
  const hasItems = order.items && order.items.length > 0;
  const hasAvailableItems = getAvailableItems(order).length > 0;

  return Boolean(hasItems && hasAvailableItems);
}
