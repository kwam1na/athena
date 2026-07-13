import { describe, expect, it } from "vitest";
import {
  backfillAuthorizationEnvelopeHash,
  backfillAuthorizationMatches,
  type BackfillAuthorizationEnvelope,
} from "./backfillAuthorization";

const envelope: BackfillAuthorizationEnvelope = {
  contractVersion: 2,
  migrationPurpose: "reports_financial_truth_reset_backfill",
  organizationId: "org-1",
  requestNonce: "nonce-1",
  sourceScope: "pos",
  storeId: "store-1",
  timezoneContentHash: "timezone:accra:v1",
};

describe("reporting backfill authorization envelope", () => {
  it("is deterministic and server-scope material", () => {
    expect(backfillAuthorizationEnvelopeHash(envelope)).toBe(
      backfillAuthorizationEnvelopeHash({ ...envelope }),
    );
    expect(backfillAuthorizationEnvelopeHash(envelope)).not.toBe(
      backfillAuthorizationEnvelopeHash({ ...envelope, storeId: "store-2" }),
    );
  });

  it("accepts only exact immutable lineage", () => {
    const hash = backfillAuthorizationEnvelopeHash(envelope);
    expect(backfillAuthorizationMatches({ envelope, envelopeHash: hash })).toBe(
      true,
    );
    expect(
      backfillAuthorizationMatches({
        envelope: { ...envelope, contractVersion: 3 },
        envelopeHash: hash,
      }),
    ).toBe(false);
  });

  it("rejects empty caller nonce and invalid scope", () => {
    expect(() =>
      backfillAuthorizationEnvelopeHash({ ...envelope, requestNonce: "" }),
    ).toThrow("request nonce");
    expect(() =>
      backfillAuthorizationEnvelopeHash({
        ...envelope,
        sourceScope: "storefront" as "pos",
      }),
    ).toThrow("source scope");
  });
});
