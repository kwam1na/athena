import { describe, expect, it } from "vitest";
import { shouldRetryReceiptLookup } from "./-PosReceiptPage";

describe("receipt lookup retry boundary", () => {
  it("does not retry denied or missing tokenized receipts", () => {
    expect(
      shouldRetryReceiptLookup(
        0,
        Object.assign(new Error("Forbidden"), { status: 403 }),
      ),
    ).toBe(false);
    expect(
      shouldRetryReceiptLookup(
        0,
        Object.assign(new Error("Not found"), { status: 404 }),
      ),
    ).toBe(false);
  });

  it("retries transient failures only within the bounded attempt count", () => {
    const transient = Object.assign(new Error("Unavailable"), { status: 503 });
    expect(shouldRetryReceiptLookup(0, transient)).toBe(true);
    expect(shouldRetryReceiptLookup(2, transient)).toBe(false);
  });
});
