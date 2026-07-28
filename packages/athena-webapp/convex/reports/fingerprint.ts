import {
  REPORTS_FINGERPRINT_VERSION,
  type NewReportFact,
} from "../../shared/reportsContract";

/**
 * Content fingerprints for reportFact rows.
 *
 * The fingerprint answers exactly one question: "is this replay byte-identical
 * to what we already stored?". It is a drift detector, not a security control —
 * an FNV-1a hash over a FIXED-ORDER JSON array is deliberately cheap.
 *
 * The field order below is part of the stored data (every persisted row carries
 * `fingerprintVersion`). Changing the order, the field set, or the hash bumps
 * REPORTS_FINGERPRINT_VERSION in the contract — never this file alone.
 */

/** Fixed-order content projection. Identity fields are NOT included: identity
 * is structural (the by_identity index), the fingerprint covers content only. */
export function fingerprintPayload(fact: NewReportFact): unknown[] {
  return [
    REPORTS_FINGERPRINT_VERSION,
    fact.currency,
    fact.occurredAt,
    fact.grossAmountMinor,
    fact.netAmountMinor,
    fact.taxAmountMinor,
    fact.discountAmountMinor,
    fact.quantity,
    fact.productSkuId ?? null,
    fact.unitCostMinor ?? null,
  ];
}

/** FNV-1a (32-bit), returned as unsigned hex. Stable across runtimes. */
export function stableStringHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    // hash *= 16777619, in 32-bit space without relying on Math.imul overflow.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Deterministic content fingerprint. Prefixed with the version so a stored
 * value is self-describing in logs and in the quarantine trail.
 */
export function factFingerprint(fact: NewReportFact): string {
  const serialized = JSON.stringify(fingerprintPayload(fact));
  return `v${REPORTS_FINGERPRINT_VERSION}:${stableStringHash(serialized)}`;
}

export { REPORTS_FINGERPRINT_VERSION };
