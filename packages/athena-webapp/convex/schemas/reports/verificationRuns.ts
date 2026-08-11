import { v } from "convex/values";

export const verificationSubjectKindValidator = v.union(
  v.literal("day"),
  v.literal("week"),
);

export const verificationOutcomeValidator = v.union(
  v.literal("clean"),
  v.literal("partial"),
  v.literal("mismatch"),
  v.literal("truncated"),
  v.literal("unavailable"),
  v.literal("error"),
);

/**
 * One compared field, compacted from a VerifyDifference (reports/verify.ts).
 * The minor amounts are optional because an unavailable side has no number to
 * record; `classification` is the classifier's verdict string for the field
 * (see reports/verificationClassify.ts) — stored as text, not a literal
 * union, so a new classification never invalidates existing rows.
 */
const verificationDifferenceSummary = v.object({
  field: v.string(),
  expectedMinor: v.optional(v.number()),
  actualMinor: v.optional(v.number()),
  classification: v.string(),
});

/**
 * One row per verification subject — a (store, subjectKind, subjectKey)
 * triple, where subjectKey is the operatingDate for days and the
 * cycleStartDate for weeks. Rows are UPSERTED in place by the verification
 * sweep: identity is the subject key via by_store_subject, so re-running a
 * sweep over the same subject rewrites its row rather than appending, and a
 * replayed sweep tick is a no-op beyond refreshing `verifiedAt`. This table
 * is a sensor: it observes fold output and never feeds back into folds.
 *
 * Alerting state rides the row: `unexplainedFingerprint` identifies the
 * current unexplained difference set, `lastAlertedFingerprint` is the set
 * last escalated, and `reArmEpoch` increments each time a clean run re-arms
 * the subject — it participates in the notification dedupeKey so the same
 * fingerprint can alert again after an intervening clean run.
 */
export const reportVerificationRunSchema = v.object({
  storeId: v.id("store"),
  subjectKind: verificationSubjectKindValidator,
  /** operatingDate ("YYYY-MM-DD") for days; cycleStartDate for weeks. */
  subjectKey: v.string(),
  outcome: verificationOutcomeValidator,
  /** Differences the classifier accounted for. Bounded by the sweep. */
  explainedDifferences: v.array(verificationDifferenceSummary),
  /** Differences nothing explains — the alertable residue. Bounded. */
  unexplainedDifferences: v.array(verificationDifferenceSummary),
  /** Stable digest of unexplainedDifferences; absent when the set is empty. */
  unexplainedFingerprint: v.optional(v.string()),
  /** Consecutive runs producing this same non-clean outcome; 0 after clean. */
  streakCount: v.number(),
  /** The unexplained fingerprint most recently escalated; absent if never. */
  lastAlertedFingerprint: v.optional(v.string()),
  /** Incremented on each clean-run re-arm; part of the alert dedupeKey. */
  reArmEpoch: v.number(),
  /**
   * certifiedFoldRevision of the verified fold output. Absent for
   * pre-stamping legacy days — absent means "revision unknown", never 0.
   */
  verifiedCertifiedFoldRevision: v.optional(v.number()),
  verifiedAt: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
});
