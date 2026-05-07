import type { Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import type { ApprovalRequirement } from "../../../../shared/approvalPolicy";
import { buildApprovalRequest } from "../../../operations/approvalRequestHelpers";
import {
  APPROVAL_ACTIONS,
  consumeCommandApprovalProofWithCtx,
} from "../../../operations/approvalActions";
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

const PAYMENT_METHOD_CORRECTION_ACTION =
  APPROVAL_ACTIONS.transactionPaymentMethodCorrection;
const PAYMENT_METHOD_CORRECTION_ACTION_KEY =
  PAYMENT_METHOD_CORRECTION_ACTION.key;
const PAYMENT_METHOD_CORRECTION_REQUEST_TYPE = "payment_method_correction";

type PaymentMethodCorrectionApprovalProof = {
  approvalProofId: Id<"approvalProof">;
  approvedByStaffProfileId: Id<"staffProfile">;
};

function transactionLabel(transaction: { transactionNumber: string }) {
  return `Transaction #${transaction.transactionNumber}`;
}

function buildPaymentMethodCorrectionApprovalRequirement(args: {
  approvalRequestId?: Id<"approvalRequest">;
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
        "A manager needs to review this completed transaction payment method update before it is applied.",
      primaryActionLabel: "Request approval",
      secondaryActionLabel: "Got it",
    },
    resolutionModes: [
      {
        kind: "inline_manager_proof",
      },
      {
        kind: "async_request",
        requestType: PAYMENT_METHOD_CORRECTION_REQUEST_TYPE,
        approvalRequestId: args.approvalRequestId,
      },
    ],
    metadata: {
      amount: args.amount,
      paymentMethod: args.paymentMethod,
      previousPaymentMethod: args.previousPaymentMethod,
    },
  };
}

async function createPaymentMethodCorrectionApprovalRequest(
  ctx: MutationCtx,
  args: {
    actorStaffProfileId?: Id<"staffProfile">;
    actorUserId?: Id<"athenaUser">;
    amount: number;
    paymentMethod: string;
    previousPaymentMethod: string;
    reason?: string;
    transaction: {
      _id: Id<"posTransaction">;
      registerSessionId?: Id<"registerSession">;
      storeId: Id<"store">;
      transactionNumber: string;
    };
  },
) {
  const store = await ctx.db.get("store", args.transaction.storeId);
  const approvalRequestId = await ctx.db.insert(
    "approvalRequest",
    buildApprovalRequest({
      metadata: {
        actionKey: PAYMENT_METHOD_CORRECTION_ACTION_KEY,
        amount: args.amount,
        paymentMethod: args.paymentMethod,
        previousPaymentMethod: args.previousPaymentMethod,
        transactionId: args.transaction._id,
        transactionNumber: args.transaction.transactionNumber,
      },
      notes: args.reason,
      organizationId: store?.organizationId,
      reason:
        "Manager approval is required to correct a completed transaction payment method.",
      registerSessionId: args.transaction.registerSessionId,
      requestType: PAYMENT_METHOD_CORRECTION_REQUEST_TYPE,
      requestedByStaffProfileId: args.actorStaffProfileId,
      requestedByUserId: args.actorUserId,
      storeId: args.transaction.storeId,
      subjectId: args.transaction._id,
      subjectType: "pos_transaction",
    }),
  );

  await recordOperationalEventWithCtx(ctx, {
    actorStaffProfileId: args.actorStaffProfileId,
    actorUserId: args.actorUserId,
    approvalRequestId,
    eventType: "pos_transaction_payment_method_approval_requested",
    message: `Payment method correction requested for ${transactionLabel(args.transaction)}.`,
    metadata: {
      actionKey: PAYMENT_METHOD_CORRECTION_ACTION_KEY,
      approvalMode: "async_approval",
      approvalRequestId,
      amount: args.amount,
      paymentMethod: args.paymentMethod,
      previousPaymentMethod: args.previousPaymentMethod,
      requiredRole: "manager",
    },
    reason: args.reason,
    registerSessionId: args.transaction.registerSessionId,
    storeId: args.transaction.storeId,
    subjectId: args.transaction._id,
    subjectLabel: transactionLabel(args.transaction),
    subjectType: "pos_transaction",
    posTransactionId: args.transaction._id,
  });

  return approvalRequestId;
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
  const proof = await consumeCommandApprovalProofWithCtx(ctx, {
    action: PAYMENT_METHOD_CORRECTION_ACTION,
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

async function applyPaymentMethodCorrection(
  ctx: MutationCtx,
  args: {
    actorStaffProfileId?: Id<"staffProfile">;
    actorUserId?: Id<"athenaUser">;
    approvalOperationalEventId?: Id<"operationalEvent">;
    approvalProofId?: Id<"approvalProof">;
    approvalRequestId?: Id<"approvalRequest">;
    approverStaffProfileId?: Id<"staffProfile">;
    paymentMethod: string;
    reason?: string;
    transaction: Awaited<ReturnType<typeof requireCompletedTransaction>>;
  },
) {
  const [payment] = args.transaction.payments;
  const correctedAllocation =
    await correctSameAmountSinglePaymentAllocationWithCtx(ctx, {
      storeId: args.transaction.storeId,
      targetType: "pos_transaction",
      targetId: args.transaction._id,
      amount: payment.amount,
      method: args.paymentMethod,
    });

  if (!correctedAllocation) {
    throw new Error("Payment allocation must be a same-amount single payment.");
  }

  await patchPosTransaction(ctx, args.transaction._id, {
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
      registerSessionId: args.transaction.registerSessionId,
      storeId: args.transaction.storeId,
    });

  const event = await recordOperationalEventWithCtx(ctx, {
    storeId: args.transaction.storeId,
    eventType: "pos_transaction_payment_method_corrected",
    subjectType: "pos_transaction",
    subjectId: args.transaction._id,
    subjectLabel: transactionLabel(args.transaction),
    message: `Corrected payment method for ${transactionLabel(args.transaction)}.`,
    approvalRequestId: args.approvalRequestId,
    reason: args.reason,
    metadata: {
      correctionType: "payment_method",
      actionKey: PAYMENT_METHOD_CORRECTION_ACTION_KEY,
      approvalProofId: args.approvalProofId,
      approvalRequestId: args.approvalRequestId,
      approvalOperationalEventId: args.approvalOperationalEventId,
      approverStaffProfileId: args.approverStaffProfileId,
      previousPaymentMethod: payment.method,
      paymentMethod: args.paymentMethod,
      requesterStaffProfileId: args.actorStaffProfileId,
      amount: payment.amount,
      registerSessionExpectedCashDelta,
      representation: "patch_single_same_amount_payment_and_allocation",
    },
    actorUserId: args.actorUserId,
    actorStaffProfileId: args.actorStaffProfileId,
    customerProfileId: args.transaction.customerProfileId,
    paymentAllocationId: correctedAllocation._id,
    registerSessionId: args.transaction.registerSessionId,
    posTransactionId: args.transaction._id,
  });

  return {
    transactionId: args.transaction._id,
    previousPaymentMethod: payment.method,
    paymentMethod: args.paymentMethod,
    approvalProofId: args.approvalProofId,
    approvalRequestId: args.approvalRequestId,
    approvalOperationalEventId: args.approvalOperationalEventId,
    approverStaffProfileId: args.approverStaffProfileId,
    paymentAllocationId: correctedAllocation._id,
    operationalEventId: event?._id,
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
    approvalRequestId?: Id<"approvalRequest">;
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
    const approvalRequestId =
      await createPaymentMethodCorrectionApprovalRequest(ctx, {
        actorStaffProfileId: args.actorStaffProfileId,
        actorUserId: args.actorUserId,
        amount: payment.amount,
        paymentMethod: args.paymentMethod,
        previousPaymentMethod: payment.method,
        reason: args.reason,
        transaction,
      });

    return {
      action: "approval_required" as const,
      approval: buildPaymentMethodCorrectionApprovalRequirement({
        approvalRequestId,
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

  const inlineApprovalRequest =
    await requireMatchingPendingPaymentMethodCorrectionApprovalRequest(ctx, {
      approvalRequestId: args.approvalRequestId,
      paymentMethod: args.paymentMethod,
      storeId: transaction.storeId,
      transactionId: args.transactionId,
    });

  const approvalProof = await consumePaymentMethodCorrectionApprovalProof(ctx, {
    actorStaffProfileId: args.actorStaffProfileId,
    approvalProofId: args.approvalProofId,
    storeId: transaction.storeId,
    transactionId: args.transactionId,
  });

  const approvalEvent = await recordOperationalEventWithCtx(ctx, {
    storeId: transaction.storeId,
    approvalRequestId: inlineApprovalRequest?._id,
    eventType: "pos_transaction_payment_method_approval_proof_consumed",
    subjectType: "pos_transaction",
    subjectId: args.transactionId,
    subjectLabel: transactionLabel(transaction),
    message: `Manager approval proof consumed for ${transactionLabel(transaction)} payment method correction.`,
    reason: args.reason,
    metadata: {
      actionKey: PAYMENT_METHOD_CORRECTION_ACTION_KEY,
      approvalRequestId: inlineApprovalRequest?._id,
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

  const result = await applyPaymentMethodCorrection(ctx, {
    actorStaffProfileId: args.actorStaffProfileId,
    actorUserId: args.actorUserId,
    approvalOperationalEventId: approvalEvent?._id,
    approvalRequestId: inlineApprovalRequest?._id,
    approvalProofId: approvalProof.approvalProofId,
    approverStaffProfileId: approvalProof.approvedByStaffProfileId,
    paymentMethod: args.paymentMethod,
    reason: args.reason,
    transaction,
  });

  if (inlineApprovalRequest) {
    await ctx.db.patch("approvalRequest", inlineApprovalRequest._id, {
      status: "approved",
      reviewedByUserId: args.actorUserId,
      reviewedByStaffProfileId: approvalProof.approvedByStaffProfileId,
      decisionNotes: args.reason,
      decidedAt: Date.now(),
    });
  }

  return result;
}

function getStringMetadata(
  metadata: Record<string, unknown> | undefined,
  key: string,
) {
  const value = metadata?.[key];
  return typeof value === "string" ? value : null;
}

async function requireMatchingPendingPaymentMethodCorrectionApprovalRequest(
  ctx: MutationCtx,
  args: {
    approvalRequestId?: Id<"approvalRequest">;
    paymentMethod: string;
    storeId: Id<"store">;
    transactionId: Id<"posTransaction">;
  },
) {
  if (!args.approvalRequestId) {
    return null;
  }

  const approvalRequest = await ctx.db.get(
    "approvalRequest",
    args.approvalRequestId,
  );

  if (
    !approvalRequest ||
    approvalRequest.requestType !== PAYMENT_METHOD_CORRECTION_REQUEST_TYPE ||
    approvalRequest.subjectType !== "pos_transaction"
  ) {
    throw new Error("Payment method approval request not found.");
  }

  if (approvalRequest.status !== "pending") {
    throw new Error(
      "Payment method approval request has already been decided.",
    );
  }

  if (
    approvalRequest.storeId !== args.storeId ||
    approvalRequest.subjectId !== args.transactionId
  ) {
    throw new Error(
      "Payment method approval request does not match this store.",
    );
  }

  const paymentMethod = getStringMetadata(
    approvalRequest.metadata,
    "paymentMethod",
  );

  if (!paymentMethod) {
    throw new Error(
      "Payment method approval request is missing correction details.",
    );
  }

  if (paymentMethod !== args.paymentMethod) {
    throw new Error(
      "Payment method approval request does not match this correction.",
    );
  }

  return approvalRequest;
}

export async function resolvePaymentMethodCorrectionApprovalDecisionWithCtx(
  ctx: MutationCtx,
  args: {
    approvalRequestId: Id<"approvalRequest">;
    decision: "approved" | "rejected" | "cancelled";
    reviewedByStaffProfileId?: Id<"staffProfile">;
    reviewedByUserId?: Id<"athenaUser">;
    decisionNotes?: string;
  },
) {
  const approvalRequest = await ctx.db.get(
    "approvalRequest",
    args.approvalRequestId,
  );

  if (
    !approvalRequest ||
    approvalRequest.requestType !== PAYMENT_METHOD_CORRECTION_REQUEST_TYPE ||
    approvalRequest.subjectType !== "pos_transaction"
  ) {
    throw new Error("Payment method approval request not found.");
  }

  const transactionId = approvalRequest.subjectId as Id<"posTransaction">;

  if (args.decision !== "approved") {
    await recordOperationalEventWithCtx(ctx, {
      actorStaffProfileId: args.reviewedByStaffProfileId,
      actorUserId: args.reviewedByUserId,
      approvalRequestId: args.approvalRequestId,
      eventType: "pos_transaction_payment_method_approval_rejected",
      message: `Payment method correction ${args.decision} for Transaction ${transactionId}.`,
      metadata: {
        actionKey: PAYMENT_METHOD_CORRECTION_ACTION_KEY,
        approvalRequestId: args.approvalRequestId,
        decision: args.decision,
      },
      reason: args.decisionNotes,
      storeId: approvalRequest.storeId,
      subjectId: transactionId,
      subjectType: "pos_transaction",
      posTransactionId: transactionId,
    });
    return null;
  }

  const paymentMethod = getStringMetadata(
    approvalRequest.metadata,
    "paymentMethod",
  );

  if (!paymentMethod) {
    throw new Error(
      "Payment method approval request is missing correction details.",
    );
  }

  const transaction = await requireCompletedTransaction(ctx, transactionId);

  if (transaction.storeId !== approvalRequest.storeId) {
    throw new Error(
      "Payment method approval request does not match this store.",
    );
  }

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

  const approvalEvent = await recordOperationalEventWithCtx(ctx, {
    actorStaffProfileId: args.reviewedByStaffProfileId,
    actorUserId: args.reviewedByUserId,
    approvalRequestId: args.approvalRequestId,
    eventType: "pos_transaction_payment_method_approval_request_approved",
    message: `Manager approved payment method correction for ${transactionLabel(transaction)}.`,
    metadata: {
      actionKey: PAYMENT_METHOD_CORRECTION_ACTION_KEY,
      approvalRequestId: args.approvalRequestId,
      paymentMethod,
      previousPaymentMethod: payment.method,
    },
    reason: args.decisionNotes,
    registerSessionId: transaction.registerSessionId,
    storeId: transaction.storeId,
    subjectId: transaction._id,
    subjectLabel: transactionLabel(transaction),
    subjectType: "pos_transaction",
    posTransactionId: transaction._id,
  });

  return applyPaymentMethodCorrection(ctx, {
    actorStaffProfileId: approvalRequest.requestedByStaffProfileId,
    actorUserId: approvalRequest.requestedByUserId,
    approvalOperationalEventId: approvalEvent?._id,
    approvalRequestId: args.approvalRequestId,
    approverStaffProfileId: args.reviewedByStaffProfileId,
    paymentMethod,
    reason: approvalRequest.notes ?? approvalRequest.reason,
    transaction,
  });
}
