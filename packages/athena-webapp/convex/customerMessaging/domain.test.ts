import { describe, expect, it } from "vitest";

import {
  maskReceiptPhone,
  normalizeReceiptPhone,
  statusIsRetryable,
} from "./domain";
import { assertSupportedCustomerMessagePolicy } from "./policy";

describe("customer messaging domain", () => {
  it("normalizes and masks receipt phone numbers without mutating profiles", () => {
    expect(normalizeReceiptPhone("+233 55 000 0000")).toBe("+233550000000");
    expect(maskReceiptPhone("+233 55 000 0000")).toBe("+********0000");
  });

  it("keeps retry policy explicit for receipt delivery statuses", () => {
    expect(statusIsRetryable("failed")).toBe(true);
    expect(statusIsRetryable("unknown")).toBe(true);
    expect(statusIsRetryable("sent")).toBe(false);
  });

  it("rejects unsupported future intent/channel combinations", () => {
    expect(() =>
      assertSupportedCustomerMessagePolicy({
        intent: "pos_receipt_link",
        channel: "whatsapp_business",
      }),
    ).not.toThrow();

    expect(() =>
      assertSupportedCustomerMessagePolicy({
        intent: "marketing_broadcast" as never,
        channel: "whatsapp_business",
      }),
    ).toThrow("Unsupported customer message intent or channel.");
  });
});
