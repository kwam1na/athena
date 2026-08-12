import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../_generated/dataModel";
import {
  correctTransactionPaymentMethod,
  resolvePaymentMethodCorrectionApprovalDecisionWithCtx,
} from "./commands/correctTransaction";
import { consumeCommandApprovalProofWithCtx } from "../../operations/approvalActions";
import { createApprovalRequesterChallengeWithCtx } from "../../operations/approvalRequesterChallenges";
import { recordOperationalEventWithCtx } from "../../operations/operationalEvents";
import { correctSameAmountSinglePaymentAllocationWithCtx } from "../../operations/paymentAllocations";
import {
  getStoreById,
  getPosTransactionById,
  patchPosTransaction,
} from "../infrastructure/repositories/transactionRepository";
import { recordFacts } from "../../reports/ingest";
import { appendPosLifecycleJournalWithCtx } from "../infrastructure/posLifecycleJournal";

vi.mock("../infrastructure/posLifecycleJournal", () => ({
  appendPosLifecycleJournalWithCtx: vi.fn(),
}));

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

vi.mock(
  "../../operations/approvalRequesterChallenges",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../operations/approvalRequesterChallenges")
      >();

    return {
      ...actual,
      createApprovalRequesterChallengeWithCtx: vi.fn(),
    };
  },
);

vi.mock("../../operations/paymentAllocations", async (importOriginal) => ({
  // The participation-identity rule stays real: it is the contract under test,
  // not a collaborator. Only the mutating helper is stubbed.
  ...(await importOriginal<typeof import("../../operations/paymentAllocations")>()),
  correctSameAmountSinglePaymentAllocationWithCtx: vi.fn(),
}));

vi.mock("../../reports/ingest", () => ({
  recordFacts: vi.fn(),
}));

vi.mock("../../notifications/emit", () => ({
  emitNotificationWithCtx: vi.fn(),
}));

vi.mock("../infrastructure/repositories/transactionRepository", () => ({
  getStoreById: vi.fn(),
  getPosTransactionById: vi.fn(),
  patchPosTransaction: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(createApprovalRequesterChallengeWithCtx).mockResolvedValue({
    kind: "ok",
    data: {
      requesterBinding: {
        kind: "operational_staff_challenge",
        challengeId: "requester-challenge-1",
        requestedByStaffProfileId: "cashier-1",
      },
    },
  } as never);
  vi.mocked(getStoreById).mockResolvedValue({
    _id: "store-1",
    currency: "GHS",
    organizationId: "org-1",
  } as never);
  // The correction now REQUIRES its reclassification fact to land, so every
  // case that is not about that failure starts from a successful record.
  vi.mocked(recordFacts).mockResolvedValue({ outcome: "recorded" } as never);
});

/** The payment was received on an earlier operating day than the correction. */
const ORIGINAL_ALLOCATION_RECORDED_AT = Date.parse("2026-08-03T10:00:00Z");
const CORRECTION_EVENT_AT = Date.parse("2026-08-06T15:00:00Z");

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
        requesterBinding: {
          kind: "operational_staff_challenge",
          challengeId: "requester-challenge-1",
          requestedByStaffProfileId: "cashier-1",
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
    expect(createApprovalRequesterChallengeWithCtx).toHaveBeenCalledWith(
      ctx as never,
      expect.objectContaining({
        actionKey: "pos.transaction.correct_payment_method",
        organizationId: "org-1",
        requestedByStaffProfileId: "cashier-1",
        requiredRole: "manager",
        storeId: "store-1",
        subject: {
          id: "txn-1",
          label: "Transaction #POS-111111",
          type: "pos_transaction",
        },
      }),
    );
    expect(
      correctSameAmountSinglePaymentAllocationWithCtx,
    ).not.toHaveBeenCalled();
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
    vi.mocked(
      correctSameAmountSinglePaymentAllocationWithCtx,
    ).mockResolvedValue({
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

    expect(consumeCommandApprovalProofWithCtx).toHaveBeenCalledWith(
      ctx as never,
      {
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
      },
    );
    expect(
      correctSameAmountSinglePaymentAllocationWithCtx,
    ).toHaveBeenCalledWith(ctx as never, {
      storeId: "store-1",
      targetType: "pos_transaction",
      targetId: "txn-1",
      amount: 1000,
      method: "card",
    });
    expect(patchPosTransaction).toHaveBeenCalledWith(ctx as never, "txn-1", {
      paymentMethod: "card",
      payments: [{ method: "card", amount: 1000, timestamp: 1 }],
    });
    expect(appendPosLifecycleJournalWithCtx).toHaveBeenCalledWith(
      ctx as never,
      expect.objectContaining({
        eventKind: "payment_method_corrected",
        eventKey: "pos:txn-1:payment-correction:event-1",
        organizationId: "org-1",
        storeId: "store-1",
        transactionId: "txn-1",
      }),
    );
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
    expect(recordFacts).toHaveBeenCalledWith(
      ctx,
      "store-1",
      expect.arrayContaining([
        expect.objectContaining({
          factKind: "correction",
          grossAmountMinor: 0,
          lineId: "event-1",
          netAmountMinor: 0,
          quantity: 0,
          sourceDomain: "pos",
          sourceId: "txn-1",
        }),
      ]),
    );
  });

  /** The approved same-amount cash -> card correction, wired end to end. */
  async function runApprovedCashToCardCorrection(
    ctx: ReturnType<typeof createMutationCtx>,
    options: { allocationRecordedAt?: number; recordFactsOutcome?: unknown } = {},
  ) {
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
    vi.mocked(
      correctSameAmountSinglePaymentAllocationWithCtx,
    ).mockResolvedValue({
      _id: "allocation-1" as Id<"paymentAllocation">,
      posTransactionId: "txn-1" as Id<"posTransaction">,
      recordedAt: options.allocationRecordedAt ?? ORIGINAL_ALLOCATION_RECORDED_AT,
    } as never);
    vi.mocked(recordOperationalEventWithCtx)
      .mockResolvedValueOnce({
        _id: "approval-event-1" as Id<"operationalEvent">,
      } as never)
      .mockResolvedValueOnce({
        _id: "event-1" as Id<"operationalEvent">,
        createdAt: CORRECTION_EVENT_AT,
      } as never);
    vi.mocked(recordFacts).mockResolvedValue(
      (options.recordFactsOutcome ?? { outcome: "recorded" }) as never,
    );

    return await correctTransactionPaymentMethod(ctx as never, {
      actorStaffProfileId: "cashier-1" as Id<"staffProfile">,
      approvalProofId: "proof-1" as Id<"approvalProof">,
      transactionId: "txn-1" as Id<"posTransaction">,
      paymentMethod: "card",
      reason: "Till entry correction",
    });
  }

  it("moves method evidence from old to new while retaining participation identity", async () => {
    const ctx = createMutationCtx();
    await runApprovedCashToCardCorrection(ctx);

    expect(recordFacts).toHaveBeenCalledWith(
      ctx,
      "store-1",
      expect.arrayContaining([
        expect.objectContaining({
          factKind: "correction",
          // Payments totals never move: the money was always received.
          grossAmountMinor: 0,
          netAmountMinor: 0,
          paymentMethodFrom: "cash",
          paymentMethod: "card",
          paymentMixMinor: 1000,
          // The same participation the receipt carried, so the tender use
          // moves rather than being counted twice.
          paymentParticipationId: "txn-1",
          // The ORIGINAL allocation's business time: the reclassification
          // belongs to the day the payment was received, not the day it was
          // noticed. Knowledge time stays server-stamped at ingest, so an
          // earlier acceptance cutoff still excludes it.
          occurredAt: ORIGINAL_ALLOCATION_RECORDED_AT,
        }),
      ]),
    );
  });

  it("rolls back the correction when its reclassification fact cannot be recorded", async () => {
    const ctx = createMutationCtx();
    await expect(
      runApprovedCashToCardCorrection(ctx, {
        recordFactsOutcome: { outcome: "contained_failure" },
      }),
    ).rejects.toThrow(/reclassification|report|fact/i);
  });

  it("records a move to nowhere when the corrected method is not reportable", async () => {
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
    vi.mocked(
      correctSameAmountSinglePaymentAllocationWithCtx,
    ).mockResolvedValue({
      _id: "allocation-1" as Id<"paymentAllocation">,
      posTransactionId: "txn-1" as Id<"posTransaction">,
      recordedAt: ORIGINAL_ALLOCATION_RECORDED_AT,
    } as never);
    vi.mocked(recordOperationalEventWithCtx)
      .mockResolvedValueOnce({
        _id: "approval-event-1" as Id<"operationalEvent">,
      } as never)
      .mockResolvedValueOnce({
        _id: "event-1" as Id<"operationalEvent">,
        createdAt: CORRECTION_EVENT_AT,
      } as never);
    vi.mocked(recordFacts).mockResolvedValue({ outcome: "recorded" } as never);

    await correctTransactionPaymentMethod(ctx as never, {
      actorStaffProfileId: "cashier-1" as Id<"staffProfile">,
      approvalProofId: "proof-1" as Id<"approvalProof">,
      transactionId: "txn-1" as Id<"posTransaction">,
      paymentMethod: "cheque",
      reason: "Till entry correction",
    });

    const [fact] = vi.mocked(recordFacts).mock.calls.at(-1)?.[2] as Array<
      Record<string, unknown>
    >;
    // The value leaves a method reporting CAN classify for one it cannot, so
    // the move is still recorded — with no destination. Staying silent would
    // leave the receipt fact crediting cash for a payment the store's own
    // records now call a cheque, and the day would publish that as complete.
    expect(fact.paymentMethodFrom).toBe("cash");
    expect(fact.paymentMethod).toBeUndefined();
    expect(fact.paymentMixMinor).toBe(1000);
    expect(fact.paymentParticipationId).toBe("txn-1");
  });

  it("emits no move at all when the ORIGINAL method was already unclassifiable", async () => {
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
      paymentMethod: "cheque",
      payments: [{ method: "cheque", amount: 1000, timestamp: 1 }],
    } as never);
    vi.mocked(
      correctSameAmountSinglePaymentAllocationWithCtx,
    ).mockResolvedValue({
      _id: "allocation-1" as Id<"paymentAllocation">,
      posTransactionId: "txn-1" as Id<"posTransaction">,
      recordedAt: ORIGINAL_ALLOCATION_RECORDED_AT,
    } as never);
    vi.mocked(recordOperationalEventWithCtx)
      .mockResolvedValueOnce({
        _id: "approval-event-1" as Id<"operationalEvent">,
      } as never)
      .mockResolvedValueOnce({
        _id: "event-1" as Id<"operationalEvent">,
        createdAt: CORRECTION_EVENT_AT,
      } as never);

    await correctTransactionPaymentMethod(ctx as never, {
      actorStaffProfileId: "cashier-1" as Id<"staffProfile">,
      approvalProofId: "proof-1" as Id<"approvalProof">,
      transactionId: "txn-1" as Id<"posTransaction">,
      paymentMethod: "card",
      reason: "Till entry correction",
    });

    // The receipt fact carried no mix dimensions either, so the day is already
    // withheld and there is nothing to move off.
    const [fact] = vi.mocked(recordFacts).mock.calls.at(-1)?.[2] as Array<
      Record<string, unknown>
    >;
    expect(fact.paymentMethodFrom).toBeUndefined();
    expect(fact.paymentMethod).toBeUndefined();
    expect(fact.paymentMixMinor).toBeUndefined();
    expect(fact.paymentParticipationId).toBeUndefined();
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
    vi.mocked(
      correctSameAmountSinglePaymentAllocationWithCtx,
    ).mockResolvedValue({
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
    expect(recordOperationalEventWithCtx).toHaveBeenNthCalledWith(
      2,
      ctx as never,
      expect.objectContaining({
        approvalRequestId: "approval-1",
        eventType: "pos_transaction_payment_method_corrected",
        metadata: expect.objectContaining({
          decisionApprovalProofId: "proof-1",
          decisionApprovedByStaffProfileId: "manager-1",
        }),
      }),
    );
    expect(ctx.db.patch).toHaveBeenCalledWith("approvalRequest", "approval-1", {
      status: "approved",
      reviewedByUserId: "user-1",
      reviewedByStaffProfileId: "manager-1",
      decisionApprovalProofId: "proof-1",
      decisionApprovedByStaffProfileId: "manager-1",
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
    vi.mocked(
      correctSameAmountSinglePaymentAllocationWithCtx,
    ).mockResolvedValue({
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

    expect(
      correctSameAmountSinglePaymentAllocationWithCtx,
    ).toHaveBeenCalledWith(ctx as never, {
      storeId: "store-1",
      targetType: "pos_transaction",
      targetId: "txn-1",
      amount: 1000,
      method: "card",
    });
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

  it("records payment correction rejection events with the transaction number", async () => {
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
      registerSessionId: "register-session-1" as Id<"registerSession">,
      storeId: "store-1" as Id<"store">,
      transactionNumber: "POS-111111",
      status: "completed",
      total: 1000,
      totalPaid: 1000,
      paymentMethod: "cash",
      payments: [{ method: "cash", amount: 1000, timestamp: 1 }],
    } as never);
    vi.mocked(recordOperationalEventWithCtx).mockResolvedValue({
      _id: "event-1" as Id<"operationalEvent">,
    } as never);

    const result = await resolvePaymentMethodCorrectionApprovalDecisionWithCtx(
      ctx as never,
      {
        approvalRequestId: "approval-1" as Id<"approvalRequest">,
        decision: "rejected",
        decisionNotes: "Wrong request.",
        reviewedByStaffProfileId: "manager-1" as Id<"staffProfile">,
      },
    );

    expect(result).toBeNull();
    expect(recordOperationalEventWithCtx).toHaveBeenCalledWith(
      ctx as never,
      expect.objectContaining({
        approvalRequestId: "approval-1",
        eventType: "pos_transaction_payment_method_approval_rejected",
        message:
          "Payment method correction rejected for Transaction #POS-111111.",
        metadata: expect.objectContaining({
          decision: "rejected",
          transactionNumber: "POS-111111",
        }),
        registerSessionId: "register-session-1",
        subjectLabel: "Transaction #POS-111111",
      }),
    );
  });

  it("subtracts cash from the register session when correcting cash to non-cash", async () => {
    const ctx = createMutationCtx();
    vi.mocked(ctx.db.get).mockResolvedValue({
      _id: "register-session-1",
      countedCash: 9000,
      expectedCash: 7000,
      status: "active",
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
    vi.mocked(
      correctSameAmountSinglePaymentAllocationWithCtx,
    ).mockResolvedValue({
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
      status: "active",
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
    vi.mocked(
      correctSameAmountSinglePaymentAllocationWithCtx,
    ).mockResolvedValue({
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

  it.each(["closing", "closeout_rejected"] as const)(
    "rejects payment method corrections while the register session is %s",
    async (status) => {
      const ctx = createMutationCtx();
      vi.mocked(ctx.db.get).mockResolvedValue({
        _id: "register-session-1",
        expectedCash: 7000,
        status,
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
      expect(
        correctSameAmountSinglePaymentAllocationWithCtx,
      ).not.toHaveBeenCalled();
      expect(patchPosTransaction).not.toHaveBeenCalled();
      expect(ctx.db.patch).not.toHaveBeenCalled();
    },
  );

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
    expect(
      correctSameAmountSinglePaymentAllocationWithCtx,
    ).not.toHaveBeenCalled();
    expect(patchPosTransaction).not.toHaveBeenCalled();
  });
});
