/**
 * Upload-sequence gap reconciliation policy.
 *
 * A terminal uploads events under a per-cursor `uploadSequence` and the server
 * only projects sequence `acceptedThroughSequence + 1`. Anything ahead of that
 * is parked as `held`/`out_of_order` until its predecessor arrives. That rule
 * is what keeps offline POS history in causal order, and it is correct as long
 * as every allocated sequence eventually shows up.
 *
 * It does not always show up. A local event can be purged by ledger
 * maintenance, dropped by a torn write, or rejected client-side *after* its
 * upload sequence was allocated — burning that number permanently. The
 * successors then wait on a predecessor that no longer exists anywhere, and the
 * terminal wedges: sales and register closes stay local forever while the
 * scheduler loops the same held batch behind exponential backoff.
 *
 * This module decides, from durable gap state alone, when to stop waiting. It
 * is deliberately pure — no clock, no database — so the escalation ladder is
 * unit-testable and the thresholds are readable in one place.
 *
 * The ladder is intentionally slow to skip and fast to close:
 *
 *   observe -> probe the terminal -> skip only on evidence or timeout
 *
 * Skipping is the last resort and is never silent: every skip records a
 * manager-visible conflict naming the exact sequences that were stepped over,
 * so a genuinely lost sale surfaces as a drawer discrepancy to investigate
 * rather than a number that quietly never existed.
 */

/**
 * How long a gap must persist before it is worth asking the terminal about.
 * Comfortably longer than a normal upload round trip plus scheduler backoff,
 * so ordinary in-flight reordering never triggers a probe.
 */
export const SEQUENCE_GAP_PROBE_AFTER_MS = 15 * 60_000;

/**
 * How many separate ingest attempts must observe the same gap before probing.
 * A gap seen exactly once is far more likely to be a batch still in flight
 * than a burned sequence.
 */
export const SEQUENCE_GAP_MIN_OBSERVATIONS_BEFORE_PROBE = 2;

/**
 * How long an unanswered probe waits before the gap is skipped anyway. A
 * terminal that is powered off over a weekend must not hold a register close
 * hostage indefinitely, but this is long enough that any terminal which comes
 * back online within a normal trading cycle gets to answer first.
 */
export const SEQUENCE_GAP_SKIP_AFTER_UNANSWERED_MS = 24 * 60 * 60_000;

/**
 * Upper bound on how many consecutive sequences a single reconciliation may
 * step over. A handful of burned numbers is the known failure mode; a large
 * contiguous run means something structural is wrong (a ledger reset, a
 * restored backup, a cursor pointed at the wrong session) and a human should
 * look at it before history is written past it.
 */
export const SEQUENCE_GAP_MAX_SKIP_SPAN = 5;

export type SequenceGapState = {
  /** First sequence the cursor is waiting on: `acceptedThroughSequence + 1`. */
  missingFromSequence: number;
  firstObservedAt: number;
  lastObservedAt: number;
  observationCount: number;
  probeIssuedAt?: number;
};

/**
 * What the terminal itself says about the missing sequence. Sourced either from
 * a `collect_local_review` acknowledgement or from the runtime heartbeat, both
 * of which enumerate the local ledger's pending upload sequences.
 */
export type SequenceGapTerminalEvidence =
  | { kind: "absent"; observedAt: number }
  | { kind: "present"; observedAt: number }
  | { kind: "unknown" };

export type SequenceGapDecision =
  | { kind: "wait"; reason: SequenceGapWaitReason }
  | { kind: "probe"; missingFromSequence: number }
  | {
      kind: "skip";
      /** Advance `acceptedThroughSequence` to exactly this value. */
      skipThroughSequence: number;
      skippedSequences: number[];
      reason: SequenceGapSkipReason;
    };

export type SequenceGapWaitReason =
  | "no_held_successor"
  | "too_recent"
  | "too_few_observations"
  | "probe_in_flight"
  | "terminal_has_event"
  | "skip_span_too_wide";

export type SequenceGapSkipReason =
  | "terminal_reports_event_absent"
  | "probe_unanswered";

export type SequenceGapInput = {
  gap: SequenceGapState;
  /**
   * Sequences currently parked as held/out_of_order for this cursor, in any
   * order. Without at least one there is nothing to unblock and nothing to do.
   */
  heldSequences: number[];
  evidence: SequenceGapTerminalEvidence;
  now: number;
};

export function decideSequenceGapAction(
  input: SequenceGapInput,
): SequenceGapDecision {
  const { gap, evidence, now } = input;

  const successors = [...new Set(input.heldSequences)]
    .filter((sequence) => sequence > gap.missingFromSequence)
    .sort((left, right) => left - right);
  const nextHeldSequence = successors[0];

  // Nothing is actually blocked behind this gap. The cursor may legitimately
  // sit below a sequence the terminal has not uploaded yet.
  if (nextHeldSequence === undefined) {
    return { kind: "wait", reason: "no_held_successor" };
  }

  // The terminal still holds the event. It is a delivery problem, not a burned
  // sequence — retries will close it, and skipping would strand a real event.
  if (evidence.kind === "present") {
    return { kind: "wait", reason: "terminal_has_event" };
  }

  const skippedSequences: number[] = [];
  for (
    let sequence = gap.missingFromSequence;
    sequence < nextHeldSequence;
    sequence += 1
  ) {
    skippedSequences.push(sequence);
  }

  // A wide contiguous run is not the burned-sequence failure mode. Refuse to
  // write history past it and leave the gap for a human.
  if (skippedSequences.length > SEQUENCE_GAP_MAX_SKIP_SPAN) {
    return { kind: "wait", reason: "skip_span_too_wide" };
  }

  const skip = (reason: SequenceGapSkipReason): SequenceGapDecision => ({
    kind: "skip",
    skipThroughSequence: nextHeldSequence - 1,
    skippedSequences,
    reason,
  });

  // The terminal has enumerated its local ledger and the sequence is not in
  // it. That is direct evidence the event no longer exists, so there is
  // nothing left to wait for regardless of how young the gap is.
  if (evidence.kind === "absent") {
    return skip("terminal_reports_event_absent");
  }

  if (gap.probeIssuedAt !== undefined) {
    return now - gap.probeIssuedAt >= SEQUENCE_GAP_SKIP_AFTER_UNANSWERED_MS
      ? skip("probe_unanswered")
      : { kind: "wait", reason: "probe_in_flight" };
  }

  if (now - gap.firstObservedAt < SEQUENCE_GAP_PROBE_AFTER_MS) {
    return { kind: "wait", reason: "too_recent" };
  }

  if (gap.observationCount < SEQUENCE_GAP_MIN_OBSERVATIONS_BEFORE_PROBE) {
    return { kind: "wait", reason: "too_few_observations" };
  }

  return { kind: "probe", missingFromSequence: gap.missingFromSequence };
}

/**
 * Fold a fresh observation of a held gap into durable cursor state.
 *
 * A gap at a *different* sequence than the one being tracked is a new gap: the
 * previous one closed and the cursor moved on, so the escalation clock restarts
 * rather than inheriting age from an unrelated hole.
 */
export function recordSequenceGapObservation(input: {
  existing: SequenceGapState | undefined;
  missingFromSequence: number;
  now: number;
}): SequenceGapState {
  const { existing, missingFromSequence, now } = input;

  if (existing && existing.missingFromSequence === missingFromSequence) {
    return {
      ...existing,
      lastObservedAt: now,
      observationCount: existing.observationCount + 1,
    };
  }

  return {
    missingFromSequence,
    firstObservedAt: now,
    lastObservedAt: now,
    observationCount: 1,
  };
}

/**
 * Whether tracked gap state is still meaningful once the cursor has advanced.
 * The gap is cleared as soon as the cursor reaches the sequence it was waiting
 * on, which is what makes the common case — a late batch that simply arrives —
 * cost nothing and leave no residue.
 */
export function isSequenceGapResolved(input: {
  gap: SequenceGapState;
  acceptedThroughSequence: number;
}): boolean {
  return input.acceptedThroughSequence >= input.gap.missingFromSequence;
}
