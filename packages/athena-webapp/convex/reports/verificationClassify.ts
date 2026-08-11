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
 *    such facts exist, every metric difference is attributable to the
 *    exclusion. This is deliberately coarse — the whole day's differences are
 *    explained, recorded, and left to human adjudication rather than paged on.
 *    The flags live on the `reportDay` doc, not on `VerifyDayResult`, so the
 *    caller passes them (`dayFlags`).
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
 *  - A partial run clears ONLY when every previously-differing field was
 *    actually checked (present in `checkedFields`) and no longer carries an
 *    unexplained difference; a withheld field carries the streak forward
 *    untouched.
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
  | "clean"
  | "partial"
  | "mismatch"
  | "truncated"
  | "unavailable"
  | "error";

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
 * Fields whose source-side expectation is a documented blind spot rather than
 * an independent recomputation. `unitsReturned` is the only one that can ever
 * SURFACE as a difference (POS line refunds are zero on both sides).
 */
export const BLIND_SPOT_FIELDS: readonly string[] = ["unitsReturned"];

/** Metric fields the void sign convention can move, with their delta basis. */
const VOID_REVENUE_FIELDS = new Set(["grossSalesMinor", "netSalesMinor"]);

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
  if (
    dayFlags &&
    (dayFlags.hasQuarantinedFacts === true ||
      dayFlags.hasForeignCurrencyFacts === true)
  ) {
    return "flagged_exclusions";
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
    unexplainedFields: [],
  };
}

/**
 * Does this run confirm the previously-differing fields are clean?
 *
 * True for a genuinely clean run, and for any non-truncated run whose
 * unexplained set is empty PROVIDED every field of the tracked streak was
 * actually checked. A field the run withheld (`unverifiedFields`) or read
 * under a cap (`truncated` → empty `checkedFields`) confirms nothing.
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
  const checked = new Set(classification.checkedFields);
  return previous.unexplainedFields.every((field) => checked.has(field));
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
