import { describe, expect, it } from "vitest";
import { calculateContinuationDelay, calculateFailureRetryDelay } from "../src/retry";

describe("retry delays", () => {
  it("uses 1s continuation delay", () => {
    expect(calculateContinuationDelay()).toBe(1000);
  });

  it("uses exponential backoff with cap", () => {
    expect(calculateFailureRetryDelay(1, 300000)).toBe(10000);
    expect(calculateFailureRetryDelay(2, 300000)).toBe(20000);
    expect(calculateFailureRetryDelay(3, 300000)).toBe(40000);
    expect(calculateFailureRetryDelay(10, 300000)).toBe(300000);
  });
});
