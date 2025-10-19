import { v } from "convex/values";
import { Address, OnlineOrder, Store } from "../../types";
import { action } from "../_generated/server";
import { OrderEmailType, sendOrderEmail } from "../mailersend";
import {
  capitalizeWords,
  currencyFormatter,
  formatDate,
  getAddressString,
} from "../utils";
import { api } from "../_generated/api";
import { getProductDiscountValue } from "../inventory/utils";

// Order status constants
const ORDER_STATUS = {
  OPEN: "open",
  READY_FOR_PICKUP: "ready-for-pickup",
  OUT_FOR_DELIVERY: "out-for-delivery",
  DELIVERED: "delivered",
  PICKED_UP: "picked-up",
  CANCELLED: "cancelled",
} as const;

const COMPLETED_STATUSES = [ORDER_STATUS.DELIVERED, ORDER_STATUS.PICKED_UP];

export const formatOrderItems = (
  items: Array<{
    productName?: string;
    productImage?: string;
    price?: number;
    quantity?: number;
    colorName?: string;
    length?: number;
    productSkuId?: string;
  }>,
  storeCurrency: string,
  discount?: any
) => {
  const formatter = currencyFormatter(storeCurrency);

  return items.map((item) => {
    const originalPrice = item.price || 0;
    const isEligibleForDiscount =
      discount &&
      (discount.span === "entire-order" ||
        !discount.span ||
        (discount.span === "selected-products" &&
          discount.productSkus?.includes(item.productSkuId)));

    // Calculate per-item discount
    let itemDiscount = 0;
    if (isEligibleForDiscount) {
      itemDiscount = getProductDiscountValue(originalPrice, discount);
    }

    const discountedPrice = originalPrice - itemDiscount;
    const totalItemSavings = itemDiscount * (item.quantity || 0);

    return {
      text: capitalizeWords(item.productName || ""),
      image: item.productImage || "",
      price: originalPrice === 0 ? "Free" : formatter.format(originalPrice),
      discountedPrice:
        itemDiscount > 0 ? formatter.format(discountedPrice) : undefined,
      savings:
        totalItemSavings > 0 ? formatter.format(totalItemSavings) : undefined,
      quantity: String(item.quantity || 0),
      color: item.colorName || "",
      length: item.length ? `${item.length} inches` : undefined,
    };
  });
};

// Helper types
type EmailResult = {
  didSendConfirmationEmail?: boolean;
  didSendReadyEmail?: boolean;
  didSendCompletedEmail?: boolean;
  didSendCancelledEmail?: boolean;
};

type EmailConfig = {
  type: OrderEmailType;
  statusMessaging: string;
  pickupDetails: string;
};

// Helper functions
const getPickupLocation = (store: Store): string =>
  store.config?.contactInfo?.location || "Location not available";

const getDeliveryAddress = (deliveryDetails?: Address): string =>
  deliveryDetails ? getAddressString(deliveryDetails) : "Details not available";

const getLocationDetails = (order: OnlineOrder, store: Store): string => {
  return order.deliveryMethod === "pickup"
    ? getPickupLocation(store)
    : getDeliveryAddress(order.deliveryDetails as Address);
};

export async function handleOrderStatusUpdate({
  order,
  newStatus,
  store,
}: {
  order: OnlineOrder;
  newStatus: string;
  store: Store;
}): Promise<EmailResult | undefined> {
  console.info(
    `handling order status update: ${newStatus} for order #${order.orderNumber}`
  );

  const formatter = currencyFormatter(store.currency || "USD");
  const { firstName, email } = order.customerDetails;

  // Helper to send email
  async function sendEmail({
    type,
    statusMessaging,
    pickupDetails,
  }: EmailConfig): Promise<boolean> {
    console.info(`sending ${type} email for order #${order.orderNumber}`);

    const items = formatOrderItems(
      order.items || [],
      store.currency,
      order.discount
    );

    // Calculate subtotal
    const subtotal = (order.items || []).reduce(
      (sum, item) => sum + (item.price || 0) * (item.quantity || 0),
      0
    );

    const emailResponse = await sendOrderEmail({
      type,
      customerEmail: email,
      store_name: "Wigclub",
      order_number: order.orderNumber,
      order_date: formatDate(order._creationTime),
      order_status_messaging: statusMessaging,
      total: formatter.format(order.amount / 100),
      subtotal: formatter.format(subtotal),
      items,
      pickup_type: order.deliveryMethod,
      pickup_details: pickupDetails,
      customer_name: firstName,
    });

    if (emailResponse.ok) {
      console.info(
        `successfully sent ${type} email for order #${order.orderNumber} to ${email}`
      );
      return true;
    }

    console.log(
      `failed to send ${type} email for order #${order.orderNumber} to ${email}`
    );
    const emailResponseBody = await emailResponse.json();
    console.log("Email error details:", emailResponseBody);
    return false;
  }

  // Handle confirmation email (order opened)
  if (newStatus === ORDER_STATUS.OPEN) {
    try {
      const statusMessaging =
        order.deliveryMethod === "pickup"
          ? "We're processing your order. We'll notify you when your items are ready for pickup. Please note it takes 24 - 48 hours to process your order."
          : "We're processing your order. We'll notify you when your items are on their way. Please note it takes 24 - 48 hours to process your order.";

      const emailSent = await sendEmail({
        type: "confirmation",
        statusMessaging,
        pickupDetails: getLocationDetails(order, store),
      });

      if (emailSent) {
        return { didSendConfirmationEmail: true };
      }
    } catch (error) {
      console.log("Failed to send order confirmation email:", error);
    }
    return undefined;
  }

  // Handle ready email (ready for pickup or out for delivery)
  if (!order.didSendReadyEmail) {
    if (newStatus === ORDER_STATUS.READY_FOR_PICKUP) {
      try {
        const statusMessaging = `Your order is ready for pickup. Visit our store any time during our business hours to pick up your items.`;

        const emailSent = await sendEmail({
          type: "ready",
          statusMessaging,
          pickupDetails: getPickupLocation(store),
        });

        if (emailSent) {
          return { didSendReadyEmail: true };
        }
      } catch (error) {
        console.log("Failed to send order ready email:", error);
      }
      return undefined;
    }

    if (newStatus === ORDER_STATUS.OUT_FOR_DELIVERY) {
      try {
        const statusMessaging = `Your order is out for delivery.`;

        const emailSent = await sendEmail({
          type: "ready",
          statusMessaging,
          pickupDetails: getDeliveryAddress(order.deliveryDetails as Address),
        });

        if (emailSent) {
          return { didSendReadyEmail: true };
        }
      } catch (error) {
        console.log("Failed to send order ready email:", error);
      }
      return undefined;
    }
  }

  // Handle completed email (delivered or picked up)
  if (
    !order.didSendCompletedEmail &&
    COMPLETED_STATUSES.includes(newStatus as any)
  ) {
    try {
      const isPickupOrder = order.deliveryMethod === "pickup";
      const statusMessaging = isPickupOrder
        ? "Your order was picked up. Thank you for shopping with us!"
        : "Your order has been delivered. Thank you for shopping with us!";

      const emailSent = await sendEmail({
        type: "complete",
        statusMessaging,
        pickupDetails: getLocationDetails(order, store),
      });

      if (emailSent) {
        return { didSendCompletedEmail: true };
      }
    } catch (error) {
      console.log("Failed to send completed email:", error);
    }
    return undefined;
  }

  // Handle cancelled email
  if (newStatus === ORDER_STATUS.CANCELLED && !order.didSendCancelledEmail) {
    try {
      const statusMessaging = `Hi ${capitalizeWords(firstName)}, your order has been cancelled. If you have any questions, please contact our support team.`;

      const emailSent = await sendEmail({
        type: "canceled",
        statusMessaging,
        pickupDetails: getLocationDetails(order, store),
      });

      if (emailSent) {
        return { didSendCancelledEmail: true };
      }
    } catch (error) {
      console.log("Failed to send cancelled email:", error);
    }
    return undefined;
  }

  return undefined;
}

type UpdateEmailResult = {
  success: boolean;
  message: string;
};

export const sendOrderUpdateEmail = action({
  args: { orderId: v.id("onlineOrder"), newStatus: v.string() },
  returns: v.object({
    success: v.boolean(),
    message: v.string(),
  }),
  handler: async (ctx, args): Promise<UpdateEmailResult> => {
    // Fetch order
    const order = await ctx.runQuery(api.storeFront.onlineOrder.get, {
      identifier: args.orderId,
    });

    if (!order) {
      console.log("Order not found in send order update email handler");
      return {
        success: false,
        message: "Order not found",
      };
    }

    // Fetch store
    const store = await ctx.runQuery(api.inventory.stores.findById, {
      id: order.storeId,
    });

    if (!store) {
      console.log("Store not found in send order update email handler");
      return {
        success: false,
        message: "Store not found",
      };
    }

    console.info(
      `sending order update: ${args.newStatus} email for order #${order.orderNumber}`
    );

    // Handle order status update
    const emailResult = await handleOrderStatusUpdate({
      order,
      newStatus: args.newStatus,
      store,
    });

    if (!emailResult) {
      return {
        success: false,
        message: "No email sent for this status",
      };
    }

    // Update order based on which email was sent
    const {
      didSendConfirmationEmail,
      didSendReadyEmail,
      didSendCompletedEmail,
      didSendCancelledEmail,
    } = emailResult;

    if (didSendConfirmationEmail) {
      await ctx.runMutation(api.storeFront.onlineOrder.update, {
        orderId: order._id,
        update: {
          didSendConfirmationEmail,
          orderReceivedEmailSentAt: Date.now(),
        },
      });
      return { success: true, message: "Confirmation email sent" };
    }

    if (didSendReadyEmail) {
      await ctx.runMutation(api.storeFront.onlineOrder.update, {
        orderId: order._id,
        update: {
          didSendReadyEmail,
          orderReadyEmailSentAt: Date.now(),
        },
      });
      return { success: true, message: "Ready email sent" };
    }

    if (didSendCompletedEmail) {
      await ctx.runMutation(api.storeFront.onlineOrder.update, {
        orderId: order._id,
        update: {
          didSendCompletedEmail,
          orderCompletedEmailSentAt: Date.now(),
        },
      });
      return { success: true, message: "Completed email sent" };
    }

    if (didSendCancelledEmail) {
      await ctx.runMutation(api.storeFront.onlineOrder.update, {
        orderId: order._id,
        update: {
          didSendCancelledEmail,
          orderCancelledEmailSentAt: Date.now(),
        },
      });
      return { success: true, message: "Cancelled email sent" };
    }

    return {
      success: false,
      message: "Email sending failed",
    };
  },
});
