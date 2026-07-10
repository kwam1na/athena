import { describe, expect, it } from "vitest";

import { sanitizeConflictEvidence } from "./integrity";

describe("reporting integrity evidence", () => {
  it("keeps safe fingerprints and allowlisted field names without source values", () => {
    expect(
      sanitizeConflictEvidence({
        expectedFingerprint: "expected-hash",
        receivedFingerprint: "received-hash",
        materialFields: ["amountMinor", "customerEmail", "quantity", "cardNumber"],
      }),
    ).toEqual({
      expectedFingerprint: "expected-hash",
      receivedFingerprint: "received-hash",
      materialFields: ["amountMinor", "quantity"],
    });
  });
});
