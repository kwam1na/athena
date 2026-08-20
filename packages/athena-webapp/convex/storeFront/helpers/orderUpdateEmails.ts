import { v } from "convex/values";
import { Address, OnlineOrder, Store } from "../../../types";
import { ActionCtx } from "../../_generated/server";
import { OrderEmailType, sendOrderEmail } from "../../mailersend";
import { toDisplayAmount } from "../../lib/currency";
import {
  capitalizeWords,
  currencyFormatter,
  formatDate,
  getAddressString,
} from "../../utils";
import { internal } from "../../_generated/api";
import {
  getDiscountValue,
  getProductDiscountValue,
} from "../../inventory/utils";
import {
  buildReadyForPickupMessage,
  formatPickupLocation,
  formatStoreScheduleHours,
  type StoreHoursRow,
  type StoreScheduleHoursSource,
} from "../../emails/fulfillmentDetails";

const ORDER_STATUS = {
  OPEN: "open",
  READY_FOR_PICKUP: "ready-for-pickup",
  READY_FOR_DELIVERY: "ready-for-delivery",
  OUT_FOR_DELIVERY: "out-for-delivery",
  DELIVERED: "delivered",
  PICKED_UP: "picked-up",
  CANCELLED: "cancelled",
} as const;

const COMPLETED_STATUSES = [ORDER_STATUS.DELIVERED, ORDER_STATUS.PICKED_UP];

export const orderUpdateEmailArgs = {
  orderId: v.id("onlineOrder"),
  newStatus: v.string(),
};

export type UpdateEmailResult = {
  success: boolean;
  message: string;
};

type EmailResult = {
  didSendConfirmationEmail?: boolean;
  didSendReadyEmail?: boolean;
  didSendReadyForDeliveryEmail?: boolean;
  didSendCompletedEmail?: boolean;
  didSendCancelledEmail?: boolean;
};

type EmailConfig = {
  pickupHours?: StoreHoursRow[];
  statusTitle?: string;
  type: OrderEmailType;
  statusMessaging: string;
  pickupDetails: string;
};

const getPickupLocation = (store: Store): string =>
  formatPickupLocation({
    storeName: store.name,
    storeLocation: store.config?.contactInfo?.location,
  });

const getDeliveryAddress = (deliveryDetails?: Address): string =>
  deliveryDetails ? getAddressString(deliveryDetails) : "Details not available";

const getLocationDetails = (order: OnlineOrder, store: Store): string => {
  return order.deliveryMethod === "pickup"
    ? getPickupLocation(store)
    : getDeliveryAddress(order.deliveryDetails as Address);
};

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
  discount?: any,
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

    let itemDiscount = 0;
    if (isEligibleForDiscount) {
      itemDiscount = getProductDiscountValue(originalPrice, discount);
    }

    const discountedPrice = originalPrice - itemDiscount;
    const totalItemSavings = itemDiscount * (item.quantity || 0);

    return {
      text: capitalizeWords(item.productName || ""),
      image: item.productImage || "",
      price:
        originalPrice === 0
          ? "Free"
          : formatter.format(toDisplayAmount(originalPrice)),
      discountedPrice:
        itemDiscount > 0
          ? formatter.format(toDisplayAmount(discountedPrice))
          : undefined,
      savings:
        totalItemSavings > 0
          ? formatter.format(toDisplayAmount(totalItemSavings))
          : undefined,
      quantity: String(item.quantity || 0),
      color: capitalizeWords(item.colorName || ""),
      length: item.length ? `${item.length} inches` : undefined,
    };
  });
};

export async function handleOrderStatusUpdate({
  order,
  newStatus,
  simulateExternalEffects = false,
  store,
  storeSchedule,
}: {
  order: OnlineOrder;
  newStatus: string;
  simulateExternalEffects?: boolean;
  store: Store;
  storeSchedule?: StoreScheduleHoursSource | null;
}): Promise<EmailResult | undefined> {
  console.info(
    `handling order status update: ${newStatus} for order #${order.orderNumber}`,
  );

  const formatter = currencyFormatter(store.currency || "USD");
  const { firstName, email } = order.customerDetails;

  async function sendEmail({
    pickupHours,
    statusTitle,
    type,
    statusMessaging,
    pickupDetails,
  }: EmailConfig): Promise<boolean> {
    console.info(`sending ${type} email for order #${order.orderNumber}`);

    if (simulateExternalEffects) return true;

    const items = formatOrderItems(
      order.items || [],
      store.currency,
      order.discount,
    );

    const discountValue = getDiscountValue(order.items || [], order.discount);
    const deliveryFee = order.deliveryFee || 0;
    const amountPaid = order.amount - discountValue + deliveryFee;

    const emailResponse = await sendOrderEmail({
      type,
      customerEmail: email,
      store_name: capitalizeWords(store.name || "Wigclub"),
      order_number: order.orderNumber,
      delivery_fee: deliveryFee
        ? formatter.format(toDisplayAmount(deliveryFee))
        : order.deliveryMethod.toLowerCase() == "delivery"
          ? "Free"
          : undefined,
      order_date: formatDate(order._creationTime),
      order_status_messaging: statusMessaging,
      status_title: statusTitle,
      total: formatter.format(toDisplayAmount(amountPaid)),
      subtotal: formatter.format(toDisplayAmount(order.amount)),
      discount: discountValue
        ? formatter.format(toDisplayAmount(discountValue))
        : undefined,
      items,
      pickup_type: order.deliveryMethod,
      pickup_details: pickupDetails,
      pickup_hours: pickupHours,
      customer_name: firstName,
    });

    if (emailResponse.ok) {
      console.info(
        `successfully sent ${type} email for order #${order.orderNumber} to ${email}`,
      );
      return true;
    }

    console.log(
      `failed to send ${type} email for order #${order.orderNumber} to ${email}`,
    );
    const emailResponseBody = await emailResponse.json();
    console.log("Email error details:", emailResponseBody);
    return false;
  }

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

  if (
    newStatus === ORDER_STATUS.READY_FOR_DELIVERY &&
    !order.didSendReadyForDeliveryEmail
  ) {
    try {
      const emailSent = await sendEmail({
        type: "ready",
        statusTitle: "Your order is ready for delivery",
        statusMessaging: "We’ll let you know as soon as it’s on the way.",
        pickupDetails: getDeliveryAddress(order.deliveryDetails as Address),
      });

      if (emailSent) return { didSendReadyForDeliveryEmail: true };
    } catch (error) {
      console.log("Failed to send ready-for-delivery email:", error);
    }
    return undefined;
  }

  if (!order.didSendReadyEmail) {
    if (newStatus === ORDER_STATUS.READY_FOR_PICKUP) {
      try {
        const emailSent = await sendEmail({
          type: "ready",
          statusTitle: "Your order is ready for pickup",
          statusMessaging: buildReadyForPickupMessage(store.name),
          pickupDetails: getPickupLocation(store),
          pickupHours: formatStoreScheduleHours(storeSchedule),
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
        const emailSent = await sendEmail({
          type: "ready",
          statusTitle: "Your order is on the way",
          statusMessaging: "It’s headed to your delivery address.",
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

  if (newStatus === ORDER_STATUS.CANCELLED && !order.didSendCancelledEmail) {
    try {
      const emailSent = await sendEmail({
        type: "canceled",
        statusMessaging: `Hi ${capitalizeWords(firstName)}, your order has been cancelled. If you have any questions, please contact our support team.`,
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

export async function processOrderUpdateEmail(
  ctx: ActionCtx,
  args: { orderId: string; newStatus: string },
  options: { simulateExternalEffects?: boolean } = {},
): Promise<UpdateEmailResult> {
  const order = await ctx.runQuery(
    internal.storeFront.onlineOrder.getInternal,
    {
      identifier: args.orderId,
    },
  );

  if (!order) {
    console.log("Order not found in send order update email handler");
    return {
      success: false,
      message: "Order not found",
    };
  }

  // The shared-demo capability + store check that used to run here is the
  // rail's now: `sendOrderUpdateEmailOperationDefinition` declares
  // `capability: "customer.messaging.send"` with `store_ready` readiness and a
  // store scope resolved from the named order, so the shared-demo adapter has
  // already denied an ungranted capability or a foreign store before this
  // helper runs. `simulateExternalEffects` remains the demo's send-simulation
  // switch only.

  const store = await ctx.runQuery(internal.inventory.stores.findById, {
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
    `sending order update: ${args.newStatus} email for order #${order.orderNumber}`,
  );

  const storeSchedule =
    args.newStatus === ORDER_STATUS.READY_FOR_PICKUP
      ? await ctx.runQuery(
          internal.inventory.storeSchedule.getActiveStoreScheduleForEmail,
          {
            at: Date.now(),
            storeId: order.storeId,
          },
        )
      : null;

  const emailResult = await handleOrderStatusUpdate({
    order,
    newStatus: args.newStatus,
    simulateExternalEffects: options.simulateExternalEffects,
    store,
    storeSchedule,
  });

  if (!emailResult) {
    return {
      success: false,
      message: "No email sent for this status",
    };
  }

  const {
    didSendConfirmationEmail,
    didSendReadyEmail,
    didSendReadyForDeliveryEmail,
    didSendCompletedEmail,
    didSendCancelledEmail,
  } = emailResult;

  if (didSendConfirmationEmail) {
    await ctx.runMutation(internal.storeFront.onlineOrder.updateInternal, {
      demoCapability: options.simulateExternalEffects
        ? "customer.messaging.send"
        : undefined,
      orderId: order._id,
      update: {
        didSendConfirmationEmail,
        orderReceivedEmailSentAt: Date.now(),
      },
    });
    return { success: true, message: "Confirmation email sent" };
  }

  if (didSendReadyEmail) {
    await ctx.runMutation(internal.storeFront.onlineOrder.updateInternal, {
      demoCapability: options.simulateExternalEffects
        ? "customer.messaging.send"
        : undefined,
      orderId: order._id,
      update: {
        didSendReadyEmail,
        orderReadyEmailSentAt: Date.now(),
      },
    });
    return { success: true, message: "Ready email sent" };
  }

  if (didSendReadyForDeliveryEmail) {
    await ctx.runMutation(internal.storeFront.onlineOrder.updateInternal, {
      demoCapability: options.simulateExternalEffects
        ? "customer.messaging.send"
        : undefined,
      orderId: order._id,
      update: { didSendReadyForDeliveryEmail },
    });
    return { success: true, message: "Ready-for-delivery email sent" };
  }

  if (didSendCompletedEmail) {
    await ctx.runMutation(internal.storeFront.onlineOrder.updateInternal, {
      demoCapability: options.simulateExternalEffects
        ? "customer.messaging.send"
        : undefined,
      orderId: order._id,
      update: {
        didSendCompletedEmail,
        orderCompletedEmailSentAt: Date.now(),
      },
    });
    return { success: true, message: "Completed email sent" };
  }

  if (didSendCancelledEmail) {
    await ctx.runMutation(internal.storeFront.onlineOrder.updateInternal, {
      demoCapability: options.simulateExternalEffects
        ? "customer.messaging.send"
        : undefined,
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
}
