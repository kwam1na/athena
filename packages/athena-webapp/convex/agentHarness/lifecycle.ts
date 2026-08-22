/**
 * Agent harness lifecycle kernel: run, attempt, call, and budget state.
 *
 * Authority boundary: this module is the only writer of harness execution
 * state. Every transition is evaluated against the pure tables in
 * `shared/agentHarness/execution.ts` inside one Convex transaction, keyed by
 * an idempotency key so retries and concurrent completions converge on one
 * terminal outcome. Budgets reserve before work and settle afterward; no
 * retry or attempt receives a fresh run budget. Every dispatch, result
 * release, and completion is fenced by the durable compatibility epoch. The
 * module never invokes a provider, runtime adapter, or product domain; it only
 * records what those layers did.
 */
import { v } from "convex/values";

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import {
  AGENT_CALL_SOURCE_REF_CAP,
  AGENT_RUN_EVIDENCE_BYTE_CEILING,
  AGENT_CAPABILITY_CALL_STATUSES,
  AGENT_CAPABILITY_CALL_TRANSITIONS,
  AGENT_PROGRAM_ATTEMPT_STATUSES,
  AGENT_PROGRAM_ATTEMPT_TRANSITIONS,
  AGENT_RUN_ACTIVE_STATUSES,
  AGENT_RUN_TRANSITIONS,
  addBudget,
  budgetVector,
  computeContentDigest,
  denial,
  evaluateBudgetReservation,
  evaluateCompatibilityEpochFence,
  evaluateEvidencePayloadSize,
  evaluateTransition,
  exceedsBudget,
  isBindingStepAtOrBeyond,
  isTerminalAttemptStatus,
  isTerminalCallStatus,
  isTerminalRunStatus,
  measureJsonByteLength,
  retentionExpiresAt,
  settleBudgetReservation,
  subtractBudget,
  type AgentCallSettlementOutcome,
  type AgentCapabilityCallStatus,
  type AgentHarnessDenial,
  type AgentProgramAttemptStatus,
  type AgentRunStatus,
  type BudgetVector,
  type CompatibilityEpochFence,
} from "../../shared/agentHarness/execution";
import {
  agentBudgetPolicyValidator,
  agentBudgetVectorValidator,
} from "../schemas/agentHarness";
import {
  intelligenceErrorValidator,
  intelligencePrincipalKindValidator,
  intelligenceSourceRefValidator,
  intelligenceVisibilityModeValidator,
} from "../schemas/intelligence";

export const AGENT_COMPATIBILITY_EPOCH_SCOPE = "global";
export const AGENT_ATTEMPT_LEASE_MS = 60_000;
export const AGENT_CITATION_CAP = 200;
/** Children per run are bounded by the budget policy; clamps page by this. */
export const AGENT_RUN_CHILD_CLAMP_BATCH = 200;
const DEFAULT_REPAIR_LIMIT = 50;
const MAX_REPAIR_LIMIT = 200;

type SourceRef = Doc<"agentCapabilityCall">["sourceRefs"][number];
type IntelligenceError = NonNullable<Doc<"intelligenceRun">["error"]>;
type ReadCtx = QueryCtx | MutationCtx;

// ---------------------------------------------------------------------------
// Compatibility epoch
// ---------------------------------------------------------------------------

export async function getCurrentCompatibilityEpochWithCtx(
  ctx: ReadCtx,
): Promise<{ epoch: number; digest: string }> {
  const row = await ctx.db
    .query("agentCompatibilityEpoch")
    .withIndex("by_scopeKey", (q) => q.eq("scopeKey", AGENT_COMPATIBILITY_EPOCH_SCOPE))
    .unique();
  return row ? { epoch: row.epoch, digest: row.digest } : { epoch: 0, digest: "" };
}

export type EpochAdvanceResult =
  | { outcome: "advanced"; epoch: number; digest: string }
  | { outcome: "already_applied"; epoch: number; digest: string }
  | { outcome: "rejected"; epoch: number; digest: string; reason: "epoch_not_monotonic" };

/**
 * Advance the durable epoch. Monotonic: a replay of the same idempotency key
 * is a no-op; an epoch at or below the current one is rejected. Old-epoch
 * runs are fenced the moment this commits; `repairFencedRunsWithCtx` later
 * terminalizes them without delaying the deploy.
 */
export async function advanceCompatibilityEpochWithCtx(
  ctx: MutationCtx,
  input: { epoch: number; digest: string; idempotencyKey: string; reason?: string; now: number },
): Promise<EpochAdvanceResult> {
  const row = await ctx.db
    .query("agentCompatibilityEpoch")
    .withIndex("by_scopeKey", (q) => q.eq("scopeKey", AGENT_COMPATIBILITY_EPOCH_SCOPE))
    .unique();
  if (row?.idempotencyKey === input.idempotencyKey) {
    return { outcome: "already_applied", epoch: row.epoch, digest: row.digest };
  }
  const current = row?.epoch ?? 0;
  if (input.epoch <= current) {
    return {
      outcome: "rejected",
      epoch: current,
      digest: row?.digest ?? "",
      reason: "epoch_not_monotonic",
    };
  }
  if (row) {
    await ctx.db.patch("agentCompatibilityEpoch", row._id, {
      epoch: input.epoch,
      digest: input.digest,
      idempotencyKey: input.idempotencyKey,
      reason: input.reason,
      advancedAt: input.now,
    });
  } else {
    await ctx.db.insert("agentCompatibilityEpoch", {
      scopeKey: AGENT_COMPATIBILITY_EPOCH_SCOPE,
      epoch: input.epoch,
      digest: input.digest,
      idempotencyKey: input.idempotencyKey,
      reason: input.reason,
      advancedAt: input.now,
    });
  }
  return { outcome: "advanced", epoch: input.epoch, digest: input.digest };
}

export async function checkRunEpochFenceWithCtx(
  ctx: ReadCtx,
  run: Pick<Doc<"intelligenceRun">, "compatibilityEpoch">,
): Promise<CompatibilityEpochFence> {
  const current = await getCurrentCompatibilityEpochWithCtx(ctx);
  return evaluateCompatibilityEpochFence({
    runEpoch: run.compatibilityEpoch ?? 0,
    currentEpoch: current.epoch,
  });
}

function fenceDenial(fence: Extract<CompatibilityEpochFence, { fenced: true }>): AgentHarnessDenial {
  return denial("compatibility_epoch_fenced", "This run belongs to an older release and can no longer proceed.", {
    detail: { runEpoch: fence.runEpoch, currentEpoch: fence.currentEpoch },
  });
}

/** Bounded repair: cancel active runs pinned to an older epoch. */
export async function repairFencedRunsWithCtx(
  ctx: MutationCtx,
  input: { now: number; limit?: number },
): Promise<{ canceled: number; hasMore: boolean }> {
  const limit = Math.min(MAX_REPAIR_LIMIT, Math.max(1, input.limit ?? DEFAULT_REPAIR_LIMIT));
  const current = await getCurrentCompatibilityEpochWithCtx(ctx);
  let canceled = 0;
  let hasMore = false;
  for (const status of AGENT_RUN_ACTIVE_STATUSES) {
    const remaining = limit - canceled;
    if (remaining <= 0) {
      hasMore = true;
      break;
    }
    // `gte(0)` excludes legacy runs that carry no epoch (non-agent runs).
    const runs = await ctx.db
      .query("intelligenceRun")
      .withIndex("by_status_compatibilityEpoch", (q) =>
        q.eq("status", status).gte("compatibilityEpoch", 0).lt("compatibilityEpoch", current.epoch),
      )
      .take(remaining);
    for (const run of runs) {
      const result = await transitionAgentRunWithCtx(ctx, {
        runId: run._id,
        to: "canceled",
        idempotencyKey: `epoch-fence:${current.epoch}`,
        now: input.now,
        error: {
          code: "compatibility_epoch_fenced",
          message: "This run belonged to an older release and was closed.",
          retryable: true,
        },
      });
      if (result.outcome === "advanced") canceled += 1;
    }
    if (runs.length === remaining) hasMore = true;
  }
  return { canceled, hasMore };
}

export const advanceCompatibilityEpoch = internalMutation({
  args: {
    epoch: v.number(),
    digest: v.string(),
    idempotencyKey: v.string(),
    reason: v.optional(v.string()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const result = await advanceCompatibilityEpochWithCtx(ctx, {
      ...args,
      now: args.now ?? Date.now(),
    });
    if (result.outcome === "advanced") {
      await ctx.scheduler.runAfter(0, internal.agentHarness.lifecycle.repairFencedRuns, {});
    }
    return result;
  },
});

export const repairFencedRuns = internalMutation({
  args: { now: v.optional(v.number()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const result = await repairFencedRunsWithCtx(ctx, { now, limit: args.limit });
    if (result.hasMore) {
      await ctx.scheduler.runAfter(0, internal.agentHarness.lifecycle.repairFencedRuns, {
        limit: args.limit,
      });
    }
    return result;
  },
});

// ---------------------------------------------------------------------------
// Run creation
// ---------------------------------------------------------------------------

export type CreateAgentRunInput = {
  storeId: Id<"store">;
  organizationId: Id<"organization">;
  principalKind: Doc<"intelligenceRun">["principalKind"];
  actorRef: string;
  policyRef?: string;
  visibilityMode: Doc<"intelligenceRun">["visibilityMode"];
  profileKey: string;
  profileVersion: string;
  packageKeys: string[];
  grantDigest: string;
  registryDigest: string;
  compatibilityDigest: string;
  adapterKind: string;
  adapterVersion: string;
  budgetPolicy: Doc<"agentRunGrant">["budgetPolicy"];
  egressClass: string;
  promptPayloadHash: string;
  runIdempotencyKey: string;
  now: number;
  /** Delegated-admission provenance; pinned immutably on the grant. */
  delegation?: Doc<"agentRunGrant">["delegation"];
};

export function agentRunCapability(profileKey: string) {
  return `agent:${profileKey}`;
}

/**
 * Create the business run plus its immutable grant and budget ledger in one
 * transaction. The run starts at `context_captured`: the grant IS the captured
 * context. The caller (turn binding) attaches the prompt payload afterwards.
 */
export async function createAgentRunWithCtx(
  ctx: MutationCtx,
  input: CreateAgentRunInput,
): Promise<{
  runId: Id<"intelligenceRun">;
  grantId: Id<"agentRunGrant">;
  ledgerId: Id<"agentBudgetLedger">;
  compatibilityEpoch: number;
}> {
  const epoch = await getCurrentCompatibilityEpochWithCtx(ctx);
  const contextHash = `${input.grantDigest}:${input.promptPayloadHash}`;
  const runId = await ctx.db.insert("intelligenceRun", {
    storeId: input.storeId,
    organizationId: input.organizationId,
    capability: agentRunCapability(input.profileKey),
    providerKey: input.adapterKind,
    providerModel: undefined,
    idempotencyKey: input.runIdempotencyKey,
    status: "context_captured",
    trigger: "operator",
    principalKind: input.principalKind,
    actorRef: input.actorRef,
    policyRef: input.policyRef,
    visibilityMode: input.visibilityMode,
    sourceRefs: [],
    snapshotHash: contextHash,
    attemptCount: 1,
    createdAt: input.now,
    updatedAt: input.now,
    harnessKind: "agent",
    compatibilityEpoch: epoch.epoch,
  });
  const grantId = await ctx.db.insert("agentRunGrant", {
    runId,
    storeId: input.storeId,
    organizationId: input.organizationId,
    initiatingPrincipalKind: input.principalKind,
    initiatingActorRef: input.actorRef,
    grantKind: "agent_delegation",
    profileKey: input.profileKey,
    profileVersion: input.profileVersion,
    packageKeys: input.packageKeys,
    grantDigest: input.grantDigest,
    registryDigest: input.registryDigest,
    compatibilityEpoch: epoch.epoch,
    compatibilityDigest: input.compatibilityDigest,
    adapterKind: input.adapterKind,
    adapterVersion: input.adapterVersion,
    budgetPolicy: input.budgetPolicy,
    egressClass: input.egressClass,
    promptPayloadHash: input.promptPayloadHash,
    promptPayloadState: "stored",
    lifecycle: "retained",
    createdAt: input.now,
    delegation: input.delegation,
  });
  const runLimits = budgetVector(input.budgetPolicy.runLimits);
  const ledgerId = await ctx.db.insert("agentBudgetLedger", {
    runId,
    storeId: input.storeId,
    organizationId: input.organizationId,
    // The run-wide evidence ceiling (V26-1264) is enforced by this counter,
    // whatever the profile policy declares.
    limits: { ...runLimits, bytes: Math.min(runLimits.bytes, AGENT_RUN_EVIDENCE_BYTE_CEILING) },
    attemptLimits: input.budgetPolicy.attemptLimits
      ? budgetVector(input.budgetPolicy.attemptLimits)
      : undefined,
    maxAttempts: input.budgetPolicy.maxAttempts,
    charged: budgetVector({}),
    outstanding: budgetVector({}),
    overrun: budgetVector({}),
    attemptCount: 0,
    reservationCount: 0,
    settledCount: 0,
    createdAt: input.now,
    updatedAt: input.now,
  });
  await ctx.db.patch("intelligenceRun", runId, { runGrantId: grantId });
  return { runId, grantId, ledgerId, compatibilityEpoch: epoch.epoch };
}

// ---------------------------------------------------------------------------
// Run transitions
// ---------------------------------------------------------------------------

export type AgentRunTransitionResult =
  | { outcome: "advanced"; status: AgentRunStatus }
  | { outcome: "already_in_state"; status: AgentRunStatus }
  | {
      outcome: "already_terminal";
      status: AgentRunStatus;
      artifactId?: Id<"intelligenceArtifact">;
      terminalIdempotencyKey?: string;
    }
  | { outcome: "rejected"; status: AgentRunStatus | null; denial: AgentHarnessDenial };

function terminalResult(run: Doc<"intelligenceRun">): AgentRunTransitionResult {
  return {
    outcome: "already_terminal",
    status: run.status,
    artifactId: run.artifactId,
    terminalIdempotencyKey: run.terminalIdempotencyKey,
  };
}

/**
 * Compare-and-set run transition. Terminal transitions are monotonic and
 * idempotent: once terminal, every later request reports `already_terminal`
 * and nothing is rewritten. Moving into a terminal state clamps every
 * non-terminal child (attempts, calls, reservations, binding) in the same
 * transaction so late work cannot change business truth.
 */
export async function transitionAgentRunWithCtx(
  ctx: MutationCtx,
  input: {
    runId: Id<"intelligenceRun">;
    to: AgentRunStatus;
    idempotencyKey: string;
    now: number;
    error?: IntelligenceError;
    artifactId?: Id<"intelligenceArtifact">;
    abandonReason?: string;
  },
): Promise<AgentRunTransitionResult> {
  const run = await ctx.db.get("intelligenceRun", input.runId);
  if (!run) {
    return { outcome: "rejected", status: null, denial: denial("run_not_found", "The run does not exist.") };
  }
  const evaluation = evaluateTransition(AGENT_RUN_TRANSITIONS, run.status, input.to);
  if (evaluation.kind === "already_in_state") {
    return { outcome: "already_in_state", status: run.status };
  }
  if (evaluation.kind === "rejected") {
    if (evaluation.reason === "terminal_state") return terminalResult(run);
    const code = input.to === "completed" && run.status !== "running" ? "run_not_running" : "illegal_transition";
    return {
      outcome: "rejected",
      status: run.status,
      denial: denial(code, `The run cannot move from ${run.status} to ${input.to}.`),
    };
  }

  const terminal = isTerminalRunStatus(input.to);
  await ctx.db.patch("intelligenceRun", run._id, {
    status: input.to,
    updatedAt: input.now,
    ...(input.error ? { error: input.error } : {}),
    ...(input.artifactId ? { artifactId: input.artifactId } : {}),
    ...(terminal
      ? { completedAt: input.now, terminalIdempotencyKey: input.idempotencyKey }
      : {}),
  });
  if (terminal) {
    await clampRunChildrenWithCtx(ctx, run, {
      now: input.now,
      terminalStatus: input.to,
      abandonReason: input.abandonReason ?? `run_${input.to}`,
    });
  }
  return { outcome: "advanced", status: input.to };
}

export async function markAgentRunRunningWithCtx(
  ctx: MutationCtx,
  input: { runId: Id<"intelligenceRun">; now: number },
): Promise<AgentRunTransitionResult> {
  return transitionAgentRunWithCtx(ctx, {
    runId: input.runId,
    to: "running",
    idempotencyKey: "running",
    now: input.now,
  });
}

export async function cancelAgentRunWithCtx(
  ctx: MutationCtx,
  input: { runId: Id<"intelligenceRun">; idempotencyKey: string; reason: string; now: number },
): Promise<AgentRunTransitionResult> {
  return transitionAgentRunWithCtx(ctx, {
    runId: input.runId,
    to: "canceled",
    idempotencyKey: input.idempotencyKey,
    now: input.now,
    error: { code: "canceled", message: "The run was canceled.", diagnostic: input.reason, retryable: false },
    abandonReason: input.reason,
  });
}

export async function failAgentRunWithCtx(
  ctx: MutationCtx,
  input: { runId: Id<"intelligenceRun">; idempotencyKey: string; error: IntelligenceError; now: number },
): Promise<AgentRunTransitionResult> {
  return transitionAgentRunWithCtx(ctx, {
    runId: input.runId,
    to: "failed",
    idempotencyKey: input.idempotencyKey,
    now: input.now,
    error: input.error,
    abandonReason: input.error.code,
  });
}

/**
 * Clamp every non-terminal child of a run that just became terminal. Calls
 * and attempts are canceled; outstanding reservations settle conservatively
 * (the reservation is charged, never refunded); the turn binding is
 * abandoned unless completion already committed it.
 */
async function clampRunChildrenWithCtx(
  ctx: MutationCtx,
  run: Doc<"intelligenceRun">,
  input: { now: number; terminalStatus: AgentRunStatus; abandonReason: string },
) {
  for (const status of AGENT_PROGRAM_ATTEMPT_STATUSES) {
    if (isTerminalAttemptStatus(status)) continue;
    const attempts = await ctx.db
      .query("agentProgramAttempt")
      .withIndex("by_runId_status", (q) => q.eq("runId", run._id).eq("status", status))
      .take(AGENT_RUN_CHILD_CLAMP_BATCH);
    for (const attempt of attempts) {
      await terminalizeAttemptWithCtx(ctx, attempt, {
        to: "canceled",
        now: input.now,
        error: { code: `run_${input.terminalStatus}`, message: "The run ended before this attempt finished.", retryable: false },
        settlementOutcome: "canceled",
      });
    }
  }
  await clampCallsWithCtx(ctx, { scope: { runId: run._id }, now: input.now, settlementOutcome: "canceled", error: { code: `run_${input.terminalStatus}`, message: "The run ended before this call finished.", retryable: false } });
  if (run.turnBindingId) {
    const binding = await ctx.db.get("agentTurnBinding", run.turnBindingId);
    if (binding && !binding.abandonedAt && !isBindingStepAtOrBeyond(binding.step, "athena_committed")) {
      await ctx.db.patch("agentTurnBinding", binding._id, {
        abandonedAt: input.now,
        abandonReason: input.abandonReason,
        updatedAt: input.now,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Budget ledger helpers
// ---------------------------------------------------------------------------

export async function getBudgetLedgerForRun(
  ctx: ReadCtx,
  runId: Id<"intelligenceRun">,
): Promise<Doc<"agentBudgetLedger"> | null> {
  return ctx.db
    .query("agentBudgetLedger")
    .withIndex("by_runId", (q) => q.eq("runId", runId))
    .unique();
}

async function requireLedger(ctx: MutationCtx, runId: Id<"intelligenceRun">) {
  const ledger = await getBudgetLedgerForRun(ctx, runId);
  if (!ledger) throw new Error("Agent run budget ledger is missing");
  return ledger;
}

/**
 * Settle one outstanding reservation exactly once. Idempotent: a reservation
 * already settled is returned untouched.
 */
async function settleReservationWithCtx(
  ctx: MutationCtx,
  reservation: Doc<"agentBudgetReservation">,
  input: { outcome: AgentCallSettlementOutcome; actual?: Partial<BudgetVector>; now: number },
) {
  if (reservation.status === "settled") {
    return {
      settled: false as const,
      charged: reservation.charged ?? budgetVector({}),
    };
  }
  const settlement = settleBudgetReservation({
    reserved: reservation.reserved,
    outcome: input.outcome,
    actual: input.actual,
  });
  const ledger = await requireLedger(ctx, reservation.runId);
  await ctx.db.patch("agentBudgetLedger", ledger._id, {
    outstanding: subtractBudget(ledger.outstanding, reservation.reserved),
    charged: addBudget(ledger.charged, settlement.charged),
    overrun: addBudget(ledger.overrun, settlement.overrun),
    settledCount: ledger.settledCount + 1,
    updatedAt: input.now,
  });
  await ctx.db.patch("agentBudgetReservation", reservation._id, {
    status: "settled",
    outcome: input.outcome,
    charged: settlement.charged,
    refunded: settlement.refunded,
    overrun: settlement.overrun,
    conservative: settlement.conservative,
    settledAt: input.now,
  });
  const attempt = await ctx.db.get("agentProgramAttempt", reservation.attemptId);
  if (attempt) {
    await ctx.db.patch("agentProgramAttempt", attempt._id, {
      charged: addBudget(attempt.charged, settlement.charged),
      updatedAt: input.now,
    });
  }
  return { settled: true as const, charged: settlement.charged, settlement };
}

// ---------------------------------------------------------------------------
// Program attempts
// ---------------------------------------------------------------------------

export type BeginAttemptResult =
  | { outcome: "created"; attemptId: Id<"agentProgramAttempt">; sequence: number }
  | { outcome: "resumed"; attemptId: Id<"agentProgramAttempt">; sequence: number; status: AgentProgramAttemptStatus }
  | { outcome: "denied"; denial: AgentHarnessDenial };

async function storeReplayPayloadWithCtx(
  ctx: MutationCtx,
  input: {
    run: Pick<Doc<"intelligenceRun">, "_id"> & { storeId: Id<"store">; organizationId: Id<"organization"> };
    attemptId?: Id<"agentProgramAttempt">;
    callId?: Id<"agentCapabilityCall">;
    subjectKind: Doc<"agentReplayPayload">["subjectKind"];
    content: unknown;
    contentHash?: string;
    now: number;
  },
): Promise<
  | { stored: true; payloadId: Id<"agentReplayPayload">; contentHash: string; byteLength: number }
  | { stored: false; reason: "evidence_payload_exceeds_ceiling"; contentHash: string; byteLength: number }
> {
  const byteLength = measureJsonByteLength(input.content);
  const contentHash = input.contentHash ?? computeContentDigest(input.content);
  const size = evaluateEvidencePayloadSize(byteLength);
  if (!size.withinCeiling) {
    return { stored: false, reason: "evidence_payload_exceeds_ceiling", contentHash, byteLength };
  }
  const payloadId = await ctx.db.insert("agentReplayPayload", {
    runId: input.run._id,
    attemptId: input.attemptId,
    callId: input.callId,
    storeId: input.run.storeId,
    organizationId: input.run.organizationId,
    subjectKind: input.subjectKind,
    contentHash,
    content: input.content,
    byteLength,
    retentionClass: "short_lived",
    expiresAt: retentionExpiresAt("short_lived", input.now),
    createdAt: input.now,
  });
  return { stored: true, payloadId, contentHash, byteLength };
}

function requireScopedRun(
  run: Doc<"intelligenceRun">,
): (Doc<"intelligenceRun"> & { storeId: Id<"store">; organizationId: Id<"organization"> }) | null {
  if (!run.storeId || !run.organizationId) return null;
  return run as Doc<"intelligenceRun"> & { storeId: Id<"store">; organizationId: Id<"organization"> };
}

async function admitRunForWork(
  ctx: MutationCtx,
  runId: Id<"intelligenceRun">,
): Promise<
  | { ok: true; run: Doc<"intelligenceRun"> & { storeId: Id<"store">; organizationId: Id<"organization"> } }
  | { ok: false; denial: AgentHarnessDenial }
> {
  const run = await ctx.db.get("intelligenceRun", runId);
  if (!run) return { ok: false, denial: denial("run_not_found", "The run does not exist.") };
  if (isTerminalRunStatus(run.status)) {
    return { ok: false, denial: denial("run_terminal", "The run has already ended.", { detail: { status: run.status } }) };
  }
  if (run.status !== "running") {
    return { ok: false, denial: denial("run_not_running", "The run is not running yet.", { detail: { status: run.status } }) };
  }
  const fence = await checkRunEpochFenceWithCtx(ctx, run);
  if (fence.fenced) return { ok: false, denial: fenceDenial(fence) };
  const scoped = requireScopedRun(run);
  if (!scoped) return { ok: false, denial: denial("scope_required", "Agent runs must be store and organization scoped.") };
  return { ok: true, run: scoped };
}

/**
 * Begin (or resume) a program attempt. Compile/validation diagnostics still
 * count toward `maxAttempts`, but consume no read budget. The attempt pins
 * the run's epoch; the source is stored short-lived and promoted only if the
 * attempt is finally cited.
 */
export async function beginProgramAttemptWithCtx(
  ctx: MutationCtx,
  input: {
    runId: Id<"intelligenceRun">;
    attemptIdempotencyKey: string;
    programSource: string;
    programSourceHash?: string;
    /**
     * Executor additions (V26-1264): the exact validated/stripped source the
     * sandbox will execute and the facade it was validated against. Stored in
     * the same short-lived `program_source` payload as the authored text so a
     * cited attempt promotes both; the hash of the validated text is pinned on
     * the attempt row.
     */
    validatedSource?: string;
    validatedSourceHash?: string;
    facade?: unknown;
    now: number;
  },
): Promise<BeginAttemptResult> {
  const admitted = await admitRunForWork(ctx, input.runId);
  if (!admitted.ok) return { outcome: "denied", denial: admitted.denial };
  const run = admitted.run;

  const existing = await ctx.db
    .query("agentProgramAttempt")
    .withIndex("by_runId_attemptIdempotencyKey", (q) =>
      q.eq("runId", run._id).eq("attemptIdempotencyKey", input.attemptIdempotencyKey),
    )
    .unique();
  if (existing) {
    return { outcome: "resumed", attemptId: existing._id, sequence: existing.sequence, status: existing.status };
  }

  const ledger = await requireLedger(ctx, run._id);
  if (ledger.attemptCount >= ledger.maxAttempts) {
    return {
      outcome: "denied",
      denial: denial("attempt_cap_exceeded", "This run has used all of its program attempts.", {
        detail: { attemptCount: ledger.attemptCount, maxAttempts: ledger.maxAttempts },
      }),
    };
  }

  const sequence = ledger.attemptCount + 1;
  const sourceHash = input.programSourceHash ?? computeContentDigest(input.programSource);
  const attemptId = await ctx.db.insert("agentProgramAttempt", {
    runId: run._id,
    storeId: run.storeId,
    organizationId: run.organizationId,
    attemptIdempotencyKey: input.attemptIdempotencyKey,
    sequence,
    status: "submitted",
    compatibilityEpoch: run.compatibilityEpoch ?? 0,
    programSourceHash: sourceHash,
    programSourceByteLength: measureJsonByteLength(input.programSource),
    charged: budgetVector({}),
    cited: false,
    createdAt: input.now,
    updatedAt: input.now,
    ...(input.validatedSourceHash ? { validatedSourceHash: input.validatedSourceHash } : {}),
  });
  const stored = await storeReplayPayloadWithCtx(ctx, {
    run,
    attemptId,
    subjectKind: "program_source",
    content:
      input.validatedSource === undefined
        ? input.programSource
        : { authored: input.programSource, validated: input.validatedSource, facade: input.facade ?? null },
    contentHash: sourceHash,
    now: input.now,
  });
  if (stored.stored) {
    await ctx.db.patch("agentProgramAttempt", attemptId, { sourcePayloadId: stored.payloadId });
  }
  await ctx.db.patch("agentBudgetLedger", ledger._id, {
    attemptCount: sequence,
    updatedAt: input.now,
  });
  return { outcome: "created", attemptId, sequence };
}

export type AttemptTransitionResult =
  | { outcome: "advanced"; status: AgentProgramAttemptStatus }
  | { outcome: "already_in_state"; status: AgentProgramAttemptStatus }
  | { outcome: "already_terminal"; status: AgentProgramAttemptStatus }
  | { outcome: "rejected"; status: AgentProgramAttemptStatus | null; denial: AgentHarnessDenial };

async function terminalizeAttemptWithCtx(
  ctx: MutationCtx,
  attempt: Doc<"agentProgramAttempt">,
  input: {
    to: Extract<AgentProgramAttemptStatus, "rejected" | "failed" | "canceled">;
    now: number;
    error: IntelligenceError;
    settlementOutcome: AgentCallSettlementOutcome;
  },
) {
  await ctx.db.patch("agentProgramAttempt", attempt._id, {
    status: input.to,
    error: input.error,
    leaseExpiresAt: undefined,
    terminalAt: input.now,
    updatedAt: input.now,
  });
  await clampCallsWithCtx(ctx, {
    scope: { attemptId: attempt._id },
    now: input.now,
    settlementOutcome: input.settlementOutcome,
    error: input.error,
  });
}

/** Cancel non-terminal calls and settle their reservations conservatively. */
async function clampCallsWithCtx(
  ctx: MutationCtx,
  input: {
    scope: { runId: Id<"intelligenceRun"> } | { attemptId: Id<"agentProgramAttempt"> };
    now: number;
    settlementOutcome: AgentCallSettlementOutcome;
    error: IntelligenceError;
  },
) {
  for (const status of AGENT_CAPABILITY_CALL_STATUSES) {
    if (isTerminalCallStatus(status)) continue;
    const calls =
      "runId" in input.scope
        ? await ctx.db
            .query("agentCapabilityCall")
            .withIndex("by_runId_status", (q) => q.eq("runId", (input.scope as { runId: Id<"intelligenceRun"> }).runId).eq("status", status))
            .take(AGENT_RUN_CHILD_CLAMP_BATCH)
        : await ctx.db
            .query("agentCapabilityCall")
            .withIndex("by_attemptId_status", (q) => q.eq("attemptId", (input.scope as { attemptId: Id<"agentProgramAttempt"> }).attemptId).eq("status", status))
            .take(AGENT_RUN_CHILD_CLAMP_BATCH);
    for (const call of calls) {
      let charged = call.charged;
      if (call.reservationId) {
        const reservation = await ctx.db.get("agentBudgetReservation", call.reservationId);
        if (reservation) {
          const settled = await settleReservationWithCtx(ctx, reservation, {
            outcome: input.settlementOutcome,
            now: input.now,
          });
          charged = settled.charged;
        }
      }
      await ctx.db.patch("agentCapabilityCall", call._id, {
        status: "canceled",
        charged,
        error: input.error,
        terminalAt: input.now,
        updatedAt: input.now,
      });
    }
  }
  // Reservations without a call row (should not happen) still settle.
  const reservations =
    "runId" in input.scope
      ? await ctx.db
          .query("agentBudgetReservation")
          .withIndex("by_runId_status", (q) => q.eq("runId", (input.scope as { runId: Id<"intelligenceRun"> }).runId).eq("status", "reserved"))
          .take(AGENT_RUN_CHILD_CLAMP_BATCH)
      : await ctx.db
          .query("agentBudgetReservation")
          .withIndex("by_attemptId_status", (q) => q.eq("attemptId", (input.scope as { attemptId: Id<"agentProgramAttempt"> }).attemptId).eq("status", "reserved"))
          .take(AGENT_RUN_CHILD_CLAMP_BATCH);
  for (const reservation of reservations) {
    await settleReservationWithCtx(ctx, reservation, { outcome: input.settlementOutcome, now: input.now });
  }
}

/**
 * Attempt transition with the same compare-and-set semantics as runs.
 * `executing` takes a lease; `result_produced` records exactly one result
 * hash (and its short-lived payload); any terminal failure clamps the
 * attempt's calls and settles their reservations conservatively.
 */
export async function transitionProgramAttemptWithCtx(
  ctx: MutationCtx,
  input: {
    attemptId: Id<"agentProgramAttempt">;
    to: AgentProgramAttemptStatus;
    now: number;
    leaseMs?: number;
    error?: IntelligenceError;
    result?: { resultHash: string; payload?: unknown };
  },
): Promise<AttemptTransitionResult> {
  const attempt = await ctx.db.get("agentProgramAttempt", input.attemptId);
  if (!attempt) {
    return { outcome: "rejected", status: null, denial: denial("attempt_not_found", "The program attempt does not exist.") };
  }
  const evaluation = evaluateTransition(AGENT_PROGRAM_ATTEMPT_TRANSITIONS, attempt.status, input.to);
  if (evaluation.kind === "already_in_state") return { outcome: "already_in_state", status: attempt.status };
  if (evaluation.kind === "rejected") {
    if (evaluation.reason === "terminal_state") return { outcome: "already_terminal", status: attempt.status };
    return {
      outcome: "rejected",
      status: attempt.status,
      denial: denial("illegal_transition", `The attempt cannot move from ${attempt.status} to ${input.to}.`),
    };
  }

  switch (input.to) {
    case "validating":
      await ctx.db.patch("agentProgramAttempt", attempt._id, { status: "validating", updatedAt: input.now });
      break;
    case "executing": {
      const run = await ctx.db.get("intelligenceRun", attempt.runId);
      if (!run || run.status !== "running") {
        return { outcome: "rejected", status: attempt.status, denial: denial("run_not_running", "The run is not running.") };
      }
      const fence = await checkRunEpochFenceWithCtx(ctx, run);
      if (fence.fenced) return { outcome: "rejected", status: attempt.status, denial: fenceDenial(fence) };
      await ctx.db.patch("agentProgramAttempt", attempt._id, {
        status: "executing",
        startedAt: attempt.startedAt ?? input.now,
        leaseExpiresAt: input.now + (input.leaseMs ?? AGENT_ATTEMPT_LEASE_MS),
        updatedAt: input.now,
      });
      break;
    }
    case "result_produced": {
      if (!input.result) {
        return { outcome: "rejected", status: attempt.status, denial: denial("illegal_transition", "A produced result needs a result hash.") };
      }
      const run = await ctx.db.get("intelligenceRun", attempt.runId);
      const scoped = run ? requireScopedRun(run) : null;
      let resultPayloadId: Id<"agentReplayPayload"> | undefined;
      if (scoped && input.result.payload !== undefined) {
        const stored = await storeReplayPayloadWithCtx(ctx, {
          run: scoped,
          attemptId: attempt._id,
          subjectKind: "program_result",
          content: input.result.payload,
          contentHash: input.result.resultHash,
          now: input.now,
        });
        if (stored.stored) resultPayloadId = stored.payloadId;
      }
      await ctx.db.patch("agentProgramAttempt", attempt._id, {
        status: "result_produced",
        resultHash: input.result.resultHash,
        resultPayloadId,
        leaseExpiresAt: undefined,
        terminalAt: input.now,
        updatedAt: input.now,
      });
      // A produced result never leaves calls dangling: anything still open is clamped.
      await clampCallsWithCtx(ctx, {
        scope: { attemptId: attempt._id },
        now: input.now,
        settlementOutcome: "canceled",
        error: { code: "attempt_result_produced", message: "The attempt finished before this call settled.", retryable: false },
      });
      break;
    }
    case "rejected":
    case "failed":
    case "canceled":
      await terminalizeAttemptWithCtx(ctx, attempt, {
        to: input.to,
        now: input.now,
        error: input.error ?? { code: input.to, message: `The attempt was ${input.to}.`, retryable: false },
        settlementOutcome: input.to === "canceled" ? "canceled" : "failed",
      });
      break;
    default:
      return { outcome: "rejected", status: attempt.status, denial: denial("illegal_transition", "Unsupported attempt transition.") };
  }
  return { outcome: "advanced", status: input.to };
}

export async function heartbeatProgramAttemptWithCtx(
  ctx: MutationCtx,
  input: { attemptId: Id<"agentProgramAttempt">; now: number; leaseMs?: number },
): Promise<{ extended: boolean; status: AgentProgramAttemptStatus | null }> {
  const attempt = await ctx.db.get("agentProgramAttempt", input.attemptId);
  if (!attempt || attempt.status !== "executing") return { extended: false, status: attempt?.status ?? null };
  await ctx.db.patch("agentProgramAttempt", attempt._id, {
    leaseExpiresAt: input.now + (input.leaseMs ?? AGENT_ATTEMPT_LEASE_MS),
    updatedAt: input.now,
  });
  return { extended: true, status: "executing" };
}

/**
 * Stale-attempt recovery: an executing attempt whose lease expired is failed
 * (retryable) and its open calls/reservations settle conservatively. The run
 * stays running with the SAME ledger, so a retry only sees what is left.
 */
export async function recoverStaleAttemptsWithCtx(
  ctx: MutationCtx,
  input: { now: number; limit?: number },
): Promise<{ recovered: number; hasMore: boolean }> {
  const limit = Math.min(MAX_REPAIR_LIMIT, Math.max(1, input.limit ?? DEFAULT_REPAIR_LIMIT));
  const stale = await ctx.db
    .query("agentProgramAttempt")
    .withIndex("by_status_leaseExpiresAt", (q) =>
      q.eq("status", "executing").gte("leaseExpiresAt", 0).lte("leaseExpiresAt", input.now),
    )
    .take(limit);
  for (const attempt of stale) {
    await terminalizeAttemptWithCtx(ctx, attempt, {
      to: "failed",
      now: input.now,
      error: { code: "stale_execution", message: "The program attempt stopped reporting progress.", retryable: true },
      settlementOutcome: "canceled",
    });
  }
  return { recovered: stale.length, hasMore: stale.length === limit };
}

export const recoverStaleAttempts = internalMutation({
  args: { now: v.optional(v.number()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const result = await recoverStaleAttemptsWithCtx(ctx, { now, limit: args.limit });
    if (result.hasMore) {
      await ctx.scheduler.runAfter(0, internal.agentHarness.lifecycle.recoverStaleAttempts, { limit: args.limit });
    }
    return result;
  },
});

export async function listProgramAttemptsForRun(
  ctx: ReadCtx,
  runId: Id<"intelligenceRun">,
  limit = 100,
): Promise<Doc<"agentProgramAttempt">[]> {
  return ctx.db
    .query("agentProgramAttempt")
    .withIndex("by_runId_sequence", (q) => q.eq("runId", runId))
    .take(limit);
}

// ---------------------------------------------------------------------------
// Capability calls
// ---------------------------------------------------------------------------

export type AdmitCallResult =
  | { outcome: "admitted"; callId: Id<"agentCapabilityCall">; reservationId: Id<"agentBudgetReservation">; remaining: BudgetVector }
  | { outcome: "resumed"; callId: Id<"agentCapabilityCall">; reservationId?: Id<"agentBudgetReservation">; status: AgentCapabilityCallStatus }
  | { outcome: "denied"; callId?: Id<"agentCapabilityCall">; denial: AgentHarnessDenial };

/**
 * Admission reserves the declared worst case against the run ledger under the
 * invocation idempotency key. A retry with the same key resumes the existing
 * call; a denial records a `denied` call that consumed one call attempt and
 * nothing else.
 */
export async function admitCapabilityCallWithCtx(
  ctx: MutationCtx,
  input: {
    runId: Id<"intelligenceRun">;
    attemptId: Id<"agentProgramAttempt">;
    callIdempotencyKey: string;
    capabilityId: string;
    normalizedArgsHash: string;
    normalizedArgs?: Record<string, unknown>;
    requested: BudgetVector;
    now: number;
    /** Delegated-admission evidence; recorded on the call row, never result data. */
    delegation?: Doc<"agentCapabilityCall">["delegation"];
  },
): Promise<AdmitCallResult> {
  const admitted = await admitRunForWork(ctx, input.runId);
  if (!admitted.ok) return { outcome: "denied", denial: admitted.denial };
  const run = admitted.run;

  const attempt = await ctx.db.get("agentProgramAttempt", input.attemptId);
  if (!attempt) return { outcome: "denied", denial: denial("attempt_not_found", "The program attempt does not exist.") };
  if (attempt.runId !== run._id) {
    return { outcome: "denied", denial: denial("attempt_not_owned_by_run", "The attempt belongs to a different run.") };
  }
  if (attempt.status !== "executing") {
    return { outcome: "denied", denial: denial("attempt_not_executing", "Calls are only admitted while the attempt executes.", { detail: { status: attempt.status } }) };
  }

  const existing = await ctx.db
    .query("agentCapabilityCall")
    .withIndex("by_runId_callIdempotencyKey", (q) =>
      q.eq("runId", run._id).eq("callIdempotencyKey", input.callIdempotencyKey),
    )
    .unique();
  if (existing) {
    return { outcome: "resumed", callId: existing._id, reservationId: existing.reservationId, status: existing.status };
  }

  const ledger = await requireLedger(ctx, run._id);
  const requested = budgetVector(input.requested);
  const sequence = ledger.reservationCount + 1;
  const admission = evaluateBudgetReservation({
    limits: ledger.limits,
    charged: ledger.charged,
    outstanding: ledger.outstanding,
    requested,
  });
  // Per-attempt caps count outstanding reservations too (V26-1264), so two
  // concurrent calls of one attempt cannot overshoot the cap by a reservation.
  let attemptOutstanding = budgetVector({});
  if (ledger.attemptLimits) {
    const open = await ctx.db
      .query("agentBudgetReservation")
      .withIndex("by_attemptId_status", (q) => q.eq("attemptId", attempt._id).eq("status", "reserved"))
      .take(AGENT_RUN_CHILD_CLAMP_BATCH);
    for (const reservation of open) attemptOutstanding = addBudget(attemptOutstanding, reservation.reserved);
  }
  const attemptExceeded = ledger.attemptLimits
    ? exceedsBudget(ledger.attemptLimits, addBudget(addBudget(attempt.charged, attemptOutstanding), requested))
    : [];

  if (!admission.admitted || attemptExceeded.length > 0) {
    const exceeded = admission.admitted ? attemptExceeded : admission.exceeded;
    const scope = admission.admitted ? "attempt" : "run";
    const settlement = settleBudgetReservation({ reserved: requested, outcome: "denied" });
    const callDenial = denial("budget_exceeded", "This call would exceed the run budget.", {
      detail: { exceeded, scope },
    });
    const reservationId = await ctx.db.insert("agentBudgetReservation", {
      runId: run._id,
      attemptId: attempt._id,
      storeId: run.storeId,
      organizationId: run.organizationId,
      idempotencyKey: input.callIdempotencyKey,
      reserved: requested,
      status: "settled",
      outcome: "denied",
      charged: settlement.charged,
      refunded: settlement.refunded,
      overrun: settlement.overrun,
      conservative: false,
      createdAt: input.now,
      settledAt: input.now,
    });
    const callId = await ctx.db.insert("agentCapabilityCall", {
      runId: run._id,
      attemptId: attempt._id,
      storeId: run.storeId,
      organizationId: run.organizationId,
      callIdempotencyKey: input.callIdempotencyKey,
      sequence,
      capabilityId: input.capabilityId,
      status: "denied",
      normalizedArgsHash: input.normalizedArgsHash,
      normalizedArgs: input.normalizedArgs,
      reservationId,
      reserved: requested,
      charged: settlement.charged,
      sourceRefs: [],
      sourceRefCount: 0,
      denial: { code: callDenial.code, message: callDenial.message, retryable: false },
      terminalAt: input.now,
      createdAt: input.now,
      updatedAt: input.now,
      delegation: input.delegation,
    });
    await ctx.db.patch("agentBudgetReservation", reservationId, { callId });
    await ctx.db.patch("agentBudgetLedger", ledger._id, {
      charged: addBudget(ledger.charged, settlement.charged),
      reservationCount: sequence,
      settledCount: ledger.settledCount + 1,
      updatedAt: input.now,
    });
    await ctx.db.patch("agentProgramAttempt", attempt._id, {
      charged: addBudget(attempt.charged, settlement.charged),
      updatedAt: input.now,
    });
    return { outcome: "denied", callId, denial: callDenial };
  }

  const reservationId = await ctx.db.insert("agentBudgetReservation", {
    runId: run._id,
    attemptId: attempt._id,
    storeId: run.storeId,
    organizationId: run.organizationId,
    idempotencyKey: input.callIdempotencyKey,
    reserved: requested,
    status: "reserved",
    createdAt: input.now,
  });
  const callId = await ctx.db.insert("agentCapabilityCall", {
    runId: run._id,
    attemptId: attempt._id,
    storeId: run.storeId,
    organizationId: run.organizationId,
    callIdempotencyKey: input.callIdempotencyKey,
    sequence,
    capabilityId: input.capabilityId,
    status: "admitted",
    normalizedArgsHash: input.normalizedArgsHash,
    normalizedArgs: input.normalizedArgs,
    reservationId,
    reserved: requested,
    charged: budgetVector({}),
    sourceRefs: [],
    sourceRefCount: 0,
    createdAt: input.now,
    updatedAt: input.now,
    delegation: input.delegation,
  });
  await ctx.db.patch("agentBudgetReservation", reservationId, { callId });
  await ctx.db.patch("agentBudgetLedger", ledger._id, {
    outstanding: addBudget(ledger.outstanding, requested),
    reservationCount: sequence,
    updatedAt: input.now,
  });
  return { outcome: "admitted", callId, reservationId, remaining: admission.remaining };
}

export type CallTransitionResult =
  | { outcome: "advanced"; status: AgentCapabilityCallStatus }
  | { outcome: "already_in_state"; status: AgentCapabilityCallStatus }
  | { outcome: "already_terminal"; status: AgentCapabilityCallStatus }
  | { outcome: "rejected"; status: AgentCapabilityCallStatus | null; denial: AgentHarnessDenial };

export async function markCapabilityCallExecutingWithCtx(
  ctx: MutationCtx,
  input: { callId: Id<"agentCapabilityCall">; now: number },
): Promise<CallTransitionResult> {
  const call = await ctx.db.get("agentCapabilityCall", input.callId);
  if (!call) return { outcome: "rejected", status: null, denial: denial("call_not_found", "The capability call does not exist.") };
  const evaluation = evaluateTransition(AGENT_CAPABILITY_CALL_TRANSITIONS, call.status, "executing");
  if (evaluation.kind === "already_in_state") return { outcome: "already_in_state", status: call.status };
  if (evaluation.kind === "rejected") {
    if (evaluation.reason === "terminal_state") return { outcome: "already_terminal", status: call.status };
    return { outcome: "rejected", status: call.status, denial: denial("illegal_transition", `The call cannot move from ${call.status} to executing.`) };
  }
  await ctx.db.patch("agentCapabilityCall", call._id, {
    status: "executing",
    startedAt: call.startedAt ?? input.now,
    updatedAt: input.now,
  });
  return { outcome: "advanced", status: "executing" };
}

const SETTLEMENT_STATUS: Record<AgentCallSettlementOutcome, AgentCapabilityCallStatus> = {
  succeeded: "succeeded",
  partial: "partial",
  unavailable: "unavailable",
  denied: "denied",
  failed: "failed",
  timeout: "failed",
  canceled: "canceled",
};

export type SettleCallResult =
  | { outcome: "settled"; status: AgentCapabilityCallStatus; charged: BudgetVector; fenced: boolean; outputStored: boolean }
  | { outcome: "already_settled"; status: AgentCapabilityCallStatus }
  | { outcome: "rejected"; status: AgentCapabilityCallStatus | null; denial: AgentHarnessDenial };

/**
 * Result release: settle the reservation exactly once and record the
 * envelope metadata (result hash, observation time, freshness, completeness,
 * bounded source refs). Output within the evidence ceiling is kept as a
 * short-lived replay payload; larger output is omitted and recorded as such.
 * A fenced run settles conservatively as canceled and withholds the output.
 */
export async function settleCapabilityCallWithCtx(
  ctx: MutationCtx,
  input: {
    callId: Id<"agentCapabilityCall">;
    outcome: AgentCallSettlementOutcome;
    actual?: Partial<BudgetVector>;
    resultHash?: string;
    output?: unknown;
    observedAt?: number;
    capturedAt?: number;
    freshness?: string;
    completeness?: string;
    sourceRefs?: SourceRef[];
    error?: IntelligenceError;
    now: number;
    /** Delegated release evidence; replaces the admission-time record when given. */
    delegation?: Doc<"agentCapabilityCall">["delegation"];
    /** Caller-declared omission (delegated admission withholds a revoked result); the fence reason still wins. */
    outputOmittedReason?: string;
  },
): Promise<SettleCallResult> {
  const call = await ctx.db.get("agentCapabilityCall", input.callId);
  if (!call) return { outcome: "rejected", status: null, denial: denial("call_not_found", "The capability call does not exist.") };
  if (isTerminalCallStatus(call.status)) return { outcome: "already_settled", status: call.status };

  const run = await ctx.db.get("intelligenceRun", call.runId);
  const scoped = run ? requireScopedRun(run) : null;
  if (!run || !scoped) {
    return { outcome: "rejected", status: call.status, denial: denial("run_not_found", "The run does not exist.") };
  }
  const fence = await checkRunEpochFenceWithCtx(ctx, run);
  const fenced = fence.fenced;
  const outcome: AgentCallSettlementOutcome = fenced ? "canceled" : input.outcome;
  const target = SETTLEMENT_STATUS[outcome];
  const evaluation = evaluateTransition(AGENT_CAPABILITY_CALL_TRANSITIONS, call.status, target);
  if (evaluation.kind === "rejected") {
    return { outcome: "rejected", status: call.status, denial: denial("illegal_transition", `The call cannot move from ${call.status} to ${target}.`) };
  }

  let charged = call.charged;
  if (call.reservationId) {
    const reservation = await ctx.db.get("agentBudgetReservation", call.reservationId);
    if (reservation) {
      const settled = await settleReservationWithCtx(ctx, reservation, {
        outcome,
        actual: fenced ? undefined : input.actual,
        now: input.now,
      });
      charged = settled.charged;
    }
  }

  let replayPayloadId: Id<"agentReplayPayload"> | undefined;
  let outputOmittedReason: string | undefined = input.outputOmittedReason;
  if (fenced) {
    outputOmittedReason = "compatibility_epoch_fenced";
  } else if (input.output !== undefined) {
    const stored = await storeReplayPayloadWithCtx(ctx, {
      run: scoped,
      attemptId: call.attemptId,
      callId: call._id,
      subjectKind: "call_output",
      content: input.output,
      now: input.now,
    });
    if (stored.stored) replayPayloadId = stored.payloadId;
    else outputOmittedReason = stored.reason;
  }

  const sourceRefs = (input.sourceRefs ?? []).slice(0, AGENT_CALL_SOURCE_REF_CAP);
  const error: IntelligenceError | undefined = fenced
    ? { code: "compatibility_epoch_fenced", message: "The result arrived after the run was fenced.", retryable: false }
    : input.error ?? (outcome === "timeout" ? { code: "timeout", message: "The call timed out.", retryable: true } : undefined);
  await ctx.db.patch("agentCapabilityCall", call._id, {
    status: target,
    charged,
    resultHash: fenced ? undefined : input.resultHash,
    observedAt: input.observedAt,
    capturedAt: input.capturedAt ?? input.now,
    freshness: input.freshness,
    completeness: input.completeness,
    sourceRefs: fenced ? [] : sourceRefs,
    sourceRefCount: fenced ? 0 : (input.sourceRefs ?? []).length,
    replayPayloadId,
    outputOmittedReason,
    error,
    terminalAt: input.now,
    updatedAt: input.now,
    ...(input.delegation ? { delegation: input.delegation } : {}),
  });
  return { outcome: "settled", status: target, charged, fenced, outputStored: replayPayloadId !== undefined };
}

export async function listCapabilityCallsForRun(
  ctx: ReadCtx,
  runId: Id<"intelligenceRun">,
  limit = 500,
): Promise<Doc<"agentCapabilityCall">[]> {
  return ctx.db
    .query("agentCapabilityCall")
    .withIndex("by_runId_sequence", (q) => q.eq("runId", runId))
    .take(limit);
}

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

export type CompletionCitationInput = {
  citationKey: string;
  callId: Id<"agentCapabilityCall">;
  resultHash: string;
  sourceRef: SourceRef;
  claimDigest?: string;
  claimSupport?: { extractorKey: string; extractorVersion: string; slice: Record<string, unknown> };
  /** Immutable authoritative revision of the cited source (V26-1264). */
  immutableRevisionRef?: string;
};

export type CompleteAgentRunInput = {
  runId: Id<"intelligenceRun">;
  idempotencyKey: string;
  now: number;
  citedAttemptIds: Id<"agentProgramAttempt">[];
  artifact: {
    title?: string;
    summary?: string;
    payload: Record<string, unknown>;
    confidence?: number;
    limitedEvidence?: boolean;
  };
  citations: CompletionCitationInput[];
};

export type CompleteAgentRunResult =
  | { outcome: "completed"; artifactId: Id<"intelligenceArtifact">; citationBindingIds: Id<"agentCitationBinding">[] }
  | { outcome: "already_terminal"; status: AgentRunStatus; artifactId?: Id<"intelligenceArtifact"> }
  | { outcome: "rejected"; status: AgentRunStatus | null; denial: AgentHarnessDenial };

/**
 * `completeRun`: one transaction that revalidates the epoch, accepts
 * citations only from the explicit successful-attempt set of this run, mints
 * exactly one terminal artifact, promotes the cited attempts' source/result
 * to the standard class (call outputs never promote), records claim-support
 * slices, commits the turn binding (`operator_release_committed`), and
 * terminalizes the run. Replays and late calls report `already_terminal`.
 */
export async function completeAgentRunWithCtx(
  ctx: MutationCtx,
  input: CompleteAgentRunInput,
): Promise<CompleteAgentRunResult> {
  const run = await ctx.db.get("intelligenceRun", input.runId);
  if (!run) return { outcome: "rejected", status: null, denial: denial("run_not_found", "The run does not exist.") };
  if (isTerminalRunStatus(run.status)) {
    return { outcome: "already_terminal", status: run.status, artifactId: run.artifactId };
  }
  if (run.status !== "running") {
    return { outcome: "rejected", status: run.status, denial: denial("run_not_running", "The run is not running.") };
  }
  const fence = await checkRunEpochFenceWithCtx(ctx, run);
  if (fence.fenced) return { outcome: "rejected", status: run.status, denial: fenceDenial(fence) };
  const scoped = requireScopedRun(run);
  if (!scoped) return { outcome: "rejected", status: run.status, denial: denial("scope_required", "Agent runs must be store and organization scoped.") };
  if (input.citations.length > AGENT_CITATION_CAP) {
    return { outcome: "rejected", status: run.status, denial: denial("citation_not_supported", "Too many citations.", { detail: { cap: AGENT_CITATION_CAP } }) };
  }

  // Successful-attempt set: every cited attempt must belong to this run and have produced a result.
  const citedAttempts = new Map<Id<"agentProgramAttempt">, Doc<"agentProgramAttempt">>();
  for (const attemptId of input.citedAttemptIds) {
    const attempt = await ctx.db.get("agentProgramAttempt", attemptId);
    if (!attempt || attempt.runId !== run._id || attempt.status !== "result_produced") {
      return {
        outcome: "rejected",
        status: run.status,
        denial: denial("citation_not_supported", "Only attempts of this run that produced a result may be cited.", {
          detail: { attemptId: String(attemptId), status: attempt?.status ?? "missing" },
        }),
      };
    }
    citedAttempts.set(attemptId, attempt);
  }

  // Citations bind to a call of a cited attempt, with the hash of what that call actually returned.
  const citationKeys = new Set<string>();
  const resolvedCitations: Array<{ citation: CompletionCitationInput; call: Doc<"agentCapabilityCall"> }> = [];
  for (const citation of input.citations) {
    if (citationKeys.has(citation.citationKey)) {
      return { outcome: "rejected", status: run.status, denial: denial("citation_not_supported", "Duplicate citation key.", { detail: { citationKey: citation.citationKey } }) };
    }
    citationKeys.add(citation.citationKey);
    const call = await ctx.db.get("agentCapabilityCall", citation.callId);
    const supported =
      call &&
      call.runId === run._id &&
      citedAttempts.has(call.attemptId) &&
      (call.status === "succeeded" || call.status === "partial") &&
      call.resultHash !== undefined &&
      call.resultHash === citation.resultHash;
    if (!supported) {
      return {
        outcome: "rejected",
        status: run.status,
        denial: denial("citation_not_supported", "A citation must come from a successful call of a cited attempt and match its result hash.", {
          detail: { citationKey: citation.citationKey },
        }),
      };
    }
    resolvedCitations.push({ citation, call });
  }

  const grant = run.runGrantId ? await ctx.db.get("agentRunGrant", run.runGrantId) : null;
  const artifactId = await ctx.db.insert("intelligenceArtifact", {
    storeId: scoped.storeId,
    organizationId: scoped.organizationId,
    runId: run._id,
    runGrantId: run.runGrantId,
    turnBindingId: run.turnBindingId,
    capability: run.capability,
    kind: "agent_answer",
    status: "ready",
    visibilityMode: run.visibilityMode,
    sourceRefs: [],
    snapshotHash: run.snapshotHash ?? grant?.grantDigest ?? "",
    title: input.artifact.title,
    summary: input.artifact.summary,
    payload: input.artifact.payload,
    evidenceRefs: resolvedCitations.map(({ citation }) => citation.sourceRef),
    confidence: input.artifact.confidence,
    limitedEvidence: input.artifact.limitedEvidence,
    createdAt: input.now,
    updatedAt: input.now,
  });

  const standardExpiresAt = retentionExpiresAt("standard", input.now);
  for (const attempt of citedAttempts.values()) {
    await ctx.db.patch("agentProgramAttempt", attempt._id, { cited: true, updatedAt: input.now });
    for (const payloadId of [attempt.sourcePayloadId, attempt.resultPayloadId]) {
      if (!payloadId) continue;
      const payload = await ctx.db.get("agentReplayPayload", payloadId);
      if (payload && payload.retentionClass === "short_lived") {
        await ctx.db.patch("agentReplayPayload", payload._id, {
          retentionClass: "standard",
          expiresAt: standardExpiresAt,
          promotedAt: input.now,
        });
      }
    }
  }

  const citationBindingIds: Id<"agentCitationBinding">[] = [];
  for (const { citation, call } of resolvedCitations) {
    const bindingId = await ctx.db.insert("agentCitationBinding", {
      runId: run._id,
      attemptId: call.attemptId,
      callId: call._id,
      artifactId,
      storeId: scoped.storeId,
      organizationId: scoped.organizationId,
      citationKey: citation.citationKey,
      resultHash: citation.resultHash,
      claimDigest: citation.claimDigest,
      sourceRef: citation.sourceRef,
      replayPayloadId: call.replayPayloadId,
      ...(citation.immutableRevisionRef ? { immutableRevisionRef: citation.immutableRevisionRef } : {}),
      evidenceLifecycle: "retained",
      retentionClass: "standard",
      expiresAt: standardExpiresAt,
      createdAt: input.now,
    });
    if (citation.claimSupport) {
      const sliceBytes = measureJsonByteLength(citation.claimSupport.slice);
      if (evaluateEvidencePayloadSize(sliceBytes).withinCeiling) {
        const claimSupportId = await ctx.db.insert("agentClaimSupport", {
          runId: run._id,
          citationBindingId: bindingId,
          callId: call._id,
          storeId: scoped.storeId,
          organizationId: scoped.organizationId,
          extractorKey: citation.claimSupport.extractorKey,
          extractorVersion: citation.claimSupport.extractorVersion,
          slice: citation.claimSupport.slice,
          sliceHash: computeContentDigest(citation.claimSupport.slice),
          byteLength: sliceBytes,
          retentionClass: "standard",
          expiresAt: standardExpiresAt,
          createdAt: input.now,
        });
        await ctx.db.patch("agentCitationBinding", bindingId, { claimSupportId });
      }
    }
    citationBindingIds.push(bindingId);
  }

  if (run.turnBindingId) {
    const binding = await ctx.db.get("agentTurnBinding", run.turnBindingId);
    if (binding && !binding.abandonedAt && !isBindingStepAtOrBeyond(binding.step, "athena_committed")) {
      await ctx.db.patch("agentTurnBinding", binding._id, {
        step: "athena_committed",
        stepUpdatedAt: input.now,
        stepIdempotencyKey: input.idempotencyKey,
        operatorReleaseCommittedAt: input.now,
        updatedAt: input.now,
      });
    }
  }

  const transition = await transitionAgentRunWithCtx(ctx, {
    runId: run._id,
    to: "completed",
    idempotencyKey: input.idempotencyKey,
    now: input.now,
    artifactId,
  });
  if (transition.outcome !== "advanced") {
    throw new Error(`Agent run completion could not terminalize the run: ${transition.outcome}`);
  }
  return { outcome: "completed", artifactId, citationBindingIds };
}

// ---------------------------------------------------------------------------
// Internal function surface for downstream units
// ---------------------------------------------------------------------------

export const cancelAgentRun = internalMutation({
  args: {
    runId: v.id("intelligenceRun"),
    idempotencyKey: v.string(),
    reason: v.string(),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) =>
    cancelAgentRunWithCtx(ctx, { ...args, now: args.now ?? Date.now() }),
});

export const failAgentRun = internalMutation({
  args: {
    runId: v.id("intelligenceRun"),
    idempotencyKey: v.string(),
    error: intelligenceErrorValidator,
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) =>
    failAgentRunWithCtx(ctx, { ...args, now: args.now ?? Date.now() }),
});

export const createAgentRun = internalMutation({
  args: {
    storeId: v.id("store"),
    organizationId: v.id("organization"),
    principalKind: intelligencePrincipalKindValidator,
    actorRef: v.string(),
    policyRef: v.optional(v.string()),
    visibilityMode: intelligenceVisibilityModeValidator,
    profileKey: v.string(),
    profileVersion: v.string(),
    packageKeys: v.array(v.string()),
    grantDigest: v.string(),
    registryDigest: v.string(),
    compatibilityDigest: v.string(),
    adapterKind: v.string(),
    adapterVersion: v.string(),
    budgetPolicy: agentBudgetPolicyValidator,
    egressClass: v.string(),
    promptPayloadHash: v.string(),
    runIdempotencyKey: v.string(),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) =>
    createAgentRunWithCtx(ctx, { ...args, now: args.now ?? Date.now() }),
});

export const admitCapabilityCall = internalMutation({
  args: {
    runId: v.id("intelligenceRun"),
    attemptId: v.id("agentProgramAttempt"),
    callIdempotencyKey: v.string(),
    capabilityId: v.string(),
    normalizedArgsHash: v.string(),
    normalizedArgs: v.optional(v.record(v.string(), v.any())),
    requested: agentBudgetVectorValidator,
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) =>
    admitCapabilityCallWithCtx(ctx, { ...args, now: args.now ?? Date.now() }),
});

export const settleCapabilityCall = internalMutation({
  args: {
    callId: v.id("agentCapabilityCall"),
    outcome: v.union(
      v.literal("succeeded"),
      v.literal("partial"),
      v.literal("unavailable"),
      v.literal("denied"),
      v.literal("failed"),
      v.literal("timeout"),
      v.literal("canceled"),
    ),
    actual: v.optional(
      v.object({
        calls: v.optional(v.number()),
        rows: v.optional(v.number()),
        bytes: v.optional(v.number()),
        costUnits: v.optional(v.number()),
        elapsedMs: v.optional(v.number()),
      }),
    ),
    resultHash: v.optional(v.string()),
    output: v.optional(v.any()),
    observedAt: v.optional(v.number()),
    capturedAt: v.optional(v.number()),
    freshness: v.optional(v.string()),
    completeness: v.optional(v.string()),
    sourceRefs: v.optional(v.array(intelligenceSourceRefValidator)),
    error: v.optional(intelligenceErrorValidator),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) =>
    settleCapabilityCallWithCtx(ctx, { ...args, now: args.now ?? Date.now() }),
});
