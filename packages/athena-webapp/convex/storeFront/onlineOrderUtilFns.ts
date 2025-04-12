import { v } from "convex/values";
import { Address, OnlineOrder, Store } from "../../types";
import { action } from "../_generated/server";
import { OrderEmailType, sendOrderEmail } from "../sendgrid";
import {
  capitalizeWords,
  currencyFormatter,
  formatDate,
  getAddressString,
} from "../utils";
import { api } from "../_generated/api";

export const formatOrderItems = (items: any, storeCurrency: string) => {
  const formatter = currencyFormatter(storeCurrency);

  return (
    items?.map((item: any) => ({
      text: capitalizeWords(item.productName),
      image: item.productImage,
      price: item.price == 0 ? "Free" : formatter.format(item.price),
      quantity: item.quantity,
      color: item.colorName,
      length: item.length && `${item.length} inches`,
    })) || []
  );
};

export async function handleOrderStatusUpdate({
  order,
  newStatus,
  store,
}: {
  order: OnlineOrder;
  newStatus: string;
  store: Store;
}) {
  console.info(`handling order status update for order #${order.orderNumber}`);

  const completedStatuses = ["delivered", "picked-up"];

  const formatter = currencyFormatter(store?.currency || "USD");

  // Helper to send email
  async function sendEmail({
    type,
    statusMessaging,
    pickupDetails,
  }: {
    type: OrderEmailType;
    statusMessaging: string;
    pickupDetails: string;
  }) {
    const items = formatOrderItems(order.items, store.currency);
    const emailResponse = await sendOrderEmail({
      type,
      customerEmail: order.customerDetails.email,
      store_name: "Wigclub",
      order_number: order.orderNumber,
      order_date: formatDate(order._creationTime),
      order_status_messaging: statusMessaging,
      total: formatter.format(order.amount / 100),
      items,
      pickup_type: order.deliveryMethod,
      pickup_details: pickupDetails,
    });

    return emailResponse.ok;
  }

  if (newStatus === "open") {
    try {
      const statusMessaging =
        order.deliveryMethod == "pickup"
          ? "Thank you for shopping with us! We're processing your order. We'll notify you when your items are ready for pickup. Please note it takes 24 - 48 hours to process your order."
          : "Thank you for shopping with us! We're processing your order. We'll notify you when your items are are on their way. Please note it takes 24 - 48 hours to process your order.";

      const orderPickupLocation = store?.config?.contactInfo?.location;

      const deliveryAddress = order.deliveryDetails
        ? getAddressString(order.deliveryDetails as Address)
        : "Details not available";

      const pickupDetails =
        order.deliveryMethod == "pickup"
          ? orderPickupLocation
          : deliveryAddress;

      if (
        await sendEmail({
          type: "confirmation",
          statusMessaging,
          pickupDetails,
        })
      ) {
        console.info(
          `sent order confirmation email for order #${order.orderNumber} to ${order.customerDetails.email}`
        );
        return { didSendConfirmationEmail: true };
      }
    } catch (e) {
      console.error("failed to send order confirmation email", e);
    }
  }

  // Handle ready email
  if (!order.didSendReadyEmail) {
    if (newStatus === "ready-for-pickup") {
      try {
        const { firstName } = order.customerDetails;

        const statusMessaging = `Get excited, ${capitalizeWords(firstName)}! Your order is ready for pickup. Visit our store any time during our business hours to pick up your items.`;

        const pickupLocation =
          store?.config?.contactInfo?.location || "Location not available";

        if (
          await sendEmail({
            type: "ready",
            statusMessaging,
            pickupDetails: pickupLocation,
          })
        ) {
          console.info(
            `sent order ready email for order #${order.orderNumber} to ${order.customerDetails.email}`
          );
          return { didSendReadyEmail: true };
        }
      } catch (e) {
        console.error("failed to send order ready email", e);
      }
    }

    if (newStatus === "out-for-delivery") {
      try {
        const { firstName } = order.customerDetails;

        const statusMessaging = `Get excited, ${capitalizeWords(firstName)}! Your order is out for delivery.`;
        const deliveryAddress =
          order.deliveryDetails &&
          getAddressString(order.deliveryDetails as Address);

        if (
          await sendEmail({
            type: "ready",
            statusMessaging,
            pickupDetails: deliveryAddress || "Details not available",
          })
        ) {
          console.info(
            `sent order ready email for order #${order.orderNumber} to ${order.customerDetails.email}`
          );
          return { didSendReadyEmail: true };
        }
      } catch (e) {
        console.error("failed to send order ready email", e);
      }
    }
  }

  // Handle completed email
  if (!order.didSendCompletedEmail && completedStatuses.includes(newStatus)) {
    try {
      const isPickupOrder = order.deliveryMethod === "pickup";
      const statusMessaging = isPickupOrder
        ? "Your order was picked up. Thank you for shopping with us!"
        : "Your order has been delivered. Thank you for shopping with us!";

      const pickupDetails = isPickupOrder
        ? store?.config?.contactInfo?.location
        : order.deliveryDetails &&
          getAddressString(order.deliveryDetails as Address);

      if (
        await sendEmail({ type: "complete", statusMessaging, pickupDetails })
      ) {
        console.info(
          `sent order complete email for order #${order.orderNumber} to ${order.customerDetails.email}`
        );
        return { didSendCompletedEmail: true };
      }
    } catch (e) {
      console.error("Ffailed to send complete email", e);
    }
  }
}

export const sendOrderUpdateEmail = action({
  args: { orderId: v.id("onlineOrder"), newStatus: v.string() },
  handler: async (ctx, args) => {
    const order = await ctx.runQuery(api.storeFront.onlineOrder.get, {
      identifier: args.orderId,
    });

    if (!order) {
      console.error("Order not found in send order update email handler");
    }

    const store = await ctx.runQuery(api.inventory.stores.findById, {
      id: order!.storeId,
    });

    if (!store) {
      console.error("Store not found in send order update email handler");
    }

    console.info(`sending order update email for order #${order!.orderNumber}`);

    const {
      didSendCompletedEmail,
      didSendReadyEmail,
      didSendConfirmationEmail,
    } =
      (await handleOrderStatusUpdate({
        order: order!,
        newStatus: args.newStatus,
        store: store!,
      })) || {};

    if (didSendConfirmationEmail) {
      console.info(
        `successfully sent confirmation email for order #${order!.orderNumber}`
      );

      await ctx.runMutation(api.storeFront.onlineOrder.update, {
        orderId: order!._id,
        update: { didSendConfirmationEmail },
      });
    }

    if (didSendReadyEmail) {
      console.info(
        `successfully sent ready email for order #${order!.orderNumber}`
      );

      await ctx.runMutation(api.storeFront.onlineOrder.update, {
        orderId: order!._id,
        update: { didSendReadyEmail },
      });
    }

    if (didSendCompletedEmail) {
      console.info(
        `successfully sent completed email for order #${order!.orderNumber}`
      );

      await ctx.runMutation(api.storeFront.onlineOrder.update, {
        orderId: order!._id,
        update: { didSendCompletedEmail },
      });
    }
  },
});
