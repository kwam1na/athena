import {
  normalizeCurrencyCode,
  REPORTS_FINGERPRINT_VERSION,
  type NewReportFact,
} from "../../shared/reportsContract";

export const LEGACY_REPORTS_FINGERPRINT_VERSION = 1 as const;

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
 * is structural (the by_identity index), the fingerprint covers content only.
 * Values are hashed exactly as given — normalisation belongs at the ingestion
 * boundary, so a stored legacy row can still be re-hashed as it was written
 * (see `matchesStoredFingerprint`). */
export function fingerprintPayload(
  fact: NewReportFact,
  version: number = REPORTS_FINGERPRINT_VERSION,
): unknown[] {
  const payload = [
    version,
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

  if (version === LEGACY_REPORTS_FINGERPRINT_VERSION) return payload;
  if (version === REPORTS_FINGERPRINT_VERSION) {
    return [
      ...payload,
      fact.paymentAllocationMinor ?? null,
      fact.paymentAllocationCoverage ?? null,
    ];
  }
  throw new Error(`Unsupported report fact fingerprint version: ${version}`);
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
export function factFingerprint(
  fact: NewReportFact,
  version: number = REPORTS_FINGERPRINT_VERSION,
): string {
  const serialized = JSON.stringify(fingerprintPayload(fact, version));
  return `v${version}:${stableStringHash(serialized)}`;
}

/**
 * Replay equality against a stored row.
 *
 * Ingestion normalises currency before hashing, but rows written before that
 * carry the source's raw spelling in BOTH `currency` and `fingerprint`. The
 * stored spelling is re-hashed as a fallback when it normalises to the same
 * code, so legacy lineage keeps validating instead of being quarantined as
 * content drift. Any other field difference is still drift.
 */
export function matchesStoredFingerprint(
  fact: NewReportFact,
  stored: {
    currency: string;
    fingerprint: string;
    fingerprintVersion?: number;
  },
): boolean {
  const version = stored.fingerprintVersion ?? REPORTS_FINGERPRINT_VERSION;
  if (stored.fingerprint === factFingerprint(fact, version)) return true;
  if (stored.currency === fact.currency) return false;
  if (normalizeCurrencyCode(stored.currency) !== normalizeCurrencyCode(fact.currency)) {
    return false;
  }
  return (
    stored.fingerprint ===
    factFingerprint({ ...fact, currency: stored.currency }, version)
  );
}

export { REPORTS_FINGERPRINT_VERSION };
