import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../_generated/dataModel";
import { correctTransactionPaymentMethod } from "./commands/correctTransaction";
import { recordOperationalEventWithCtx } from "../../operations/operationalEvents";
import { correctSameAmountSinglePaymentAllocationWithCtx } from "../../operations/paymentAllocations";
import {
  getPosTransactionById,
  patchPosTransaction,
} from "../infrastructure/repositories/transactionRepository";

vi.mock("../../operations/operationalEvents", () => ({
  recordOperationalEventWithCtx: vi.fn(),
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
        patch: vi.fn(),
      },
    };
  }

  it("patches the single same-amount payment and matching allocation", async () => {
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
    vi.mocked(recordOperationalEventWithCtx).mockResolvedValue({
      _id: "event-1" as Id<"operationalEvent">,
    } as never);

    const result = await correctTransactionPaymentMethod({} as never, {
      transactionId: "txn-1" as Id<"posTransaction">,
      paymentMethod: "card",
      reason: "Till entry correction",
    });

    expect(correctSameAmountSinglePaymentAllocationWithCtx).toHaveBeenCalledWith(
      {} as never,
      {
        storeId: "store-1",
        targetType: "pos_transaction",
        targetId: "txn-1",
        amount: 1000,
        method: "card",
      },
    );
    expect(patchPosTransaction).toHaveBeenCalledWith({} as never, "txn-1", {
      paymentMethod: "card",
      payments: [{ method: "card", amount: 1000, timestamp: 1 }],
    });
    expect(recordOperationalEventWithCtx).toHaveBeenCalledWith(
      {} as never,
      expect.objectContaining({
        eventType: "pos_transaction_payment_method_corrected",
        paymentAllocationId: "allocation-1",
        metadata: expect.objectContaining({
          previousPaymentMethod: "cash",
          paymentMethod: "card",
          amount: 1000,
          representation: "patch_single_same_amount_payment_and_allocation",
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        previousPaymentMethod: "cash",
        paymentMethod: "card",
        paymentAllocationId: "allocation-1",
        operationalEventId: "event-1",
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
    vi.mocked(recordOperationalEventWithCtx).mockResolvedValue({
      _id: "event-1" as Id<"operationalEvent">,
    } as never);

    await correctTransactionPaymentMethod(ctx as never, {
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
    vi.mocked(recordOperationalEventWithCtx).mockResolvedValue({
      _id: "event-1" as Id<"operationalEvent">,
    } as never);

    await correctTransactionPaymentMethod(ctx as never, {
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
});
