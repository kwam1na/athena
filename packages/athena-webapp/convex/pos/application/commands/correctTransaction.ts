import type { Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import { recordOperationalEventWithCtx } from "../../../operations/operationalEvents";
import { correctSameAmountSinglePaymentAllocationWithCtx } from "../../../operations/paymentAllocations";
import {
  getPosTransactionById,
  patchPosTransaction,
} from "../../infrastructure/repositories/transactionRepository";

type CorrectionActor = {
  actorUserId?: Id<"athenaUser">;
  actorStaffProfileId?: Id<"staffProfile">;
};

function transactionLabel(transaction: { transactionNumber: string }) {
  return `Transaction #${transaction.transactionNumber}`;
}

async function requireCompletedTransaction(
  ctx: MutationCtx,
  transactionId: Id<"posTransaction">,
) {
  const transaction = await getPosTransactionById(ctx, transactionId);

  if (!transaction) {
    throw new Error("Transaction not found.");
  }

  if (transaction.status !== "completed") {
    throw new Error("Only completed transactions can be corrected.");
  }

  return transaction;
}

export async function correctTransactionCustomer(
  ctx: MutationCtx,
  args: {
    transactionId: Id<"posTransaction">;
    customerProfileId?: Id<"customerProfile">;
    reason?: string;
  } & CorrectionActor,
) {
  const transaction = await requireCompletedTransaction(ctx, args.transactionId);
  const previousCustomerProfileId = transaction.customerProfileId;
  const customerProfile = args.customerProfileId && ctx.db
    ? await ctx.db.get("customerProfile", args.customerProfileId)
    : null;

  if (args.customerProfileId && ctx.db && !customerProfile) {
    throw new Error("Customer profile not found.");
  }

  await patchPosTransaction(ctx, args.transactionId, {
    customerProfileId: args.customerProfileId,
    customerInfo: customerProfile
      ? {
          name: customerProfile.fullName ?? undefined,
          email: customerProfile.email ?? undefined,
          phone: customerProfile.phoneNumber ?? undefined,
        }
      : undefined,
  });

  const event = await recordOperationalEventWithCtx(ctx, {
    storeId: transaction.storeId,
    eventType: "pos_transaction_customer_corrected",
    subjectType: "pos_transaction",
    subjectId: args.transactionId,
    subjectLabel: transactionLabel(transaction),
    message: `Corrected customer attribution for ${transactionLabel(transaction)}.`,
    reason: args.reason,
    metadata: {
      correctionType: "customer_attribution",
      previousCustomerProfileId,
      customerProfileId: args.customerProfileId,
      metadataOnly: true,
    },
    actorUserId: args.actorUserId,
    actorStaffProfileId: args.actorStaffProfileId,
    customerProfileId: args.customerProfileId,
    registerSessionId: transaction.registerSessionId,
    posTransactionId: args.transactionId,
  });

  return {
    transactionId: args.transactionId,
    previousCustomerProfileId,
    customerProfileId: args.customerProfileId,
    operationalEventId: event?._id,
  };
}

export async function correctTransactionPaymentMethod(
  ctx: MutationCtx,
  args: {
    transactionId: Id<"posTransaction">;
    paymentMethod: string;
    reason?: string;
  } & CorrectionActor,
) {
  const transaction = await requireCompletedTransaction(ctx, args.transactionId);

  if (transaction.payments.length !== 1) {
    throw new Error("Only single-payment transactions can be corrected.");
  }

  const [payment] = transaction.payments;
  if (payment.amount !== transaction.totalPaid || payment.amount !== transaction.total) {
    throw new Error("Only same-amount payment method corrections are supported.");
  }

  const correctedAllocation =
    await correctSameAmountSinglePaymentAllocationWithCtx(ctx, {
      storeId: transaction.storeId,
      targetType: "pos_transaction",
      targetId: args.transactionId,
      amount: payment.amount,
      method: args.paymentMethod,
    });

  if (!correctedAllocation) {
    throw new Error("Payment allocation must be a same-amount single payment.");
  }

  await patchPosTransaction(ctx, args.transactionId, {
    paymentMethod: args.paymentMethod,
    payments: [
      {
        ...payment,
        method: args.paymentMethod,
      },
    ],
  });

  const event = await recordOperationalEventWithCtx(ctx, {
    storeId: transaction.storeId,
    eventType: "pos_transaction_payment_method_corrected",
    subjectType: "pos_transaction",
    subjectId: args.transactionId,
    subjectLabel: transactionLabel(transaction),
    message: `Corrected payment method for ${transactionLabel(transaction)}.`,
    reason: args.reason,
    metadata: {
      correctionType: "payment_method",
      previousPaymentMethod: payment.method,
      paymentMethod: args.paymentMethod,
      amount: payment.amount,
      representation: "patch_single_same_amount_payment_and_allocation",
    },
    actorUserId: args.actorUserId,
    actorStaffProfileId: args.actorStaffProfileId,
    customerProfileId: transaction.customerProfileId,
    paymentAllocationId: correctedAllocation._id,
    registerSessionId: transaction.registerSessionId,
    posTransactionId: args.transactionId,
  });

  return {
    transactionId: args.transactionId,
    previousPaymentMethod: payment.method,
    paymentMethod: args.paymentMethod,
    paymentAllocationId: correctedAllocation._id,
    operationalEventId: event?._id,
  };
}
