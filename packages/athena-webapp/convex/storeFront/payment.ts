import { v } from "convex/values";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { CheckoutSession, OnlineOrder } from "../../types";
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

      // console.log("response from verification", res);

      // Query for the first active session for the given customerId
      const session: CheckoutSession | null = await ctx.runQuery(
        api.storeFront.checkoutSession.getCheckoutSession,
        {
          customerId: args.customerId,
          externalReference: args.externalReference,
        }
      );

      const order: OnlineOrder | null = await ctx.runQuery(
        api.storeFront.onlineOrder.getByExternalReference,
        {
          externalReference: args.externalReference,
        }
      );

      const amount = session?.amount || order?.amount;

      // console.log("session", session);

      const isVerified = Boolean(
        res.data.status == "success" && res.data.amount == amount
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

        await ctx.runMutation(api.storeFront.onlineOrder.update, {
          externalReference: args.externalReference,
          update: { hasVerifiedPayment: true },
        });

        console.log(
          `verified payment for session. [session: ${session?._id}, order: ${order?._id}, customer: ${args.customerId}, externalReference: ${args.externalReference}]`
        );
      }

      if (!isVerified) {
        console.log(
          `unable to verify payment. [session: ${session?._id}, order: ${order?._id}, customer: ${args.customerId}, externalReference: ${args.externalReference}]`
        );
      }

      return { verified: isVerified };
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
  },
  handler: async (ctx, args) => {
    const response = await fetch(`https://api.paystack.co/refund`, {
      method: "POST",
      headers: {
        Authorization:
          "Bearer sk_test_4460590841638115d8dae604191fdf38844042d0",
      },
      body: JSON.stringify({
        transaction: args.externalTransactionId,
        amount: args.amount,
      }),
    });

    const res = await response.json();
    console.log("response from refund", res);

    if (response.ok) {
      if (args.returnItemsToStock) {
        await ctx.runMutation(api.storeFront.onlineOrder.returnItemsToStock, {
          externalTransactionId: args.externalTransactionId,
          onlineOrderItemIds: args.onlineOrderItemIds,
        });

        console.log("returned items to stock");
      }

      return { success: true, message: res.message };
    }

    return { success: false, message: res.message };
  },
});
