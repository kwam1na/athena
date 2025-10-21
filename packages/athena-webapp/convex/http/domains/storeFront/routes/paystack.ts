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

const paystackRoutes: HonoWithConvex<ActionCtx> = new Hono();

paystackRoutes.post("/", async (c) => {
  const payload = await c.req.json();

  console.log("received payload", payload);

  const { checkout_session_id, order_details } = payload?.data?.metadata || {};

  if (payload?.event == "charge.success" && checkout_session_id) {
    console.log(`charge successful for session: ${checkout_session_id}`);

    // place order
    console.log("creating order..");
    const createOrderResponse = await c.env.runMutation(
      internal.storeFront.onlineOrder.createFromSession,
      {
        checkoutSessionId: checkout_session_id as Id<"checkoutSession">,
        externalTransactionId: payload.data.id.toString(),
        paymentMethod: {
          last4: payload?.data?.authorization?.last4,
          brand: payload?.data?.authorization?.brand,
          bank: payload?.data?.authorization?.bank,
          channel: payload?.data?.authorization?.channel,
        },
      }
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
        const deliveryFee = (order.deliveryFee || 0) * 100;
        const subtotal = order.amount || 0;

        const orderAmount = calculateOrderAmount({
          items,
          discount,
          deliveryFee,
          subtotal,
        });
        const discountValue = getOrderDiscountValue(items, discount);

        console.log(
          "sending payment verification emails after order creation..."
        );

        // Send emails using the service
        const emailResults = await sendPaymentVerificationEmails({
          order,
          store,
          orderAmount,
          discountValue,
          didSendNewOrderEmail: order.didSendNewOrderReceivedEmail || false,
          didSendConfirmationEmail: order.didSendConfirmationEmail || false,
        });

        if (emailResults.confirmationSent) {
          console.log("confirmation email sent");
        }

        if (emailResults.adminNotificationSent) {
          console.log("admin notification email sent");
        }

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

    // update important fields first
    await c.env.runMutation(
      internal.storeFront.checkoutSession.updateCheckoutSession,
      {
        id: checkout_session_id as Id<"checkoutSession">,
        hasCompletedPayment: true,
        externalTransactionId: payload.data.id.toString(),
        paymentMethod: {
          last4: payload?.data?.authorization?.last4,
          brand: payload?.data?.authorization?.brand,
          bank: payload?.data?.authorization?.bank,
          channel: payload?.data?.authorization?.channel,
        },
        orderDetails: {
          ...order_details,
          deliveryInstructions: order_details.deliveryInstructions || "",
          billingDetails: null,
          deliveryFee: order_details.deliveryFee
            ? parseFloat(order_details.deliveryFee)
            : null,
          discount: order_details.discount || null,
        },
      }
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
