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
  /**
   * The checked-field list the CURRENT STREAK's recorded differences were
   * produced under — NOT, in general, the list this row's `outcome` describes.
   * Its COMPLEMENT within the subject's field inventory is verify.ts's
   * `unverifiedFields` — what was declined a claim — which the U5 alert email
   * renders as its own "not checked" section (R4: unverified is not
   * mismatched).
   *
   * CARRY-FORWARD (see `recordVerificationOutcome`'s F6 note, which points
   * back here): the trigger is an EMPTY checked-field list on the incoming run
   * (e.g. `error` / `truncated` / `unavailable`, but equally a `partial` whose
   * every field went unverified) while a live `unexplainedFingerprint` is being
   * carried — such a run RETAINS the previous run's list, because the carried
   * `unexplainedDifferences` are only interpretable against the list they were
   * computed under. Resetting it to `[]` while the differences persist would
   * make the email render the same field as both "checked and wrong" and "not
   * checked". If the previous run's list was itself ABSENT, that absence
   * carries through — the carry never manufactures `[]`, since "unknown" must
   * not degrade into "nothing was checked". So on such a row `outcome` and
   * `checkedFields` deliberately describe DIFFERENT runs, and nothing may
   * render "this run checked N fields" off this column — read it as the
   * streak's basis, and consult `verifiedAt` / `outcome` for what the latest
   * tick actually managed to do. `verifiedCertifiedFoldRevision` below is
   * another column whose meaning depends on context, though on a different
   * axis: there it turns on `subjectKind`, here on which run is being
   * described.
   *
   * Optional because rows written before this capture landed have no honest
   * value: absent means "unknown", never "nothing was checked".
   */
  checkedFields: v.optional(v.array(v.string())),
  /** Consecutive runs producing this same non-clean outcome; 0 after clean. */
  streakCount: v.number(),
  /** The unexplained fingerprint most recently escalated; absent if never. */
  lastAlertedFingerprint: v.optional(v.string()),
  /** Incremented on each clean-run re-arm; part of the alert dedupeKey. */
  reArmEpoch: v.number(),
  /**
   * Monotonic count of alerts raised for this subject. NEVER reset — not on a
   * clean run, not on re-arm. `reArmEpoch` alone cannot distinguish an
   * oscillating fingerprint (A -> B -> A with no intervening clean run), which
   * would rebuild a byte-identical dedupeKey and be swallowed by the rail's
   * permanent unique lookup. This counter makes every alert identity distinct.
   * Optional because rows written before it landed have no honest value.
   */
  alertSeq: v.optional(v.number()),
  /**
   * Verified generation of the subject's projection. For DAY subjects this is
   * `reportDay.certifiedFoldRevision` — absent for pre-stamping legacy days,
   * where absent means "revision unknown", never 0. For WEEK subjects the sweep
   * stores `reportWeekCurrent.materializedAt` here instead: both are monotonic
   * staleness markers, no path cross-reads them between subject kinds, and the
   * weekly lane compares only against its own stored value.
   */
  verifiedCertifiedFoldRevision: v.optional(v.number()),
  verifiedAt: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
});
