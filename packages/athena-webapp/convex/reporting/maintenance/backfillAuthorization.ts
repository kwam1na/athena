export type BackfillAuthorizationEnvelope = {
  contractVersion: number;
  migrationPurpose: "reports_financial_truth_reset_backfill";
  organizationId: string;
  requestNonce: string;
  sourceScope: "pos";
  storeId: string;
  timezoneContentHash: string;
};

function fnv1a(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizeEnvelope(input: BackfillAuthorizationEnvelope) {
  if (input.sourceScope !== "pos") {
    throw new Error("Reporting backfill source scope is invalid");
  }
  if (!input.requestNonce.trim()) {
    throw new Error("Reporting backfill request nonce is required");
  }
  if (
    !Number.isSafeInteger(input.contractVersion) ||
    input.contractVersion < 1
  ) {
    throw new Error("Reporting backfill contract version is invalid");
  }
  if (
    !input.organizationId.trim() ||
    !input.storeId.trim() ||
    !input.timezoneContentHash.trim()
  ) {
    throw new Error("Reporting backfill authorization scope is incomplete");
  }
  return {
    ...input,
    organizationId: input.organizationId.trim(),
    requestNonce: input.requestNonce.trim(),
    storeId: input.storeId.trim(),
    timezoneContentHash: input.timezoneContentHash.trim(),
  };
}

export function backfillAuthorizationEnvelopeHash(
  input: BackfillAuthorizationEnvelope,
) {
  const value = normalizeEnvelope(input);
  return `reporting-backfill-authorization-v1:${fnv1a(
    JSON.stringify([
      value.organizationId,
      value.storeId,
      value.sourceScope,
      value.migrationPurpose,
      value.contractVersion,
      value.timezoneContentHash,
      value.requestNonce,
    ]),
  )}`;
}

export function backfillAuthorizationMatches(input: {
  envelope: BackfillAuthorizationEnvelope;
  envelopeHash: string;
}) {
  return backfillAuthorizationEnvelopeHash(input.envelope) === input.envelopeHash;
}
