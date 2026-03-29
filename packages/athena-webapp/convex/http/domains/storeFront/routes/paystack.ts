import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api, internal } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";
import { PAYSTACK_SECRET_KEY } from "../../../../env";

const paystackRoutes: HonoWithConvex<ActionCtx> = new Hono();

function toHex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function signPayload(secret: string, payload: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload)
  );

  return toHex(new Uint8Array(signature));
}

paystackRoutes.post("/", async (c) => {
  if (!PAYSTACK_SECRET_KEY) {
    return c.json({ error: "Paystack secret key is not configured." }, 500);
  }

  const incomingSignature = c.req.header("x-paystack-signature");
  const rawBody = await c.req.text();

  if (!incomingSignature) {
    return c.json({ error: "Missing webhook signature." }, 401);
  }

  const expectedSignature = await signPayload(PAYSTACK_SECRET_KEY, rawBody);

  if (incomingSignature.toLowerCase() !== expectedSignature.toLowerCase()) {
    return c.json({ error: "Invalid webhook signature." }, 401);
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "Malformed webhook payload." }, 400);
  }

  const { checkout_session_id, order_details } = payload?.data?.metadata || {};
  const transactionId = payload?.data?.id?.toString();

  if (payload?.event == "charge.success" && checkout_session_id) {
    if (!transactionId) {
      return c.json({ error: "Missing transaction id." }, 400);
    }

    if (!order_details?.billingDetails) {
      return c.json({ error: "Missing order details metadata." }, 400);
    }

    const session = await c.env.runQuery(api.storeFront.checkoutSession.getById, {
      sessionId: checkout_session_id as Id<"checkoutSession">,
    });

    if (!session) {
      return c.json({ error: "Checkout session not found." }, 404);
    }

    if (
      session.hasCompletedPayment &&
      session.externalTransactionId &&
      session.externalTransactionId === transactionId
    ) {
      return c.json({ success: true, deduplicated: true });
    }

    await c.env.runMutation(
      internal.storeFront.checkoutSession.updateCheckoutSession,
      {
        id: checkout_session_id as Id<"checkoutSession">,
        hasCompletedPayment: true,
        amount: payload.data.amount,
        externalTransactionId: transactionId,
        paymentMethod: {
          last4: payload?.data?.authorization?.last4,
          brand: payload?.data?.authorization?.brand,
          bank: payload?.data?.authorization?.bank,
          channel: payload?.data?.authorization?.channel,
        },
        orderDetails: {
          ...order_details,
          deliveryInstructions: order_details.deliveryInstructions || "",
          billingDetails: {
            ...order_details.billingDetails,
            billingAddressSameAsDelivery: Boolean(
              order_details.billingDetails.billingAddressSameAsDelivery
            ),
          },
          deliveryFee: order_details.deliveryFee
            ? parseFloat(order_details.deliveryFee)
            : null,
        },
      }
    );
  }

  const refundReference = payload?.data?.transaction_reference;
  const refundId = payload?.data?.id?.toString();
  const refundAmount = payload?.data?.amount;

  if (refundReference && refundId) {
    const order = await c.env.runQuery(api.storeFront.onlineOrder.getByExternalReference, {
      externalReference: refundReference,
    });

    const alreadyProcessed = order?.refunds?.some((refund) => refund.id === refundId);

    if (alreadyProcessed) {
      return c.json({ success: true, deduplicated: true });
    }
  }

  if (payload?.event == "refund.processing" && refundReference) {
    await c.env.runMutation(api.storeFront.onlineOrder.update, {
      externalReference: refundReference,
      update: {
        status: "refund-processing",
        refund_id: refundId,
        refund_amount: refundAmount,
      },
    });
  }

  if (payload?.event == "refund.pending" && refundReference) {
    await c.env.runMutation(api.storeFront.onlineOrder.update, {
      externalReference: refundReference,
      update: {
        status: "refund-pending",
        refund_id: refundId,
        refund_amount: refundAmount,
      },
    });
  }

  if (payload?.event == "refund.failed" && refundReference) {
    await c.env.runMutation(api.storeFront.onlineOrder.update, {
      externalReference: refundReference,
      update: {
        status: "refund-failed",
        refund_id: refundId,
        refund_amount: refundAmount,
      },
    });
  }

  if (payload?.event == "refund.processed" && refundReference) {
    await c.env.runMutation(api.storeFront.onlineOrder.update, {
      externalReference: refundReference,
      update: {
        status: "refunded",
        refund_id: refundId,
        refund_amount: refundAmount,
      },
    });
  }

  return c.json({});
});

export { paystackRoutes };
