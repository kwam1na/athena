/**
 * Executor budget policy (kernel; pure, V8-safe).
 *
 * Authority boundary: this module decides nothing on its own — it is the
 * documented reserve/settle policy (plan decision 11) expressed over the
 * lifecycle's budget primitives, plus the ceilings the executor hands the
 * sandbox. The lifecycle ledger remains the only counter: every reservation is keyed by the
 * invocation idempotency key, settled exactly once, and bounded by the run
 * limits (clamped to the 2 MiB evidence ceiling at run creation) and the
 * attempt limits (counting outstanding reservations). Identical reads are
 * deduplicated only inside one attempt: the idempotency key binds the
 * normalized request to the attempt, so a retry or a new attempt re-reads and
 * re-charges against the SAME run budget, never a fresh one.
 */
import {
  AGENT_BUDGET_DIMENSIONS,
  AGENT_CALL_EVIDENCE_BYTE_CEILING,
  AGENT_RUN_EVIDENCE_BYTE_CEILING,
  budgetVector,
  settleBudgetReservation,
  type AgentBudgetDimension,
  type AgentCallSettlementOutcome,
  type BudgetVector,
} from "../../shared/agentHarness/execution";
import { AGENT_PROGRAM_RUNTIME_CEILINGS, type AgentProgramRuntimeCeilings } from "./programRuntime/types";

/**
 * Bytes reserved on a persisted call record for validators, index fields,
 * hashes, retention markers, and system fields, so the whole stored record —
 * not only its content — stays under the 240 KiB ceiling.
 */
export const AGENT_CALL_EVIDENCE_METADATA_HEADROOM_BYTES = 8 * 1024;

/** Largest encoded envelope the executor persists for one call. */
export const AGENT_CALL_EVIDENCE_CONTENT_CEILING_BYTES =
  AGENT_CALL_EVIDENCE_BYTE_CEILING - AGENT_CALL_EVIDENCE_METADATA_HEADROOM_BYTES;

export type AgentSettlementPolicy = {
  readonly charges: readonly AgentBudgetDimension[];
  readonly refunds: readonly AgentBudgetDimension[];
  /** True when unknown actuals fall back to the reservation. */
  readonly conservative: boolean;
};

/**
 * Dimensions the executor always knows when it settles an outcome: full usage
 * for a released envelope, elapsed time for an unavailable/failed port, and
 * nothing for a timeout or cancellation (the work may or may not have run).
 */
const KNOWN_ACTUALS: { readonly [outcome in AgentCallSettlementOutcome]: readonly AgentBudgetDimension[] } = {
  succeeded: AGENT_BUDGET_DIMENSIONS,
  partial: AGENT_BUDGET_DIMENSIONS,
  denied: [],
  unavailable: ["elapsedMs"],
  failed: ["elapsedMs"],
  timeout: [],
  canceled: [],
};

/**
 * The charge/refund table, derived from the lifecycle's `settleBudgetReservation` so it
 * cannot drift from the counter: a reservation of one unit per dimension is
 * settled with one unit of every actual the executor knows for that outcome,
 * and the charged dimensions are read back.
 */
export function describeSettlementPolicy(outcome: AgentCallSettlementOutcome): AgentSettlementPolicy {
  const unit = budgetVector(Object.fromEntries(AGENT_BUDGET_DIMENSIONS.map((dimension) => [dimension, 1])));
  const actual = Object.fromEntries(KNOWN_ACTUALS[outcome].map((dimension) => [dimension, 1])) as Partial<BudgetVector>;
  const settlement = settleBudgetReservation({ reserved: unit, outcome, actual });
  const charges = AGENT_BUDGET_DIMENSIONS.filter((dimension) => settlement.charged[dimension] > 0);
  const refunds = AGENT_BUDGET_DIMENSIONS.filter((dimension) => settlement.charged[dimension] === 0);
  return { charges, refunds, conservative: settlement.conservative };
}

/**
 * How the calls still open when a program ends are settled: a timeout settles
 * as `timeout`, cancellation as `canceled`, and any other failure (runtime
 * error, detached call, ceiling breach) conservatively as `canceled` — the
 * work may have happened, so nothing is refunded.
 */
export function settlementOutcomeForProgramEnd(end: {
  readonly status: "failed" | "canceled";
  readonly code?: string;
}): AgentCallSettlementOutcome {
  if (end.status === "canceled") return "canceled";
  if (end.code === "timeout") return "timeout";
  return "canceled";
}

/** Run limits never exceed the evidence ceiling, whatever the profile says. */
export function clampRunLimitsToEvidenceCeiling(limits: BudgetVector): BudgetVector {
  return { ...budgetVector(limits), bytes: Math.min(limits.bytes, AGENT_RUN_EVIDENCE_BYTE_CEILING) };
}

export type AgentExecutionBudgetPolicy = {
  readonly runLimits: BudgetVector;
  readonly attemptLimits?: BudgetVector;
  readonly maxAttempts: number;
  readonly maxInFlightCalls?: number;
};

/**
 * Sandbox ceilings for one run: the runtime defaults bounded by the run's
 * budget policy. The per-call output ceiling stays at the evidence ceiling
 * (the executor truncates before the guest sees an output) and the result
 * ceiling is the persisted-content ceiling, so a produced result can always
 * be stored as replay evidence.
 */
export function deriveExecutionCeilings(
  policy: AgentExecutionBudgetPolicy,
  base: AgentProgramRuntimeCeilings = AGENT_PROGRAM_RUNTIME_CEILINGS,
): AgentProgramRuntimeCeilings {
  const limits = clampRunLimitsToEvidenceCeiling(policy.runLimits);
  const bounded = (ceiling: number, limit: number | undefined) =>
    limit === undefined || limit <= 0 ? ceiling : Math.min(ceiling, Math.floor(limit));
  return Object.freeze({
    ...base,
    maxElapsedMs: bounded(base.maxElapsedMs, limits.elapsedMs),
    maxAttempts: bounded(base.maxAttempts, policy.maxAttempts),
    maxCapabilityCalls: bounded(base.maxCapabilityCalls, limits.calls),
    maxInFlightCalls: bounded(base.maxInFlightCalls, policy.maxInFlightCalls),
    maxRows: bounded(base.maxRows, limits.rows),
    maxRunBridgeBytes: bounded(Math.min(base.maxRunBridgeBytes, AGENT_RUN_EVIDENCE_BYTE_CEILING), limits.bytes),
    maxCallOutputBytes: Math.min(base.maxCallOutputBytes, AGENT_CALL_EVIDENCE_BYTE_CEILING),
    maxResultBytes: Math.min(base.maxResultBytes, AGENT_CALL_EVIDENCE_CONTENT_CEILING_BYTES),
  });
}

/**
 * Invocation idempotency key: one normalized request reads once per attempt.
 * The attempt id is part of the key, so a retry attempt reads again (and pays
 * again) instead of replaying a prior attempt's result.
 */
export function attemptCallIdempotencyKey(attemptId: string, requestDigest: string): string {
  return `attempt:${attemptId}:${requestDigest}`;
}
