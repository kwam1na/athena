import { describe, expect, it } from "vitest";

import {
  AGENT_BUDGET_DIMENSIONS,
  AGENT_CALL_EVIDENCE_BYTE_CEILING,
  AGENT_CAPABILITY_CALL_STATUSES,
  AGENT_CAPABILITY_CALL_TRANSITIONS,
  AGENT_PROGRAM_ATTEMPT_STATUSES,
  AGENT_PROGRAM_ATTEMPT_TRANSITIONS,
  AGENT_RUN_STATUSES,
  AGENT_RUN_TRANSITIONS,
  AGENT_TURN_BINDING_STEPS,
  SHORT_LIVED_RETENTION_MS,
  STANDARD_RETENTION_MS,
  budgetVector,
  evaluateBindingAdvance,
  evaluateBudgetReservation,
  evaluateCompatibilityEpochFence,
  evaluateEvidencePayloadSize,
  evaluateTransition,
  isTerminalState,
  measureJsonByteLength,
  resolveEvidenceState,
  retentionExpiresAt,
  settleBudgetReservation,
  terminalStatesOf,
} from "./execution";

describe("agent harness state machines", () => {
  it("declares the run, attempt, and call machines from the plan", () => {
    expect(AGENT_RUN_STATUSES).toEqual([
      "queued",
      "context_captured",
      "running",
      "completed",
      "failed",
      "canceled",
    ]);
    expect(AGENT_PROGRAM_ATTEMPT_STATUSES).toEqual([
      "submitted",
      "validating",
      "executing",
      "result_produced",
      "rejected",
      "failed",
      "canceled",
    ]);
    expect(AGENT_CAPABILITY_CALL_STATUSES).toEqual([
      "requested",
      "admitted",
      "executing",
      "succeeded",
      "partial",
      "unavailable",
      "denied",
      "failed",
      "canceled",
    ]);
    expect(terminalStatesOf(AGENT_RUN_TRANSITIONS)).toEqual([
      "completed",
      "failed",
      "canceled",
    ]);
    expect(terminalStatesOf(AGENT_PROGRAM_ATTEMPT_TRANSITIONS)).toEqual([
      "result_produced",
      "rejected",
      "failed",
      "canceled",
    ]);
    expect(terminalStatesOf(AGENT_CAPABILITY_CALL_TRANSITIONS)).toEqual([
      "succeeded",
      "partial",
      "unavailable",
      "denied",
      "failed",
      "canceled",
    ]);
  });

  it("advances legal transitions once and treats repeats as idempotent", () => {
    expect(evaluateTransition(AGENT_RUN_TRANSITIONS, "queued", "running")).toEqual({
      kind: "advance",
      from: "queued",
      to: "running",
    });
    expect(
      evaluateTransition(AGENT_RUN_TRANSITIONS, "running", "completed"),
    ).toEqual({ kind: "advance", from: "running", to: "completed" });
    expect(
      evaluateTransition(AGENT_RUN_TRANSITIONS, "completed", "completed"),
    ).toEqual({ kind: "already_in_state", state: "completed" });
    expect(
      evaluateTransition(AGENT_PROGRAM_ATTEMPT_TRANSITIONS, "failed", "failed"),
    ).toEqual({ kind: "already_in_state", state: "failed" });
    expect(
      evaluateTransition(AGENT_CAPABILITY_CALL_TRANSITIONS, "executing", "partial"),
    ).toEqual({ kind: "advance", from: "executing", to: "partial" });
  });

  it("rejects every regression out of a terminal state", () => {
    for (const terminal of terminalStatesOf(AGENT_RUN_TRANSITIONS)) {
      for (const target of AGENT_RUN_STATUSES) {
        if (target === terminal) continue;
        expect(evaluateTransition(AGENT_RUN_TRANSITIONS, terminal, target)).toEqual(
          {
            kind: "rejected",
            from: terminal,
            to: target,
            reason: "terminal_state",
          },
        );
      }
    }
    for (const terminal of terminalStatesOf(AGENT_PROGRAM_ATTEMPT_TRANSITIONS)) {
      for (const target of AGENT_PROGRAM_ATTEMPT_STATUSES) {
        if (target === terminal) continue;
        expect(
          evaluateTransition(AGENT_PROGRAM_ATTEMPT_TRANSITIONS, terminal, target)
            .kind,
        ).toBe("rejected");
      }
    }
    for (const terminal of terminalStatesOf(AGENT_CAPABILITY_CALL_TRANSITIONS)) {
      expect(isTerminalState(AGENT_CAPABILITY_CALL_TRANSITIONS, terminal)).toBe(
        true,
      );
      expect(
        evaluateTransition(AGENT_CAPABILITY_CALL_TRANSITIONS, terminal, "executing")
          .kind,
      ).toBe("rejected");
    }
  });

  it("rejects illegal non-terminal jumps as illegal transitions", () => {
    expect(
      evaluateTransition(AGENT_RUN_TRANSITIONS, "queued", "completed"),
    ).toEqual({
      kind: "rejected",
      from: "queued",
      to: "completed",
      reason: "illegal_transition",
    });
    expect(
      evaluateTransition(AGENT_PROGRAM_ATTEMPT_TRANSITIONS, "submitted", "result_produced"),
    ).toMatchObject({ kind: "rejected", reason: "illegal_transition" });
    expect(
      evaluateTransition(AGENT_CAPABILITY_CALL_TRANSITIONS, "requested", "succeeded"),
    ).toMatchObject({ kind: "rejected", reason: "illegal_transition" });
    // Denial happens at admission, before any execution.
    expect(
      evaluateTransition(AGENT_CAPABILITY_CALL_TRANSITIONS, "requested", "denied"),
    ).toMatchObject({ kind: "advance" });
    // Cancellation clamps from any non-terminal state.
    expect(
      evaluateTransition(AGENT_CAPABILITY_CALL_TRANSITIONS, "admitted", "canceled"),
    ).toMatchObject({ kind: "advance" });
    expect(
      evaluateTransition(AGENT_PROGRAM_ATTEMPT_TRANSITIONS, "validating", "rejected"),
    ).toMatchObject({ kind: "advance" });
  });
});

describe("turn binding steps", () => {
  it("orders the durable binding steps from the plan", () => {
    expect(AGENT_TURN_BINDING_STEPS).toEqual([
      "intent_recorded",
      "runtime_thread_bound",
      "runtime_input_saved",
      "scheduled",
      "running",
      "completion_prepared",
      "athena_committed",
      "runtime_projected",
    ]);
  });

  it("advances one step at a time, replays reached steps idempotently, and rejects skips", () => {
    expect(
      evaluateBindingAdvance({
        current: "intent_recorded",
        next: "runtime_thread_bound",
        abandoned: false,
      }),
    ).toEqual({ kind: "advance", from: "intent_recorded", to: "runtime_thread_bound" });
    expect(
      evaluateBindingAdvance({
        current: "scheduled",
        next: "runtime_thread_bound",
        abandoned: false,
      }),
    ).toEqual({ kind: "already_reached", current: "scheduled", requested: "runtime_thread_bound" });
    expect(
      evaluateBindingAdvance({
        current: "scheduled",
        next: "scheduled",
        abandoned: false,
      }),
    ).toEqual({ kind: "already_reached", current: "scheduled", requested: "scheduled" });
    expect(
      evaluateBindingAdvance({
        current: "intent_recorded",
        next: "scheduled",
        abandoned: false,
      }),
    ).toEqual({
      kind: "rejected",
      current: "intent_recorded",
      requested: "scheduled",
      reason: "step_skipped",
    });
    expect(
      evaluateBindingAdvance({
        current: "running",
        next: "completion_prepared",
        abandoned: true,
      }),
    ).toEqual({
      kind: "rejected",
      current: "running",
      requested: "completion_prepared",
      reason: "binding_abandoned",
    });
  });
});

describe("budget reservation and settlement", () => {
  const limits = budgetVector({
    calls: 10,
    rows: 1_000,
    bytes: 100_000,
    costUnits: 50,
    elapsedMs: 60_000,
  });

  it("names the run-wide dimensions", () => {
    expect(AGENT_BUDGET_DIMENSIONS).toEqual([
      "calls",
      "rows",
      "bytes",
      "costUnits",
      "elapsedMs",
    ]);
    expect(budgetVector({ calls: 1 })).toEqual({
      calls: 1,
      rows: 0,
      bytes: 0,
      costUnits: 0,
      elapsedMs: 0,
    });
  });

  it("admits a reservation only when charged + outstanding + requested fits every dimension", () => {
    expect(
      evaluateBudgetReservation({
        limits,
        charged: budgetVector({ calls: 4, rows: 500 }),
        outstanding: budgetVector({ calls: 2, rows: 300 }),
        requested: budgetVector({ calls: 1, rows: 200 }),
      }),
    ).toEqual({
      admitted: true,
      remaining: budgetVector({
        calls: 3,
        rows: 0,
        bytes: 100_000,
        costUnits: 50,
        elapsedMs: 60_000,
      }),
    });
    expect(
      evaluateBudgetReservation({
        limits,
        charged: budgetVector({ calls: 4, rows: 500 }),
        outstanding: budgetVector({ calls: 2, rows: 300 }),
        requested: budgetVector({ calls: 1, rows: 201, bytes: 100_001 }),
      }),
    ).toEqual({
      admitted: false,
      exceeded: ["rows", "bytes"],
      remaining: budgetVector({
        calls: 4,
        rows: 200,
        bytes: 100_000,
        costUnits: 50,
        elapsedMs: 60_000,
      }),
    });
  });

  it("settles successful calls at actual usage with a refund bounded by the reservation", () => {
    const reserved = budgetVector({
      calls: 1,
      rows: 100,
      bytes: 10_000,
      costUnits: 5,
      elapsedMs: 5_000,
    });
    expect(
      settleBudgetReservation({
        reserved,
        outcome: "succeeded",
        actual: { rows: 40, bytes: 4_000, costUnits: 2, elapsedMs: 1_200 },
      }),
    ).toEqual({
      charged: budgetVector({ calls: 1, rows: 40, bytes: 4_000, costUnits: 2, elapsedMs: 1_200 }),
      refunded: budgetVector({ rows: 60, bytes: 6_000, costUnits: 3, elapsedMs: 3_800 }),
      overrun: budgetVector({}),
      conservative: false,
    });
    // Overrun is charged honestly and never produces a negative refund.
    expect(
      settleBudgetReservation({
        reserved,
        outcome: "partial",
        actual: { rows: 140, bytes: 4_000, costUnits: 2, elapsedMs: 1_200 },
      }),
    ).toMatchObject({
      charged: budgetVector({ calls: 1, rows: 140, bytes: 4_000, costUnits: 2, elapsedMs: 1_200 }),
      refunded: budgetVector({ rows: 0, bytes: 6_000, costUnits: 3, elapsedMs: 3_800 }),
      overrun: budgetVector({ rows: 40 }),
    });
  });

  it("charges denied calls the call attempt only", () => {
    const reserved = budgetVector({ calls: 1, rows: 100, bytes: 10_000, costUnits: 5, elapsedMs: 5_000 });
    expect(settleBudgetReservation({ reserved, outcome: "denied" })).toEqual({
      charged: budgetVector({ calls: 1 }),
      refunded: budgetVector({ rows: 100, bytes: 10_000, costUnits: 5, elapsedMs: 5_000 }),
      overrun: budgetVector({}),
      conservative: false,
    });
  });

  it("charges unavailable and upstream-failed calls the call and elapsed time, refunding unused rows and bytes", () => {
    const reserved = budgetVector({ calls: 1, rows: 100, bytes: 10_000, costUnits: 5, elapsedMs: 5_000 });
    expect(
      settleBudgetReservation({ reserved, outcome: "unavailable", actual: { elapsedMs: 700 } }),
    ).toEqual({
      charged: budgetVector({ calls: 1, elapsedMs: 700 }),
      refunded: budgetVector({ rows: 100, bytes: 10_000, costUnits: 5, elapsedMs: 4_300 }),
      overrun: budgetVector({}),
      conservative: false,
    });
    // Unknown elapsed time settles conservatively at the reservation.
    expect(settleBudgetReservation({ reserved, outcome: "failed" })).toEqual({
      charged: budgetVector({ calls: 1, elapsedMs: 5_000 }),
      refunded: budgetVector({ rows: 100, bytes: 10_000, costUnits: 5 }),
      overrun: budgetVector({}),
      conservative: true,
    });
  });

  it("settles timeouts and cancellations conservatively when actual usage is unknown", () => {
    const reserved = budgetVector({ calls: 1, rows: 100, bytes: 10_000, costUnits: 5, elapsedMs: 5_000 });
    expect(settleBudgetReservation({ reserved, outcome: "timeout" })).toEqual({
      charged: reserved,
      refunded: budgetVector({}),
      overrun: budgetVector({}),
      conservative: true,
    });
    expect(
      settleBudgetReservation({ reserved, outcome: "canceled", actual: { rows: 10 } }),
    ).toEqual({
      charged: budgetVector({ calls: 1, rows: 10, bytes: 10_000, costUnits: 5, elapsedMs: 5_000 }),
      refunded: budgetVector({ rows: 90 }),
      overrun: budgetVector({}),
      conservative: true,
    });
  });
});

describe("evidence and retention", () => {
  it("distinguishes the four evidence states", () => {
    expect(
      resolveEvidenceState({ lifecycle: "retained", claimSupportAvailable: false, replayPayloadAvailable: true }),
    ).toBe("reconstructible");
    expect(
      resolveEvidenceState({ lifecycle: "retained", claimSupportAvailable: true, replayPayloadAvailable: false }),
    ).toBe("reconstructible");
    expect(
      resolveEvidenceState({ lifecycle: "retained", claimSupportAvailable: false, replayPayloadAvailable: false }),
    ).toBe("provenance_only");
    expect(
      resolveEvidenceState({ lifecycle: "expired", claimSupportAvailable: true, replayPayloadAvailable: true }),
    ).toBe("evidence_expired");
    expect(
      resolveEvidenceState({ lifecycle: "deleted_by_lifecycle", claimSupportAvailable: true, replayPayloadAvailable: true }),
    ).toBe("evidence_deleted_by_lifecycle");
  });

  it("derives retention expiry from the 30/365-day classes", () => {
    expect(SHORT_LIVED_RETENTION_MS).toBe(30 * 86_400_000);
    expect(STANDARD_RETENTION_MS).toBe(365 * 86_400_000);
    expect(retentionExpiresAt("short_lived", 1_000)).toBe(1_000 + SHORT_LIVED_RETENTION_MS);
    expect(retentionExpiresAt("standard", 1_000)).toBe(1_000 + STANDARD_RETENTION_MS);
  });

  it("measures evidence payloads in UTF-8 bytes against the per-call ceiling", () => {
    expect(AGENT_CALL_EVIDENCE_BYTE_CEILING).toBe(240 * 1024);
    expect(measureJsonByteLength({ a: "é" })).toBe(Buffer.byteLength(JSON.stringify({ a: "é" }), "utf8"));
    expect(evaluateEvidencePayloadSize(AGENT_CALL_EVIDENCE_BYTE_CEILING)).toEqual({
      withinCeiling: true,
      byteLength: AGENT_CALL_EVIDENCE_BYTE_CEILING,
      ceiling: AGENT_CALL_EVIDENCE_BYTE_CEILING,
    });
    expect(evaluateEvidencePayloadSize(AGENT_CALL_EVIDENCE_BYTE_CEILING + 1)).toMatchObject({
      withinCeiling: false,
    });
  });
});

describe("compatibility epoch fence", () => {
  it("fences runs pinned to an older epoch and admits the current one", () => {
    expect(evaluateCompatibilityEpochFence({ runEpoch: 3, currentEpoch: 3 })).toEqual({
      fenced: false,
    });
    expect(evaluateCompatibilityEpochFence({ runEpoch: 2, currentEpoch: 3 })).toEqual({
      fenced: true,
      code: "compatibility_epoch_fenced",
      runEpoch: 2,
      currentEpoch: 3,
    });
    // A run can never be ahead of the durable epoch; treat it as fenced too.
    expect(evaluateCompatibilityEpochFence({ runEpoch: 4, currentEpoch: 3 })).toMatchObject({
      fenced: true,
    });
  });
});
