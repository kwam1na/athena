import { v } from "convex/values";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { CheckoutSession, OnlineOrder } from "../../types";
import { orderDetailsSchema } from "../schemas/storeFront";
import {
  PaymentResult,
  PaymentVerificationResult,
  PaymentMethodDetails,
} from "../types/payment";
import {
  initializeTransaction,
  verifyTransaction,
  initiateRefund,
} from "../services/paystackService";
import {
  generatePODReference,
  extractOrderItems,
  calculateOrderAmount,
  calculateRewardPoints,
  validatePaymentAmount,
  getOrderDiscountValue,
} from "./helpers/paymentHelpers";
import {
  sendPODOrderEmails,
  sendPaymentVerificationEmails,
} from "../services/orderEmailService";

const appUrl = process.env.APP_URL;

/**
 * Create a Paystack transaction for online payment
 */
export const createTransaction = action({
  args: {
    checkoutSessionId: v.id("checkoutSession"),
    customerEmail: v.string(),
    amount: v.number(),
    orderDetails: orderDetailsSchema,
  },
  returns: v.union(
    v.object({
      success: v.boolean(),
      message: v.string(),
    }),
    v.object({
      authorization_url: v.string(),
      access_code: v.string(),
      reference: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    try {
      // Fetch the checkout session
      const session = await ctx.runQuery(
        api.storeFront.checkoutSession.getById,
        {
          sessionId: args.checkoutSessionId,
        }
      );

      if (!session) {
        return {
          success: false,
          message: "Session not found",
        };
      }

      // Extract and calculate order amount
      const discount = session.discount || args.orderDetails.discount;
      const items = (session.items || [])
        .filter(
          (item) =>
            item.productSkuId !== undefined &&
            item.quantity !== undefined &&
            item.price !== undefined
        )
        .map((item) => ({
          productSkuId: item.productSkuId,
          quantity: item.quantity,
          price: item.price!,
        }));

      const amountToCharge = calculateOrderAmount({
        items,
        discount,
        deliveryFee: (args.orderDetails.deliveryFee || 0) * 100,
        subtotal: args.amount * 100,
      });

      // Initialize transaction with Paystack
      const response = await initializeTransaction({
        email: args.customerEmail,
        amount: amountToCharge,
        callbackUrl: `${appUrl}/shop/checkout/verify`,
        metadata: {
          cancel_action: `${appUrl}/shop/checkout?origin=paystack`,
          checkout_session_id: args.checkoutSessionId,
          checkout_session_amount: args.amount.toString(),
          order_details: args.orderDetails,
          amount_to_charge: amountToCharge.toString(),
        },
      });

      // Update checkout session with transaction reference
      try {
        await ctx.runMutation(
          internal.storeFront.checkoutSession.updateCheckoutSession,
          {
            id: args.checkoutSessionId,
            isFinalizingPayment: true,
            externalReference: response.data.reference,
            orderDetails: args.orderDetails,
          }
        );
      } catch (error) {
        console.error(
          "Failed to update checkout session with transaction reference",
          error
        );
      }

      console.log(`Finalizing payment for session: ${args.checkoutSessionId}`);

      return response.data;
    } catch (error) {
      console.error("Failed to create transaction", error);
      return {
        success: false,
        message: "Failed to create payment transaction",
      };
    }
  },
});

/**
 * Create a Payment on Delivery (POD) order
 */
export const createPODOrder = action({
  args: {
    checkoutSessionId: v.id("checkoutSession"),
    customerEmail: v.string(),
    amount: v.number(),
    orderDetails: orderDetailsSchema,
  },
  returns: v.object({
    success: v.boolean(),
    message: v.string(),
    reference: v.optional(v.string()),
  }),
  handler: async (ctx, args): Promise<PaymentResult> => {
    console.log(`Creating POD order for session: ${args.checkoutSessionId}`);

    try {
      // Generate POD reference
      const podReference = generatePODReference(args.checkoutSessionId);

      // Build payment method details
      const paymentMethod: PaymentMethodDetails = {
        type: "payment_on_delivery",
        podPaymentMethod: args.orderDetails.podPaymentMethod || "cash",
        channel: args.orderDetails.podPaymentMethod || "cash",
      };

      // Update checkout session with order details
      await ctx.runMutation(
        internal.storeFront.checkoutSession.updateCheckoutSession,
        {
          id: args.checkoutSessionId,
          hasCompletedPayment: false,
          hasVerifiedPayment: false,
          externalReference: podReference,
          orderDetails: {
            ...args.orderDetails,
            paymentMethod: "payment_on_delivery",
          },
          paymentMethod,
        }
      );

      // Create the order from the updated session
      await ctx.runMutation(internal.storeFront.onlineOrder.createFromSession, {
        checkoutSessionId: args.checkoutSessionId,
        externalTransactionId: podReference,
        paymentMethod,
      });

      // Fetch the created order
      const order = await ctx.runQuery(api.storeFront.onlineOrder.get, {
        identifier: podReference,
      });

      if (order) {
        // Fetch store details
        const store = await ctx.runQuery(api.inventory.stores.getById, {
          id: order.storeId,
        });

        const amountToCharge = calculateOrderAmount({
          items: order.items || [],
          discount: order.discount || 0,
          deliveryFee: (args.orderDetails.deliveryFee || 0) * 100,
          subtotal: args.amount * 100,
        });

        // Send confirmation and admin notification emails
        const emailResults = await sendPODOrderEmails({
          order,
          store,
          amount: amountToCharge,
          podPaymentMethod: args.orderDetails.podPaymentMethod,
        });

        // Update order with email statuses
        await ctx.runMutation(api.storeFront.onlineOrder.update, {
          orderId: order._id,
          update: {
            didSendConfirmationEmail: emailResults.confirmationSent,
            didSendNewOrderReceivedEmail: emailResults.adminNotificationSent,
          },
        });
      }

      console.log(
        `Successfully created POD order with reference: ${podReference}`
      );

      return {
        success: true,
        message: "Payment on delivery order created successfully",
        reference: podReference,
      };
    } catch (error) {
      console.error("Failed to create POD order:", error);
      return {
        success: false,
        message: "Failed to create payment on delivery order",
      };
    }
  },
});

/**
 * Verify a payment transaction with Paystack
 */
export const verifyPayment = action({
  args: {
    storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
    externalReference: v.string(),
  },
  returns: v.union(
    v.object({
      verified: v.boolean(),
    }),
    v.object({
      message: v.string(),
    })
  ),
  handler: async (ctx, args): Promise<PaymentVerificationResult> => {
    console.log(
      `Verifying payment for session with reference: ${args.externalReference}`
    );

    try {
      // Verify transaction with Paystack
      const paystackResponse = await verifyTransaction(args.externalReference);

      // Fetch session and order
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

      // Calculate expected order amount
      const subtotal = session?.amount || order?.amount || 0; // already in cents
      const discount = session?.discount || order?.discount;
      const items = (order?.items || [])
        .filter(
          (item) =>
            item.productSkuId !== undefined &&
            item.quantity !== undefined &&
            item.price !== undefined
        )
        .map((item) => ({
          productSkuId: item.productSkuId,
          quantity: item.quantity,
          price: item.price!,
        }));

      const orderAmountLessDiscounts = calculateOrderAmount({
        items,
        discount,
        deliveryFee: (order?.deliveryFee || session?.deliveryFee || 0) * 100,
        subtotal,
      });

      const discountValue = getOrderDiscountValue(items, discount);

      // Validate payment
      const isVerified = validatePaymentAmount({
        paystackAmount: paystackResponse.data.amount,
        orderAmount: orderAmountLessDiscounts,
        paystackStatus: paystackResponse.data.status,
      });

      if (isVerified) {
        // Update session as verified
        if (session) {
          await ctx.runMutation(
            internal.storeFront.checkoutSession.updateCheckoutSession,
            {
              id: session._id,
              hasVerifiedPayment: true,
            }
          );
        }

        console.log(
          `Payment Verification Success | ` +
            `Session: ${session?._id || "N/A"} | ` +
            `Order: ${order?._id || "N/A"} | ` +
            `Amount: ${orderAmountLessDiscounts / 100} | ` +
            `Customer: ${args.storeFrontUserId} | ` +
            `Reference: ${args.externalReference}`
        );
      } else {
        console.log(
          `Unable to verify payment. [session: ${session?._id}, order: ${order?._id}, customer: ${args.storeFrontUserId}, reference: ${args.externalReference}]`
        );
        console.info(
          `Status: ${paystackResponse.data.status}, Paystack amount: ${paystackResponse.data.amount}, Expected amount: ${orderAmountLessDiscounts}`
        );
      }

      const update: Record<string, any> = { hasVerifiedPayment: isVerified };

      // Handle emails and rewards for the order
      if (order) {
        const store = await ctx.runQuery(api.inventory.stores.getById, {
          id: order.storeId,
        });

        // Send confirmation and admin notification emails
        const emailResults = await sendPaymentVerificationEmails({
          order,
          store,
          orderAmount: orderAmountLessDiscounts,
          discountValue,
          didSendNewOrderEmail: order.didSendNewOrderReceivedEmail || false,
          didSendConfirmationEmail: order.didSendConfirmationEmail || false,
        });

        if (emailResults.confirmationSent) {
          update.didSendConfirmationEmail = true;
          update.orderReceivedEmailSentAt = Date.now();
        }

        if (emailResults.adminNotificationSent) {
          update.didSendNewOrderReceivedEmail = true;
        }

        // Award loyalty points
        const points = calculateRewardPoints(session?.amount || 0);
        const rewardResult = await ctx.runMutation(
          internal.storeFront.rewards.awardOrderPoints,
          {
            orderId: order._id,
            points,
          }
        );

        if (rewardResult.success) {
          console.log(`Awarded ${points} points for order ${order._id}`);
        } else {
          console.log("Failed to award points", rewardResult.error);
        }
      }

      // Update order with verification and email statuses
      await ctx.runMutation(api.storeFront.onlineOrder.update, {
        externalReference: args.externalReference,
        update,
      });

      return { verified: isVerified };
    } catch (error) {
      console.error("Failed to verify transaction", error);
      return {
        verified: false,
        message: "No active session found.",
      };
    }
  },
});

/**
 * Refund a payment transaction
 */
export const refundPayment = action({
  args: {
    externalTransactionId: v.string(),
    amount: v.optional(v.number()),
    returnItemsToStock: v.boolean(),
    onlineOrderItemIds: v.optional(v.array(v.id("onlineOrderItem"))),
    refundItems: v.optional(v.array(v.string())),
    signedInAthenaUser: v.optional(
      v.object({
        id: v.id("athenaUser"),
        email: v.string(),
      })
    ),
  },
  returns: v.object({
    success: v.boolean(),
    message: v.string(),
  }),
  handler: async (ctx, args): Promise<PaymentResult> => {
    try {
      // Initiate refund with Paystack
      const refundResponse = await initiateRefund({
        transactionReference: args.externalTransactionId,
        amount: args.amount,
      });

      // Update order status to refund-submitted
      await ctx.runMutation(api.storeFront.onlineOrder.update, {
        externalReference: refundResponse.data?.transaction?.reference,
        update: {
          status: "refund-submitted",
          didRefundDeliveryFee: args.refundItems?.includes("delivery-fee"),
        },
        signedInAthenaUser: args.signedInAthenaUser,
      });

      console.log('Updated order status to "refund-submitted"');

      // Handle stock returns if requested
      if (args.returnItemsToStock && args.onlineOrderItemIds) {
        await ctx.runMutation(api.storeFront.onlineOrder.returnItemsToStock, {
          externalTransactionId: args.externalTransactionId,
          onlineOrderItemIds: args.onlineOrderItemIds,
        });
        console.log("Returned items to stock");
      } else if (args.onlineOrderItemIds) {
        // Mark items as refunded without returning to stock
        await ctx.runMutation(api.storeFront.onlineOrder.updateOrderItems, {
          orderItemIds: args.onlineOrderItemIds,
          updates: { isRefunded: true },
        });
        console.log("Updated order items to refunded");
      }

      return {
        success: true,
        message: refundResponse.message,
      };
    } catch (error) {
      console.error("Failed to refund payment", error);
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Failed to refund payment",
      };
    }
  },
});
