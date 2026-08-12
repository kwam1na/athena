import { describe, expect, it } from "vitest";
import type {
  VerifyCurrentWeekResult,
  VerifyDayResult,
  VerifyPaymentPosture,
  VerifiedMetrics,
} from "./verify";
import {
  DAY_FIELD_INVENTORY,
  WEEK_FIELD_INVENTORY,
  classifyDayResult,
  classifyWeekResult,
  fingerprintDifferences,
  initialStreakState,
  nextStreakState,
  type VerificationClassification,
  type VerificationStreakState,
} from "./verificationClassify";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function zeroMetrics(): VerifiedMetrics {
  return {
    grossSalesMinor: 0,
    netSalesMinor: 0,
    paymentsCollectedMinor: 0,
    paymentsRefundedMinor: 0,
    paymentAllocatedMinor: 0,
    refundsMinor: 0,
    unitsReturned: 0,
    unitsSold: 0,
  };
}

function completePosture(): VerifyPaymentPosture {
  return {
    outcome: "complete",
    reason: "complete",
    eligibleMinor: 0,
    coveredMinor: 0,
    omittedMinor: 0,
    unsettledMinor: 0,
    allocationCoverage: "complete",
    hasInvalidAllocation: false,
    reversalLookback: { outcome: "complete", reason: "complete" },
  };
}

function makeDayResult(
  overrides: Partial<VerifyDayResult> = {},
): VerifyDayResult {
  return {
    operatingDate: "2026-08-09",
    matches: true,
    differences: [],
    factCount: 3,
    dayStatus: "reconciled",
    expected: zeroMetrics(),
    paymentPosture: completePosture(),
    paymentDifferences: [],
    unverifiedFields: [],
    truncated: false,
    ...overrides,
  };
}

function makeVerifiedWeek(
  overrides: Partial<
    Extract<VerifyCurrentWeekResult, { outcome: "verified" }>
  > = {},
): VerifyCurrentWeekResult {
  return {
    outcome: "verified",
    cycleStartDate: "2026-08-03",
    cycleEndDate: "2026-08-09",
    daysChecked: 7,
    matches: true,
    scheduleMatches: true,
    includedDifferences: [],
    outsideScheduleDifferences: [],
    includedPaymentDifferences: [],
    outsideSchedulePaymentDifferences: [],
    unverifiedFields: [],
    truncated: false,
    varianceMatches: true,
    closeMatches: true,
    amendmentMatches: true,
    inventoryMatches: true,
    closeEvidenceMatches: true,
    ...overrides,
  };
}

/** A mismatch classification with one unexplained netSales difference. */
function unexplainedMismatch(): VerificationClassification {
  return classifyDayResult(
    makeDayResult({
      matches: false,
      differences: [{ field: "netSalesMinor", expected: 100, actual: 250 }],
    }),
  );
}

// ---------------------------------------------------------------------------
// Day classification
// ---------------------------------------------------------------------------

describe("classifyDayResult", () => {
  it("classifies a clean result as clean, not alertable, no fingerprint", () => {
    const classification = classifyDayResult(makeDayResult());
    expect(classification.outcome).toBe("clean");
    expect(classification.alertable).toBe(false);
    expect(classification.explained).toEqual([]);
    expect(classification.unexplained).toEqual([]);
    expect(classification.fingerprint).toBeNull();
  });

  it("classifies an unexplained difference as an alertable mismatch with a stable fingerprint", () => {
    const first = unexplainedMismatch();
    const second = unexplainedMismatch();
    expect(first.outcome).toBe("mismatch");
    expect(first.alertable).toBe(true);
    expect(first.unexplained).toHaveLength(1);
    expect(first.fingerprint).toBeTypeOf("string");
    expect(first.fingerprint).toBe(second.fingerprint);
  });

  it("F4 — the exported inventories are exactly what a fully-checked run checks", () => {
    // The alert email renders "not checked" as the complement of a run's
    // `checkedFields` within these inventories. If the inventory and the
    // classifier's field universe ever diverge (a field added or renamed in
    // one place only), that section lies. A fully-verified clean run checks
    // the WHOLE universe, so equality here is the tether.
    const day = classifyDayResult(makeDayResult());
    expect([...day.checkedFields].sort()).toEqual(
      [...DAY_FIELD_INVENTORY].sort(),
    );
    const week = classifyWeekResult(makeVerifiedWeek(), {
      storeAllowlisted: true,
    });
    expect([...week.checkedFields].sort()).toEqual(
      [...WEEK_FIELD_INVENTORY].sort(),
    );
  });

  it("produces different fingerprints for different deltas on the same field", () => {
    const a = classifyDayResult(
      makeDayResult({
        matches: false,
        differences: [{ field: "netSalesMinor", expected: 100, actual: 250 }],
      }),
    );
    const b = classifyDayResult(
      makeDayResult({
        matches: false,
        differences: [{ field: "netSalesMinor", expected: 100, actual: 300 }],
      }),
    );
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });

  it("classifies matches:true plus unverifiedFields as partial, never alertable", () => {
    const classification = classifyDayResult(
      makeDayResult({
        matches: true,
        unverifiedFields: ["paymentsRefundedMinor", "paymentUnsettledMinor"],
      }),
    );
    expect(classification.outcome).toBe("partial");
    expect(classification.alertable).toBe(false);
    expect(classification.checkedFields).not.toContain("paymentsRefundedMinor");
    expect(classification.checkedFields).toContain("netSalesMinor");
  });

  it("classifies truncated as truncated, never alertable, even with differences", () => {
    const classification = classifyDayResult(
      makeDayResult({
        matches: false,
        truncated: true,
        differences: [{ field: "grossSalesMinor", expected: 100, actual: 900 }],
      }),
    );
    expect(classification.outcome).toBe("truncated");
    expect(classification.alertable).toBe(false);
    // A truncated expectation is a lower bound: nothing was confirmed clean.
    expect(classification.checkedFields).toEqual([]);
  });

  it("explains void-only differences: mismatch with zero unexplained, not alertable", () => {
    // Fold ADDS a 500-minor void that the verifier subtracts: delta is 2x500
    // on both revenue fields and 2x2 on unitsSold.
    const classification = classifyDayResult(
      makeDayResult({
        matches: false,
        differences: [
          { field: "grossSalesMinor", expected: 1000, actual: 2000 },
          { field: "netSalesMinor", expected: 1000, actual: 2000 },
          { field: "unitsSold", expected: 3, actual: 7 },
        ],
      }),
      { voidImpact: { revenueMinor: 500, units: 2 } },
    );
    expect(classification.outcome).toBe("mismatch");
    expect(classification.unexplained).toEqual([]);
    expect(classification.explained).toHaveLength(3);
    expect(
      classification.explained.every(
        (difference) => difference.reason === "void_sign_convention",
      ),
    ).toBe(true);
    expect(classification.alertable).toBe(false);
    expect(classification.fingerprint).toBeNull();
  });

  it("does not void-explain a delta that does not match twice the void magnitude", () => {
    const classification = classifyDayResult(
      makeDayResult({
        matches: false,
        differences: [{ field: "netSalesMinor", expected: 1000, actual: 1900 }],
      }),
      { voidImpact: { revenueMinor: 500, units: 0 } },
    );
    expect(classification.unexplained).toHaveLength(1);
    expect(classification.alertable).toBe(true);
  });

  it("explains blind-spot-only differences (unitsReturned), not alertable", () => {
    const classification = classifyDayResult(
      makeDayResult({
        matches: false,
        differences: [{ field: "unitsReturned", expected: 0, actual: 4 }],
      }),
    );
    expect(classification.outcome).toBe("mismatch");
    expect(classification.unexplained).toEqual([]);
    expect(classification.explained[0]?.reason).toBe("blind_spot_field");
    expect(classification.alertable).toBe(false);
  });

  it("explains a quarantine-flagged difference within the excluded facts' magnitude", () => {
    const classification = classifyDayResult(
      makeDayResult({
        matches: false,
        differences: [{ field: "netSalesMinor", expected: 100, actual: 40 }],
      }),
      {
        dayFlags: { hasQuarantinedFacts: true },
        flaggedExclusionImpact: { revenueMinor: 60, units: 0 },
      },
    );
    expect(classification.unexplained).toEqual([]);
    expect(classification.explained[0]?.reason).toBe("flagged_exclusions");
    expect(classification.alertable).toBe(false);
  });

  it("explains a foreign-currency-flagged difference within magnitude", () => {
    const classification = classifyDayResult(
      makeDayResult({
        matches: false,
        differences: [{ field: "unitsSold", expected: 10, actual: 7 }],
      }),
      {
        dayFlags: { hasForeignCurrencyFacts: true },
        flaggedExclusionImpact: { revenueMinor: 0, units: 3 },
      },
    );
    expect(classification.unexplained).toEqual([]);
    expect(classification.explained[0]?.reason).toBe("flagged_exclusions");
    expect(classification.alertable).toBe(false);
  });

  it("does NOT let a tiny quarantined fact explain a large fold defect (F4)", () => {
    const classification = classifyDayResult(
      makeDayResult({
        matches: false,
        differences: [
          { field: "netSalesMinor", expected: 40_000_000, actual: 1 },
        ],
      }),
      {
        dayFlags: { hasQuarantinedFacts: true },
        flaggedExclusionImpact: { revenueMinor: 1, units: 0 },
      },
    );
    expect(classification.explained).toEqual([]);
    expect(classification.unexplained).toHaveLength(1);
    expect(classification.alertable).toBe(true);
  });

  it("does not attribute to flags when no exclusion magnitude is supplied", () => {
    const classification = classifyDayResult(
      makeDayResult({
        matches: false,
        differences: [{ field: "netSalesMinor", expected: 100, actual: 40 }],
      }),
      { dayFlags: { hasQuarantinedFacts: true } },
    );
    expect(classification.unexplained).toHaveLength(1);
    expect(classification.alertable).toBe(true);
  });

  it("never magnitude-explains a non-numeric posture field via flags", () => {
    const classification = classifyDayResult(
      makeDayResult({
        matches: false,
        paymentDifferences: [
          {
            field: "paymentHasInvalidAllocation",
            expected: false,
            actual: true,
          },
        ],
      }),
      {
        dayFlags: { hasQuarantinedFacts: true },
        flaggedExclusionImpact: { revenueMinor: 10_000_000, units: 10_000 },
      },
    );
    expect(classification.unexplained).toHaveLength(1);
    expect(classification.alertable).toBe(true);
  });

  it("keeps mixed explained+unexplained alertable with fingerprint over the unexplained subset only", () => {
    const mixed = classifyDayResult(
      makeDayResult({
        matches: false,
        differences: [
          { field: "unitsReturned", expected: 0, actual: 4 },
          { field: "netSalesMinor", expected: 100, actual: 250 },
        ],
      }),
    );
    const unexplainedOnly = unexplainedMismatch();
    expect(mixed.alertable).toBe(true);
    expect(mixed.explained).toHaveLength(1);
    expect(mixed.unexplained).toHaveLength(1);
    // The explained difference must not participate in the fingerprint.
    expect(mixed.fingerprint).toBe(unexplainedOnly.fingerprint);
  });

  it("includes payment posture differences as unexplained", () => {
    const classification = classifyDayResult(
      makeDayResult({
        matches: false,
        paymentDifferences: [
          { field: "paymentUnsettledMinor", expected: 0, actual: 500 },
        ],
      }),
    );
    expect(classification.outcome).toBe("mismatch");
    expect(classification.unexplained).toHaveLength(1);
    expect(classification.alertable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Week classification
// ---------------------------------------------------------------------------

describe("classifyWeekResult", () => {
  const allowlisted = { storeAllowlisted: true };
  const notAllowlisted = { storeAllowlisted: false };

  it("classifies both incomplete reasons as partial, never alertable", () => {
    for (const reason of [
      "source_cap_exceeded",
      "inventory_remediation_in_progress",
    ] as const) {
      const classification = classifyWeekResult(
        {
          outcome: "incomplete",
          reason,
          cycleStartDate: "2026-08-03",
          cycleEndDate: "2026-08-09",
          daysChecked: 4,
        },
        allowlisted,
      );
      expect(classification.outcome).toBe("partial");
      expect(classification.alertable).toBe(false);
    }
  });

  it("classifies missing_projection on a non-allowlisted store as expected record-only", () => {
    const classification = classifyWeekResult(
      { outcome: "unavailable", reason: "missing_projection" },
      notAllowlisted,
    );
    expect(classification.outcome).toBe("unavailable");
    expect(classification.alertable).toBe(false);
    expect(classification.escalationVariant).toBeUndefined();
  });

  it("classifies missing_schedule/missing_timezone/missing_day_fold on an allowlisted store as config-defect escalation", () => {
    for (const reason of [
      "missing_schedule",
      "missing_timezone",
      "missing_day_fold",
    ] as const) {
      const classification = classifyWeekResult(
        { outcome: "unavailable", reason },
        allowlisted,
      );
      expect(classification.outcome).toBe("unavailable");
      expect(classification.alertable).toBe(true);
      expect(classification.escalationVariant).toBe("config_defect");
      expect(classification.fingerprint).toBe(`unavailable:${reason}`);
    }
  });

  it("classifies the same defect reasons on a NON-allowlisted store as record-only", () => {
    const classification = classifyWeekResult(
      { outcome: "unavailable", reason: "missing_schedule" },
      notAllowlisted,
    );
    expect(classification.alertable).toBe(false);
    expect(classification.escalationVariant).toBeUndefined();
  });

  it("classifies schedule_history_cap and no_scheduled_dates as expected record-only even when allowlisted", () => {
    for (const reason of [
      "schedule_history_cap",
      "no_scheduled_dates",
    ] as const) {
      const classification = classifyWeekResult(
        { outcome: "unavailable", reason },
        allowlisted,
      );
      expect(classification.outcome).toBe("unavailable");
      expect(classification.alertable).toBe(false);
      expect(classification.escalationVariant).toBeUndefined();
    }
  });

  it("classifies a clean verified week as clean", () => {
    const classification = classifyWeekResult(makeVerifiedWeek(), allowlisted);
    expect(classification.outcome).toBe("clean");
    expect(classification.alertable).toBe(false);
  });

  it("classifies verified matches:true with unverifiedFields as partial", () => {
    const classification = classifyWeekResult(
      makeVerifiedWeek({ unverifiedFields: ["paymentAllocatedMinor"] }),
      allowlisted,
    );
    expect(classification.outcome).toBe("partial");
    expect(classification.alertable).toBe(false);
  });

  it("classifies a truncated verified week as truncated, never alertable", () => {
    const classification = classifyWeekResult(
      makeVerifiedWeek({
        matches: false,
        truncated: true,
        includedDifferences: [
          { field: "netSalesMinor", expected: 10, actual: 20 },
        ],
      }),
      allowlisted,
    );
    expect(classification.outcome).toBe("truncated");
    expect(classification.alertable).toBe(false);
  });

  it("classifies included unexplained differences as an alertable mismatch", () => {
    const classification = classifyWeekResult(
      makeVerifiedWeek({
        matches: false,
        includedDifferences: [
          { field: "netSalesMinor", expected: 10, actual: 20 },
        ],
      }),
      allowlisted,
    );
    expect(classification.outcome).toBe("mismatch");
    expect(classification.alertable).toBe(true);
    expect(classification.unexplained).toHaveLength(1);
  });

  it("treats outside-schedule differences as explained, not alertable", () => {
    const classification = classifyWeekResult(
      makeVerifiedWeek({
        outsideScheduleDifferences: [
          { field: "netSalesMinor", expected: 0, actual: 40 },
        ],
      }),
      allowlisted,
    );
    expect(classification.outcome).toBe("mismatch");
    expect(classification.unexplained).toEqual([]);
    expect(classification.explained[0]?.reason).toBe("outside_schedule");
    expect(classification.alertable).toBe(false);
  });

  it("surfaces a failing consistency lane as an unexplained pseudo-difference", () => {
    const classification = classifyWeekResult(
      makeVerifiedWeek({ matches: false, closeMatches: false }),
      allowlisted,
    );
    expect(classification.outcome).toBe("mismatch");
    expect(classification.alertable).toBe(true);
    expect(classification.unexplained).toEqual([
      { field: "closeMatches", expected: true, actual: false },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Fingerprint
// ---------------------------------------------------------------------------

describe("fingerprintDifferences", () => {
  it("is order-independent and deterministic", () => {
    const a = fingerprintDifferences([
      { field: "netSalesMinor", expected: 1, actual: 2 },
      { field: "grossSalesMinor", expected: 3, actual: 4 },
    ]);
    const b = fingerprintDifferences([
      { field: "grossSalesMinor", expected: 3, actual: 4 },
      { field: "netSalesMinor", expected: 1, actual: 2 },
    ]);
    expect(a).toBe(b);
  });

  it("changes when a delta changes", () => {
    const a = fingerprintDifferences([
      { field: "netSalesMinor", expected: 1, actual: 2 },
    ]);
    const b = fingerprintDifferences([
      { field: "netSalesMinor", expected: 1, actual: 3 },
    ]);
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Streak transitions
// ---------------------------------------------------------------------------

describe("nextStreakState", () => {
  function mismatchState(): {
    state: VerificationStreakState;
    classification: VerificationClassification;
  } {
    const classification = unexplainedMismatch();
    const { state } = nextStreakState(initialStreakState(), classification);
    return { state, classification };
  }

  it("alerts on streak start and not on an identical repeat", () => {
    const classification = unexplainedMismatch();
    const first = nextStreakState(initialStreakState(), classification);
    expect(first.shouldAlert).toBe(true);
    expect(first.state.streakCount).toBe(1);

    const second = nextStreakState(first.state, unexplainedMismatch());
    expect(second.shouldAlert).toBe(false);
    expect(second.state.streakCount).toBe(2);
    expect(second.state.lastAlertedFingerprint).toBe(
      classification.fingerprint,
    );
  });

  it("does not alert for a non-alertable mismatch (all explained)", () => {
    const classification = classifyDayResult(
      makeDayResult({
        matches: false,
        differences: [{ field: "unitsReturned", expected: 0, actual: 4 }],
      }),
    );
    const { shouldAlert, state } = nextStreakState(
      initialStreakState(),
      classification,
    );
    expect(shouldAlert).toBe(false);
    expect(state.streakCount).toBe(0);
  });

  it("clears the streak and re-arms on a clean run", () => {
    const { state } = mismatchState();
    const clean = classifyDayResult(makeDayResult());
    const cleared = nextStreakState(state, clean);
    expect(cleared.shouldAlert).toBe(false);
    expect(cleared.state.streakCount).toBe(0);
    expect(cleared.state.fingerprint).toBeNull();
    expect(cleared.state.lastAlertedFingerprint).toBeNull();
    expect(cleared.state.reArmEpoch).toBe(state.reArmEpoch + 1);
  });

  it("re-alerts the same discrepancy after a clean re-arm", () => {
    const { state } = mismatchState();
    const afterClean = nextStreakState(
      state,
      classifyDayResult(makeDayResult()),
    );
    const again = nextStreakState(afterClean.state, unexplainedMismatch());
    expect(again.shouldAlert).toBe(true);
    expect(again.state.streakCount).toBe(1);
  });

  /** A streak tracking a PAYMENT field, which `unverifiedFields` can withhold. */
  function paymentMismatchState(): VerificationStreakState {
    const classification = classifyDayResult(
      makeDayResult({
        matches: false,
        differences: [
          { field: "paymentsRefundedMinor", expected: 100, actual: 250 },
        ],
      }),
    );
    return nextStreakState(initialStreakState(), classification).state;
  }

  it("a partial run does NOT clear the streak when the differing field was withheld", () => {
    const state = paymentMismatchState();
    expect(state.unexplainedFields).toEqual(["paymentsRefundedMinor"]);
    // The real filter path: an unverified field is absent from checkedFields.
    const withheld = classifyDayResult(
      makeDayResult({
        matches: true,
        unverifiedFields: ["paymentsRefundedMinor"],
      }),
    );
    expect(withheld.checkedFields).not.toContain("paymentsRefundedMinor");
    const next = nextStreakState(state, withheld);
    expect(next.shouldAlert).toBe(false);
    expect(next.state.streakCount).toBe(state.streakCount);
    expect(next.state.fingerprint).toBe(state.fingerprint);
    expect(next.state.reArmEpoch).toBe(state.reArmEpoch);
  });

  it("a partial run DOES clear a payment-field streak when that field was checked", () => {
    const state = paymentMismatchState();
    const checked = classifyDayResult(
      makeDayResult({
        matches: true,
        unverifiedFields: ["paymentUnsettledMinor"],
      }),
    );
    expect(checked.checkedFields).toContain("paymentsRefundedMinor");
    const next = nextStreakState(state, checked);
    expect(next.state.streakCount).toBe(0);
    expect(next.state.reArmEpoch).toBe(state.reArmEpoch + 1);
  });

  it("a partial run DOES clear the streak when the differing field was checked clean", () => {
    const { state } = mismatchState();
    // netSalesMinor was checked (in checkedFields) and shows no difference.
    const partial = classifyDayResult(
      makeDayResult({
        matches: true,
        unverifiedFields: ["paymentsRefundedMinor"],
      }),
    );
    expect(partial.checkedFields).toContain("netSalesMinor");
    const next = nextStreakState(state, partial);
    expect(next.state.streakCount).toBe(0);
    expect(next.state.fingerprint).toBeNull();
    expect(next.state.reArmEpoch).toBe(state.reArmEpoch + 1);
  });

  it("a truncated run neither clears nor alerts", () => {
    const { state } = mismatchState();
    const truncated = classifyDayResult(
      makeDayResult({ matches: false, truncated: true }),
    );
    const next = nextStreakState(state, truncated);
    expect(next.shouldAlert).toBe(false);
    expect(next.state.streakCount).toBe(state.streakCount);
    expect(next.state.fingerprint).toBe(state.fingerprint);
  });

  it("re-alerts exactly once per changed fingerprint", () => {
    const { state } = mismatchState();
    const changed = classifyDayResult(
      makeDayResult({
        matches: false,
        differences: [{ field: "grossSalesMinor", expected: 100, actual: 900 }],
      }),
    );
    const first = nextStreakState(state, changed);
    expect(first.shouldAlert).toBe(true);
    expect(first.state.streakCount).toBe(1);

    const repeat = nextStreakState(first.state, changed);
    expect(repeat.shouldAlert).toBe(false);
    expect(repeat.state.streakCount).toBe(2);
  });

  it("gives an A -> B -> A fingerprint oscillation three distinct alert identities (F1)", () => {
    const at = (actual: number) =>
      classifyDayResult(
        makeDayResult({
          matches: false,
          differences: [{ field: "netSalesMinor", expected: 100, actual }],
        }),
      );
    const a1 = nextStreakState(initialStreakState(), at(600));
    const b = nextStreakState(a1.state, at(800));
    const a2 = nextStreakState(b.state, at(600));

    expect([a1.shouldAlert, b.shouldAlert, a2.shouldAlert]).toEqual([
      true,
      true,
      true,
    ]);
    // The fingerprint alone repeats; the emission identity must not.
    expect(a2.state.fingerprint).toBe(a1.state.fingerprint);
    const identities = [a1, b, a2].map(
      (step) =>
        `${step.state.fingerprint}|${step.state.reArmEpoch}|${step.state.alertSeq}`,
    );
    expect(new Set(identities).size).toBe(3);
    expect([a1.state.alertSeq, b.state.alertSeq, a2.state.alertSeq]).toEqual([
      1, 2, 3,
    ]);
  });

  it("does not increment alertSeq on a silent repeat, and never resets it on re-arm", () => {
    const { state } = mismatchState();
    expect(state.alertSeq).toBe(1);
    const repeat = nextStreakState(state, unexplainedMismatch());
    expect(repeat.state.alertSeq).toBe(1);
    const cleared = nextStreakState(
      repeat.state,
      classifyDayResult(makeDayResult()),
    );
    expect(cleared.state.alertSeq).toBe(1);
    const again = nextStreakState(cleared.state, unexplainedMismatch());
    expect(again.shouldAlert).toBe(true);
    expect(again.state.alertSeq).toBe(2);
  });

  it("a run that checked nothing relevant never confirms clean (F2)", () => {
    // A weekly config-defect escalation tracks no fields at all.
    const escalation = classifyWeekResult(
      { outcome: "unavailable", reason: "missing_schedule" },
      { storeAllowlisted: true },
    );
    const state = nextStreakState(initialStreakState(), escalation).state;
    expect(state.unexplainedFields).toEqual([]);
    expect(state.streakCount).toBe(1);

    const partial = classifyWeekResult(
      {
        outcome: "incomplete",
        reason: "source_cap_exceeded",
        cycleStartDate: "2026-08-03",
        cycleEndDate: "2026-08-09",
        daysChecked: 2,
      },
      { storeAllowlisted: true },
    );
    expect(partial.checkedFields).toEqual([]);
    const next = nextStreakState(state, partial);
    expect(next.state.streakCount).toBe(1);
    expect(next.state.fingerprint).toBe(state.fingerprint);
    expect(next.state.reArmEpoch).toBe(state.reArmEpoch);
    expect(next.state.lastAlertedFingerprint).toBe(
      state.lastAlertedFingerprint,
    );
  });

  it("an all-explained mismatch on the tracked field does NOT clear the streak (F3)", () => {
    const { state } = mismatchState();
    expect(state.unexplainedFields).toEqual(["netSalesMinor"]);
    // Same field still differs; a void explanation has now arrived for it.
    const explainedNow = classifyDayResult(
      makeDayResult({
        matches: false,
        differences: [{ field: "netSalesMinor", expected: 1000, actual: 2000 }],
      }),
      { voidImpact: { revenueMinor: 500, units: 0 } },
    );
    expect(explainedNow.unexplained).toEqual([]);
    expect(explainedNow.alertable).toBe(false);
    const next = nextStreakState(state, explainedNow);
    expect(next.state.streakCount).toBe(state.streakCount);
    expect(next.state.fingerprint).toBe(state.fingerprint);
    expect(next.state.reArmEpoch).toBe(state.reArmEpoch);
  });

  it("an all-explained mismatch on an UNRELATED field still clears a checked-clean streak", () => {
    const { state } = mismatchState();
    const elsewhere = classifyDayResult(
      makeDayResult({
        matches: false,
        differences: [{ field: "unitsReturned", expected: 0, actual: 4 }],
      }),
    );
    const next = nextStreakState(state, elsewhere);
    expect(next.state.streakCount).toBe(0);
    expect(next.state.reArmEpoch).toBe(state.reArmEpoch + 1);
  });

  it("alerts once per streak for a weekly config-defect unavailability", () => {
    const classification = classifyWeekResult(
      { outcome: "unavailable", reason: "missing_schedule" },
      { storeAllowlisted: true },
    );
    const first = nextStreakState(initialStreakState(), classification);
    expect(first.shouldAlert).toBe(true);
    const second = nextStreakState(first.state, classification);
    expect(second.shouldAlert).toBe(false);
    expect(second.state.streakCount).toBe(2);
  });
});
