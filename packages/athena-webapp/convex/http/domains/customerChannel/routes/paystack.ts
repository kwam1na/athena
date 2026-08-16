import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";
import { sendPaymentVerificationEmails } from "../../../../services/orderEmailService";
import {
  calculateOrderAmount,
  getOrderDiscountValue,
} from "../../../../storeFront/helpers/paymentHelpers";
import { isDuplicateChargeSuccess } from "./security";
import { admitHttpRoute } from "../../../../platform/operationAdmission";
import { paystackWebhookRouteOperationDefinition } from "../../../../operationAdmission/domains/u10_httpCustomer_definitions";

const paystackRoutes: HonoWithConvex<ActionCtx> = new Hono();

/**
 * Paystack webhook.
 *
 * The signature check that used to sit commented out in this handler is now the
 * definition's `ingressVerification`, which the rail runs on the raw request
 * BEFORE admission — so an unsigned, mis-signed, or unconfigured-secret request
 * is rejected with no admission row and no capture, and the handler below never
 * runs. The verifier HMACs `ingress.rawBody`, the very string parsed here, so
 * what is signed and what is acted on cannot drift apart.
 *
 * The webhook has no shopper claim, so every callee is invoked without `owner`;
 * the checkout session id inside the signed payload is the only authority, and
 * it is trusted precisely because the signature covers it.
 */
paystackRoutes.post(
  "/",
  admitHttpRoute(
    paystackWebhookRouteOperationDefinition,
    async (c, { ingress }) => {
      let payload: any;

      try {
        payload = JSON.parse(ingress.rawBody);
      } catch {
        return c.json({ error: "Invalid webhook payload" }, 400);
      }

      const { checkout_session_id, order_details } =
        payload?.data?.metadata || {};

      if (payload?.event == "charge.success" && checkout_session_id) {
        const incomingTransactionId = payload?.data?.id?.toString();

        if (!incomingTransactionId) {
          return c.json({ error: "Missing transaction identifier" }, 400);
        }

        const [session, existingOrder] = await Promise.all([
          c.env.runQuery(internal.storeFront.checkoutSession.getByIdInternal, {
            sessionId: checkout_session_id as Id<"checkoutSession">,
          }),
          c.env.runQuery(
            internal.storeFront.onlineOrder.getByCheckoutSessionIdInternal,
            {
              checkoutSessionId: checkout_session_id as Id<"checkoutSession">,
            },
          ),
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

        const orderDetailsFromWebhook =
          order_details && typeof order_details === "object"
            ? order_details
            : {};

        // Persist the settled-payment state FIRST, before any best-effort
        // side-effects (notification emails, order flag updates). Downstream
        // completion and verification key off hasCompletedPayment, so a failure
        // in those side-effects must never prevent this write — that ordering is
        // what previously left paid sessions stuck with hasCompletedPayment
        // unset.
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

        // Best-effort: notification emails + order email-status flags. Isolated
        // in try/catch so a failure here cannot abort the webhook or undo the
        // payment-state write above.
        if (createOrderResponse.success) {
          try {
            // Fetch the created order and store
            const order = await c.env.runQuery(
              internal.storeFront.onlineOrder.getInternal,
              {
                identifier: checkout_session_id as Id<"checkoutSession">,
              },
            );

            if (order) {
              const store = await c.env.runQuery(
                internal.inventory.stores.findById,
                { id: order.storeId },
              );

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
                didSendNewOrderEmail:
                  order.didSendNewOrderReceivedEmail || false,
                didSendConfirmationEmail:
                  order.didSendConfirmationEmail || false,
              });

              // Update order with email status flags
              await c.env.runMutation(
                internal.storeFront.onlineOrder.updateInternal,
                {
                  orderId: order._id,
                  update: {
                    didSendConfirmationEmail: emailResults.confirmationSent,
                    didSendNewOrderReceivedEmail:
                      emailResults.adminNotificationSent,
                    orderReceivedEmailSentAt: emailResults.confirmationSent
                      ? Date.now()
                      : undefined,
                  },
                },
              );
            }
          } catch (error) {
            console.error(
              "failed to send order notification emails from webhook",
              error,
            );
          }
        }
      }

      if (payload?.event == "refund.processed") {
        await c.env.runMutation(internal.storeFront.onlineOrder.updateInternal, {
          externalReference: payload?.data?.transaction_reference,
          update: {
            status: "refunded",
            refund_id: payload?.data?.id,
            refund_amount: payload?.data?.amount,
          },
        });
      }

      if (payload?.event == "refund.processing") {
        await c.env.runMutation(internal.storeFront.onlineOrder.updateInternal, {
          externalReference: payload?.data?.transaction_reference,
          update: {
            status: "refund-processing",
            refund_id: payload?.data?.id,
            refund_amount: payload?.data?.amount,
          },
        });
      }

      if (payload?.event == "refund.pending") {
        await c.env.runMutation(internal.storeFront.onlineOrder.updateInternal, {
          externalReference: payload?.data?.transaction_reference,
          update: {
            status: "refund-pending",
            refund_id: payload?.data?.id,
            refund_amount: payload?.data?.amount,
          },
        });
      }

      if (payload?.event == "refund.failed") {
        await c.env.runMutation(internal.storeFront.onlineOrder.updateInternal, {
          externalReference: payload?.data?.transaction_reference,
          update: {
            status: "refund-failed",
            refund_id: payload?.data?.id,
            refund_amount: payload?.data?.amount,
          },
        });
      }

      return c.json({ message: "OK" });
    },
  ),
);

export { paystackRoutes };
