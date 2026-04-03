import { v } from "convex/values";
import { action, internalAction } from "../_generated/server";
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
      const discount = session.discount;
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

      // Log calculation inputs
      console.log(
        `[CHECKOUT-CALCULATION] Amount calculation inputs | Session: ${args.checkoutSessionId} | Items count: ${items.length} | Subtotal: ${session.amount} | Delivery fee: ${args.orderDetails.deliveryFee || 0} | Has discount: ${!!discount}`
      );
      console.log(
        `[CHECKOUT-CALCULATION] Items breakdown:`,
        items.map((item) => ({
          sku: item.productSkuId,
          qty: item.quantity,
          price: item.price,
          total: item.price * item.quantity,
        }))
      );
      if (discount) {
        console.log(`[CHECKOUT-CALCULATION] Discount details:`, {
          type: discount.discountType,
          value: discount.discountValue,
          code: discount.code,
          span: discount.span,
        });
      }

      const amountToCharge = calculateOrderAmount({
        items,
        discount,
        deliveryFee: args.orderDetails.deliveryFee || 0,  // already pesewas
        subtotal: session.amount,  // already pesewas
      });

      // Log calculation result
      console.log(
        `[CHECKOUT-CALCULATION] Amount calculated | Session: ${args.checkoutSessionId} | Final amount to charge: ${amountToCharge} (${amountToCharge / 100} in currency)`
      );

      // Log pre-Paystack details
      console.log(
        `[CHECKOUT-PRE-PAYSTACK] Initiating Paystack transaction | Session: ${args.checkoutSessionId} | Email: ${args.customerEmail} | Amount to charge: ${amountToCharge} | Has discount: ${!!discount}`
      );

      // Initialize transaction with Paystack
      const response = await initializeTransaction({
        email: args.customerEmail,
        amount: amountToCharge,
        callbackUrl: `${appUrl}/shop/checkout/verify`,
        metadata: {
          cancel_action: `${appUrl}/shop/checkout?origin=paystack`,
          checkout_session_id: args.checkoutSessionId,
          checkout_session_amount: session.amount.toString(),
          order_details: { ...args.orderDetails, discount: session.discount ?? null },
          amount_to_charge: amountToCharge.toString(),
        },
      });

      // Log successful Paystack initialization
      console.log(
        `[CHECKOUT-SUCCESS] Paystack transaction initialized | Session: ${args.checkoutSessionId} | Reference: ${response.data.reference} | Access code: ${response.data.access_code}`
      );

      // Update checkout session with transaction reference
      try {
        await ctx.runMutation(
          internal.storeFront.checkoutSession.updateCheckoutSession,
          {
            id: args.checkoutSessionId,
            isFinalizingPayment: true,
            externalReference: response.data.reference,
            orderDetails: { ...args.orderDetails, discount: session.discount ?? null },
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
      console.error(
        `[CHECKOUT-FAILURE] Failed to create transaction | Session: ${args.checkoutSessionId} | Error:`,
        error
      );
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
      const session = await ctx.runQuery(api.storeFront.checkoutSession.getById, {
        sessionId: args.checkoutSessionId,
      });

      if (!session) {
        return {
          success: false,
          message: "Session not found",
        };
      }

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
            discount: session.discount ?? null,
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
          deliveryFee: args.orderDetails.deliveryFee || 0,  // already pesewas
          subtotal: session.amount,  // already pesewas
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
    signedInAthenaUser: v.optional(
      v.object({
        id: v.id("athenaUser"),
        email: v.string(),
      })
    ),
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
        deliveryFee: order?.deliveryFee || session?.deliveryFee || 0,  // already pesewas
        subtotal,  // already pesewas (from session.amount or order.amount)
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

      // Add manual verification tracking if user is signed in and payment is verified
      if (isVerified && args.signedInAthenaUser) {
        update.manuallyVerifiedAt = Date.now();
        update.manuallyVerifiedBy = args.signedInAthenaUser;

        // Add transition entry for activity feed
        update.transitions = [
          ...(order?.transitions ?? []),
          {
            status: "payment_verified",
            date: Date.now(),
            signedInAthenaUser: args.signedInAthenaUser,
          },
        ];
      }

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

/**
 * Auto-verify payments for orders where the user completed payment on Paystack
 * but never returned to the app to trigger client-side verification.
 * Runs as a cron job, using Paystack's verify API as source of truth.
 */
export const autoVerifyUnverifiedPayments = internalAction({
  args: {},
  handler: async (ctx) => {
    const sessions = await ctx.runQuery(
      internal.storeFront.checkoutSession.getUnverifiedPaidSessions,
      {}
    );

    if (sessions.length === 0) return;

    console.log(
      `[AUTO-VERIFY] Found ${sessions.length} unverified payment(s) to process.`
    );

    for (const session of sessions) {
      const reference = session.externalReference;
      if (!reference) continue;

      try {
        const paystackResponse = await verifyTransaction(reference);

        const order: OnlineOrder | null = await ctx.runQuery(
          api.storeFront.onlineOrder.get,
          { identifier: reference }
        );

        if (!order) {
          console.warn(
            `[AUTO-VERIFY] No order found for reference: ${reference}`
          );
          continue;
        }

        // Calculate expected amount (same logic as verifyPayment)
        const subtotal = session.amount || order.amount || 0;
        const discount = session.discount || order.discount;
        const items = (order.items || [])
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
          deliveryFee: order.deliveryFee || session.deliveryFee || 0,
          subtotal,
        });

        const discountValue = getOrderDiscountValue(items, discount);

        const isVerified = validatePaymentAmount({
          paystackAmount: paystackResponse.data.amount,
          orderAmount: orderAmountLessDiscounts,
          paystackStatus: paystackResponse.data.status,
        });

        if (!isVerified) {
          console.warn(
            `[AUTO-VERIFY] Verification failed for reference: ${reference} | ` +
              `Paystack status: ${paystackResponse.data.status} | ` +
              `Paystack amount: ${paystackResponse.data.amount} | ` +
              `Expected: ${orderAmountLessDiscounts}`
          );
          continue;
        }

        // Update checkout session
        await ctx.runMutation(
          internal.storeFront.checkoutSession.updateCheckoutSession,
          { id: session._id, hasVerifiedPayment: true }
        );

        // Build order update
        const update: Record<string, any> = {
          hasVerifiedPayment: true,
          autoVerifiedAt: Date.now(),
          transitions: [
            ...(order.transitions ?? []),
            {
              status: "payment_auto_verified",
              date: Date.now(),
            },
          ],
        };

        // Send verification emails (guards against duplicates internally)
        const store = await ctx.runQuery(api.inventory.stores.getById, {
          id: order.storeId,
        });

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

        // Award loyalty points (idempotent — checks for existing reward by orderId)
        const points = calculateRewardPoints(session.amount || 0);
        const rewardResult = await ctx.runMutation(
          internal.storeFront.rewards.awardOrderPoints,
          { orderId: order._id, points }
        );

        if (rewardResult.success) {
          console.log(
            `[AUTO-VERIFY] Awarded ${points} points for order ${order._id}`
          );
        }

        // Update order
        await ctx.runMutation(api.storeFront.onlineOrder.update, {
          externalReference: reference,
          update,
        });

        console.log(
          `[AUTO-VERIFY] Verified payment | Reference: ${reference} | Order: ${order._id}`
        );
      } catch (error) {
        console.error(
          `[AUTO-VERIFY] Error processing session ${session._id}:`,
          error
        );
      }
    }
  },
});
