import { v } from "convex/values";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { CheckoutSession, OnlineOrder } from "../../types";
import { orderDetailsSchema } from "../schemas/storeFront";
import { sendOrderEmail } from "../sendgrid";
import {
  capitalizeWords,
  currencyFormatter,
  formatDate,
  getAddressString,
} from "../utils";
import { HOST_URL, PAYSTACK_SECRET_KEY, SITE_URL } from "../env";

const appUrl = SITE_URL || HOST_URL || "http://localhost:3000";

function getPaystackAuthorizationHeader() {
  if (!PAYSTACK_SECRET_KEY) {
    throw new Error("PAYSTACK_SECRET_KEY is not configured.");
  }

  return `Bearer ${PAYSTACK_SECRET_KEY}`;
}

export const createTransaction = action({
  args: {
    checkoutSessionId: v.id("checkoutSession"),
    customerEmail: v.string(),
    amount: v.number(),
    orderDetails: orderDetailsSchema,
  },
  handler: async (ctx, args) => {
    // throw new Error("Not implemented");
    const response = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        body: JSON.stringify({
          email: args.customerEmail,
          amount: args.amount.toString(),
          callback_url: `${appUrl}/shop/checkout/verify`,
          metadata: {
            cancel_action: `${appUrl}/shop/checkout`,
            checkout_session_id: args.checkoutSessionId,
            checkout_session_amount: args.amount.toString(),
            order_details: args.orderDetails,
          },
        }),
        headers: {
          Authorization: getPaystackAuthorizationHeader(),
          "Content-Type": "application/json",
        },
      }
    );

    if (response.ok) {
      const res = await response.json();

      try {
        await ctx.runMutation(
          internal.storeFront.checkoutSession.updateCheckoutSession,
          {
            id: args.checkoutSessionId,
            isFinalizingPayment: true,
            externalReference: res.data.reference,
          }
        );
      } catch (error) {
        // handled
      }

      return res.data;
    } else {
      // handled
    }
  },
});

export const verifyPayment = action({
  args: {
    storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
    externalReference: v.string(),
  },
  handler: async (ctx, args): Promise<{ verified?: boolean; message?: string }> => {
    const response = await fetch(
      `https://api.paystack.co/transaction/verify/${args.externalReference}`,
      {
        headers: {
          Authorization: getPaystackAuthorizationHeader(),
        },
      }
    );

    if (response.ok) {
      const res = await response.json();

      // Query for the first active session for the given storeFrontUserId
      const session: CheckoutSession | null = await ctx.runQuery(
        api.storeFront.checkoutSession.getCheckoutSession,
        {
          storeFrontUserId: args.storeFrontUserId,
          externalReference: args.externalReference,
        }
      );

      const order: OnlineOrder | null = await ctx.runQuery(
        api.storeFront.onlineOrder.get,
        {
          identifier: args.externalReference,
        }
      );

      const amount = session?.amount || order?.amount;

      const isVerified = Boolean(
        res.data.status == "success" && res.data.amount == amount
      );

      if (isVerified) {
        if (session) {
          await ctx.runMutation(
            internal.storeFront.checkoutSession.updateCheckoutSession,
            {
              id: session?._id,
              hasVerifiedPayment: true,
            }
          );
        }

        const update: Record<string, any> = { hasVerifiedPayment: true };

        if (order && !order.didSendConfirmationEmail) {
          try {
            const store = await ctx.runQuery(api.inventory.stores.getById, {
              id: order.storeId,
            });

            const formatter = currencyFormatter(store?.currency || "USD");

            const orderStatusMessaging =
              order.deliveryMethod == "pickup"
                ? "Thank you for shopping with us! We're processing your order. We'll notify you when your items are ready for pickup. Please note it takes 24 - 48 hours to process your order."
                : "Thank you for shopping with us! We're processing your order. We'll notify you when your items are are on their way. Please note it takes 24 - 48 hours to process your order.";

            const orderPickupLocation = store?.config?.contactInfo?.location;

            const deliveryAddress = getAddressString(order.deliveryDetails as any);

            const pickupDetails =
              order.deliveryMethod == "pickup"
                ? orderPickupLocation
                : deliveryAddress;

            const items: { text: string; image: string; price: string; quantity: string; length?: string; color: string }[] = (order.items ?? []).map((item: any) => ({
              text: item.productName,
              image: item.productImage,
              price: formatter.format(item.price),
              quantity: item.quantity,
              color: item.colorName,
              length: item.length ? `${item.length} inches` : undefined,
            }));

            // send confirmation email
            const emailResponse = await sendOrderEmail({
              type: "confirmation",
              customerEmail: order.customerDetails.email,
              store_name: "Wigclub",
              order_number: order.orderNumber,
              order_date: formatDate(order._creationTime),
              order_status_messaging: orderStatusMessaging,
              total: formatter.format(order.amount / 100),
              items,
              pickup_type: order.deliveryMethod,
              pickup_details: pickupDetails,
              customer_name: (order.customerDetails as any)?.firstName || "",
            });

            if (emailResponse.ok) {
              update.didSendConfirmationEmail = true;
            }
          } catch (e) {
            // handled
          }
        }

        await ctx.runMutation(api.storeFront.onlineOrder.update, {
          externalReference: args.externalReference,
          update,
        });

      }

      return { verified: isVerified };
    }

    return {
      message: "No active session found.",
    };
  },
});

export const refundPayment = action({
  args: {
    externalTransactionId: v.string(),
    amount: v.optional(v.number()),
    returnItemsToStock: v.boolean(),
    onlineOrderItemIds: v.optional(v.array(v.id("onlineOrderItem"))),
    refundItems: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const response = await fetch(`https://api.paystack.co/refund`, {
      method: "POST",
      headers: {
        Authorization: getPaystackAuthorizationHeader(),
      },
      body: JSON.stringify({
        transaction: args.externalTransactionId,
        amount: args.amount,
      }),
    });

    const res = await response.json();

    if (response.ok) {
      await ctx.runMutation(api.storeFront.onlineOrder.update, {
        externalReference: res.data?.transaction?.reference,
        update: {
          status: "refund-submitted",
          didRefundDeliveryFee: args.refundItems?.includes("delivery-fee"),
        },
      });

      if (args.returnItemsToStock) {
        await ctx.runMutation(api.storeFront.onlineOrder.returnItemsToStock, {
          externalTransactionId: args.externalTransactionId,
          onlineOrderItemIds: args.onlineOrderItemIds,
        });

        return { success: true, message: res.message };
      }

      if (args.onlineOrderItemIds) {
        await ctx.runMutation(api.storeFront.onlineOrder.updateOrderItems, {
          orderItemIds: args.onlineOrderItemIds,
          updates: { isRefunded: true },
        });
      }
      return { success: true, message: res.message };
    }

    return { success: false, message: res.message };
  },
});
