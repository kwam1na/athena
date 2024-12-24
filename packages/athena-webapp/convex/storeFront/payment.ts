import { v } from "convex/values";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { CheckoutSession } from "../../types";
import { orderDetailsSchema } from "../schemas/storeFront";

export const createTransaction = action({
  args: {
    checkoutSessionId: v.id("checkoutSession"),
    customerEmail: v.string(),
    amount: v.number(),
    orderDetails: orderDetailsSchema,
  },
  handler: async (ctx, args) => {
    const response = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        body: JSON.stringify({
          email: args.customerEmail,
          amount: args.amount.toString(),
          callback_url: "http://localhost:3000/shop/checkout/verify",
          metadata: {
            cancel_action: "http://localhost:3000/shop/checkout",
            checkout_session_id: args.checkoutSessionId,
            checkout_session_amount: args.amount.toString(),
            order_details: args.orderDetails,
          },
        }),
        headers: {
          Authorization:
            "Bearer sk_test_4460590841638115d8dae604191fdf38844042d0",
          "Content-Type": "application/json",
        },
      }
    );

    if (response.ok) {
      const res = await response.json();

      await ctx.runMutation(
        internal.storeFront.checkoutSession.updateCheckoutSession,
        {
          id: args.checkoutSessionId,
          isFinalizingPayment: true,
          externalReference: res.data.reference,
        }
      );

      console.log(`finalizing payment for session: ${args.checkoutSessionId}`);

      return res.data;
    }
  },
});

export const verifyPayment = action({
  args: {
    customerId: v.union(v.id("customer"), v.id("guest")),
    externalReference: v.string(),
  },
  handler: async (ctx, args) => {
    const response = await fetch(
      `https://api.paystack.co/transaction/verify/${args.externalReference}`,
      {
        headers: {
          Authorization:
            "Bearer sk_test_4460590841638115d8dae604191fdf38844042d0",
        },
      }
    );

    if (response.ok) {
      const res = await response.json();

      // Query for the first active session for the given customerId
      const session: CheckoutSession | null = await ctx.runQuery(
        api.storeFront.checkoutSession.getCheckoutSession,
        {
          customerId: args.customerId,
          externalReference: args.externalReference,
        }
      );

      const isVerified = Boolean(
        res.data.status == "success" && res.data.amount == session?.amount
      );

      if (isVerified) {
        await ctx.runMutation(
          internal.storeFront.checkoutSession.updateCheckoutSession,
          {
            id: session?._id,
            hasVerifiedPayment: true,
          }
        );

        console.log(`verified payment for session: ${session?._id}`);
      }

      return { verified: isVerified };
    }

    return {
      message: "No active session found.",
    };
  },
});
