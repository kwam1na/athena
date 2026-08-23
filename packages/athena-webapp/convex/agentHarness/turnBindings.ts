/**
 * Durable turn bindings: the cross-runtime ladder between an operator's
 * intent and the runtime adapter's thread/message/job mechanics.
 *
 * Authority boundary: one opaque runtime thread binds many turns; every turn
 * owns exactly one `intelligenceRun`; the binding advances one rung at a
 * time (`intent_recorded → runtime_thread_bound → runtime_input_saved →
 * scheduled → running → completion_prepared → athena_committed →
 * runtime_projected`) recording only opaque runtime references and
 * idempotency keys. Resume-on-read and the bounded sweeper retry incomplete
 * rungs but never duplicate a prompt, run, job, or artifact, and never reopen
 * a terminal run. Only `completeAgentRunWithCtx` may claim
 * `athena_committed`; projection is an outbox rung after that commit.
 *
 * The sweeper closes two kinds of stranded turn: one that never reached
 * `running` (no host ever picked it up) and one parked at `running` or
 * `completion_prepared` past the abandon window (its host died mid-turn).
 * Either way the run fails as retryable, the binding is abandoned, and the
 * turn's provider-spend reservation is released.
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
  AGENT_TURN_BINDING_STEPS,
  SHORT_LIVED_RETENTION_MS,
  bindingStepIndex,
  computeContentDigest,
  denial,
  evaluateBindingAdvance,
  evaluateEvidencePayloadSize,
  isBindingStepAtOrBeyond,
  isTerminalRunStatus,
  measureJsonByteLength,
  retentionExpiresAt,
  type AgentHarnessDenial,
  type AgentRunStatus,
  type AgentTurnBindingStep,
} from "../../shared/agentHarness/execution";
import {
  createAgentRunWithCtx,
  failAgentRunWithCtx,
  markAgentRunRunningWithCtx,
  type CreateAgentRunInput,
} from "./lifecycle";
import { settleTurnSpendOnceWithCtx } from "./runAdmission";

/** A rung older than this on an active turn is offered for retry on read. */
export const AGENT_TURN_STEP_STALE_AFTER_MS = 5 * 60 * 1000;
/**
 * A rung older than this is closed by the bounded sweeper. It exceeds every
 * turn's elapsed ceiling (`max(runLimits.elapsedMs, the program ceiling)` plus
 * the turn headroom), so a binding this stale cannot still have a live host.
 */
export const AGENT_TURN_BINDING_ABANDON_AFTER_MS = 3 * AGENT_TURN_STEP_STALE_AFTER_MS;
/**
 * Marker prefix on `outboxLastError` for a runtime projection the outbox has
 * given up on. The committed answer stays released; only the mirror into
 * runtime history is abandoned.
 */
export const AGENT_OUTBOX_EXHAUSTED_PREFIX = "outbox_exhausted: ";
const DEFAULT_SWEEP_LIMIT = 50;
const MAX_SWEEP_LIMIT = 200;

type ReadCtx = QueryCtx | MutationCtx;

const PRE_RUNNING_STEPS = AGENT_TURN_BINDING_STEPS.filter(
  (step) => bindingStepIndex(step) < bindingStepIndex("running"),
);
/** Steps only a live host owns; past the abandon window that host is gone. */
const HOST_OWNED_STEPS: readonly AgentTurnBindingStep[] = ["running", "completion_prepared"];

// ---------------------------------------------------------------------------
// Intent
// ---------------------------------------------------------------------------

export type RecordTurnIntentInput = Omit<CreateAgentRunInput, "runIdempotencyKey" | "promptPayloadHash"> & {
  turnIdempotencyKey: string;
  runtimeThreadRef?: string;
  /** Athena-owned thread identity (V26-1265): many turns share one key; never a runtime ref. */
  threadKey?: string;
  promptPayload: Record<string, unknown>;
  promptPayloadHash?: string;
};

export type RecordTurnIntentResult =
  | { outcome: "created"; bindingId: Id<"agentTurnBinding">; runId: Id<"intelligenceRun">; step: "intent_recorded" }
  | {
      outcome: "resumed";
      bindingId: Id<"agentTurnBinding">;
      runId: Id<"intelligenceRun">;
      step: AgentTurnBindingStep;
      runStatus: AgentRunStatus;
      abandoned: boolean;
    }
  | { outcome: "rejected"; denial: AgentHarnessDenial };

/**
 * Record an operator's intent exactly once per (store, turn key). A duplicate
 * submission resumes the existing binding; it never rewrites the grant or
 * stores a second prompt. Run, grant, ledger, binding, and prompt payload are
 * created in one transaction, so a failure leaves no partial turn behind.
 */
export async function recordTurnIntentWithCtx(
  ctx: MutationCtx,
  input: RecordTurnIntentInput,
): Promise<RecordTurnIntentResult> {
  const existing = await ctx.db
    .query("agentTurnBinding")
    .withIndex("by_storeId_turnIdempotencyKey", (q) =>
      q.eq("storeId", input.storeId).eq("turnIdempotencyKey", input.turnIdempotencyKey),
    )
    .unique();
  if (existing) {
    const run = await ctx.db.get("intelligenceRun", existing.runId);
    return {
      outcome: "resumed",
      bindingId: existing._id,
      runId: existing.runId,
      step: existing.step,
      runStatus: run?.status ?? "failed",
      abandoned: existing.abandonedAt !== undefined,
    };
  }

  const promptBytes = measureJsonByteLength(input.promptPayload);
  if (!evaluateEvidencePayloadSize(promptBytes).withinCeiling) {
    return {
      outcome: "rejected",
      denial: denial("evidence_payload_exceeds_ceiling", "The prompt is too large to record.", {
        detail: { byteLength: promptBytes },
      }),
    };
  }
  const promptPayloadHash = input.promptPayloadHash ?? computeContentDigest(input.promptPayload);
  const { turnIdempotencyKey, runtimeThreadRef, threadKey, promptPayload, promptPayloadHash: _hash, ...runInput } = input;
  const created = await createAgentRunWithCtx(ctx, {
    ...runInput,
    promptPayloadHash,
    runIdempotencyKey: turnIdempotencyKey,
  });
  const bindingId = await ctx.db.insert("agentTurnBinding", {
    runId: created.runId,
    storeId: input.storeId,
    organizationId: input.organizationId,
    turnIdempotencyKey,
    adapterKind: input.adapterKind,
    adapterVersion: input.adapterVersion,
    runtimeThreadRef,
    threadKey,
    step: "intent_recorded",
    stepUpdatedAt: input.now,
    stepIdempotencyKey: turnIdempotencyKey,
    repairCount: 0,
    runtimeCleanupStatus: "not_requested",
    runtimeCleanupAttempts: 0,
    // Runtime payloads for this turn are short-lived: the sweep asks the
    // adapter to clean them once the class expires.
    runtimeCleanupNextAttemptAt: input.now + SHORT_LIVED_RETENTION_MS,
    createdAt: input.now,
    updatedAt: input.now,
  });
  const promptPayloadId = await ctx.db.insert("agentPromptPayload", {
    runId: created.runId,
    storeId: input.storeId,
    organizationId: input.organizationId,
    bindingId,
    payloadHash: promptPayloadHash,
    payload: promptPayload,
    byteLength: promptBytes,
    egressClass: input.egressClass,
    retentionClass: "short_lived",
    expiresAt: retentionExpiresAt("short_lived", input.now),
    createdAt: input.now,
  });
  await ctx.db.patch("agentRunGrant", created.grantId, { promptPayloadId });
  await ctx.db.patch("intelligenceRun", created.runId, {
    turnBindingId: bindingId,
    runtimeThreadRef,
  });
  return { outcome: "created", bindingId, runId: created.runId, step: "intent_recorded" };
}

// ---------------------------------------------------------------------------
// Rungs
// ---------------------------------------------------------------------------

export type AdvanceTurnBindingInput = {
  bindingId: Id<"agentTurnBinding">;
  step: AgentTurnBindingStep;
  idempotencyKey: string;
  now: number;
  runtimeThreadRef?: string;
  runtimeInputRef?: string;
  runtimeScheduleRef?: string;
  preparedCompletionRef?: string;
  runtimeProjectionRef?: string;
};

export type AdvanceTurnBindingResult =
  | { outcome: "advanced"; step: AgentTurnBindingStep }
  | { outcome: "already_reached"; step: AgentTurnBindingStep }
  | { outcome: "rejected"; step: AgentTurnBindingStep | null; denial: AgentHarnessDenial };

/**
 * Advance one rung. Re-requesting a reached rung is the resume path and
 * leaves the recorded runtime reference untouched. Every rung that names a
 * runtime object requires its opaque reference; `athena_committed` is
 * reserved for `completeAgentRunWithCtx`.
 */
export async function advanceTurnBindingWithCtx(
  ctx: MutationCtx,
  input: AdvanceTurnBindingInput,
): Promise<AdvanceTurnBindingResult> {
  const binding = await ctx.db.get("agentTurnBinding", input.bindingId);
  if (!binding) {
    return { outcome: "rejected", step: null, denial: denial("binding_not_found", "The turn binding does not exist.") };
  }
  const evaluation = evaluateBindingAdvance({
    current: binding.step,
    next: input.step,
    abandoned: binding.abandonedAt !== undefined,
  });
  if (evaluation.kind === "already_reached") return { outcome: "already_reached", step: binding.step };
  if (evaluation.kind === "rejected") {
    return {
      outcome: "rejected",
      step: binding.step,
      denial:
        evaluation.reason === "binding_abandoned"
          ? denial("binding_abandoned", "This turn was closed and cannot continue.")
          : denial("binding_step_skipped", `The turn must reach ${AGENT_TURN_BINDING_STEPS[bindingStepIndex(binding.step) + 1]} before ${input.step}.`),
    };
  }

  const run = await ctx.db.get("intelligenceRun", binding.runId);
  if (!run) return { outcome: "rejected", step: binding.step, denial: denial("run_not_found", "The run does not exist.") };
  if (isTerminalRunStatus(run.status) && !isBindingStepAtOrBeyond(binding.step, "athena_committed")) {
    return { outcome: "rejected", step: binding.step, denial: denial("run_terminal", "The run has already ended.", { detail: { status: run.status } }) };
  }

  const patch: Partial<Doc<"agentTurnBinding">> = {
    step: input.step,
    stepUpdatedAt: input.now,
    stepIdempotencyKey: input.idempotencyKey,
    updatedAt: input.now,
  };
  const missingRef = (name: string) =>
    ({
      outcome: "rejected",
      step: binding.step,
      denial: denial("illegal_transition", `${input.step} needs a ${name}.`),
    }) as const;

  switch (input.step) {
    case "runtime_thread_bound": {
      const threadRef = binding.runtimeThreadRef ?? input.runtimeThreadRef;
      if (!threadRef) return missingRef("runtime thread reference");
      patch.runtimeThreadRef = threadRef;
      if (run.runtimeThreadRef !== threadRef) {
        await ctx.db.patch("intelligenceRun", run._id, { runtimeThreadRef: threadRef, updatedAt: input.now });
      }
      break;
    }
    case "runtime_input_saved":
      if (!input.runtimeInputRef) return missingRef("runtime input reference");
      patch.runtimeInputRef = input.runtimeInputRef;
      break;
    case "scheduled":
      if (!input.runtimeScheduleRef) return missingRef("runtime schedule reference");
      patch.runtimeScheduleRef = input.runtimeScheduleRef;
      break;
    case "running": {
      const result = await markAgentRunRunningWithCtx(ctx, { runId: run._id, now: input.now });
      if (result.outcome === "rejected") return { outcome: "rejected", step: binding.step, denial: result.denial };
      if (result.outcome === "already_terminal") {
        return { outcome: "rejected", step: binding.step, denial: denial("run_terminal", "The run has already ended.", { detail: { status: result.status } }) };
      }
      break;
    }
    case "completion_prepared":
      if (!input.preparedCompletionRef) return missingRef("prepared completion reference");
      patch.preparedCompletionRef = input.preparedCompletionRef;
      break;
    case "athena_committed":
      return { outcome: "rejected", step: binding.step, denial: denial("illegal_transition", "Only run completion commits a turn.") };
    case "runtime_projected":
      if (!input.runtimeProjectionRef) return missingRef("runtime projection reference");
      if (!binding.operatorReleaseCommittedAt) {
        return { outcome: "rejected", step: binding.step, denial: denial("illegal_transition", "Projection needs a committed release.") };
      }
      patch.runtimeProjectionRef = input.runtimeProjectionRef;
      break;
    case "intent_recorded":
      return { outcome: "already_reached", step: binding.step };
  }

  await ctx.db.patch("agentTurnBinding", binding._id, patch);
  return { outcome: "advanced", step: input.step };
}

// ---------------------------------------------------------------------------
// Resume-on-read
// ---------------------------------------------------------------------------

export type ResolveTurnResult =
  | { kind: "none" }
  | { kind: "active"; bindingId: Id<"agentTurnBinding">; runId: Id<"intelligenceRun">; step: AgentTurnBindingStep; runStatus: AgentRunStatus }
  | {
      kind: "terminal";
      bindingId: Id<"agentTurnBinding">;
      runId: Id<"intelligenceRun">;
      step: AgentTurnBindingStep;
      runStatus: AgentRunStatus;
      artifactId?: Id<"intelligenceArtifact">;
    };

export async function resolveTurnWithCtx(
  ctx: ReadCtx,
  input: { storeId: Id<"store">; turnIdempotencyKey: string },
): Promise<ResolveTurnResult> {
  const binding = await ctx.db
    .query("agentTurnBinding")
    .withIndex("by_storeId_turnIdempotencyKey", (q) =>
      q.eq("storeId", input.storeId).eq("turnIdempotencyKey", input.turnIdempotencyKey),
    )
    .unique();
  if (!binding) return { kind: "none" };
  const run = await ctx.db.get("intelligenceRun", binding.runId);
  const runStatus = run?.status ?? "failed";
  if (isTerminalRunStatus(runStatus)) {
    return { kind: "terminal", bindingId: binding._id, runId: binding.runId, step: binding.step, runStatus, artifactId: run?.artifactId };
  }
  return { kind: "active", bindingId: binding._id, runId: binding.runId, step: binding.step, runStatus };
}

export type ResumeTurnBindingResult = {
  action: "continue" | "retry_step" | "await_projection" | "terminal" | "abandoned";
  step: AgentTurnBindingStep;
  runStatus: AgentRunStatus;
  artifactId?: Id<"intelligenceArtifact">;
};

/**
 * Resume-on-read repair. Reports what the caller should do with this turn:
 * keep going, retry the current rung (stale on an active run), project the
 * committed artifact (outbox), or nothing (terminal/abandoned). Repairs only
 * patch bookkeeping; they never create runtime objects, prompts, or artifacts.
 */
export async function resumeTurnBindingWithCtx(
  ctx: MutationCtx,
  input: { bindingId: Id<"agentTurnBinding">; now: number },
): Promise<ResumeTurnBindingResult | null> {
  const binding = await ctx.db.get("agentTurnBinding", input.bindingId);
  if (!binding) return null;
  const run = await ctx.db.get("intelligenceRun", binding.runId);
  const runStatus = run?.status ?? "failed";

  if (binding.abandonedAt !== undefined) {
    // Only a writer that terminalizes the run abandons a binding, and the host
    // that owned this turn is gone by the time anyone reads it: whatever the
    // turn cost is unknowable, so the reservation is released against 0.
    await settleTurnSpendOnceWithCtx(ctx, { bindingId: binding._id, actualCostUnits: 0, now: input.now });
    return { action: "abandoned", step: binding.step, runStatus, artifactId: run?.artifactId };
  }
  if (isTerminalRunStatus(runStatus)) {
    if (runStatus === "completed" && binding.step === "athena_committed") {
      // The outbox gave up on this projection: the answer is released, so
      // there is nothing left for the caller to wait on.
      const exhausted = binding.outboxNextAttemptAt === undefined && (binding.outboxLastError?.startsWith(AGENT_OUTBOX_EXHAUSTED_PREFIX) ?? false);
      if (!exhausted) return { action: "await_projection", step: binding.step, runStatus, artifactId: run?.artifactId };
      await settleTurnSpendOnceWithCtx(ctx, { bindingId: binding._id, actualCostUnits: 0, now: input.now });
      return { action: "terminal", step: binding.step, runStatus, artifactId: run?.artifactId };
    }
    if (!isBindingStepAtOrBeyond(binding.step, "athena_committed")) {
      // Orphan: the run ended without the binding being closed. Close it now
      // and release the turn's reservation with it.
      await ctx.db.patch("agentTurnBinding", binding._id, {
        abandonedAt: input.now,
        abandonReason: `run_${runStatus}`,
        updatedAt: input.now,
      });
      await settleTurnSpendOnceWithCtx(ctx, { bindingId: binding._id, actualCostUnits: 0, now: input.now });
      return { action: "abandoned", step: binding.step, runStatus, artifactId: run?.artifactId };
    }
    // Committed or projected on a terminal run: the reservation is released
    // here for a turn whose host died before it could finalize.
    await settleTurnSpendOnceWithCtx(ctx, { bindingId: binding._id, actualCostUnits: 0, now: input.now });
    return { action: "terminal", step: binding.step, runStatus, artifactId: run?.artifactId };
  }
  if (
    !isBindingStepAtOrBeyond(binding.step, "running") &&
    binding.stepUpdatedAt <= input.now - AGENT_TURN_STEP_STALE_AFTER_MS
  ) {
    await ctx.db.patch("agentTurnBinding", binding._id, {
      repairCount: binding.repairCount + 1,
      stepUpdatedAt: input.now,
      updatedAt: input.now,
    });
    return { action: "retry_step", step: binding.step, runStatus };
  }
  return { action: "continue", step: binding.step, runStatus };
}

export async function acknowledgeOperatorViewWithCtx(
  ctx: MutationCtx,
  input: { bindingId: Id<"agentTurnBinding">; viewerActorRef: string; now: number },
): Promise<{ acknowledged: boolean; operatorViewedAt?: number }> {
  const binding = await ctx.db.get("agentTurnBinding", input.bindingId);
  if (!binding || binding.abandonedAt !== undefined || !binding.operatorReleaseCommittedAt) {
    return { acknowledged: false };
  }
  if (binding.operatorViewedAt !== undefined) {
    return { acknowledged: true, operatorViewedAt: binding.operatorViewedAt };
  }
  await ctx.db.patch("agentTurnBinding", binding._id, {
    operatorViewedAt: input.now,
    operatorViewedByActorRef: input.viewerActorRef,
    updatedAt: input.now,
  });
  return { acknowledged: true, operatorViewedAt: input.now };
}

/**
 * Record that provisional text was released to the operator's pane. Written
 * exactly once, by the first stored flush; every later flush leaves the
 * binding untouched so reactive turn-view subscribers see one update from
 * streaming, not one per delta.
 */
export async function markProvisionalReleaseWithCtx(
  ctx: MutationCtx,
  input: { bindingId: Id<"agentTurnBinding">; now: number },
): Promise<{ outcome: "released" | "already_released"; provisionalReleasedAt: number } | { outcome: "refused"; reason: "binding_not_found" | "binding_abandoned" }> {
  const binding = await ctx.db.get("agentTurnBinding", input.bindingId);
  if (!binding) return { outcome: "refused", reason: "binding_not_found" };
  if (binding.abandonedAt !== undefined) return { outcome: "refused", reason: "binding_abandoned" };
  if (binding.provisionalReleasedAt !== undefined) return { outcome: "already_released", provisionalReleasedAt: binding.provisionalReleasedAt };
  await ctx.db.patch("agentTurnBinding", binding._id, { provisionalReleasedAt: input.now, updatedAt: input.now });
  return { outcome: "released", provisionalReleasedAt: input.now };
}

/**
 * The operator's first paint of provisional text: confirmed receipt, first
 * write wins, refused until something was released (mirroring how the
 * committed-answer view refuses without a committed release).
 */
export async function acknowledgeProvisionalViewWithCtx(
  ctx: MutationCtx,
  input: { bindingId: Id<"agentTurnBinding">; viewerActorRef: string; now: number },
): Promise<{ acknowledged: true; provisionalViewedAt: number } | { acknowledged: false; reason: "binding_not_found" | "binding_abandoned" | "not_released" }> {
  const binding = await ctx.db.get("agentTurnBinding", input.bindingId);
  if (!binding) return { acknowledged: false, reason: "binding_not_found" };
  if (binding.abandonedAt !== undefined) return { acknowledged: false, reason: "binding_abandoned" };
  if (binding.provisionalReleasedAt === undefined) return { acknowledged: false, reason: "not_released" };
  if (binding.provisionalViewedAt !== undefined) return { acknowledged: true, provisionalViewedAt: binding.provisionalViewedAt };
  await ctx.db.patch("agentTurnBinding", binding._id, {
    provisionalViewedAt: input.now,
    provisionalViewedByActorRef: input.viewerActorRef,
    updatedAt: input.now,
  });
  return { acknowledged: true, provisionalViewedAt: input.now };
}

export async function listTurnBindingsForThread(
  ctx: ReadCtx,
  runtimeThreadRef: string,
  limit = 50,
): Promise<Doc<"agentTurnBinding">[]> {
  return ctx.db
    .query("agentTurnBinding")
    .withIndex("by_runtimeThreadRef_createdAt", (q) => q.eq("runtimeThreadRef", runtimeThreadRef))
    .take(limit);
}

// ---------------------------------------------------------------------------
// Bounded sweeper
// ---------------------------------------------------------------------------

/**
 * How a stranded rung is closed. `turn_binding_stalled` names a turn no host
 * ever picked up; `turn_host_stalled` names one whose host died mid-turn.
 */
const SWEEP_TARGETS: readonly { step: AgentTurnBindingStep; code: string; message: string }[] = [
  ...PRE_RUNNING_STEPS.map((step) => ({
    step,
    code: "turn_binding_stalled",
    message: "The request did not start in time. Ask again to retry.",
  })),
  ...HOST_OWNED_STEPS.map((step) => ({
    step,
    code: "turn_host_stalled",
    message: "The request stopped unexpectedly. Ask again to retry.",
  })),
];

/**
 * Close turns nothing can finish any more: those that never reached `running`
 * (queued-without-work, missing runtime thread/input, scheduling that never
 * landed) and those parked at `running` or `completion_prepared` past the
 * abandon window, whose host cannot still be alive. The run fails as retryable,
 * the binding is abandoned, and the turn's spend reservation is released; the
 * operator's next prompt is a new turn. Nothing is duplicated or reopened.
 */
export async function sweepStaleTurnBindingsWithCtx(
  ctx: MutationCtx,
  input: { now: number; limit?: number },
): Promise<{ failed: number; hasMore: boolean }> {
  const limit = Math.min(MAX_SWEEP_LIMIT, Math.max(1, input.limit ?? DEFAULT_SWEEP_LIMIT));
  const cutoff = input.now - AGENT_TURN_BINDING_ABANDON_AFTER_MS;
  let processed = 0;
  let failed = 0;
  let hasMore = false;
  for (const target of SWEEP_TARGETS) {
    const remaining = limit - processed;
    if (remaining <= 0) {
      hasMore = true;
      break;
    }
    const bindings = await ctx.db
      .query("agentTurnBinding")
      .withIndex("by_step_abandonedAt_stepUpdatedAt", (q) =>
        q.eq("step", target.step).eq("abandonedAt", undefined).lte("stepUpdatedAt", cutoff),
      )
      .take(remaining);
    for (const binding of bindings) {
      processed += 1;
      const run = await ctx.db.get("intelligenceRun", binding.runId);
      if (!run || isTerminalRunStatus(run.status)) {
        await ctx.db.patch("agentTurnBinding", binding._id, {
          abandonedAt: input.now,
          abandonReason: run ? `run_${run.status}` : "run_missing",
          updatedAt: input.now,
        });
        await settleTurnSpendOnceWithCtx(ctx, { bindingId: binding._id, actualCostUnits: 0, now: input.now });
        continue;
      }
      const result = await failAgentRunWithCtx(ctx, {
        runId: run._id,
        idempotencyKey: `${target.code}:${binding._id}`,
        error: { code: target.code, message: target.message, retryable: true },
        now: input.now,
      });
      if (result.outcome === "advanced") failed += 1;
      const refreshed = await ctx.db.get("agentTurnBinding", binding._id);
      if (refreshed && refreshed.abandonedAt === undefined) {
        await ctx.db.patch("agentTurnBinding", binding._id, {
          abandonedAt: input.now,
          abandonReason: target.code,
          updatedAt: input.now,
        });
      }
      await settleTurnSpendOnceWithCtx(ctx, { bindingId: binding._id, actualCostUnits: 0, now: input.now });
    }
    if (bindings.length === remaining) hasMore = true;
  }
  return { failed, hasMore };
}

// ---------------------------------------------------------------------------
// Internal function surface
// ---------------------------------------------------------------------------

const turnBindingStepValidator = v.union(
  v.literal("intent_recorded"),
  v.literal("runtime_thread_bound"),
  v.literal("runtime_input_saved"),
  v.literal("scheduled"),
  v.literal("running"),
  v.literal("completion_prepared"),
  v.literal("athena_committed"),
  v.literal("runtime_projected"),
);

export const advanceTurnBinding = internalMutation({
  args: {
    bindingId: v.id("agentTurnBinding"),
    step: turnBindingStepValidator,
    idempotencyKey: v.string(),
    runtimeThreadRef: v.optional(v.string()),
    runtimeInputRef: v.optional(v.string()),
    runtimeScheduleRef: v.optional(v.string()),
    preparedCompletionRef: v.optional(v.string()),
    runtimeProjectionRef: v.optional(v.string()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) =>
    advanceTurnBindingWithCtx(ctx, { ...args, now: args.now ?? Date.now() }),
});

export const sweepStaleTurnBindings = internalMutation({
  args: { now: v.optional(v.number()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const result = await sweepStaleTurnBindingsWithCtx(ctx, { now, limit: args.limit });
    if (result.hasMore) {
      await ctx.scheduler.runAfter(0, internal.agentHarness.turnBindings.sweepStaleTurnBindings, {
        limit: args.limit,
      });
    }
    return result;
  },
});
