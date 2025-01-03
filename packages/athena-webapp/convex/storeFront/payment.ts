import { v } from "convex/values";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { CheckoutSession, OnlineOrder } from "../../types";
import { orderDetailsSchema } from "../schemas/storeFront";

// const appUrl = "https://transmit-constitutes-kit-latvia.trycloudflare.com";
const appUrl = "http://localhost:3000";

export const createTransaction = action({
  args: {
    checkoutSessionId: v.id("checkoutSession"),
    customerEmail: v.string(),
    amount: v.number(),
    orderDetails: orderDetailsSchema,
  },
  handler: async (ctx, args) => {
    // throw new Error("Not implemented");
    const response = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        body: JSON.stringify({
          email: args.customerEmail,
          amount: args.amount.toString(),
          callback_url: `${appUrl}/shop/checkout/verify`,
          metadata: {
            cancel_action: `${appUrl}/shop/checkout`,
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
    } else {
      console.error("Failed to create transaction", response);
    }
  },
});

export const verifyPayment = action({
  args: {
    storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
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

      // Query for the first active session for the given storeFrontUserId
      const session: CheckoutSession | null = await ctx.runQuery(
        api.storeFront.checkoutSession.getCheckoutSession,
        {
          storeFrontUserId: args.storeFrontUserId,
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
          `verified payment for session. [session: ${session?._id}, order: ${order?._id}, customer: ${args.storeFrontUserId}, externalReference: ${args.externalReference}]`
        );
      }

      if (!isVerified) {
        console.log(
          `unable to verify payment. [session: ${session?._id}, order: ${order?._id}, customer: ${args.storeFrontUserId}, externalReference: ${args.externalReference}]`
        );
      }

      return { verified: isVerified };
    } else {
      console.error("Failed to create transaction", response);
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
    refundItems: v.optional(v.array(v.string())),
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

    if (response.ok) {
      await ctx.runMutation(api.storeFront.onlineOrder.update, {
        externalReference: res.data?.transaction?.reference,
        update: {
          status: "refund-submitted",
          didRefundDeliveryFee: args.refundItems?.includes("delivery-fee"),
        },
      });

      console.log('updated order status to "refund-submitted"');

      if (args.returnItemsToStock) {
        await ctx.runMutation(api.storeFront.onlineOrder.returnItemsToStock, {
          externalTransactionId: args.externalTransactionId,
          onlineOrderItemIds: args.onlineOrderItemIds,
        });

        console.log("returned items to stock");
        return { success: true, message: res.message };
      }

      if (args.onlineOrderItemIds) {
        await ctx.runMutation(api.storeFront.onlineOrder.updateOrderItems, {
          orderItemIds: args.onlineOrderItemIds,
          updates: { isRefunded: true },
        });

        console.log("updated order items to refunded");
      }
      return { success: true, message: res.message };
    } else {
      console.error("Failed to refund payment", response);
    }

    return { success: false, message: res.message };
  },
});
