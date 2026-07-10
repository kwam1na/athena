import { v } from "convex/values";
import { action, ActionCtx, internalAction } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { commandResultValidator } from "../lib/commandResultValidators";
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
  calculateItemsSubtotal,
  calculateOrderAmount,
  calculateRewardPoints,
  validatePaymentAmount,
  getOrderDiscountValue,
  resolveServerDeliveryFee,
} from "./helpers/paymentHelpers";
import {
  sendPODOrderEmails,
  sendPaymentVerificationEmails,
} from "../services/orderEmailService";
import { ok, userError, type CommandResult } from "../../shared/commandResult";
import {
  deriveScheduledRunOutcome,
  type ScheduledCronFamily,
} from "../automation/scheduledRunLedger";

const appUrl = process.env.APP_URL;

type RefundReservationResult = {
  customerProfileId?: string;
  message?: string;
  orderId?: string;
  refundAmount?: number;
  reservationId?: string;
  storeId?: string;
  success: boolean;
};

type ScheduledRunStoreStats = {
  candidateCount: number;
  processedCount: number;
  succeededCount: number;
  failedCount: number;
  skippedCount: number;
  sampleSubjectIds: string[];
};

function addScheduledRunCandidate(
  stats: Map<string, ScheduledRunStoreStats>,
  storeId: Id<"store">,
  subjectId: string,
) {
  const existing =
    stats.get(storeId) ??
    ({
      candidateCount: 0,
      processedCount: 0,
      succeededCount: 0,
      failedCount: 0,
      skippedCount: 0,
      sampleSubjectIds: [],
    } satisfies ScheduledRunStoreStats);

  existing.candidateCount += 1;
  if (existing.sampleSubjectIds.length < 25) {
    existing.sampleSubjectIds.push(subjectId);
  }
  stats.set(storeId, existing);
  return existing;
}

async function recordPaymentScheduledRunEvidence(args: {
  ctx: ActionCtx;
  cronFamily: ScheduledCronFamily;
  sourceSubjectType: string;
  storeStats: Map<string, ScheduledRunStoreStats>;
  totalCandidateCount: number;
  totalProcessedCount: number;
  totalSucceededCount: number;
  totalFailedCount: number;
  totalSkippedCount: number;
  totalSampleSubjectIds: string[];
}) {
  try {
    await args.ctx.runMutation(
      internal.automation.scheduledRunLedger.recordScheduledRunEvidence,
      {
        cronFamily: args.cronFamily,
        scope: "system",
        visibility: "support",
        outcome:
          args.totalCandidateCount === 0
            ? "no_candidates"
            : args.totalFailedCount > 0 && args.totalSucceededCount === 0
              ? "failed"
              : args.totalFailedCount > 0
                ? "partial_failure"
                : "support_only",
        candidateCount: args.totalCandidateCount,
        processedCount: args.totalProcessedCount,
        succeededCount: args.totalSucceededCount,
        failedCount: args.totalFailedCount,
        skippedCount: args.totalSkippedCount,
        sourceSubjectType: args.sourceSubjectType,
        sampleSubjectIds: args.totalSampleSubjectIds,
        snapshotCounts: {
          stores: args.storeStats.size,
        },
        notes:
          "Cross-store scheduled run summary. Store-scoped rows hold operator-visible evidence.",
      },
    );
  } catch (error) {
    console.error("[SCHEDULED-RUN] Failed to record payment summary", error);
  }

  await Promise.all(
    Array.from(args.storeStats.entries()).map(async ([storeId, stats]) => {
      try {
        await args.ctx.runMutation(
          internal.automation.scheduledRunLedger.recordScheduledRunEvidence,
          {
            cronFamily: args.cronFamily,
            scope: "store",
            storeId: storeId as Id<"store">,
            outcome: deriveScheduledRunOutcome(stats),
            candidateCount: stats.candidateCount,
            processedCount: stats.processedCount,
            succeededCount: stats.succeededCount,
            failedCount: stats.failedCount,
            skippedCount: stats.skippedCount,
            sourceSubjectType: args.sourceSubjectType,
            sampleSubjectIds: stats.sampleSubjectIds,
          },
        );
      } catch (error) {
        console.error("[SCHEDULED-RUN] Failed to record payment store row", {
          cronFamily: args.cronFamily,
          storeId,
          error,
        });
      }
    }),
  );
}

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
    }),
  ),
  handler: async (ctx, args) => {
    try {
      // Fetch the checkout session
      const session = await ctx.runQuery(
        api.storeFront.checkoutSession.getById,
        {
          sessionId: args.checkoutSessionId,
        },
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
            item.price !== undefined,
        )
        .map((item) => ({
          productSkuId: item.productSkuId,
          quantity: item.quantity,
          price: item.price!,
        }));
      const subtotal = calculateItemsSubtotal(items);
      const store = await ctx.runQuery(internal.inventory.stores.findById, {
        id: session.storeId,
      });
      const deliveryFee = resolveServerDeliveryFee({
        deliveryDetails: args.orderDetails.deliveryDetails,
        deliveryMethod: args.orderDetails.deliveryMethod,
        deliveryOption: args.orderDetails.deliveryOption,
        storeConfig: store?.config,
        subtotal,
      });

      if (deliveryFee === null) {
        return {
          success: false,
          message: "Delivery details are required before payment can be created",
        };
      }

      // Log calculation inputs
      console.log(
        `[CHECKOUT-CALCULATION] Amount calculation inputs | Session: ${args.checkoutSessionId} | Items count: ${items.length} | Subtotal: ${subtotal} | Delivery fee: ${deliveryFee} | Has discount: ${!!discount}`,
      );
      console.log(
        `[CHECKOUT-CALCULATION] Items breakdown:`,
        items.map((item) => ({
          sku: item.productSkuId,
          qty: item.quantity,
          price: item.price,
          total: item.price * item.quantity,
        })),
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
        deliveryFee,
        subtotal,
      });

      // Log calculation result
      console.log(
        `[CHECKOUT-CALCULATION] Amount calculated | Session: ${args.checkoutSessionId} | Final amount to charge: ${amountToCharge} (${amountToCharge / 100} in currency)`,
      );

      // Log pre-Paystack details
      console.log(
        `[CHECKOUT-PRE-PAYSTACK] Initiating Paystack transaction | Session: ${args.checkoutSessionId} | Email: ${args.customerEmail} | Amount to charge: ${amountToCharge} | Has discount: ${!!discount}`,
      );

      // Initialize transaction with Paystack
      const response = await initializeTransaction({
        email: args.customerEmail,
        amount: amountToCharge,
        callbackUrl: `${appUrl}/shop/checkout/verify`,
        metadata: {
          cancel_action: `${appUrl}/shop/checkout?origin=paystack`,
          checkout_session_id: args.checkoutSessionId,
          checkout_session_amount: subtotal.toString(),
          order_details: {
            ...args.orderDetails,
            deliveryFee,
            discount: session.discount ?? null,
          },
          amount_to_charge: amountToCharge.toString(),
        },
      });

      // Log successful Paystack initialization
      console.log(
        `[CHECKOUT-SUCCESS] Paystack transaction initialized | Session: ${args.checkoutSessionId} | Reference: ${response.data.reference} | Access code: ${response.data.access_code}`,
      );

      // Update checkout session with transaction reference
      try {
        await ctx.runMutation(
          internal.storeFront.checkoutSession.updateCheckoutSession,
          {
            id: args.checkoutSessionId,
            isFinalizingPayment: true,
            externalReference: response.data.reference,
            orderDetails: {
              ...args.orderDetails,
              deliveryFee,
              discount: session.discount ?? null,
            },
          },
        );
      } catch (error) {
        console.error(
          "Failed to update checkout session with transaction reference",
          error,
        );
      }

      console.log(`Finalizing payment for session: ${args.checkoutSessionId}`);

      return response.data;
    } catch (error) {
      console.error(
        `[CHECKOUT-FAILURE] Failed to create transaction | Session: ${args.checkoutSessionId} | Error:`,
        error,
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
      const session = await ctx.runQuery(
        internal.storeFront.checkoutSession.getByIdInternal,
        {
          sessionId: args.checkoutSessionId,
        },
      );

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
      const items = (session.items || [])
        .filter(
          (item) =>
            item.productSkuId !== undefined &&
            item.quantity !== undefined &&
            item.price !== undefined,
        )
        .map((item) => ({
          productSkuId: item.productSkuId,
          quantity: item.quantity,
          price: item.price!,
        }));
      const subtotal = calculateItemsSubtotal(items);
      const storeForFee = await ctx.runQuery(internal.inventory.stores.findById, {
        id: session.storeId,
      });
      const deliveryFee = resolveServerDeliveryFee({
        deliveryDetails: args.orderDetails.deliveryDetails,
        deliveryMethod: args.orderDetails.deliveryMethod,
        deliveryOption: args.orderDetails.deliveryOption,
        storeConfig: storeForFee?.config,
        subtotal,
      });

      if (deliveryFee === null) {
        return {
          success: false,
          message: "Delivery details are required before payment on delivery can be created",
        };
      }

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
            deliveryFee,
            paymentMethod: "payment_on_delivery",
            discount: session.discount ?? null,
          },
          paymentMethod,
        },
      );

      // Create the order from the updated session
      await ctx.runMutation(internal.storeFront.onlineOrder.createFromSession, {
        checkoutSessionId: args.checkoutSessionId,
        externalTransactionId: podReference,
        paymentMethod,
      });

      // Fetch the created order
      const order = await ctx.runQuery(
        internal.storeFront.onlineOrder.getInternal,
        {
          identifier: podReference,
        },
      );

      if (order) {
        // Fetch store details
        const store = await ctx.runQuery(internal.inventory.stores.findById, {
          id: order.storeId,
        });

        const amountToCharge = calculateOrderAmount({
          items: order.items || [],
          discount: order.discount || 0,
          deliveryFee,
          subtotal,
        });

        // Send confirmation and admin notification emails
        const emailResults = await sendPODOrderEmails({
          order,
          store,
          amount: amountToCharge,
          podPaymentMethod: args.orderDetails.podPaymentMethod,
        });

        // Update order with email statuses
        await ctx.runMutation(internal.storeFront.onlineOrder.updateInternal, {
          orderId: order._id,
          update: {
            didSendConfirmationEmail: emailResults.confirmationSent,
            didSendNewOrderReceivedEmail: emailResults.adminNotificationSent,
          },
        });
      }

      console.log(
        `Successfully created POD order with reference: ${podReference}`,
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
      }),
    ),
  },
  returns: v.union(
    v.object({
      verified: v.boolean(),
    }),
    v.object({
      message: v.string(),
    }),
  ),
  handler: async (ctx, args): Promise<PaymentVerificationResult> => {
    console.log(
      `Verifying payment for session with reference: ${args.externalReference}`,
    );

    try {
      // Verify transaction with Paystack
      const paystackResponse = await verifyTransaction(args.externalReference);

      // Fetch session and order
      const session: CheckoutSession | null = await ctx.runQuery(
        internal.storeFront.checkoutSession.getCheckoutSession,
        {
          storeFrontUserId: args.storeFrontUserId,
          externalReference: args.externalReference,
        },
      );

      const order: OnlineOrder | null = await ctx.runQuery(
        api.storeFront.onlineOrder.get,
        {
          identifier: args.externalReference,
        },
      );

      // Calculate expected order amount
      const subtotal = session?.amount || order?.amount || 0; // already in cents
      const discount = session?.discount || order?.discount;
      const items = (order?.items || [])
        .filter(
          (item) =>
            item.productSkuId !== undefined &&
            item.quantity !== undefined &&
            item.price !== undefined,
        )
        .map((item) => ({
          productSkuId: item.productSkuId,
          quantity: item.quantity,
          price: item.price!,
        }));

      const orderAmountLessDiscounts = calculateOrderAmount({
        items,
        discount,
        deliveryFee: order?.deliveryFee || session?.deliveryFee || 0, // already pesewas
        subtotal, // already pesewas (from session.amount or order.amount)
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
            },
          );
        }

        console.log(
          `Payment Verification Success | ` +
            `Session: ${session?._id || "N/A"} | ` +
            `Order: ${order?._id || "N/A"} | ` +
            `Amount: ${orderAmountLessDiscounts / 100} | ` +
            `Customer: ${args.storeFrontUserId} | ` +
            `Reference: ${args.externalReference}`,
        );
      } else {
        console.log(
          `Unable to verify payment. [session: ${session?._id}, order: ${order?._id}, customer: ${args.storeFrontUserId}, reference: ${args.externalReference}]`,
        );
        console.info(
          `Status: ${paystackResponse.data.status}, Paystack amount: ${paystackResponse.data.amount}, Expected amount: ${orderAmountLessDiscounts}`,
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
        const store = await ctx.runQuery(internal.inventory.stores.findById, {
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
          },
        );

        if (rewardResult.success) {
          console.log(`Awarded ${points} points for order ${order._id}`);
        } else {
          console.log("Failed to award points", rewardResult.error);
        }
      }

      // Update order with verification and email statuses
      await ctx.runMutation(internal.storeFront.onlineOrder.updateInternal, {
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
      }),
    ),
  },
  returns: commandResultValidator(
    v.object({
      message: v.string(),
    })
  ),
  handler: async (
    ctx,
    args,
  ): Promise<CommandResult<{ message: string }>> => {
    let refundReservation: RefundReservationResult | undefined;
    let refundFinalized = false;

    try {
      const reservation = (await ctx.runMutation(
        internal.storeFront.onlineOrder.reserveRefundInternal,
        {
          externalTransactionId: args.externalTransactionId,
          requestedAmount: args.amount,
        },
      )) as RefundReservationResult;
      refundReservation = reservation;

      if (
        !reservation.success ||
        !reservation.refundAmount ||
        !reservation.reservationId
      ) {
        return userError({
          code:
            reservation.message === "Order not found."
              ? "not_found"
              : "validation_failed",
          message:
            reservation.message ??
            "Unable to reserve the requested refund amount.",
        });
      }

      const refundAmount = reservation.refundAmount;

      // Initiate refund with Paystack
      const refundResponse = await initiateRefund({
        transactionReference: args.externalTransactionId,
        amount: refundAmount,
      });
      const refundId =
        refundResponse.data?.transaction?.reference ?? `refund-${Date.now()}`;

      await ctx.runMutation(internal.storeFront.onlineOrder.finalizeRefundInternal, {
        didRefundDeliveryFee: args.refundItems?.includes("delivery-fee"),
        externalTransactionId: args.externalTransactionId,
        onlineOrderItemIds: args.onlineOrderItemIds,
        refundAmount,
        refundId,
        reservationId: reservation.reservationId,
        signedInAthenaUser: args.signedInAthenaUser,
      });
      refundFinalized = true;

      console.log('Updated order status to "refund-submitted"');

      // Handle stock returns if requested
      if (args.returnItemsToStock && args.onlineOrderItemIds) {
        await ctx.runMutation(
          internal.storeFront.onlineOrder.returnItemsToStockInternal,
          {
            externalTransactionId: args.externalTransactionId,
            onlineOrderItemIds: args.onlineOrderItemIds,
          },
        );
        console.log("Returned items to stock");
      } else if (args.onlineOrderItemIds) {
        // Mark items as refunded without returning to stock
        await ctx.runMutation(
          internal.storeFront.onlineOrder.updateOrderItemsInternal,
          {
            orderItemIds: args.onlineOrderItemIds,
            updates: { isRefunded: true },
          },
        );
        console.log("Updated order items to refunded");
      }

      return ok({
        message: refundResponse.message,
      });
    } catch (error) {
      console.error("Failed to refund payment", error);
      const message = error instanceof Error ? error.message : "";

      if (refundReservation?.reservationId && !refundFinalized) {
        await ctx.runMutation(
          internal.storeFront.onlineOrder.releaseRefundReservationInternal,
          {
            externalTransactionId: args.externalTransactionId,
            reservationId: refundReservation.reservationId,
          },
        );
      }

      if (
        message === "Refund amount must be a positive integer minor-unit amount." ||
        message === "Refund amount exceeds the remaining refundable balance."
      ) {
        return userError({
          code: "validation_failed",
          message,
        });
      }

      return userError({
        code: "unavailable",
        message: "Failed to refund payment.",
      });
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
    const orders = await ctx.runQuery(
      internal.storeFront.onlineOrder.getUnverifiedPaidOrders,
      {},
    );
    const storeStats = new Map<string, ScheduledRunStoreStats>();
    const sampleSubjectIds: string[] = [];
    let processedCount = 0;
    let succeededCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    if (orders.length === 0) {
      console.log(`[AUTO-VERIFY] Found no unverified payment(s) to process.`);
      await recordPaymentScheduledRunEvidence({
        ctx,
        cronFamily: "auto-verify-payments",
        sourceSubjectType: "onlineOrder",
        storeStats,
        totalCandidateCount: 0,
        totalProcessedCount: 0,
        totalSucceededCount: 0,
        totalFailedCount: 0,
        totalSkippedCount: 0,
        totalSampleSubjectIds: [],
      });
      return;
    }

    console.log(
      `[AUTO-VERIFY] Found ${orders.length} unverified payment(s) to process.`,
    );

    for (const order of orders) {
      const stats = addScheduledRunCandidate(
        storeStats,
        order.storeId,
        order._id,
      );
      if (sampleSubjectIds.length < 25) {
        sampleSubjectIds.push(order._id);
      }
      processedCount += 1;
      stats.processedCount += 1;

      const reference = order.externalReference;
      if (!reference) {
        skippedCount += 1;
        stats.skippedCount += 1;
        continue;
      }

      try {
        const paystackResponse = await verifyTransaction(reference);

        // Calculate expected amount (same logic as verifyPayment)
        const subtotal = order.amount || 0;
        const discount = order.discount;
        const items = (order.items || [])
          .filter(
            (item) =>
              item.productSkuId !== undefined &&
              item.quantity !== undefined &&
              item.price !== undefined,
          )
          .map((item) => ({
            productSkuId: item.productSkuId,
            quantity: item.quantity,
            price: item.price!,
          }));

        const orderAmountLessDiscounts = calculateOrderAmount({
          items,
          discount,
          deliveryFee: order.deliveryFee || 0,
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
              `Expected: ${orderAmountLessDiscounts}`,
          );
          skippedCount += 1;
          stats.skippedCount += 1;
          continue;
        }

        // Update checkout session
        await ctx.runMutation(
          internal.storeFront.checkoutSession.updateCheckoutSession,
          { id: order.checkoutSessionId, hasVerifiedPayment: true },
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
        const store = await ctx.runQuery(internal.inventory.stores.findById, {
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
        const points = calculateRewardPoints(order.amount || 0);
        const rewardResult = await ctx.runMutation(
          internal.storeFront.rewards.awardOrderPoints,
          { orderId: order._id, points },
        );

        if (rewardResult.success) {
          console.log(
            `[AUTO-VERIFY] Awarded ${points} points for order ${order._id}`,
          );
        }

        await Promise.all([
          // Update order
          await ctx.runMutation(
            internal.storeFront.onlineOrder.updateInternal,
            {
              externalReference: reference,
              update,
            },
          ),

          // Update checkout session for the order
          await ctx.runMutation(
            internal.storeFront.checkoutSession.updateCheckoutSession,
            {
              id: order.checkoutSessionId,
              hasCompletedCheckoutSession: true,
            },
          ),
        ]);

        console.log(
          `[AUTO-VERIFY] Verified payment | Reference: ${reference} | Order: ${order._id}`,
        );
        succeededCount += 1;
        stats.succeededCount += 1;
      } catch (error) {
        failedCount += 1;
        stats.failedCount += 1;
        console.error(
          `[AUTO-VERIFY] Error processing order ${order._id}:`,
          error,
        );
      }
    }
    await recordPaymentScheduledRunEvidence({
      ctx,
      cronFamily: "auto-verify-payments",
      sourceSubjectType: "onlineOrder",
      storeStats,
      totalCandidateCount: orders.length,
      totalProcessedCount: processedCount,
      totalSucceededCount: succeededCount,
      totalFailedCount: failedCount,
      totalSkippedCount: skippedCount,
      totalSampleSubjectIds: sampleSubjectIds,
    });
  },
});
