import { describe, expect, it } from "vitest";

import {
  decideSequenceGapAction,
  isSequenceGapResolved,
  recordSequenceGapObservation,
  SEQUENCE_GAP_MAX_SKIP_SPAN,
  SEQUENCE_GAP_PROBE_AFTER_MS,
  SEQUENCE_GAP_SKIP_AFTER_UNANSWERED_MS,
  type SequenceGapInput,
  type SequenceGapState,
} from "./sequenceGapPolicy";

const NOW = 1_784_939_000_000;

function gap(overrides: Partial<SequenceGapState> = {}): SequenceGapState {
  return {
    missingFromSequence: 17,
    firstObservedAt: NOW - SEQUENCE_GAP_PROBE_AFTER_MS - 1,
    lastObservedAt: NOW,
    observationCount: 5,
    ...overrides,
  };
}

function decide(overrides: Partial<SequenceGapInput> = {}) {
  return decideSequenceGapAction({
    gap: gap(),
    heldSequences: [18, 19],
    evidence: { kind: "unknown" },
    now: NOW,
    ...overrides,
  });
}

describe("POS upload-sequence gap policy", () => {
  describe("waiting", () => {
    it("does nothing when no event is blocked behind the gap", () => {
      expect(decide({ heldSequences: [] })).toEqual({
        kind: "wait",
        reason: "no_held_successor",
      });
    });

    it("ignores held sequences at or below the gap", () => {
      // A cursor can legitimately sit below sequences the terminal simply has
      // not uploaded yet; only a *successor* proves something is blocked.
      expect(decide({ heldSequences: [15, 16, 17] })).toEqual({
        kind: "wait",
        reason: "no_held_successor",
      });
    });

    it("waits while the gap is younger than the probe threshold", () => {
      expect(
        decide({
          gap: gap({ firstObservedAt: NOW - SEQUENCE_GAP_PROBE_AFTER_MS + 1 }),
        }),
      ).toEqual({ kind: "wait", reason: "too_recent" });
    });

    it("waits until the gap has been seen more than once", () => {
      expect(decide({ gap: gap({ observationCount: 1 }) })).toEqual({
        kind: "wait",
        reason: "too_few_observations",
      });
    });

    it("waits while a probe is still within its answer window", () => {
      expect(
        decide({
          gap: gap({
            probeIssuedAt:
              NOW - SEQUENCE_GAP_SKIP_AFTER_UNANSWERED_MS + 60_000,
          }),
        }),
      ).toEqual({ kind: "wait", reason: "probe_in_flight" });
    });
  });

  describe("probing", () => {
    it("probes an aged, repeatedly observed gap", () => {
      expect(decide()).toEqual({ kind: "probe", missingFromSequence: 17 });
    });
  });

  describe("skipping", () => {
    it("skips immediately when the terminal reports the event is gone", () => {
      expect(
        decide({ evidence: { kind: "absent", observedAt: NOW } }),
      ).toEqual({
        kind: "skip",
        skipThroughSequence: 17,
        skippedSequences: [17],
        reason: "terminal_reports_event_absent",
      });
    });

    it("skips a young gap on absence evidence, without waiting to probe", () => {
      // Direct evidence beats the clock: there is nothing left to wait for.
      expect(
        decide({
          gap: gap({ firstObservedAt: NOW, observationCount: 1 }),
          evidence: { kind: "absent", observedAt: NOW },
        }),
      ).toMatchObject({ kind: "skip" });
    });

    it("skips once a probe has gone unanswered past its window", () => {
      expect(
        decide({
          gap: gap({
            probeIssuedAt: NOW - SEQUENCE_GAP_SKIP_AFTER_UNANSWERED_MS,
          }),
        }),
      ).toMatchObject({ kind: "skip", reason: "probe_unanswered" });
    });

    it("steps over every burned sequence up to the next held event", () => {
      expect(
        decide({
          heldSequences: [21, 22],
          evidence: { kind: "absent", observedAt: NOW },
        }),
      ).toMatchObject({
        skipThroughSequence: 20,
        skippedSequences: [17, 18, 19, 20],
      });
    });
  });

  describe("refusing to skip", () => {
    it("never skips while the terminal still holds the event", () => {
      // The decisive case: absent evidence would skip here, but the terminal
      // says it has the event, so this is a delivery problem and skipping
      // would strand real POS history.
      expect(
        decide({
          gap: gap({
            probeIssuedAt: NOW - SEQUENCE_GAP_SKIP_AFTER_UNANSWERED_MS * 10,
          }),
          evidence: { kind: "present", observedAt: NOW },
        }),
      ).toEqual({ kind: "wait", reason: "terminal_has_event" });
    });

    it("refuses a contiguous run wider than the skip bound", () => {
      const nextHeld = 17 + SEQUENCE_GAP_MAX_SKIP_SPAN + 1;
      expect(
        decide({
          heldSequences: [nextHeld],
          evidence: { kind: "absent", observedAt: NOW },
        }),
      ).toEqual({ kind: "wait", reason: "skip_span_too_wide" });
    });

    it("allows a run exactly at the skip bound", () => {
      const nextHeld = 17 + SEQUENCE_GAP_MAX_SKIP_SPAN;
      expect(
        decide({
          heldSequences: [nextHeld],
          evidence: { kind: "absent", observedAt: NOW },
        }),
      ).toMatchObject({ kind: "skip" });
    });
  });

  describe("observation folding", () => {
    it("ages an existing gap at the same sequence", () => {
      expect(
        recordSequenceGapObservation({
          existing: gap({ firstObservedAt: 100, observationCount: 2 }),
          missingFromSequence: 17,
          now: 500,
        }),
      ).toMatchObject({
        firstObservedAt: 100,
        lastObservedAt: 500,
        observationCount: 3,
      });
    });

    it("restarts the clock when the gap moves to a new sequence", () => {
      // The old gap closed and the cursor advanced; the new hole must not
      // inherit enough age to skip on its first sighting.
      expect(
        recordSequenceGapObservation({
          existing: gap({ firstObservedAt: 100, observationCount: 9 }),
          missingFromSequence: 42,
          now: 500,
        }),
      ).toEqual({
        missingFromSequence: 42,
        firstObservedAt: 500,
        lastObservedAt: 500,
        observationCount: 1,
      });
    });

    it("starts fresh with no prior state", () => {
      expect(
        recordSequenceGapObservation({
          existing: undefined,
          missingFromSequence: 17,
          now: 500,
        }),
      ).toEqual({
        missingFromSequence: 17,
        firstObservedAt: 500,
        lastObservedAt: 500,
        observationCount: 1,
      });
    });
  });

  describe("resolution", () => {
    it("treats the gap as resolved once the cursor reaches it", () => {
      expect(
        isSequenceGapResolved({ gap: gap(), acceptedThroughSequence: 17 }),
      ).toBe(true);
    });

    it("keeps the gap while the cursor is still behind it", () => {
      expect(
        isSequenceGapResolved({ gap: gap(), acceptedThroughSequence: 16 }),
      ).toBe(false);
    });
  });
});
