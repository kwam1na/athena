import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../_generated/dataModel";
import {
  correctTransactionPaymentMethod,
  resolvePaymentMethodCorrectionApprovalDecisionWithCtx,
} from "./commands/correctTransaction";
import { consumeCommandApprovalProofWithCtx } from "../../operations/approvalActions";
import { recordOperationalEventWithCtx } from "../../operations/operationalEvents";
import { correctSameAmountSinglePaymentAllocationWithCtx } from "../../operations/paymentAllocations";
import {
  getPosTransactionById,
  patchPosTransaction,
} from "../infrastructure/repositories/transactionRepository";

vi.mock("../../operations/operationalEvents", () => ({
  recordOperationalEventWithCtx: vi.fn(),
}));

vi.mock("../../operations/approvalActions", () => ({
  APPROVAL_ACTIONS: {
    transactionPaymentMethodCorrection: {
      key: "pos.transaction.correct_payment_method",
      label: "Correct payment method",
    },
  },
  consumeCommandApprovalProofWithCtx: vi.fn(),
}));

vi.mock("../../operations/paymentAllocations", () => ({
  correctSameAmountSinglePaymentAllocationWithCtx: vi.fn(),
}));

vi.mock("../infrastructure/repositories/transactionRepository", () => ({
  getPosTransactionById: vi.fn(),
  patchPosTransaction: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
});

describe("correctTransactionPaymentMethod", () => {
  function createMutationCtx() {
    return {
      db: {
        get: vi.fn(),
        insert: vi.fn(),
        patch: vi.fn(),
      },
      runMutation: vi.fn(),
    };
  }

  it("creates an async manager approval request before mutating", async () => {
    const ctx = createMutationCtx();
    vi.mocked(ctx.db.get).mockResolvedValue({
      _id: "store-1",
      organizationId: "org-1",
    } as never);
    vi.mocked(ctx.db.insert).mockResolvedValue(
      "approval-1" as Id<"approvalRequest">,
    );
    vi.mocked(getPosTransactionById).mockResolvedValue({
      _id: "txn-1" as Id<"posTransaction">,
      storeId: "store-1" as Id<"store">,
      transactionNumber: "POS-111111",
      status: "completed",
      total: 1000,
      totalPaid: 1000,
      paymentMethod: "cash",
      payments: [{ method: "cash", amount: 1000, timestamp: 1 }],
    } as never);

    vi.mocked(recordOperationalEventWithCtx).mockResolvedValue({
      _id: "request-event-1" as Id<"operationalEvent">,
    } as never);

    const result = await correctTransactionPaymentMethod(ctx as never, {
      actorStaffProfileId: "cashier-1" as Id<"staffProfile">,
      transactionId: "txn-1" as Id<"posTransaction">,
      paymentMethod: "card",
      reason: "Till entry correction",
    });

    expect(result).toMatchObject({
      action: "approval_required",
      approval: {
        action: {
          key: "pos.transaction.correct_payment_method",
        },
        requiredRole: "manager",
        subject: {
          id: "txn-1",
          type: "pos_transaction",
        },
        resolutionModes: [
          {
            kind: "inline_manager_proof",
          },
          {
            kind: "async_request",
            requestType: "payment_method_correction",
            approvalRequestId: "approval-1",
          },
        ],
      },
      previousPaymentMethod: "cash",
      paymentMethod: "card",
      transactionId: "txn-1",
    });
    expect(ctx.db.insert).toHaveBeenCalledWith(
      "approvalRequest",
      expect.objectContaining({
        organizationId: "org-1",
        requestType: "payment_method_correction",
        requestedByStaffProfileId: "cashier-1",
        status: "pending",
        subjectId: "txn-1",
        subjectType: "pos_transaction",
        metadata: expect.objectContaining({
          actionKey: "pos.transaction.correct_payment_method",
          paymentMethod: "card",
          previousPaymentMethod: "cash",
        }),
      }),
    );
    expect(correctSameAmountSinglePaymentAllocationWithCtx).not.toHaveBeenCalled();
    expect(patchPosTransaction).not.toHaveBeenCalled();
    expect(recordOperationalEventWithCtx).toHaveBeenCalledWith(
      ctx as never,
      expect.objectContaining({
        approvalRequestId: "approval-1",
        eventType: "pos_transaction_payment_method_approval_requested",
      }),
    );
  });

  it("patches the single same-amount payment and matching allocation after consuming a matching proof", async () => {
    const ctx = createMutationCtx();
    vi.mocked(consumeCommandApprovalProofWithCtx).mockResolvedValue({
      kind: "ok",
      data: {
        approvalProofId: "proof-1" as Id<"approvalProof">,
        approvedByStaffProfileId: "manager-1",
        consumedAt: 1,
        expiresAt: 2,
      },
    } as never);
    vi.mocked(getPosTransactionById).mockResolvedValue({
      _id: "txn-1" as Id<"posTransaction">,
      storeId: "store-1" as Id<"store">,
      transactionNumber: "POS-111111",
      status: "completed",
      total: 1000,
      totalPaid: 1000,
      paymentMethod: "cash",
      payments: [{ method: "cash", amount: 1000, timestamp: 1 }],
    } as never);
    vi.mocked(correctSameAmountSinglePaymentAllocationWithCtx).mockResolvedValue({
      _id: "allocation-1" as Id<"paymentAllocation">,
    } as never);
    vi.mocked(recordOperationalEventWithCtx)
      .mockResolvedValueOnce({
        _id: "approval-event-1" as Id<"operationalEvent">,
      } as never)
      .mockResolvedValueOnce({
        _id: "event-1" as Id<"operationalEvent">,
      } as never);

    const result = await correctTransactionPaymentMethod(ctx as never, {
      actorStaffProfileId: "cashier-1" as Id<"staffProfile">,
      approvalProofId: "proof-1" as Id<"approvalProof">,
      transactionId: "txn-1" as Id<"posTransaction">,
      paymentMethod: "card",
      reason: "Till entry correction",
    });

    expect(consumeCommandApprovalProofWithCtx).toHaveBeenCalledWith(ctx as never, {
      action: expect.objectContaining({
        key: "pos.transaction.correct_payment_method",
      }),
      approvalProofId: "proof-1" as Id<"approvalProof">,
      requestedByStaffProfileId: "cashier-1" as Id<"staffProfile">,
      requiredRole: "manager",
      storeId: "store-1",
      subject: {
        id: "txn-1",
        type: "pos_transaction",
      },
    });
    expect(correctSameAmountSinglePaymentAllocationWithCtx).toHaveBeenCalledWith(
      ctx as never,
      {
        storeId: "store-1",
        targetType: "pos_transaction",
        targetId: "txn-1",
        amount: 1000,
        method: "card",
      },
    );
    expect(patchPosTransaction).toHaveBeenCalledWith(ctx as never, "txn-1", {
      paymentMethod: "card",
      payments: [{ method: "card", amount: 1000, timestamp: 1 }],
    });
    expect(recordOperationalEventWithCtx).toHaveBeenNthCalledWith(
      2,
      ctx as never,
      expect.objectContaining({
        eventType: "pos_transaction_payment_method_corrected",
        paymentAllocationId: "allocation-1",
        metadata: expect.objectContaining({
          approvalProofId: "proof-1" as Id<"approvalProof">,
          approvalOperationalEventId: "approval-event-1",
          approverStaffProfileId: "manager-1",
          previousPaymentMethod: "cash",
          paymentMethod: "card",
          requesterStaffProfileId: "cashier-1",
          amount: 1000,
          representation: "patch_single_same_amount_payment_and_allocation",
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        previousPaymentMethod: "cash",
        paymentMethod: "card",
        approvalProofId: "proof-1" as Id<"approvalProof">,
        approvalOperationalEventId: "approval-event-1",
        approverStaffProfileId: "manager-1",
        paymentAllocationId: "allocation-1",
        operationalEventId: "event-1",
      }),
    );
  });

  it("closes the queued approval request after same-submission manager approval", async () => {
    const ctx = createMutationCtx();
    vi.mocked(ctx.db.get).mockResolvedValue({
      _id: "approval-1",
      requestType: "payment_method_correction",
      subjectType: "pos_transaction",
      subjectId: "txn-1",
      storeId: "store-1",
      status: "pending",
      metadata: {
        paymentMethod: "card",
      },
    } as never);
    vi.mocked(consumeCommandApprovalProofWithCtx).mockResolvedValue({
      kind: "ok",
      data: {
        approvalProofId: "proof-1" as Id<"approvalProof">,
        approvedByStaffProfileId: "manager-1",
        consumedAt: 1,
        expiresAt: 2,
      },
    } as never);
    vi.mocked(getPosTransactionById).mockResolvedValue({
      _id: "txn-1" as Id<"posTransaction">,
      storeId: "store-1" as Id<"store">,
      transactionNumber: "POS-111111",
      status: "completed",
      total: 1000,
      totalPaid: 1000,
      paymentMethod: "cash",
      payments: [{ method: "cash", amount: 1000, timestamp: 1 }],
    } as never);
    vi.mocked(correctSameAmountSinglePaymentAllocationWithCtx).mockResolvedValue({
      _id: "allocation-1" as Id<"paymentAllocation">,
    } as never);
    vi.mocked(recordOperationalEventWithCtx)
      .mockResolvedValueOnce({
        _id: "approval-event-1" as Id<"operationalEvent">,
      } as never)
      .mockResolvedValueOnce({
        _id: "event-1" as Id<"operationalEvent">,
      } as never);

    const result = await correctTransactionPaymentMethod(ctx as never, {
      actorStaffProfileId: "manager-1" as Id<"staffProfile">,
      actorUserId: "user-1" as Id<"athenaUser">,
      approvalRequestId: "approval-1" as Id<"approvalRequest">,
      approvalProofId: "proof-1" as Id<"approvalProof">,
      transactionId: "txn-1" as Id<"posTransaction">,
      paymentMethod: "card",
      reason: "Till entry correction",
    });

    expect(recordOperationalEventWithCtx).toHaveBeenNthCalledWith(
      1,
      ctx as never,
      expect.objectContaining({
        approvalRequestId: "approval-1",
        eventType: "pos_transaction_payment_method_approval_proof_consumed",
        metadata: expect.objectContaining({
          approvalRequestId: "approval-1",
          approvalProofId: "proof-1",
        }),
      }),
    );
    expect(ctx.db.patch).toHaveBeenCalledWith("approvalRequest", "approval-1", {
      status: "approved",
      reviewedByUserId: "user-1",
      reviewedByStaffProfileId: "manager-1",
      decisionNotes: "Till entry correction",
      decidedAt: expect.any(Number),
    });
    expect(result).toEqual(
      expect.objectContaining({
        approvalRequestId: "approval-1",
        approvalProofId: "proof-1",
        paymentMethod: "card",
        previousPaymentMethod: "cash",
      }),
    );
  });

  it("applies the queued payment correction when the async request is approved", async () => {
    const ctx = createMutationCtx();
    vi.mocked(ctx.db.get).mockResolvedValue({
      _id: "approval-1",
      requestType: "payment_method_correction",
      subjectType: "pos_transaction",
      subjectId: "txn-1",
      storeId: "store-1",
      requestedByStaffProfileId: "cashier-1",
      notes: "Till entry correction",
      metadata: {
        paymentMethod: "card",
      },
    } as never);
    vi.mocked(getPosTransactionById).mockResolvedValue({
      _id: "txn-1" as Id<"posTransaction">,
      storeId: "store-1" as Id<"store">,
      transactionNumber: "POS-111111",
      status: "completed",
      total: 1000,
      totalPaid: 1000,
      paymentMethod: "cash",
      payments: [{ method: "cash", amount: 1000, timestamp: 1 }],
    } as never);
    vi.mocked(correctSameAmountSinglePaymentAllocationWithCtx).mockResolvedValue({
      _id: "allocation-1" as Id<"paymentAllocation">,
    } as never);
    vi.mocked(recordOperationalEventWithCtx)
      .mockResolvedValueOnce({
        _id: "approval-event-1" as Id<"operationalEvent">,
      } as never)
      .mockResolvedValueOnce({
        _id: "event-1" as Id<"operationalEvent">,
      } as never);

    const result = await resolvePaymentMethodCorrectionApprovalDecisionWithCtx(
      ctx as never,
      {
        approvalRequestId: "approval-1" as Id<"approvalRequest">,
        decision: "approved",
        reviewedByStaffProfileId: "manager-1" as Id<"staffProfile">,
      },
    );

    expect(correctSameAmountSinglePaymentAllocationWithCtx).toHaveBeenCalledWith(
      ctx as never,
      {
        storeId: "store-1",
        targetType: "pos_transaction",
        targetId: "txn-1",
        amount: 1000,
        method: "card",
      },
    );
    expect(patchPosTransaction).toHaveBeenCalledWith(ctx as never, "txn-1", {
      paymentMethod: "card",
      payments: [{ method: "card", amount: 1000, timestamp: 1 }],
    });
    expect(recordOperationalEventWithCtx).toHaveBeenNthCalledWith(
      2,
      ctx as never,
      expect.objectContaining({
        approvalRequestId: "approval-1",
        eventType: "pos_transaction_payment_method_corrected",
        metadata: expect.objectContaining({
          approvalRequestId: "approval-1",
          approvalOperationalEventId: "approval-event-1",
          approverStaffProfileId: "manager-1",
          paymentMethod: "card",
          previousPaymentMethod: "cash",
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        approvalRequestId: "approval-1",
        paymentMethod: "card",
        previousPaymentMethod: "cash",
      }),
    );
  });

  it("subtracts cash from the register session when correcting cash to non-cash", async () => {
    const ctx = createMutationCtx();
    vi.mocked(ctx.db.get).mockResolvedValue({
      _id: "register-session-1",
      countedCash: 9000,
      expectedCash: 7000,
      storeId: "store-1",
    } as never);
    vi.mocked(getPosTransactionById).mockResolvedValue({
      _id: "txn-1" as Id<"posTransaction">,
      registerSessionId: "register-session-1" as Id<"registerSession">,
      storeId: "store-1" as Id<"store">,
      transactionNumber: "POS-111111",
      status: "completed",
      total: 1000,
      totalPaid: 1000,
      paymentMethod: "cash",
      payments: [{ method: "cash", amount: 1000, timestamp: 1 }],
    } as never);
    vi.mocked(correctSameAmountSinglePaymentAllocationWithCtx).mockResolvedValue({
      _id: "allocation-1" as Id<"paymentAllocation">,
    } as never);
    vi.mocked(consumeCommandApprovalProofWithCtx).mockResolvedValue({
      kind: "ok",
      data: {
        approvalProofId: "proof-1" as Id<"approvalProof">,
        approvedByStaffProfileId: "manager-1",
        consumedAt: 1,
        expiresAt: 2,
      },
    } as never);
    vi.mocked(recordOperationalEventWithCtx).mockResolvedValue({
      _id: "event-1" as Id<"operationalEvent">,
    } as never);

    await correctTransactionPaymentMethod(ctx as never, {
      approvalProofId: "proof-1" as Id<"approvalProof">,
      transactionId: "txn-1" as Id<"posTransaction">,
      paymentMethod: "card",
      reason: "Till entry correction",
    });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      "registerSession",
      "register-session-1",
      {
        expectedCash: 6000,
        variance: 3000,
      },
    );
    expect(recordOperationalEventWithCtx).toHaveBeenCalledWith(
      ctx as never,
      expect.objectContaining({
        metadata: expect.objectContaining({
          registerSessionExpectedCashDelta: -1000,
        }),
      }),
    );
  });

  it("adds cash to the register session when correcting non-cash to cash", async () => {
    const ctx = createMutationCtx();
    vi.mocked(ctx.db.get).mockResolvedValue({
      _id: "register-session-1",
      expectedCash: 7000,
      storeId: "store-1",
    } as never);
    vi.mocked(getPosTransactionById).mockResolvedValue({
      _id: "txn-1" as Id<"posTransaction">,
      registerSessionId: "register-session-1" as Id<"registerSession">,
      storeId: "store-1" as Id<"store">,
      transactionNumber: "POS-111111",
      status: "completed",
      total: 1000,
      totalPaid: 1000,
      paymentMethod: "card",
      payments: [{ method: "card", amount: 1000, timestamp: 1 }],
    } as never);
    vi.mocked(correctSameAmountSinglePaymentAllocationWithCtx).mockResolvedValue({
      _id: "allocation-1" as Id<"paymentAllocation">,
    } as never);
    vi.mocked(consumeCommandApprovalProofWithCtx).mockResolvedValue({
      kind: "ok",
      data: {
        approvalProofId: "proof-1" as Id<"approvalProof">,
        approvedByStaffProfileId: "manager-1",
        consumedAt: 1,
        expiresAt: 2,
      },
    } as never);
    vi.mocked(recordOperationalEventWithCtx).mockResolvedValue({
      _id: "event-1" as Id<"operationalEvent">,
    } as never);

    await correctTransactionPaymentMethod(ctx as never, {
      approvalProofId: "proof-1" as Id<"approvalProof">,
      transactionId: "txn-1" as Id<"posTransaction">,
      paymentMethod: "cash",
      reason: "Till entry correction",
    });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      "registerSession",
      "register-session-1",
      {
        expectedCash: 8000,
      },
    );
  });

  it("rejects payment method corrections while the register session is closing", async () => {
    const ctx = createMutationCtx();
    vi.mocked(ctx.db.get).mockResolvedValue({
      _id: "register-session-1",
      expectedCash: 7000,
      status: "closing",
      storeId: "store-1",
    } as never);
    vi.mocked(getPosTransactionById).mockResolvedValue({
      _id: "txn-1" as Id<"posTransaction">,
      registerSessionId: "register-session-1" as Id<"registerSession">,
      storeId: "store-1" as Id<"store">,
      transactionNumber: "POS-111111",
      status: "completed",
      total: 1000,
      totalPaid: 1000,
      paymentMethod: "card",
      payments: [{ method: "card", amount: 1000, timestamp: 1 }],
    } as never);

    await expect(
      correctTransactionPaymentMethod(ctx as never, {
        approvalProofId: "proof-1" as Id<"approvalProof">,
        transactionId: "txn-1" as Id<"posTransaction">,
        paymentMethod: "cash",
        reason: "Till entry correction",
      }),
    ).rejects.toThrow(
      "Register closeout is under review. Reopen the register before updating payment details.",
    );
    expect(correctSameAmountSinglePaymentAllocationWithCtx).not.toHaveBeenCalled();
    expect(patchPosTransaction).not.toHaveBeenCalled();
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it("rejects split payments", async () => {
    vi.mocked(getPosTransactionById).mockResolvedValue({
      _id: "txn-1" as Id<"posTransaction">,
      storeId: "store-1" as Id<"store">,
      transactionNumber: "POS-111111",
      status: "completed",
      total: 1000,
      totalPaid: 1000,
      payments: [
        { method: "cash", amount: 500, timestamp: 1 },
        { method: "card", amount: 500, timestamp: 2 },
      ],
    } as never);

    await expect(
      correctTransactionPaymentMethod({} as never, {
        transactionId: "txn-1" as Id<"posTransaction">,
        paymentMethod: "card",
      }),
    ).rejects.toThrow("Only single-payment transactions can be corrected.");
    expect(patchPosTransaction).not.toHaveBeenCalled();
  });

  it("rejects invalid approval proofs before payment allocation changes", async () => {
    const ctx = createMutationCtx();
    vi.mocked(consumeCommandApprovalProofWithCtx).mockResolvedValue({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message: "Approval proof does not match this command.",
      },
    } as never);
    vi.mocked(getPosTransactionById).mockResolvedValue({
      _id: "txn-1" as Id<"posTransaction">,
      storeId: "store-1" as Id<"store">,
      transactionNumber: "POS-111111",
      status: "completed",
      total: 1000,
      totalPaid: 1000,
      paymentMethod: "cash",
      payments: [{ method: "cash", amount: 1000, timestamp: 1 }],
    } as never);

    await expect(
      correctTransactionPaymentMethod(ctx as never, {
        actorStaffProfileId: "cashier-1" as Id<"staffProfile">,
        approvalProofId: "proof-other-transaction" as Id<"approvalProof">,
        transactionId: "txn-1" as Id<"posTransaction">,
        paymentMethod: "card",
      }),
    ).rejects.toThrow("Approval proof does not match this command.");
    expect(correctSameAmountSinglePaymentAllocationWithCtx).not.toHaveBeenCalled();
    expect(patchPosTransaction).not.toHaveBeenCalled();
  });
});
