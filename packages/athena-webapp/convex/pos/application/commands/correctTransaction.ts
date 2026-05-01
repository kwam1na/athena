import type { Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import type { ApprovalRequirement } from "../../../../shared/approvalPolicy";
import { consumeApprovalProofWithCtx } from "../../../operations/approvalProofs";
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

const PAYMENT_METHOD_CORRECTION_ACTION_KEY =
  "pos.transaction.correct_payment_method";

type PaymentMethodCorrectionApprovalProof = {
  approvalProofId: Id<"approvalProof">;
  approvedByStaffProfileId: Id<"staffProfile">;
};

function transactionLabel(transaction: { transactionNumber: string }) {
  return `Transaction #${transaction.transactionNumber}`;
}

function buildPaymentMethodCorrectionApprovalRequirement(args: {
  amount: number;
  paymentMethod: string;
  previousPaymentMethod: string;
  transaction: {
    _id: Id<"posTransaction">;
    transactionNumber: string;
  };
}): ApprovalRequirement {
  return {
    action: {
      key: PAYMENT_METHOD_CORRECTION_ACTION_KEY,
      label: "Correct payment method",
    },
    reason:
      "Manager approval is required to correct a completed transaction payment method.",
    requiredRole: "manager",
    selfApproval: "allowed",
    subject: {
      id: args.transaction._id,
      label: transactionLabel(args.transaction),
      type: "pos_transaction",
    },
    copy: {
      title: "Manager approval required",
      message:
        "Authorization is needed from a manager to update this completed transaction payment method.",
      primaryActionLabel: "Approve update",
      secondaryActionLabel: "Cancel",
    },
    resolutionModes: [{ kind: "inline_manager_proof" }],
    metadata: {
      amount: args.amount,
      paymentMethod: args.paymentMethod,
      previousPaymentMethod: args.previousPaymentMethod,
    },
  };
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

function getPaymentMethodCashContribution(payment: {
  amount: number;
  method: string;
}) {
  return payment.method === "cash" ? payment.amount : 0;
}

const CLOSING_REGISTER_PAYMENT_UPDATE_MESSAGE =
  "Register closeout is under review. Reopen the register before updating payment details.";

async function requireRegisterSessionAllowsPaymentCorrection(
  ctx: MutationCtx,
  args: {
    registerSessionId?: Id<"registerSession">;
    storeId: Id<"store">;
  },
) {
  if (!args.registerSessionId) {
    return;
  }

  const registerSession = await ctx.db.get(
    "registerSession",
    args.registerSessionId,
  );

  if (!registerSession || registerSession.storeId !== args.storeId) {
    throw new Error("Register session not found for this transaction.");
  }

  if (registerSession.status === "closing") {
    throw new Error(CLOSING_REGISTER_PAYMENT_UPDATE_MESSAGE);
  }
}

async function adjustRegisterSessionExpectedCashForPaymentCorrection(
  ctx: MutationCtx,
  args: {
    nextPayment: { amount: number; method: string };
    previousPayment: { amount: number; method: string };
    registerSessionId?: Id<"registerSession">;
    storeId: Id<"store">;
  },
) {
  if (!args.registerSessionId) {
    return 0;
  }

  const expectedCashDelta =
    getPaymentMethodCashContribution(args.nextPayment) -
    getPaymentMethodCashContribution(args.previousPayment);

  if (expectedCashDelta === 0) {
    return 0;
  }

  const registerSession = await ctx.db.get(
    "registerSession",
    args.registerSessionId,
  );

  if (!registerSession || registerSession.storeId !== args.storeId) {
    throw new Error("Register session not found for this transaction.");
  }

  const nextExpectedCash = registerSession.expectedCash + expectedCashDelta;

  if (nextExpectedCash < 0) {
    throw new Error("Register session expected cash cannot be negative.");
  }

  await ctx.db.patch("registerSession", args.registerSessionId, {
    expectedCash: nextExpectedCash,
    ...(registerSession.countedCash !== undefined
      ? { variance: registerSession.countedCash - nextExpectedCash }
      : {}),
  });

  return expectedCashDelta;
}

async function consumePaymentMethodCorrectionApprovalProof(
  ctx: MutationCtx,
  args: {
    actorStaffProfileId?: Id<"staffProfile">;
    approvalProofId: Id<"approvalProof">;
    storeId: Id<"store">;
    transactionId: Id<"posTransaction">;
  },
): Promise<PaymentMethodCorrectionApprovalProof> {
  const proof = await consumeApprovalProofWithCtx(ctx, {
    actionKey: PAYMENT_METHOD_CORRECTION_ACTION_KEY,
    approvalProofId: args.approvalProofId,
    requiredRole: "manager",
    requestedByStaffProfileId: args.actorStaffProfileId,
    storeId: args.storeId,
    subject: {
      type: "pos_transaction",
      id: args.transactionId,
    },
  });

  if (proof.kind !== "ok") {
    throw new Error(proof.error.message);
  }

  return {
    approvalProofId: proof.data.approvalProofId,
    approvedByStaffProfileId: proof.data.approvedByStaffProfileId,
  };
}

export async function correctTransactionCustomer(
  ctx: MutationCtx,
  args: {
    transactionId: Id<"posTransaction">;
    customerProfileId?: Id<"customerProfile">;
    reason?: string;
  } & CorrectionActor,
) {
  const transaction = await requireCompletedTransaction(
    ctx,
    args.transactionId,
  );
  const previousCustomerProfileId = transaction.customerProfileId;
  const customerProfile =
    args.customerProfileId && ctx.db
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
    approvalProofId?: Id<"approvalProof">;
    transactionId: Id<"posTransaction">;
    paymentMethod: string;
    reason?: string;
  } & CorrectionActor,
) {
  const transaction = await requireCompletedTransaction(
    ctx,
    args.transactionId,
  );

  if (transaction.payments.length !== 1) {
    throw new Error("Only single-payment transactions can be corrected.");
  }

  const [payment] = transaction.payments;
  if (
    payment.amount !== transaction.totalPaid ||
    payment.amount !== transaction.total
  ) {
    throw new Error(
      "Only same-amount payment method corrections are supported.",
    );
  }

  await requireRegisterSessionAllowsPaymentCorrection(ctx, {
    registerSessionId: transaction.registerSessionId,
    storeId: transaction.storeId,
  });

  if (!args.approvalProofId) {
    return {
      action: "approval_required" as const,
      approval: buildPaymentMethodCorrectionApprovalRequirement({
        amount: payment.amount,
        paymentMethod: args.paymentMethod,
        previousPaymentMethod: payment.method,
        transaction,
      }),
      paymentMethod: args.paymentMethod,
      previousPaymentMethod: payment.method,
      transactionId: args.transactionId,
    };
  }

  const approvalProof = await consumePaymentMethodCorrectionApprovalProof(ctx, {
    actorStaffProfileId: args.actorStaffProfileId,
    approvalProofId: args.approvalProofId,
    storeId: transaction.storeId,
    transactionId: args.transactionId,
  });

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
  const registerSessionExpectedCashDelta =
    await adjustRegisterSessionExpectedCashForPaymentCorrection(ctx, {
      nextPayment: {
        amount: payment.amount,
        method: args.paymentMethod,
      },
      previousPayment: payment,
      registerSessionId: transaction.registerSessionId,
      storeId: transaction.storeId,
    });

  const approvalEvent = await recordOperationalEventWithCtx(ctx, {
    storeId: transaction.storeId,
    eventType: "pos_transaction_payment_method_approval_proof_consumed",
    subjectType: "pos_transaction",
    subjectId: args.transactionId,
    subjectLabel: transactionLabel(transaction),
    message: `Manager approval proof consumed for ${transactionLabel(transaction)} payment method correction.`,
    reason: args.reason,
    metadata: {
      actionKey: PAYMENT_METHOD_CORRECTION_ACTION_KEY,
      approvalProofId: approvalProof.approvalProofId,
      approverStaffProfileId: approvalProof.approvedByStaffProfileId,
      correctionType: "payment_method",
      previousPaymentMethod: payment.method,
      paymentMethod: args.paymentMethod,
      requesterStaffProfileId: args.actorStaffProfileId,
    },
    actorUserId: args.actorUserId,
    actorStaffProfileId: approvalProof.approvedByStaffProfileId,
    customerProfileId: transaction.customerProfileId,
    registerSessionId: transaction.registerSessionId,
    posTransactionId: args.transactionId,
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
      actionKey: PAYMENT_METHOD_CORRECTION_ACTION_KEY,
      approvalProofId: approvalProof.approvalProofId,
      approvalOperationalEventId: approvalEvent?._id,
      approverStaffProfileId: approvalProof.approvedByStaffProfileId,
      previousPaymentMethod: payment.method,
      paymentMethod: args.paymentMethod,
      requesterStaffProfileId: args.actorStaffProfileId,
      amount: payment.amount,
      registerSessionExpectedCashDelta,
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
    approvalProofId: approvalProof.approvalProofId,
    approvalOperationalEventId: approvalEvent?._id,
    approverStaffProfileId: approvalProof.approvedByStaffProfileId,
    paymentAllocationId: correctedAllocation._id,
    operationalEventId: event?._id,
  };
}
