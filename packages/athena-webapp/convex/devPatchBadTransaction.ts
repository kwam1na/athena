import { v } from "convex/values";

import { mutation } from "./_generated/server";

export const patchBadTransaction = mutation({
  args: {
    transactionId: v.id("posTransaction"),
    expectedTransactionNumber: v.string(),
  },
  handler: async (ctx, args) => {
    const transaction = await ctx.db.get("posTransaction", args.transactionId);
    if (!transaction) {
      throw new Error("Transaction not found");
    }

    if (transaction.transactionNumber !== args.expectedTransactionNumber) {
      throw new Error("Refusing to patch an unexpected transaction");
    }

    if (transaction.status !== "completed") {
      throw new Error("Refusing to patch a non-completed transaction");
    }

    const items = await ctx.db
      .query("posTransactionItem")
      .withIndex("by_transactionId", (q) => q.eq("transactionId", args.transactionId))
      .take(100);

    if (items.length === 0) {
      throw new Error("Refusing to patch a transaction with no item rows");
    }

    const canonicalSubtotal = items.reduce(
      (sum, item) => sum + Math.round(item.totalPrice),
      0
    );
    const canonicalTax = 0;
    const canonicalTotal = canonicalSubtotal + canonicalTax;
    const previousCashPaid = transaction.payments
      .filter((payment) => payment.method === "cash")
      .reduce((sum, payment) => sum + payment.amount, 0);
    const previousChangeGiven = transaction.changeGiven ?? 0;
    const previousCashExposure = previousCashPaid - previousChangeGiven;
    const newCashExposure = canonicalTotal;
    const cashExposureDelta = newCashExposure - previousCashExposure;
    const paymentTimestamp =
      transaction.payments.find((payment) => payment.method === "cash")
        ?.timestamp ?? transaction.completedAt;
    const paymentMethod = transaction.paymentMethod ?? "cash";
    const canonicalPayments = [
      {
        method: paymentMethod,
        amount: canonicalTotal,
        timestamp: paymentTimestamp,
      },
    ];

    await ctx.db.patch("posTransaction", args.transactionId, {
      subtotal: canonicalSubtotal,
      tax: canonicalTax,
      total: canonicalTotal,
      payments: canonicalPayments,
      totalPaid: canonicalTotal,
      changeGiven: undefined,
    });

    if (transaction.sessionId) {
      await ctx.db.patch("posSession", transaction.sessionId, {
        subtotal: canonicalSubtotal,
        tax: canonicalTax,
        total: canonicalTotal,
        payments: canonicalPayments,
      });
    }

    const allocations = await ctx.db
      .query("paymentAllocation")
      .withIndex("by_storeId_target", (q) =>
        q
          .eq("storeId", transaction.storeId)
          .eq("targetType", "pos_transaction")
          .eq("targetId", args.transactionId)
      )
      .take(100);

    const patchedAllocationIds = [];
    for (const allocation of allocations) {
      if (
        allocation.status === "recorded" &&
        allocation.direction === "in" &&
        allocation.allocationType === "retail_sale"
      ) {
        await ctx.db.patch("paymentAllocation", allocation._id, {
          amount: canonicalTotal,
          method: paymentMethod,
        });
        patchedAllocationIds.push(allocation._id);
      }
    }

    let registerSessionBefore = null;
    let registerSessionAfter = null;
    if (transaction.registerSessionId && paymentMethod === "cash") {
      const registerSession = await ctx.db.get(
        "registerSession",
        transaction.registerSessionId
      );
      if (registerSession) {
        registerSessionBefore = {
          expectedCash: registerSession.expectedCash,
          countedCash: registerSession.countedCash,
          variance: registerSession.variance,
        };
        const nextExpectedCash =
          registerSession.expectedCash + cashExposureDelta;
        await ctx.db.patch("registerSession", registerSession._id, {
          expectedCash: nextExpectedCash,
          ...(registerSession.countedCash === undefined
            ? {}
            : { variance: registerSession.countedCash - nextExpectedCash }),
        });
        registerSessionAfter = {
          expectedCash: nextExpectedCash,
          countedCash: registerSession.countedCash,
          variance:
            registerSession.countedCash === undefined
              ? registerSession.variance
              : registerSession.countedCash - nextExpectedCash,
        };
      }
    }

    return {
      transactionId: args.transactionId,
      transactionNumber: transaction.transactionNumber,
      itemCount: items.length,
      previous: {
        subtotal: transaction.subtotal,
        tax: transaction.tax,
        total: transaction.total,
        totalPaid: transaction.totalPaid,
        payments: transaction.payments,
        changeGiven: transaction.changeGiven,
      },
      canonical: {
        subtotal: canonicalSubtotal,
        tax: canonicalTax,
        total: canonicalTotal,
        totalPaid: canonicalTotal,
        payments: canonicalPayments,
      },
      cashExposureDelta,
      patchedAllocationIds,
      registerSessionBefore,
      registerSessionAfter,
    };
  },
});
