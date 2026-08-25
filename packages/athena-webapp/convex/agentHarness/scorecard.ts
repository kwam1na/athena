/**
 * Harness scorecard aggregation (pure; V8-safe).
 *
 * One question: is the agent getting better? The inputs are bounded slices of
 * the engineer-only tables (`agentTurnTraceEvent`, `agentCapabilityCall`,
 * `agentProgramAttempt`, `agentBudgetLedger`) and the output is the small set
 * of rates and percentiles this harness is actually tuned by: turn outcomes,
 * completion latency, tone-retry rate, capability partial/denial rates,
 * attempt rejections, and budget utilization. Everything here is arithmetic
 * over rows the caller already read; nothing reaches a database.
 */

export type ScorecardTraceEvent = {
  readonly runId: string;
  readonly kind: string;
  readonly at: number;
  readonly payload?: unknown;
};

export type ScorecardCallRow = {
  readonly capabilityId: string;
  readonly status: string;
  readonly delegation?: { readonly refusal?: { readonly code?: string } };
};

export type ScorecardAttemptRow = { readonly status: string };

export type ScorecardLedgerRow = {
  readonly charged?: Readonly<Record<string, number>>;
  readonly limits?: Readonly<Record<string, number>>;
};

export type HarnessScorecard = {
  readonly window: { readonly from?: string; readonly to?: string; readonly turns: number };
  readonly outcomes: Readonly<Record<string, number>>;
  readonly latencyMs: {
    readonly completion: { readonly p50?: number; readonly p90?: number; readonly max?: number };
    readonly firstDelta: { readonly p50?: number; readonly p90?: number; readonly max?: number };
  };
  readonly completeRun: { readonly turnsWithRetry: number; readonly denialsByCode: Readonly<Record<string, number>> };
  readonly capabilities: Readonly<
    Record<string, { readonly reads: number; readonly succeeded: number; readonly partial: number; readonly denied: number }>
  >;
  readonly callDenialsByCode: Readonly<Record<string, number>>;
  readonly attempts: Readonly<Record<string, number>>;
  readonly budget: Readonly<Record<string, { readonly p50: number; readonly p90: number; readonly max: number; readonly limit?: number }>>;
  /** Per-profile segmentation: the scorecard serves every surface, not one. */
  readonly profiles: Readonly<Record<string, { readonly turns: number; readonly outcomes: Readonly<Record<string, number>>; readonly turnsWithRetry: number }>>;
};

/**
 * Bounds for the query's trace read. A turn writes tens of trace rows, so the
 * requested turn count is multiplied out and clamped: this is a bounded
 * engineer diagnostic run by hand, never a cron.
 */
export const SCORECARD_MIN_TRACE_EVENTS = 400;
export const SCORECARD_MAX_TRACE_EVENTS = 4_000;
const TRACE_EVENTS_PER_TURN_ESTIMATE = 40;

export function scorecardTraceTake(turns: number | undefined): number {
  const requested = Math.max(1, Math.trunc(turns ?? 100)) * TRACE_EVENTS_PER_TURN_ESTIMATE;
  return Math.min(SCORECARD_MAX_TRACE_EVENTS, Math.max(SCORECARD_MIN_TRACE_EVENTS, requested));
}

function percentile(sorted: readonly number[], fraction: number): number | undefined {
  if (sorted.length === 0) return undefined;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

export type ScorecardGrantProfile = { readonly runId: string; readonly profileKey: string };

export function aggregateHarnessScorecard(input: {
  readonly traceEvents: readonly ScorecardTraceEvent[];
  readonly calls: readonly ScorecardCallRow[];
  readonly attempts: readonly ScorecardAttemptRow[];
  readonly ledgers: readonly ScorecardLedgerRow[];
  /** runId → profile map from the recent grants; turns of unmapped runs report as "unknown". */
  readonly grantProfiles?: readonly ScorecardGrantProfile[];
}): HarnessScorecard {
  const outcomes: Record<string, number> = {};
  const outcomeByRun = new Map<string, string>();
  const completions: number[] = [];
  const firstDeltas: number[] = [];
  const denialsByCode: Record<string, number> = {};
  const completeRunsByRun = new Map<string, number>();
  let turns = 0;
  let oldest: number | undefined;
  let newest: number | undefined;
  for (const event of input.traceEvents) {
    oldest = oldest === undefined ? event.at : Math.min(oldest, event.at);
    newest = newest === undefined ? event.at : Math.max(newest, event.at);
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    if (event.kind === "turn_report") {
      turns += 1;
      const outcome = typeof payload.outcome === "string" ? payload.outcome : "unknown";
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
      outcomeByRun.set(event.runId, outcome);
      if (typeof payload.completionMs === "number") completions.push(payload.completionMs);
      if (typeof payload.firstDeltaMs === "number") firstDeltas.push(payload.firstDeltaMs);
    }
    if (event.kind === "tool_call_completed" && payload.toolId === "athena.completeRun") {
      completeRunsByRun.set(event.runId, (completeRunsByRun.get(event.runId) ?? 0) + 1);
      const denial = ((payload.outcome ?? {}) as Record<string, unknown>).denial as Record<string, unknown> | undefined;
      if (denial && typeof denial.code === "string") denialsByCode[denial.code] = (denialsByCode[denial.code] ?? 0) + 1;
    }
  }
  completions.sort((left, right) => left - right);
  firstDeltas.sort((left, right) => left - right);

  const capabilities: Record<string, { reads: number; succeeded: number; partial: number; denied: number }> = {};
  const callDenialsByCode: Record<string, number> = {};
  for (const call of input.calls) {
    const row = (capabilities[call.capabilityId] ??= { reads: 0, succeeded: 0, partial: 0, denied: 0 });
    row.reads += 1;
    if (call.status === "succeeded") row.succeeded += 1;
    else if (call.status === "partial") row.partial += 1;
    else if (call.status === "denied") {
      row.denied += 1;
      const code = call.delegation?.refusal?.code ?? "unknown";
      callDenialsByCode[code] = (callDenialsByCode[code] ?? 0) + 1;
    }
  }

  const attempts: Record<string, number> = {};
  for (const attempt of input.attempts) attempts[attempt.status] = (attempts[attempt.status] ?? 0) + 1;

  const budget: Record<string, { p50: number; p90: number; max: number; limit?: number }> = {};
  const dimensions = new Set(input.ledgers.flatMap((ledger) => Object.keys(ledger.charged ?? {})));
  for (const dimension of dimensions) {
    const values = input.ledgers.map((ledger) => ledger.charged?.[dimension] ?? 0).sort((left, right) => left - right);
    budget[dimension] = {
      p50: percentile(values, 0.5) ?? 0,
      p90: percentile(values, 0.9) ?? 0,
      max: values[values.length - 1] ?? 0,
      limit: input.ledgers.find((ledger) => ledger.limits?.[dimension] !== undefined)?.limits?.[dimension],
    };
  }

  const profileByRun = new Map((input.grantProfiles ?? []).map((grant) => [grant.runId, grant.profileKey]));
  const profiles: Record<string, { turns: number; outcomes: Record<string, number>; turnsWithRetry: number }> = {};
  for (const [runId, outcome] of outcomeByRun) {
    const profileKey = profileByRun.get(runId) ?? "unknown";
    const row = (profiles[profileKey] ??= { turns: 0, outcomes: {}, turnsWithRetry: 0 });
    row.turns += 1;
    row.outcomes[outcome] = (row.outcomes[outcome] ?? 0) + 1;
    if ((completeRunsByRun.get(runId) ?? 0) > 1) row.turnsWithRetry += 1;
  }

  return {
    window: {
      from: oldest === undefined ? undefined : new Date(oldest).toISOString(),
      to: newest === undefined ? undefined : new Date(newest).toISOString(),
      turns,
    },
    outcomes,
    latencyMs: {
      completion: { p50: percentile(completions, 0.5), p90: percentile(completions, 0.9), max: completions[completions.length - 1] },
      firstDelta: { p50: percentile(firstDeltas, 0.5), p90: percentile(firstDeltas, 0.9), max: firstDeltas[firstDeltas.length - 1] },
    },
    completeRun: {
      turnsWithRetry: [...completeRunsByRun.values()].filter((count) => count > 1).length,
      denialsByCode,
    },
    capabilities,
    callDenialsByCode,
    attempts,
    budget,
    profiles,
  };
}
