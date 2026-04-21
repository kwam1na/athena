import { describe, expect, it } from "vitest";

import { buildCompleteTransactionResult } from "./commands/completeTransaction";

describe("buildCompleteTransactionResult", () => {
  it("returns ok with transaction data when completion succeeds", () => {
    const result = buildCompleteTransactionResult({
      transactionId: "txn-1",
      transactionNumber: "POS-TXN-001",
      paymentAllocated: true,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error("Expected successful completion result");
    }
    expect(result.data.transactionNumber).toBe("POS-TXN-001");
  });

  it("does not fail completion when no payment allocations are recorded", () => {
    const result = buildCompleteTransactionResult({
      transactionId: "txn-1",
      transactionNumber: "POS-TXN-001",
      paymentAllocated: false,
    });

    expect(result.status).toBe("ok");
  });

  it("returns validationFailed when transaction identifiers are missing", () => {
    const result = buildCompleteTransactionResult({
      transactionId: null,
      transactionNumber: null,
      paymentAllocated: true,
    });

    expect(result.status).toBe("validationFailed");
  });
});
