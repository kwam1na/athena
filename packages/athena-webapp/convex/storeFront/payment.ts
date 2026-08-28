import { v } from "convex/values";
import { action, ActionCtx, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
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

import { refundPaymentOperationDefinition } from "../operationAdmission/domains/storefrontCustomer_definitions";
import { admitPublicAction } from "../platform/operationAdmission";
import {
  assertCustomerOwnsRow,
  customerOwnerValidator,
  type CustomerOwner,
} from "./customerOwnership";

/**
 * Every `enforceSharedDemoActionCapability` call site in this module is retired
 * in favour of the definition it stood in for:
 *
 * | retired site                          | successor on the definition                                  |
 * |---------------------------------------|--------------------------------------------------------------|
 * | createTransaction ("billing.manage")  | capability `billing.manage`, gateway `payment.collect`, demo deny |
 * | createPODOrder ("billing.manage")     | capability `billing.manage`, gateway `payment.collect`, demo deny |
 * | verifyPayment ("billing.manage")      | capability `billing.manage`, gateway `payment.collect`, demo deny |
 * | refundPayment ("payments.refund")     | capability `payments.refund`, gateway `payment.refund`, demo ADMIT + `store_ready` |
 *
 * `billing.manage` is not in `SHARED_DEMO_ALLOWED_CAPABILITIES`, so the three
 * collection paths deny a demo principal exactly as the helper did.
 * `payments.refund` IS granted and `payment.refund` is classified `simulated`,
 * so the refund keeps its demo reach — and now also gains the store clamp and
 * the restore fence the ad-hoc call never applied. `isSharedDemo` is read from
 * the admitted actor instead of the helper's return value.
 */

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
const paymentSessionArgs = {
  checkoutSessionId: v.id("checkoutSession"),
  customerEmail: v.string(),
  amount: v.number(),
  orderDetails: orderDetailsSchema,
};

type PaymentSessionArgs = {
  checkoutSessionId: Id<"checkoutSession">;
  customerEmail: string;
  amount: number;
  orderDetails: any;
};

/** The session named in the path must belong to the admitted shopper. */
async function requireOwnedCheckoutSession(
  ctx: ActionCtx,
  checkoutSessionId: Id<"checkoutSession">,
  owner: { guestId?: Id<"guest">; storeFrontUserId?: Id<"storeFrontUser">; storeId: Id<"store"> },
) {
  const session = await ctx.runQuery(
    internal.storeFront.checkoutSession.getByIdInternal,
    { sessionId: checkoutSessionId },
  );
  assertCustomerOwnsRow(owner, session);
  return session;
}

async function createTransactionWithCtx(
  ctx: ActionCtx,
  args: PaymentSessionArgs,
): Promise<any> {
  {
    try {
      // Fetch the checkout session. This used to re-enter through
      // `api.storeFront.checkoutSession.getById`, which ran a second admission
      // with the backend's own context; the internal twin returns the same
      // enriched shape under this call's admission.
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
  }
}

/**
 * Internal sibling for `POST /checkout/:checkoutSessionId` (pay action). The
 * session named in the path must belong to the admitted shopper before a live
 * Paystack transaction is initialized for it.
 */
export const createTransactionInternal = internalAction({
  args: { ...paymentSessionArgs, owner: customerOwnerValidator },
  // Carried over from the deleted public `createTransaction`. An internal
  // sibling is still a contract with its caller, and dropping the validator
  // during internalization silently removed the only runtime check that this
  // action returns what the route serialises.
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
  handler: async (ctx, { owner, ...args }): Promise<any> => {
    await requireOwnedCheckoutSession(ctx, args.checkoutSessionId, owner);
    return await createTransactionWithCtx(ctx, args);
  },
});

/**
 * Create a Payment on Delivery (POD) order
 */
async function createPODOrderWithCtx(
  ctx: ActionCtx,
  args: PaymentSessionArgs,
): Promise<PaymentResult> {
  {
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
  }
}

/** Internal sibling for `POST /checkout/:checkoutSessionId` (POD action). */
export const createPODOrderInternal = internalAction({
  args: { ...paymentSessionArgs, owner: customerOwnerValidator },
  // Carried over from the deleted public `createPODOrder` — see the note on
  // `createTransactionInternal` above.
  returns: v.object({
    success: v.boolean(),
    message: v.string(),
    reference: v.optional(v.string()),
  }),
  handler: async (ctx, { owner, ...args }): Promise<PaymentResult> => {
    await requireOwnedCheckoutSession(ctx, args.checkoutSessionId, owner);
    return await createPODOrderWithCtx(ctx, args);
  },
});

/**
 * Verify a payment transaction with Paystack
 */
const verifyPaymentArgs = {
  storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
  externalReference: v.string(),
  signedInAthenaUser: v.optional(
    v.object({
      id: v.id("athenaUser"),
      email: v.string(),
    }),
  ),
};

type VerifyPaymentArgs = {
  storeFrontUserId: Id<"storeFrontUser"> | Id<"guest">;
  externalReference: string;
  owner: CustomerOwner;
  signedInAthenaUser?: { id: Id<"athenaUser">; email: string };
};

async function verifyPaymentWithCtx(
  ctx: ActionCtx,
  args: VerifyPaymentArgs,
): Promise<PaymentVerificationResult> {
  {
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

      // Resolve the Paystack reference through the internal query that safely
      // distinguishes external references from Convex document ids.
      const order: OnlineOrder | null = await ctx.runQuery(
        internal.storeFront.onlineOrder.getForCustomerInternal,
        {
          identifier: args.externalReference,
          owner: args.owner,
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
  }
}

/**
 * Internal sibling for `GET /checkout/verify/:reference`. Verification runs for
 * the ADMITTED shopper, so a reference belonging to another customer cannot be
 * verified into this session.
 */
export const verifyPaymentInternal = internalAction({
  args: { ...verifyPaymentArgs, owner: customerOwnerValidator },
  /**
   * NOT carried over verbatim from the deleted public `verifyPayment`, because
   * that one was wrong. It declared
   * `v.union(v.object({verified}), v.object({message}))` — two disjoint arms —
   * while the handler can return `{ verified: false, message: "No active
   * session found." }`, which matches NEITHER. On a live path that would have
   * thrown a return-validation error. `PaymentVerificationResult` in
   * `convex/types/payment.ts` is `{ verified: boolean; message?: string }`, so
   * that is what the validator states.
   */
  returns: v.object({
    verified: v.boolean(),
    message: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<PaymentVerificationResult> => {
    if (
      String(args.storeFrontUserId) !==
      String(args.owner.storeFrontUserId ?? args.owner.guestId)
    ) {
      throw new Error(
        "This storefront resource is not available for this shopper.",
      );
    }
    return await verifyPaymentWithCtx(ctx, args);
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
  handler: admitPublicAction(
    refundPaymentOperationDefinition,
    async (
      ctx,
      args: {
        externalTransactionId: string;
        amount?: number;
        returnItemsToStock: boolean;
        onlineOrderItemIds?: Array<Id<"onlineOrderItem">>;
        refundItems?: string[];
        signedInAthenaUser?: { id: Id<"athenaUser">; email: string };
      },
    ): Promise<CommandResult<{ message: string }>> => {
    let refundReservation: RefundReservationResult | undefined;
    let refundFinalized = false;

    // Retired `enforceSharedDemoActionCapability({ capability: "payments.refund" })`:
    // the grant, the store clamp and the restore fence are the definition's
    // job now, and the demo flag comes from the admitted actor.
    const isSharedDemo = ctx.operationAdmission.actor.kind === "shared_demo";
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
      const refundResponse = isSharedDemo
        ? {
            data: {
              transaction: {
                reference: `shared-demo-refund-${reservation.reservationId}`,
              },
            },
            message: "Refund simulated in the demo.",
          }
        : await initiateRefund({
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
  ),
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
        const orderWithItems = await ctx.runQuery(
          internal.storeFront.onlineOrder.getInternal,
          { identifier: order._id },
        );

        if (!orderWithItems) {
          throw new Error(`Order ${order._id} could not be hydrated.`);
        }

        // Calculate expected amount (same logic as verifyPayment)
        const subtotal = orderWithItems.amount || 0;
        const discount = orderWithItems.discount;
        const items = (orderWithItems.items || [])
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
          deliveryFee: orderWithItems.deliveryFee || 0,
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
          { id: orderWithItems.checkoutSessionId, hasVerifiedPayment: true },
        );

        // Build order update
        const update: Record<string, any> = {
          hasVerifiedPayment: true,
          autoVerifiedAt: Date.now(),
          transitions: [
            ...(orderWithItems.transitions ?? []),
            {
              status: "payment_auto_verified",
              date: Date.now(),
            },
          ],
        };

        // Send verification emails (guards against duplicates internally)
        const store = await ctx.runQuery(internal.inventory.stores.findById, {
          id: orderWithItems.storeId,
        });

        const emailResults = await sendPaymentVerificationEmails({
          order: orderWithItems,
          store,
          orderAmount: orderAmountLessDiscounts,
          discountValue,
          didSendNewOrderEmail:
            orderWithItems.didSendNewOrderReceivedEmail || false,
          didSendConfirmationEmail:
            orderWithItems.didSendConfirmationEmail || false,
        });

        if (emailResults.confirmationSent) {
          update.didSendConfirmationEmail = true;
          update.orderReceivedEmailSentAt = Date.now();
        }

        if (emailResults.adminNotificationSent) {
          update.didSendNewOrderReceivedEmail = true;
        }

        // Award loyalty points (idempotent — checks for existing reward by orderId)
        const points = calculateRewardPoints(orderWithItems.amount || 0);
        const rewardResult = await ctx.runMutation(
          internal.storeFront.rewards.awardOrderPoints,
          { orderId: orderWithItems._id, points },
        );

        if (rewardResult.success) {
          console.log(
            `[AUTO-VERIFY] Awarded ${points} points for order ${orderWithItems._id}`,
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
              id: orderWithItems.checkoutSessionId,
              hasCompletedCheckoutSession: true,
            },
          ),
        ]);

        console.log(
          `[AUTO-VERIFY] Verified payment | Reference: ${reference} | Order: ${orderWithItems._id}`,
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
