import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api, internal } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";
import { sendPaymentVerificationEmails } from "../../../../services/orderEmailService";
import {
  calculateOrderAmount,
  getOrderDiscountValue,
} from "../../../../storeFront/helpers/paymentHelpers";
import { isDuplicateChargeSuccess } from "./security";

const paystackRoutes: HonoWithConvex<ActionCtx> = new Hono();

paystackRoutes.post("/", async (c) => {
  // const secret = process.env.PAYSTACK_SECRET_KEY;
  // const signature = c.req.header("x-paystack-signature");
  const rawPayload = await c.req.text();

  // if (!secret) {
  //   return c.json({ error: "PAYSTACK_SECRET_KEY is not configured" }, 500);
  // }

  // if (!signature) {
  //   return c.json({ error: "Missing webhook signature" }, 401);
  // }

  // if (!isValidPaystackSignature(rawPayload, secret, signature)) {
  //   return c.json({ error: "Invalid webhook signature" }, 401);
  // }

  let payload: any;

  try {
    payload = JSON.parse(rawPayload);
  } catch {
    return c.json({ error: "Invalid webhook payload" }, 400);
  }

  const { checkout_session_id, order_details } = payload?.data?.metadata || {};

  if (payload?.event == "charge.success" && checkout_session_id) {
    const incomingTransactionId = payload?.data?.id?.toString();

    if (!incomingTransactionId) {
      return c.json({ error: "Missing transaction identifier" }, 400);
    }

    const [session, existingOrder] = await Promise.all([
      c.env.runQuery(api.storeFront.checkoutSession.getById, {
        sessionId: checkout_session_id as Id<"checkoutSession">,
      }),
      c.env.runQuery(api.storeFront.onlineOrder.getByCheckoutSessionId, {
        checkoutSessionId: checkout_session_id as Id<"checkoutSession">,
      }),
    ]);

    if (!session) {
      return c.json({ message: "Checkout session not found" });
    }

    if (
      isDuplicateChargeSuccess({
        hasCompletedPayment: Boolean(session.hasCompletedPayment),
        placedOrderId: session.placedOrderId,
        hasExistingOrder: Boolean(existingOrder),
        incomingTransactionId,
        existingTransactionId: session.externalTransactionId,
      })
    ) {
      return c.json({ message: "Duplicate charge.success ignored" });
    }

    // place order
    const createOrderResponse = await c.env.runMutation(
      internal.storeFront.onlineOrder.createFromSession,
      {
        checkoutSessionId: checkout_session_id as Id<"checkoutSession">,
        externalTransactionId: incomingTransactionId,
        paymentMethod: {
          last4: payload?.data?.authorization?.last4,
          brand: payload?.data?.authorization?.brand,
          bank: payload?.data?.authorization?.bank,
          channel: payload?.data?.authorization?.channel,
        },
      },
    );

    if (!createOrderResponse.success) {
      console.error("failed to create order", createOrderResponse.error);
    }

    if (createOrderResponse.success) {
      // Fetch the created order and store
      const order = await c.env.runQuery(api.storeFront.onlineOrder.get, {
        identifier: checkout_session_id as Id<"checkoutSession">,
      });

      if (order) {
        const store = await c.env.runQuery(api.inventory.stores.getById, {
          id: order.storeId,
        });

        // Calculate order amounts
        const items = order.items || [];
        const discount = order.discount;
        const deliveryFee = order.deliveryFee || 0; // already pesewas
        const subtotal = order.amount || 0;

        const orderAmount = calculateOrderAmount({
          items,
          discount,
          deliveryFee,
          subtotal,
        });
        const discountValue = getOrderDiscountValue(items, discount);

        // Send emails using the service
        const emailResults = await sendPaymentVerificationEmails({
          order,
          store,
          orderAmount,
          discountValue,
          didSendNewOrderEmail: order.didSendNewOrderReceivedEmail || false,
          didSendConfirmationEmail: order.didSendConfirmationEmail || false,
        });

        // Update order with email status flags
        await c.env.runMutation(api.storeFront.onlineOrder.update, {
          orderId: order._id,
          update: {
            didSendConfirmationEmail: emailResults.confirmationSent,
            didSendNewOrderReceivedEmail: emailResults.adminNotificationSent,
            orderReceivedEmailSentAt: emailResults.confirmationSent
              ? Date.now()
              : undefined,
          },
        });
      }
    }

    const orderDetailsFromWebhook =
      order_details && typeof order_details === "object" ? order_details : {};

    // update important fields first
    await c.env.runMutation(
      internal.storeFront.checkoutSession.updateCheckoutSession,
      {
        id: checkout_session_id as Id<"checkoutSession">,
        hasCompletedPayment: true,
        externalTransactionId: incomingTransactionId,
        paymentMethod: {
          last4: payload?.data?.authorization?.last4,
          brand: payload?.data?.authorization?.brand,
          bank: payload?.data?.authorization?.bank,
          channel: payload?.data?.authorization?.channel,
        },
        orderDetails: {
          ...orderDetailsFromWebhook,
          billingDetails: null,
          deliveryDetails:
            orderDetailsFromWebhook.deliveryDetails ??
            session.deliveryDetails ??
            null,
          deliveryInstructions:
            orderDetailsFromWebhook.deliveryInstructions ||
            session.deliveryInstructions ||
            "",
          deliveryFee:
            typeof orderDetailsFromWebhook.deliveryFee === "number"
              ? orderDetailsFromWebhook.deliveryFee
              : (session.deliveryFee ?? null),
          deliveryMethod:
            orderDetailsFromWebhook.deliveryMethod ??
            session.deliveryMethod ??
            "delivery",
          deliveryOption:
            orderDetailsFromWebhook.deliveryOption ??
            session.deliveryOption ??
            null,
          pickupLocation:
            orderDetailsFromWebhook.pickupLocation ??
            session.pickupLocation ??
            null,
          discount: session.discount ?? null,
        },
      },
    );
  }

  if (payload?.event == "refund.processed") {
    await c.env.runMutation(api.storeFront.onlineOrder.update, {
      externalReference: payload?.data?.transaction_reference,
      update: {
        status: "refunded",
        refund_id: payload?.data?.id,
        refund_amount: payload?.data?.amount,
      },
    });
  }

  if (payload?.event == "refund.processing") {
    await c.env.runMutation(api.storeFront.onlineOrder.update, {
      externalReference: payload?.data?.transaction_reference,
      update: {
        status: "refund-processing",
        refund_id: payload?.data?.id,
        refund_amount: payload?.data?.amount,
      },
    });
  }

  if (payload?.event == "refund.pending") {
    await c.env.runMutation(api.storeFront.onlineOrder.update, {
      externalReference: payload?.data?.transaction_reference,
      update: {
        status: "refund-pending",
        refund_id: payload?.data?.id,
        refund_amount: payload?.data?.amount,
      },
    });
  }

  if (payload?.event == "refund.failed") {
    await c.env.runMutation(api.storeFront.onlineOrder.update, {
      externalReference: payload?.data?.transaction_reference,
      update: {
        status: "refund-failed",
        refund_id: payload?.data?.id,
        refund_amount: payload?.data?.amount,
      },
    });
  }

  return c.json({ message: "OK" });
});

export { paystackRoutes };
