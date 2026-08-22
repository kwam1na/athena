/**
 * Agent harness execution contract (browser-safe, no Convex imports).
 *
 * This module is the single source of truth for the durable state machines the
 * harness kernel enforces: run, program attempt, and capability call statuses,
 * the turn-binding step ladder, evidence states, retention classes, budget
 * dimensions, and the pure transition/settlement/fence rules. Convex modules
 * under `convex/agentHarness/` apply these rules inside transactions; nothing
 * here touches a database, clock, or provider, so every rule is testable with
 * plain Vitest and reusable by the host UI for display logic.
 */

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Status vocabularies (plan decision 6 and 10)
// ---------------------------------------------------------------------------

export const AGENT_RUN_STATUSES = [
  "queued",
  "context_captured",
  "running",
  "completed",
  "failed",
  "canceled",
] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

export const AGENT_PROGRAM_ATTEMPT_STATUSES = [
  "submitted",
  "validating",
  "executing",
  "result_produced",
  "rejected",
  "failed",
  "canceled",
] as const;
export type AgentProgramAttemptStatus =
  (typeof AGENT_PROGRAM_ATTEMPT_STATUSES)[number];

export const AGENT_CAPABILITY_CALL_STATUSES = [
  "requested",
  "admitted",
  "executing",
  "succeeded",
  "partial",
  "unavailable",
  "denied",
  "failed",
  "canceled",
] as const;
export type AgentCapabilityCallStatus =
  (typeof AGENT_CAPABILITY_CALL_STATUSES)[number];

export const AGENT_TURN_BINDING_STEPS = [
  "intent_recorded",
  "runtime_thread_bound",
  "runtime_input_saved",
  "scheduled",
  "running",
  "completion_prepared",
  "athena_committed",
  "runtime_projected",
] as const;
export type AgentTurnBindingStep = (typeof AGENT_TURN_BINDING_STEPS)[number];

export const AGENT_EVIDENCE_STATES = [
  "reconstructible",
  "provenance_only",
  "evidence_expired",
  "evidence_deleted_by_lifecycle",
] as const;
export type AgentEvidenceState = (typeof AGENT_EVIDENCE_STATES)[number];

export const AGENT_EVIDENCE_LIFECYCLES = [
  "retained",
  "expired",
  "deleted_by_lifecycle",
] as const;
export type AgentEvidenceLifecycle = (typeof AGENT_EVIDENCE_LIFECYCLES)[number];

export const AGENT_RETENTION_CLASSES = ["short_lived", "standard"] as const;
export type AgentRetentionClass = (typeof AGENT_RETENTION_CLASSES)[number];

export const SHORT_LIVED_RETENTION_MS = 30 * DAY_MS;
export const STANDARD_RETENTION_MS = 365 * DAY_MS;

/** Per-call evidence ceiling that keeps every child row far below 1 MiB. */
export const AGENT_CALL_EVIDENCE_BYTE_CEILING = 240 * 1024;

/**
 * Run-wide bridge/evidence ceiling: the ledger's `bytes` limit is
 * clamped to this at run creation so the reservation counter enforces it for
 * every profile, whatever its budget policy says.
 */
export const AGENT_RUN_EVIDENCE_BYTE_CEILING = 2 * 1024 * 1024;

/** Embedded source-ref arrays on a call row are capped; the rest is counted. */
export const AGENT_CALL_SOURCE_REF_CAP = 64;

// ---------------------------------------------------------------------------
// Transition tables
// ---------------------------------------------------------------------------

export type TransitionTable<S extends string> = Readonly<Record<S, readonly S[]>>;

export const AGENT_RUN_TRANSITIONS: TransitionTable<AgentRunStatus> = {
  queued: ["context_captured", "running", "failed", "canceled"],
  context_captured: ["running", "failed", "canceled"],
  running: ["completed", "failed", "canceled"],
  completed: [],
  failed: [],
  canceled: [],
};

export const AGENT_PROGRAM_ATTEMPT_TRANSITIONS: TransitionTable<AgentProgramAttemptStatus> =
  {
    submitted: ["validating", "rejected", "failed", "canceled"],
    validating: ["executing", "rejected", "failed", "canceled"],
    executing: ["result_produced", "failed", "canceled"],
    result_produced: [],
    rejected: [],
    failed: [],
    canceled: [],
  };

export const AGENT_CAPABILITY_CALL_TRANSITIONS: TransitionTable<AgentCapabilityCallStatus> =
  {
    requested: ["admitted", "denied", "failed", "canceled"],
    admitted: ["executing", "denied", "unavailable", "failed", "canceled"],
    executing: ["succeeded", "partial", "unavailable", "failed", "canceled"],
    succeeded: [],
    partial: [],
    unavailable: [],
    denied: [],
    failed: [],
    canceled: [],
  };

export function terminalStatesOf<S extends string>(table: TransitionTable<S>): S[] {
  return (Object.keys(table) as S[]).filter((state) => table[state].length === 0);
}

export function isTerminalState<S extends string>(
  table: TransitionTable<S>,
  state: S,
): boolean {
  return (table[state]?.length ?? 0) === 0;
}

export type TransitionEvaluation<S extends string> =
  | { kind: "advance"; from: S; to: S }
  | { kind: "already_in_state"; state: S }
  | {
      kind: "rejected";
      from: S;
      to: S;
      reason: "terminal_state" | "illegal_transition";
    };

/**
 * Evaluate a requested transition. A repeat of the current state is an
 * idempotent no-op (so retried terminalization never throws); leaving a
 * terminal state is always rejected as `terminal_state`; anything else not in
 * the table is `illegal_transition`.
 */
export function evaluateTransition<S extends string>(
  table: TransitionTable<S>,
  from: S,
  to: S,
): TransitionEvaluation<S> {
  if (from === to) return { kind: "already_in_state", state: from };
  if (isTerminalState(table, from)) {
    return { kind: "rejected", from, to, reason: "terminal_state" };
  }
  if (!table[from]?.includes(to)) {
    return { kind: "rejected", from, to, reason: "illegal_transition" };
  }
  return { kind: "advance", from, to };
}

export const AGENT_RUN_ACTIVE_STATUSES = AGENT_RUN_STATUSES.filter(
  (status) => !isTerminalState(AGENT_RUN_TRANSITIONS, status),
);

export function isTerminalRunStatus(status: AgentRunStatus): boolean {
  return isTerminalState(AGENT_RUN_TRANSITIONS, status);
}

export function isTerminalAttemptStatus(status: AgentProgramAttemptStatus): boolean {
  return isTerminalState(AGENT_PROGRAM_ATTEMPT_TRANSITIONS, status);
}

export function isTerminalCallStatus(status: AgentCapabilityCallStatus): boolean {
  return isTerminalState(AGENT_CAPABILITY_CALL_TRANSITIONS, status);
}

// ---------------------------------------------------------------------------
// Turn binding ladder (plan decision 10)
// ---------------------------------------------------------------------------

export function bindingStepIndex(step: AgentTurnBindingStep): number {
  return AGENT_TURN_BINDING_STEPS.indexOf(step);
}

export function isBindingStepAtOrBeyond(
  current: AgentTurnBindingStep,
  target: AgentTurnBindingStep,
): boolean {
  return bindingStepIndex(current) >= bindingStepIndex(target);
}

export type BindingAdvanceEvaluation =
  | { kind: "advance"; from: AgentTurnBindingStep; to: AgentTurnBindingStep }
  | {
      kind: "already_reached";
      current: AgentTurnBindingStep;
      requested: AgentTurnBindingStep;
    }
  | {
      kind: "rejected";
      current: AgentTurnBindingStep;
      requested: AgentTurnBindingStep;
      reason: "step_skipped" | "binding_abandoned";
    };

/**
 * The binding advances exactly one rung at a time. Requesting a rung that was
 * already reached is the resume path (idempotent), never a regression; skipping
 * a rung is rejected because each rung records the runtime reference the next
 * one depends on.
 */
export function evaluateBindingAdvance(input: {
  current: AgentTurnBindingStep;
  next: AgentTurnBindingStep;
  abandoned: boolean;
}): BindingAdvanceEvaluation {
  const currentIndex = bindingStepIndex(input.current);
  const nextIndex = bindingStepIndex(input.next);
  if (nextIndex <= currentIndex) {
    return { kind: "already_reached", current: input.current, requested: input.next };
  }
  if (input.abandoned) {
    return {
      kind: "rejected",
      current: input.current,
      requested: input.next,
      reason: "binding_abandoned",
    };
  }
  if (nextIndex !== currentIndex + 1) {
    return {
      kind: "rejected",
      current: input.current,
      requested: input.next,
      reason: "step_skipped",
    };
  }
  return { kind: "advance", from: input.current, to: input.next };
}

// ---------------------------------------------------------------------------
// Budgets (plan decision 11)
// ---------------------------------------------------------------------------

export const AGENT_BUDGET_DIMENSIONS = [
  "calls",
  "rows",
  "bytes",
  "costUnits",
  "elapsedMs",
] as const;
export type AgentBudgetDimension = (typeof AGENT_BUDGET_DIMENSIONS)[number];
export type BudgetVector = Record<AgentBudgetDimension, number>;

export function budgetVector(partial: Partial<BudgetVector> = {}): BudgetVector {
  const vector = {} as BudgetVector;
  for (const dimension of AGENT_BUDGET_DIMENSIONS) {
    vector[dimension] = Math.max(0, partial[dimension] ?? 0);
  }
  return vector;
}

export function addBudget(a: BudgetVector, b: BudgetVector): BudgetVector {
  const vector = {} as BudgetVector;
  for (const dimension of AGENT_BUDGET_DIMENSIONS) {
    vector[dimension] = a[dimension] + b[dimension];
  }
  return vector;
}

export function subtractBudget(a: BudgetVector, b: BudgetVector): BudgetVector {
  const vector = {} as BudgetVector;
  for (const dimension of AGENT_BUDGET_DIMENSIONS) {
    vector[dimension] = Math.max(0, a[dimension] - b[dimension]);
  }
  return vector;
}

export type BudgetAdmission =
  | { admitted: true; remaining: BudgetVector }
  | { admitted: false; exceeded: AgentBudgetDimension[]; remaining: BudgetVector };

/**
 * Admission reserves the declared worst case against charged + outstanding
 * counters. `remaining` always reports the headroom before this request, so a
 * denial explains exactly which dimensions ran out.
 */
export function evaluateBudgetReservation(input: {
  limits: BudgetVector;
  charged: BudgetVector;
  outstanding: BudgetVector;
  requested: BudgetVector;
}): BudgetAdmission {
  const remaining = subtractBudget(
    input.limits,
    addBudget(input.charged, input.outstanding),
  );
  const exceeded = AGENT_BUDGET_DIMENSIONS.filter(
    (dimension) => input.requested[dimension] > remaining[dimension],
  );
  if (exceeded.length > 0) return { admitted: false, exceeded, remaining };
  return { admitted: true, remaining: subtractBudget(remaining, input.requested) };
}

export const AGENT_CALL_SETTLEMENT_OUTCOMES = [
  "succeeded",
  "partial",
  "unavailable",
  "denied",
  "failed",
  "timeout",
  "canceled",
] as const;
export type AgentCallSettlementOutcome =
  (typeof AGENT_CALL_SETTLEMENT_OUTCOMES)[number];

export type BudgetSettlement = {
  charged: BudgetVector;
  refunded: BudgetVector;
  overrun: BudgetVector;
  /** True when at least one dimension fell back to the reservation. */
  conservative: boolean;
};

/**
 * Settlement policy from plan decision 11:
 * - succeeded/partial: charge actual usage, refund the unused reservation,
 *   record any overrun honestly (never a negative refund).
 * - denied: consume the call attempt only.
 * - unavailable/failed: consume the call and elapsed time; refund unused
 *   row/byte/cost allocation.
 * - timeout/canceled: settle conservatively; unknown dimensions charge the
 *   reservation.
 * Any dimension without an actual figure falls back to the reservation (or to
 * zero for the refundable dimensions of unavailable/failed calls).
 */
export function settleBudgetReservation(input: {
  reserved: BudgetVector;
  outcome: AgentCallSettlementOutcome;
  actual?: Partial<BudgetVector>;
}): BudgetSettlement {
  const charged = {} as BudgetVector;
  let conservative = false;
  const actual = input.actual ?? {};

  for (const dimension of AGENT_BUDGET_DIMENSIONS) {
    const reserved = input.reserved[dimension];
    const known = actual[dimension];
    switch (input.outcome) {
      case "denied":
        charged[dimension] = dimension === "calls" ? reserved : 0;
        break;
      case "unavailable":
      case "failed":
        if (dimension === "calls") {
          charged[dimension] = reserved;
        } else if (dimension === "elapsedMs") {
          if (known === undefined) conservative = true;
          charged[dimension] = known ?? reserved;
        } else {
          charged[dimension] = known ?? 0;
        }
        break;
      case "succeeded":
      case "partial":
      case "timeout":
      case "canceled":
        if (dimension === "calls") {
          charged[dimension] = reserved;
        } else {
          if (known === undefined) conservative = true;
          charged[dimension] = known ?? reserved;
        }
        break;
    }
    charged[dimension] = Math.max(0, charged[dimension]);
  }

  return {
    charged,
    refunded: subtractBudget(input.reserved, charged),
    overrun: subtractBudget(charged, input.reserved),
    conservative,
  };
}

export function exceedsBudget(limits: BudgetVector, used: BudgetVector): AgentBudgetDimension[] {
  return AGENT_BUDGET_DIMENSIONS.filter((dimension) => used[dimension] > limits[dimension]);
}

// ---------------------------------------------------------------------------
// Evidence and retention (plan decision 12)
// ---------------------------------------------------------------------------

/**
 * `reconstructible` needs the promoted claim-support slice, the short-lived
 * replay payload, or an immutable authoritative revision reference (an
 * immutable authoritative revision reference may replace a copied call
 * output); with none of them, only provenance remains. Lifecycle markers win
 * over availability so an expired or lifecycle-deleted citation is reported
 * as such even if a stray payload row still exists.
 */
export function resolveEvidenceState(input: {
  lifecycle: AgentEvidenceLifecycle;
  claimSupportAvailable: boolean;
  replayPayloadAvailable: boolean;
  immutableRevisionAvailable?: boolean;
}): AgentEvidenceState {
  if (input.lifecycle === "deleted_by_lifecycle") return "evidence_deleted_by_lifecycle";
  if (input.lifecycle === "expired") return "evidence_expired";
  if (input.claimSupportAvailable || input.replayPayloadAvailable || input.immutableRevisionAvailable === true) {
    return "reconstructible";
  }
  return "provenance_only";
}

export function retentionExpiresAt(
  retentionClass: AgentRetentionClass,
  at: number,
): number {
  return (
    at +
    (retentionClass === "short_lived" ? SHORT_LIVED_RETENTION_MS : STANDARD_RETENTION_MS)
  );
}

export function isExpiredAt(expiresAt: number, now: number): boolean {
  return expiresAt <= now;
}

export function measureJsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value) ?? "").byteLength;
}

export function evaluateEvidencePayloadSize(
  byteLength: number,
  ceiling: number = AGENT_CALL_EVIDENCE_BYTE_CEILING,
): { withinCeiling: boolean; byteLength: number; ceiling: number } {
  return { withinCeiling: byteLength <= ceiling, byteLength, ceiling };
}

/**
 * Deterministic, dependency-free content digest (64-bit FNV-1a over the JSON
 * encoding). It binds stored payloads to the hash recorded on audit rows; it
 * is an integrity/identity label, not a cryptographic commitment. Callers that
 * already hold a stronger digest (e.g. the executor's sha256) pass it instead.
 */
export function computeContentDigest(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value) ?? "");
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & mask;
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}

// ---------------------------------------------------------------------------
// Compatibility epoch fence (plan decision 4)
// ---------------------------------------------------------------------------

export type CompatibilityEpochFence =
  | { fenced: false }
  | {
      fenced: true;
      code: "compatibility_epoch_fenced";
      runEpoch: number;
      currentEpoch: number;
    };

/** A run is admitted only while it pins exactly the durable current epoch. */
export function evaluateCompatibilityEpochFence(input: {
  runEpoch: number;
  currentEpoch: number;
}): CompatibilityEpochFence {
  if (input.runEpoch === input.currentEpoch) return { fenced: false };
  return {
    fenced: true,
    code: "compatibility_epoch_fenced",
    runEpoch: input.runEpoch,
    currentEpoch: input.currentEpoch,
  };
}

// ---------------------------------------------------------------------------
// Typed denials shared by every kernel mutation
// ---------------------------------------------------------------------------

export const AGENT_HARNESS_DENIAL_CODES = [
  "run_not_found",
  "run_terminal",
  "run_not_running",
  "attempt_not_found",
  "attempt_terminal",
  "attempt_not_executing",
  "attempt_not_owned_by_run",
  "call_not_found",
  "call_terminal",
  "call_not_owned_by_run",
  "binding_not_found",
  "binding_abandoned",
  "binding_step_skipped",
  "budget_exceeded",
  "attempt_cap_exceeded",
  "compatibility_epoch_fenced",
  "evidence_payload_exceeds_ceiling",
  "citation_not_supported",
  "illegal_transition",
  "scope_required",
] as const;
export type AgentHarnessDenialCode = (typeof AGENT_HARNESS_DENIAL_CODES)[number];

export type AgentHarnessDenial = {
  code: AgentHarnessDenialCode;
  message: string;
  retryable: boolean;
  detail?: Record<string, string | number | boolean | string[]>;
};

export function denial(
  code: AgentHarnessDenialCode,
  message: string,
  options: { retryable?: boolean; detail?: AgentHarnessDenial["detail"] } = {},
): AgentHarnessDenial {
  return {
    code,
    message,
    retryable: options.retryable ?? false,
    ...(options.detail ? { detail: options.detail } : {}),
  };
}
