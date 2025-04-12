import { v } from "convex/values";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { Address, CheckoutSession, OnlineOrder } from "../../types";
import { orderDetailsSchema } from "../schemas/storeFront";
import { sendNewOrderEmail, sendOrderEmail } from "../sendgrid";
import {
  capitalizeWords,
  currencyFormatter,
  formatDate,
  getAddressString,
} from "../utils";
import { getDiscountValue, getOrderAmount } from "../inventory/utils";
import { formatOrderItems } from "./onlineOrderUtilFns";

const appUrl = process.env.APP_URL;

export const createTransaction = action({
  args: {
    checkoutSessionId: v.id("checkoutSession"),
    customerEmail: v.string(),
    amount: v.number(),
    orderDetails: orderDetailsSchema,
  },
  handler: async (ctx, args) => {
    const amountToCharge = getOrderAmount({
      discount: args.orderDetails.discount,
      deliveryFee: args.orderDetails.deliveryFee || 0,
      subtotal: args.amount,
    });

    const response = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        body: JSON.stringify({
          email: args.customerEmail,
          amount: amountToCharge.toString(),
          callback_url: `${appUrl}/shop/checkout/verify`,
          metadata: {
            cancel_action: `${appUrl}/shop/checkout`,
            checkout_session_id: args.checkoutSessionId,
            checkout_session_amount: args.amount.toString(),
            order_details: args.orderDetails,
            amount_to_charge: amountToCharge.toString(),
          },
        }),
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (response.ok) {
      const res = await response.json();

      try {
        // update the checkout session with the transaction reference
        await ctx.runMutation(
          internal.storeFront.checkoutSession.updateCheckoutSession,
          {
            id: args.checkoutSessionId,
            isFinalizingPayment: true,
            externalReference: res.data.reference,
            orderDetails: args.orderDetails,
          }
        );
      } catch (error) {
        console.error("Failed to update checkout session", error);
      }

      console.log(`finalizing payment for session: ${args.checkoutSessionId}`);

      return res.data;
    } else {
      const r = await response.json();
      console.error("Failed to create transaction", r);
    }
  },
});

export const verifyPayment = action({
  args: {
    storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
    externalReference: v.string(),
  },
  handler: async (ctx, args): Promise<any> => {
    console.log(
      `verifying payment for session with reference: ${args.externalReference}`
    );

    const response = await fetch(
      `https://api.paystack.co/transaction/verify/${args.externalReference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
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

      const subtotal = session?.amount || order?.amount || 0;

      const discount = session?.discount || order?.discount;

      const orderAmountLessDiscounts = getOrderAmount({
        discount,
        deliveryFee: order?.deliveryFee || session?.deliveryFee || 0,
        subtotal,
      });

      const discountValue =
        discount?.totalDiscount || getDiscountValue(subtotal, discount);

      const baseForDiscount = discount?.type === "percentage" ? 1 : 100;

      const actualDiscount = discountValue * baseForDiscount;

      const isVerified = Boolean(
        res.data.status == "success" &&
          res.data.amount == orderAmountLessDiscounts
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

        if (order) {
          const store = await ctx.runQuery(api.inventory.stores.getById, {
            id: order.storeId,
          });

          const formatter = currencyFormatter(store?.currency || "GHS");

          if (!order.didSendNewOrderReceivedEmail) {
            const emailResponse = await sendNewOrderEmail({
              store_name: "Wigclub",
              order_amount: formatter.format(orderAmountLessDiscounts / 100),
              order_status: "Paid",
              order_date: formatDate(order._creationTime),
              customer_name: `${order.customerDetails.firstName} ${order.customerDetails.lastName}`,
            });
            if (emailResponse.ok) {
              console.log(
                `sent new order received email for order #${order?.orderNumber} to admins`
              );
              update.didSendNewOrderReceivedEmail = true;
            } else {
              console.error(
                `Failed to send new order received email for order #${order?.orderNumber}`
              );
            }
          }

          if (!order.didSendConfirmationEmail) {
            try {
              const orderStatusMessaging =
                order.deliveryMethod == "pickup"
                  ? "Thank you for shopping with us! We're processing your order and will notify you once it's ready for pickup. Processing takes 24-48 hours."
                  : "Thank you for shopping with us! We're processing your order and will notify you once it's on the way. Processing takes 24-48 hours.";

              const orderPickupLocation = store?.config?.contactInfo?.location;

              const deliveryAddress = order.deliveryDetails
                ? getAddressString(order.deliveryDetails as Address)
                : "Details not available";

              const pickupDetails =
                order.deliveryMethod == "pickup"
                  ? orderPickupLocation
                  : deliveryAddress;

              const items = formatOrderItems(
                order.items,
                store?.currency || "GHS"
              );

              // send confirmation email
              const emailResponse = await sendOrderEmail({
                type: "confirmation",
                customerEmail: order.customerDetails.email,
                delivery_fee: order.deliveryFee
                  ? formatter.format(order.deliveryFee)
                  : undefined,
                discount: discountValue
                  ? formatter.format(actualDiscount / 100)
                  : undefined,
                store_name: "Wigclub",
                order_number: order.orderNumber,
                order_date: formatDate(order._creationTime),
                order_status_messaging: orderStatusMessaging,
                total: formatter.format(orderAmountLessDiscounts / 100),
                items,
                pickup_type: order.deliveryMethod,
                pickup_details: pickupDetails,
              });

              if (emailResponse.ok) {
                console.log(
                  `sent order confirmation for order #${order?.orderNumber} to ${order.customerDetails?.email}`
                );
                update.didSendConfirmationEmail = true;
              }
            } catch (e) {
              console.error("Failed to send order confirmation email", e);
            }
          }
        }

        await ctx.runMutation(api.storeFront.onlineOrder.update, {
          externalReference: args.externalReference,
          update,
        });

        console.log(
          `Payment Verification Success | ` +
            `Session: ${session?._id || "N/A"} | ` +
            `Order: ${order?._id || "N/A"} | ` +
            `Amount: ${orderAmountLessDiscounts / 100} | ` +
            `Customer: ${args.storeFrontUserId} | ` +
            `Reference: ${args.externalReference}`
        );
      }

      if (!isVerified) {
        console.error(
          `unable to verify payment. [session: ${session?._id}, order: ${order?._id}, customer: ${args.storeFrontUserId}, externalReference: ${args.externalReference}]`
        );
      }

      return { verified: isVerified };
    } else {
      console.error("Failed to verify transaction", response);
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
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
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

      console.log('updated order status to "refund-submitted"');

      if (args.returnItemsToStock) {
        await ctx.runMutation(api.storeFront.onlineOrder.returnItemsToStock, {
          externalTransactionId: args.externalTransactionId,
          onlineOrderItemIds: args.onlineOrderItemIds,
        });

        console.log("returned items to stock");
        return { success: true, message: res.message };
      }

      if (args.onlineOrderItemIds) {
        await ctx.runMutation(api.storeFront.onlineOrder.updateOrderItems, {
          orderItemIds: args.onlineOrderItemIds,
          updates: { isRefunded: true },
        });

        console.log("updated order items to refunded");
      }
      return { success: true, message: res.message };
    } else {
      console.error("Failed to refund payment", response);
    }

    return { success: false, message: res.message };
  },
});
