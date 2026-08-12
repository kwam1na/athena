import type {
  VerifyCurrentWeekResult,
  VerifyDayResult,
  VerifyDifference,
  VerifyPaymentDifference,
  VerifyUnverifiedField,
} from "./verify";

/**
 * Pure classification layer for the report verification sweep (plan U2).
 *
 * Maps raw `VerifyDayResult` / `VerifyCurrentWeekResult` into a deterministic
 * outcome plus an explained/unexplained partition of the differences, a stable
 * fingerprint over the unexplained subset, and streak/alert transition rules.
 *
 * PURE by construction, mirroring `foldDay.ts` discipline: no Convex imports
 * (the `./verify` import above is type-only and erased at compile time), no
 * `Date`, no randomness. Same inputs always classify identically.
 *
 * ---------------------------------------------------------------------------
 * THE THREE-STATE READING (from verify.ts header docs)
 * ---------------------------------------------------------------------------
 * "Unverified is not mismatched" and "truncated is a lower bound" both mean
 * could-not-check, never wrong:
 *  - `matches: true` + non-empty `unverifiedFields` → `partial`, never
 *    alertable.
 *  - `truncated: true` → `truncated`, never alertable, and NOTHING counts as
 *    checked clean (the expectation is a lower bound, so an agreeing field may
 *    only agree by accident of the cap).
 * Only a `mismatch` with a non-empty UNEXPLAINED subset is alertable.
 *
 * ---------------------------------------------------------------------------
 * EXPLAINED-DIFFERENCE ATTRIBUTION — what is detectable and what is not
 * ---------------------------------------------------------------------------
 * `VerifyDifference` is `{field, expected, actual}` and carries NO attribution
 * of its own, so each explanation uses the most defensible detectable signal:
 *
 *  - VOID SIGN CONVENTION: the fold ADDS void amounts while the verifier
 *    subtracts them (a void withdraws a sale — see the escalation note in
 *    verify.ts), so a day whose voids total R minor / U units shows
 *    `actual - expected === 2R` on grossSalesMinor and netSalesMinor and
 *    `2U` on unitsSold. That exact-delta identity is the signal. It requires
 *    the caller to supply the day's void magnitudes (`voidImpact`) — they are
 *    not recoverable from the difference rows themselves, and guessing from
 *    delta shape alone (e.g. "gross and net moved together") would bless real
 *    defects. No context supplied → no void attribution.
 *  - BLIND-SPOT FIELDS: `unitsReturned` has no row-reachable source, so the
 *    verifier's expectation is always 0 and ANY difference on it is the
 *    documented blind spot, not evidence of a defect. POS line-level refunds
 *    are also a documented blind spot but are zero on BOTH sides — they can
 *    never surface as a difference, so no field entry is needed for them.
 *  - FLAGGED EXCLUSIONS: quarantined / foreign-currency facts are excluded by
 *    the fold but invisible from the domain side, so on a day whose flags say
 *    such facts exist, differences are attributable to the exclusion — but
 *    ONLY UP TO THE MAGNITUDE OF THE EXCLUDED FACTS THEMSELVES. A bare flag is
 *    not a licence to explain arbitrary deltas: a day with one quarantined ¢1
 *    fact and a ₵400,000 net-sales fold defect must still alert. So the caller
 *    supplies both the flags (`dayFlags`, read from the `reportDay` doc) and
 *    the excluded facts' summed magnitude (`flaggedExclusionImpact`), and a
 *    difference is explained only when |delta| <= that magnitude on the
 *    matching basis (revenue-minor fields vs unit fields). Exactly like the
 *    void path: no magnitude context supplied → no flagged attribution, and
 *    non-numeric posture fields are never magnitude-explainable. The
 *    orchestrator sources that magnitude by re-summing the day's own excluded
 *    `reportFact` rows (`gatherDaySubject`) — `flags` records only THAT such
 *    facts exist, never what they were worth — and supplies none at all when
 *    its bounded scan caps out, so an oversized day alerts rather than being
 *    blessed by a lower bound.
 *  - OUTSIDE SCHEDULE (weekly): activity outside the scheduled frame is
 *    definitionally excluded from the week's accepted totals; its differences
 *    are recorded as explained, never alerted.
 *
 * ---------------------------------------------------------------------------
 * STREAK / ALERT RULES (plan Key Technical Decisions)
 * ---------------------------------------------------------------------------
 *  - Alert fires on streak start; identical fingerprint repeats extend the
 *    streak silently.
 *  - A changed fingerprint re-alerts exactly once (per newly-seen-vs-last-
 *    alerted fingerprint).
 *  - A clean run clears the streak and increments the re-arm epoch (the epoch
 *    participates in the notification dedupeKey downstream).
 *  - Every actual alert increments `alertSeq`, a MONOTONIC emission counter
 *    that never resets. It exists because the rail's dedupe is a permanent
 *    unique lookup with no expiry, while `lastAlertedFingerprint` remembers
 *    only the LAST fingerprint: an oscillation A → B → A inside one streak
 *    decides to alert a third time, but (store, subject, A, epoch) is
 *    byte-identical to the first emission and the rail drops it silently, so
 *    the run row would claim an alert that never went out. `alertSeq` makes
 *    each decided emission a distinct identity. It is preferred over tracking
 *    a bounded set of already-alerted fingerprints because a set answers the
 *    wrong question — returning to a previously-seen delta after it changed IS
 *    news worth re-sending — and because a set is unbounded-ish state to
 *    persist, whereas a counter is one number and is trivially monotonic.
 *  - A partial run clears ONLY when every previously-differing field was
 *    actually checked (present in `checkedFields`) and came back with NO
 *    difference at all — explained or unexplained. Consequences, decided
 *    deliberately:
 *      * An empty tracked-field list can never confirm cleanliness. A run that
 *        checked nothing relevant (e.g. the next tick after a weekly
 *        config_defect escalation, which tracks no fields) must not clear the
 *        streak or bump the epoch. Only a genuinely `clean` outcome resolves
 *        such a streak.
 *      * An ALL-EXPLAINED mismatch does NOT clear an active streak on a field
 *        that is still differing. A void/blind-spot/flag explanation arriving
 *        mid-streak means "we now have a story for this delta", not "the delta
 *        is gone"; treating it as clean would silently drop a live
 *        discrepancy and bump the re-arm epoch. A tracked field only clears
 *        when it was checked and produced no difference row.
 *      * CONSEQUENCE — the permanently-unclearable streak. A streak that
 *        started because a delta was UNEXPLAINED can never clear while that
 *        same delta persists in EXPLAINED form. Concretely: tick 1 the void
 *        fact scan caps out, `voidImpact` is absent, `netSalesMinor` is
 *        unexplained → streak starts, alert fires, `lastAlertedFingerprint`
 *        = F. Tick 2 the scan fits, the identical delta is now explained as
 *        `void_sign_convention` → `unexplained: []` but `netSalesMinor` is
 *        still differing, so `confirmsClean` stays false forever, the streak
 *        never resolves and `reArmEpoch` never bumps. A later genuine
 *        recurrence of the UNEXPLAINED form of F is then swallowed
 *        (fingerprint F is still `lastAlertedFingerprint`, and without an
 *        epoch bump the dedupeKey would repeat).
 *        Deliberate, on two grounds: the delta never actually went away — the
 *        run rows keep recording it every tick, explained — so "unresolved"
 *        is the honest state; and the failure direction is silence on a
 *        fingerprint an operator has ALREADY been paged about, not a new
 *        unreported discrepancy and not repeated noise. Clearing it requires
 *        the delta itself to disappear (a genuinely `clean` run), which is
 *        the correct bar.
 *  - `truncated`, expected `unavailable`, and `error` neither clear nor alert.
 *
 * NOTE on state shape: deciding "withheld vs checked clean" requires the
 * previous run's unexplained FIELD LIST, not just its fingerprint (a hash is
 * not invertible). `VerificationStreakState.unexplainedFields` carries it —
 * the U1 run row persists the difference summary, so this costs nothing extra.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VerificationOutcome =
  "clean" | "partial" | "mismatch" | "truncated" | "unavailable" | "error";

export type ClassifiedValue = number | string | boolean | null;

export type ClassifiedDifference = {
  field: string;
  expected: ClassifiedValue;
  actual: ClassifiedValue;
};

export type ExplainedReason =
  | "void_sign_convention"
  | "blind_spot_field"
  | "flagged_exclusions"
  | "outside_schedule";

export type ExplainedDifference = ClassifiedDifference & {
  reason: ExplainedReason;
};

export type VerificationEscalationVariant = "config_defect";

export type VerificationClassification = {
  outcome: VerificationOutcome;
  explained: ExplainedDifference[];
  unexplained: ClassifiedDifference[];
  /**
   * Stable hash over the unexplained subset (fields + expected/actual), or
   * the `unavailable:<reason>` marker for a config-defect escalation. `null`
   * whenever there is nothing to alert on.
   */
  fingerprint: string | null;
  alertable: boolean;
  escalationVariant?: VerificationEscalationVariant;
  /**
   * Fields a comparison was actually made on. Empty for `truncated` (lower
   * bound — nothing is confirmed), `unavailable`, weekly `incomplete`, and
   * `error`. Streak clearing consults this list.
   */
  checkedFields: string[];
};

export type DayClassificationContext = {
  /**
   * Positive magnitudes of the day's voided revenue and units, supplied by
   * the orchestrator (readable from void facts or voided transactions). Used
   * for the exact-delta void-convention attribution documented above.
   */
  voidImpact?: { revenueMinor: number; units: number };
  /** Read from the `reportDay` doc's flags by the caller. */
  dayFlags?: {
    hasQuarantinedFacts?: boolean;
    hasForeignCurrencyFacts?: boolean;
  };
  /**
   * Summed positive magnitude of the facts the flags refer to (quarantined +
   * foreign-currency), supplied by the caller alongside `dayFlags`. Bounds the
   * `flagged_exclusions` explanation: only differences whose |delta| is within
   * this magnitude are explained. Omitted → no flagged attribution at all.
   */
  flaggedExclusionImpact?: { revenueMinor: number; units: number };
};

export type WeekClassificationContext = {
  /** Is this store on the reporting/folding allowlist? */
  storeAllowlisted: boolean;
  voidImpact?: { revenueMinor: number; units: number };
};

export type VerificationStreakState = {
  outcome: VerificationOutcome;
  fingerprint: string | null;
  streakCount: number;
  lastAlertedFingerprint: string | null;
  /** Incremented on every clearing run; participates in the dedupeKey (U5). */
  reArmEpoch: number;
  /**
   * Monotonic count of alerts actually emitted for this subject. Never resets
   * (not on clear, not on re-arm). Participates in the dedupeKey so that an
   * A → B → A fingerprint oscillation cannot collide with an earlier emission
   * and be silently swallowed by the rail's permanent dedupe.
   */
  alertSeq: number;
  /** Unexplained difference fields of the streak being tracked. */
  unexplainedFields: readonly string[];
};

// ---------------------------------------------------------------------------
// Field inventories (declared locally: importing the VALUE constants from
// verify.ts would pull its Convex imports into this module at runtime)
// ---------------------------------------------------------------------------

const DAY_METRIC_FIELDS = [
  "netSalesMinor",
  "grossSalesMinor",
  "refundsMinor",
  "unitsSold",
  "unitsReturned",
  "paymentsCollectedMinor",
  "paymentsRefundedMinor",
  "paymentAllocatedMinor",
] as const satisfies readonly VerifyDifference["field"][];

const PAYMENT_POSTURE_FIELDS = [
  "paymentUnsettledMinor",
  "paymentAllocationCoverage",
  "paymentAllocationOmittedMinor",
  "paymentHasInvalidAllocation",
] as const satisfies readonly VerifyPaymentDifference["field"][];

/** Consistency lanes a verified week asserts beyond the metric diffs. */
const WEEK_CONSISTENCY_FIELDS = [
  "scheduleMatches",
  "varianceMatches",
  "closeMatches",
  "amendmentMatches",
  "inventoryMatches",
  "closeEvidenceMatches",
] as const;

/**
 * Every field a DAY verification run can make a claim about — the composed
 * union of the metric and payment-posture inventories above. Exported (this
 * module is pure and import-safe) so consumers that render the complement of
 * `checkedFields` (the U5 alert email's "not checked" section) derive it from
 * the same source of truth the classifier checks against, instead of
 * hand-copying a list that silently drifts when a field is added or renamed.
 */
export const DAY_FIELD_INVENTORY: readonly string[] = [
  ...DAY_METRIC_FIELDS,
  ...PAYMENT_POSTURE_FIELDS,
];

/** Every field a WEEK verification run can make a claim about: the day
 * inventory plus the weekly consistency lanes. */
export const WEEK_FIELD_INVENTORY: readonly string[] = [
  ...DAY_FIELD_INVENTORY,
  ...WEEK_CONSISTENCY_FIELDS,
];

/**
 * Fields whose source-side expectation is a documented blind spot rather than
 * an independent recomputation. `unitsReturned` is the only one that can ever
 * SURFACE as a difference (POS line refunds are zero on both sides).
 */
export const BLIND_SPOT_FIELDS: readonly string[] = ["unitsReturned"];

/** Metric fields the void sign convention can move, with their delta basis. */
const VOID_REVENUE_FIELDS = new Set(["grossSalesMinor", "netSalesMinor"]);

/** Unit-basis fields, for magnitude-bounded flagged-exclusion attribution. */
const UNIT_FIELDS = new Set(["unitsSold", "unitsReturned"]);

// ---------------------------------------------------------------------------
// Fingerprint
// ---------------------------------------------------------------------------

/**
 * Deterministic, order-independent FNV-1a (64-bit via two 32-bit lanes) over
 * the sorted `field:expected:actual` entries. No randomness, no Date — the
 * same unexplained set always hashes to the same string.
 */
export function fingerprintDifferences(
  differences: readonly ClassifiedDifference[],
): string {
  const canonical = differences
    .map(
      (difference) =>
        `${difference.field}:${String(difference.expected)}:${String(difference.actual)}`,
    )
    .sort()
    .join("|");
  let hashA = 0x811c9dc5;
  let hashB = 0xcbf29ce4;
  for (let index = 0; index < canonical.length; index += 1) {
    const code = canonical.charCodeAt(index);
    hashA = Math.imul(hashA ^ code, 0x01000193) >>> 0;
    hashB = Math.imul(hashB ^ code, 0x01000197) >>> 0;
  }
  return `${hashA.toString(16).padStart(8, "0")}${hashB.toString(16).padStart(8, "0")}`;
}

// ---------------------------------------------------------------------------
// Partitioning
// ---------------------------------------------------------------------------

function explainMetricDifference(
  difference: ClassifiedDifference,
  context: DayClassificationContext | WeekClassificationContext | undefined,
): ExplainedReason | null {
  if (BLIND_SPOT_FIELDS.includes(difference.field)) return "blind_spot_field";

  const dayFlags =
    context && "dayFlags" in context ? context.dayFlags : undefined;
  const flaggedImpact =
    context && "flaggedExclusionImpact" in context
      ? context.flaggedExclusionImpact
      : undefined;
  if (
    dayFlags &&
    (dayFlags.hasQuarantinedFacts === true ||
      dayFlags.hasForeignCurrencyFacts === true) &&
    flaggedImpact &&
    typeof difference.expected === "number" &&
    typeof difference.actual === "number"
  ) {
    // Bounded by the excluded facts' own magnitude: a flag explains deltas the
    // excluded facts could actually account for, never a defect beyond them.
    const magnitude = Math.abs(difference.actual - difference.expected);
    const bound = UNIT_FIELDS.has(difference.field)
      ? flaggedImpact.units
      : difference.field.endsWith("Minor")
        ? flaggedImpact.revenueMinor
        : null;
    if (bound !== null && magnitude <= bound) return "flagged_exclusions";
  }

  const voidImpact = context?.voidImpact;
  if (
    voidImpact &&
    typeof difference.expected === "number" &&
    typeof difference.actual === "number"
  ) {
    const delta = difference.actual - difference.expected;
    if (
      VOID_REVENUE_FIELDS.has(difference.field) &&
      voidImpact.revenueMinor > 0 &&
      delta === 2 * voidImpact.revenueMinor
    ) {
      return "void_sign_convention";
    }
    if (
      difference.field === "unitsSold" &&
      voidImpact.units > 0 &&
      delta === 2 * voidImpact.units
    ) {
      return "void_sign_convention";
    }
  }
  return null;
}

function partitionDifferences(
  differences: readonly ClassifiedDifference[],
  context: DayClassificationContext | WeekClassificationContext | undefined,
): { explained: ExplainedDifference[]; unexplained: ClassifiedDifference[] } {
  const explained: ExplainedDifference[] = [];
  const unexplained: ClassifiedDifference[] = [];
  for (const difference of differences) {
    const reason = explainMetricDifference(difference, context);
    if (reason) explained.push({ ...difference, reason });
    else unexplained.push(difference);
  }
  return { explained, unexplained };
}

function buildClassification(args: {
  outcome: VerificationOutcome;
  explained: ExplainedDifference[];
  unexplained: ClassifiedDifference[];
  checkedFields: string[];
  escalationVariant?: VerificationEscalationVariant;
  escalationFingerprint?: string;
}): VerificationClassification {
  const alertableOutcome =
    args.outcome === "mismatch" || args.escalationVariant !== undefined;
  const alertable =
    alertableOutcome &&
    (args.unexplained.length > 0 || args.escalationVariant !== undefined);
  const fingerprint = alertable
    ? (args.escalationFingerprint ?? fingerprintDifferences(args.unexplained))
    : null;
  return {
    outcome: args.outcome,
    explained: args.explained,
    unexplained: args.unexplained,
    fingerprint,
    alertable,
    ...(args.escalationVariant
      ? { escalationVariant: args.escalationVariant }
      : {}),
    checkedFields: args.checkedFields,
  };
}

// ---------------------------------------------------------------------------
// Day classification
// ---------------------------------------------------------------------------

export function classifyDayResult(
  result: VerifyDayResult,
  context?: DayClassificationContext,
): VerificationClassification {
  const unverified = new Set<VerifyUnverifiedField>(result.unverifiedFields);
  const allDifferences: ClassifiedDifference[] = [
    ...result.differences,
    ...result.paymentDifferences,
  ];
  const { explained, unexplained } = partitionDifferences(
    allDifferences,
    context,
  );

  if (result.truncated) {
    // A truncated expectation is a lower bound: an agreeing field may agree
    // only because the scan stopped, so nothing is confirmed clean.
    return buildClassification({
      outcome: "truncated",
      explained,
      unexplained,
      checkedFields: [],
    });
  }

  const checkedFields = [
    ...DAY_METRIC_FIELDS.filter(
      (field) => !unverified.has(field as VerifyUnverifiedField),
    ),
    ...PAYMENT_POSTURE_FIELDS.filter((field) => !unverified.has(field)),
  ];

  if (allDifferences.length === 0) {
    return buildClassification({
      outcome: result.unverifiedFields.length > 0 ? "partial" : "clean",
      explained: [],
      unexplained: [],
      checkedFields,
    });
  }

  return buildClassification({
    outcome: "mismatch",
    explained,
    unexplained,
    checkedFields,
  });
}

// ---------------------------------------------------------------------------
// Week classification
// ---------------------------------------------------------------------------

/**
 * Weekly `unavailable` dispositions, fully enumerated (plan Open Questions,
 * resolved): `missing_schedule` / `missing_timezone` / `missing_day_fold` on
 * an ALLOWLISTED folding store is a config/pipeline defect and escalates once
 * per streak; everything else — `missing_projection` (store not folding, or
 * projection simply not yet written), `schedule_history_cap`,
 * `no_scheduled_dates`, and every reason on a non-allowlisted store — is an
 * expected state, recorded and never alerted.
 */
const CONFIG_DEFECT_UNAVAILABLE_REASONS = new Set([
  "missing_schedule",
  "missing_timezone",
  "missing_day_fold",
]);

export function classifyWeekResult(
  result: VerifyCurrentWeekResult,
  context: WeekClassificationContext,
): VerificationClassification {
  if (result.outcome === "unavailable") {
    const configDefect =
      context.storeAllowlisted &&
      CONFIG_DEFECT_UNAVAILABLE_REASONS.has(result.reason);
    return buildClassification({
      outcome: "unavailable",
      explained: [],
      unexplained: [],
      checkedFields: [],
      ...(configDefect
        ? {
            escalationVariant: "config_defect" as const,
            escalationFingerprint: `unavailable:${result.reason}`,
          }
        : {}),
    });
  }

  if (result.outcome === "incomplete") {
    // Could-not-fully-check, never alertable — same reading as a partial day.
    return buildClassification({
      outcome: "partial",
      explained: [],
      unexplained: [],
      checkedFields: [],
    });
  }

  const unverified = new Set<VerifyUnverifiedField>(result.unverifiedFields);
  const included: ClassifiedDifference[] = [
    ...result.includedDifferences,
    ...result.includedPaymentDifferences,
  ];
  const partitioned = partitionDifferences(included, context);
  // Outside-schedule activity is definitionally excluded from the week's
  // accepted totals: recorded as explained, never alertable.
  const explained: ExplainedDifference[] = [
    ...partitioned.explained,
    ...[
      ...result.outsideScheduleDifferences,
      ...result.outsideSchedulePaymentDifferences,
    ].map((difference) => ({
      ...difference,
      reason: "outside_schedule" as const,
    })),
  ];
  const unexplained: ClassifiedDifference[] = [...partitioned.unexplained];
  for (const lane of WEEK_CONSISTENCY_FIELDS) {
    if (result[lane] === false) {
      unexplained.push({ field: lane, expected: true, actual: false });
    }
  }

  if (result.truncated) {
    return buildClassification({
      outcome: "truncated",
      explained,
      unexplained,
      checkedFields: [],
    });
  }

  const checkedFields = [
    ...DAY_METRIC_FIELDS.filter(
      (field) => !unverified.has(field as VerifyUnverifiedField),
    ),
    ...PAYMENT_POSTURE_FIELDS.filter((field) => !unverified.has(field)),
    ...WEEK_CONSISTENCY_FIELDS,
  ];

  if (explained.length === 0 && unexplained.length === 0) {
    return buildClassification({
      outcome: result.unverifiedFields.length > 0 ? "partial" : "clean",
      explained: [],
      unexplained: [],
      checkedFields,
    });
  }

  return buildClassification({
    outcome: "mismatch",
    explained,
    unexplained,
    checkedFields,
  });
}

// ---------------------------------------------------------------------------
// Streak transitions
// ---------------------------------------------------------------------------

export function initialStreakState(): VerificationStreakState {
  return {
    outcome: "clean",
    fingerprint: null,
    streakCount: 0,
    lastAlertedFingerprint: null,
    reArmEpoch: 0,
    alertSeq: 0,
    unexplainedFields: [],
  };
}

/**
 * Does this run confirm the previously-differing fields are clean?
 *
 * True for a genuinely clean run. Otherwise a non-truncated run clears only
 * when EVERY tracked field was actually checked and produced no difference row
 * of any kind. A field the run withheld (`unverifiedFields`), read under a cap
 * (`truncated` → empty `checkedFields`), or that still differs but now has an
 * explanation attached confirms nothing — and a run tracking no fields at all
 * confirms nothing either (an empty `every()` is vacuously true, which is how
 * a checked-nothing partial used to clear a live streak).
 */
function confirmsClean(
  previous: VerificationStreakState,
  classification: VerificationClassification,
): boolean {
  if (classification.outcome === "clean") return true;
  if (
    classification.outcome !== "partial" &&
    classification.outcome !== "mismatch"
  ) {
    return false;
  }
  if (classification.unexplained.length > 0) return false;
  // Nothing tracked → nothing this run can vouch for (F2).
  if (previous.unexplainedFields.length === 0) return false;
  const checked = new Set(classification.checkedFields);
  // Still-differing-but-explained is NOT clean (F3) — and so a streak that
  // began unexplained stays open for as long as the delta survives in
  // explained form. See "the permanently-unclearable streak" in the header.
  const stillDiffering = new Set(
    classification.explained.map((difference) => difference.field),
  );
  return previous.unexplainedFields.every(
    (field) => checked.has(field) && !stillDiffering.has(field),
  );
}

export function nextStreakState(
  previous: VerificationStreakState,
  classification: VerificationClassification,
): { state: VerificationStreakState; shouldAlert: boolean } {
  // Alertable run: start or extend the streak; alert once per fingerprint
  // not yet alerted (streak start, or a changed fingerprint mid-streak).
  if (classification.alertable && classification.fingerprint !== null) {
    const sameStreak =
      previous.streakCount > 0 &&
      previous.fingerprint === classification.fingerprint;
    const shouldAlert =
      classification.fingerprint !== previous.lastAlertedFingerprint;
    return {
      shouldAlert,
      state: {
        outcome: classification.outcome,
        fingerprint: classification.fingerprint,
        streakCount: sameStreak ? previous.streakCount + 1 : 1,
        lastAlertedFingerprint: shouldAlert
          ? classification.fingerprint
          : previous.lastAlertedFingerprint,
        reArmEpoch: previous.reArmEpoch,
        alertSeq: shouldAlert ? previous.alertSeq + 1 : previous.alertSeq,
        unexplainedFields: classification.unexplained.map(
          (difference) => difference.field,
        ),
      },
    };
  }

  // Clearing run: streak resolved. Re-arm (epoch bump + alert reset) only if
  // there was an active streak to resolve.
  if (confirmsClean(previous, classification)) {
    const hadStreak = previous.streakCount > 0;
    return {
      shouldAlert: false,
      state: {
        outcome: classification.outcome,
        fingerprint: null,
        streakCount: 0,
        lastAlertedFingerprint: null,
        reArmEpoch: hadStreak ? previous.reArmEpoch + 1 : previous.reArmEpoch,
        // Monotonic: an emission counter that reset would re-collide.
        alertSeq: previous.alertSeq,
        unexplainedFields: [],
      },
    };
  }

  // Everything else — withheld partial, truncated, expected unavailable,
  // error — carries the streak forward untouched and never alerts.
  return {
    shouldAlert: false,
    state: {
      ...previous,
      outcome: classification.outcome,
    },
  };
}
