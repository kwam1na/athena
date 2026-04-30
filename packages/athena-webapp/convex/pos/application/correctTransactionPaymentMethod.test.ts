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
