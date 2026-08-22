/**
 * Completion outbox (kernel; V8).
 *
 * Authority boundary (plan decisions 10 and 12):
 * - `completeRun` PREPARES privately: the binding records a digest of the
 *   completion request at `completion_prepared` (and an outbox due time), and
 *   nothing is visible to anyone.
 * - ONE Athena transaction (the executor's `completeRun` seam → delegated
 *   reauthorization → the lifecycle's `completeAgentRunWithCtx`) commits evidence, artifact, run state, and
 *   `operator_release_committed`. Revocation between prepare and commit wins
 *   there: the refusal leaves the binding at `completion_prepared`.
 * - Afterwards an idempotent outbox projects the committed artifact through
 *   the runtime adapter, only after reauthorizing the initiating operator for
 *   it RIGHT NOW. Repair (the sweeper) retries with backoff and never
 *   duplicates a projection or reopens the run.
 * - Revocation after commit but before an authorized fetch suppresses release:
 *   the binding is marked, the adapter is asked to purge its payloads through
 *   the retention cleanup hook, and the exposure audit (attempt provider egress,
 *   release committed, view never acknowledged) stays intact.
 */
import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "../_generated/server";
import type { AgentProjectedArtifact } from "../../shared/agentHarness/agentRuntime";
import { sha256Hex } from "../../shared/agentHarness/digest";
import { isBindingStepAtOrBeyond, isTerminalRunStatus, type AgentTurnBindingStep } from "../../shared/agentHarness/execution";
import { egressClassRank } from "../../shared/agentHarness/values";
import type { DelegatedAdmission } from "./delegatedAdmission";
import { parseAnswerPayload, resolveViewerAuthorityWithCtx } from "./historyProjection";
import { requestRuntimeCleanupWithCtx } from "./retention";
import { settleTurnSpendOnceWithCtx } from "./runAdmission";
import { AGENT_OUTBOX_EXHAUSTED_PREFIX, advanceTurnBindingWithCtx } from "./turnBindings";
import { agentDelegatedAdmission } from "../platform/operationAdmission";

type ReadCtx = QueryCtx | MutationCtx;

/** Projection retry backoff: 1 m, 10 m, 1 h, 6 h (then 6 h). */
export const AGENT_OUTBOX_BACKOFF_MS = [60_000, 10 * 60_000, 60 * 60_000, 6 * 60 * 60_000] as const;
/**
 * Projection attempts before the outbox gives up. A projection that has failed
 * through the whole backoff twice over cannot succeed on its own — a host that
 * died before terminalizing its runtime turn leaves that turn pending forever —
 * so retrying it further would keep the cron busy for the life of the row.
 */
export const AGENT_OUTBOX_MAX_ATTEMPTS = AGENT_OUTBOX_BACKOFF_MS.length + 2;
const DEFAULT_OUTBOX_LIMIT = 50;
const MAX_OUTBOX_LIMIT = 200;

export type CompletionOutboxConfig = {
  readonly admission: DelegatedAdmission;
};

export type AgentPrepareCompletionOutcome =
  | { outcome: "prepared"; preparedCompletionRef: string }
  | { outcome: "already_prepared"; preparedCompletionRef: string }
  | { outcome: "rejected"; code: string; message: string };

export type AgentProjectionLoad =
  | { kind: "ready"; threadRef: string; turnRef: string; artifact: AgentProjectedArtifact; idempotencyKey: string }
  | { kind: "already_projected"; projectionRef: string }
  | { kind: "not_committed"; step: AgentTurnBindingStep }
  | { kind: "suppressed"; reason: string }
  | { kind: "missing_runtime_refs" }
  | { kind: "not_found" };

export type AgentRecordProjectionOutcome = { outcome: "projected" | "already_projected" | "rejected"; step: AgentTurnBindingStep | null; code?: string };

/** Opaque artifact reference for runtime metadata: a digest, never the document id. */
export function artifactRefFor(artifactId: Id<"intelligenceArtifact">): string {
  return `artifact:${sha256Hex(`artifact:${artifactId}`).slice(0, 24)}`;
}

export function createCompletionOutbox(config: CompletionOutboxConfig) {
  const { admission } = config;

  async function prepareCompletionWithCtx(
    ctx: MutationCtx,
    input: { bindingId: Id<"agentTurnBinding">; runId: Id<"intelligenceRun">; preparedCompletionRef: string; now: number },
  ): Promise<AgentPrepareCompletionOutcome> {
    const binding = await ctx.db.get("agentTurnBinding", input.bindingId);
    if (!binding || binding.runId !== input.runId) return { outcome: "rejected", code: "binding_not_found", message: "The turn does not exist." };
    if (binding.preparedCompletionRef !== undefined) return { outcome: "already_prepared", preparedCompletionRef: binding.preparedCompletionRef };
    const advanced = await advanceTurnBindingWithCtx(ctx, {
      bindingId: binding._id,
      step: "completion_prepared",
      idempotencyKey: input.preparedCompletionRef,
      now: input.now,
      preparedCompletionRef: input.preparedCompletionRef,
    });
    if (advanced.outcome === "rejected") return { outcome: "rejected", code: advanced.denial.code, message: advanced.denial.message };
    if (advanced.outcome === "already_reached") {
      const refreshed = await ctx.db.get("agentTurnBinding", binding._id);
      return { outcome: "already_prepared", preparedCompletionRef: refreshed?.preparedCompletionRef ?? input.preparedCompletionRef };
    }
    // Due immediately once committed; cleared by a successful projection.
    await ctx.db.patch("agentTurnBinding", binding._id, { outboxNextAttemptAt: input.now, outboxAttempts: 0, updatedAt: input.now });
    return { outcome: "prepared", preparedCompletionRef: input.preparedCompletionRef };
  }

  /** Reauthorize the initiating operator for the committed artifact NOW and shape it for the adapter. */
  async function loadProjectionWithCtx(ctx: ReadCtx, input: { bindingId: Id<"agentTurnBinding">; now: number }): Promise<AgentProjectionLoad> {
    const binding = await ctx.db.get("agentTurnBinding", input.bindingId);
    if (!binding) return { kind: "not_found" };
    if (binding.runtimeProjectionRef) return { kind: "already_projected", projectionRef: binding.runtimeProjectionRef };
    if (binding.releaseSuppressedAt !== undefined) return { kind: "suppressed", reason: binding.releaseSuppressedReason ?? "release_suppressed" };
    const run = await ctx.db.get("intelligenceRun", binding.runId);
    if (!run) return { kind: "not_found" };
    if (!isBindingStepAtOrBeyond(binding.step, "athena_committed") || binding.operatorReleaseCommittedAt === undefined || run.status !== "completed" || !run.artifactId) {
      return { kind: "not_committed", step: binding.step };
    }
    const grant = run.runGrantId ? await ctx.db.get("agentRunGrant", run.runGrantId) : null;
    const delegation = grant?.delegation;
    if (!grant || !delegation) return { kind: "suppressed", reason: "delegation_missing" };
    if (grant.lifecycle !== "retained") return { kind: "suppressed", reason: "deleted_by_lifecycle" };
    const authority = await resolveViewerAuthorityWithCtx(ctx, admission.config, {
      viewer: { kind: delegation.operatorKind, athenaUserId: delegation.athenaUserId, authUserId: delegation.authUserId },
      storeId: grant.storeId,
      organizationId: grant.organizationId,
      profileId: grant.profileKey,
      now: input.now,
    });
    if (authority.kind === "unauthorized") return { kind: "suppressed", reason: authority.reason };
    const artifact = await ctx.db.get("intelligenceArtifact", run.artifactId);
    const payload = artifact ? parseAnswerPayload(artifact.payload) : null;
    if (!artifact || artifact.status !== "ready" || !payload) return { kind: "suppressed", reason: "artifact_unavailable" };
    if (egressClassRank(payload.egressClass) > egressClassRank(authority.egressClass)) return { kind: "suppressed", reason: "egress_beyond_authority" };
    if (!binding.runtimeThreadRef || !binding.runtimeTurnRef) return { kind: "missing_runtime_refs" };
    return {
      kind: "ready",
      threadRef: binding.runtimeThreadRef,
      turnRef: binding.runtimeTurnRef,
      idempotencyKey: `project:${binding._id}`,
      artifact: {
        artifactRef: artifactRefFor(artifact._id),
        narrative: payload.narrative,
        egressClass: payload.egressClass,
        citations: payload.citations.map((citation) => ({ citationKey: citation.ref, label: citation.label ?? citation.namespace ?? citation.ref })),
        committedAt: binding.operatorReleaseCommittedAt,
      },
    };
  }

  async function recordProjectionWithCtx(
    ctx: MutationCtx,
    input: { bindingId: Id<"agentTurnBinding">; projectionRef: string; now: number },
  ): Promise<AgentRecordProjectionOutcome> {
    const binding = await ctx.db.get("agentTurnBinding", input.bindingId);
    if (!binding) return { outcome: "rejected", step: null, code: "binding_not_found" };
    if (binding.runtimeProjectionRef) return { outcome: "already_projected", step: binding.step };
    const advanced = await advanceTurnBindingWithCtx(ctx, {
      bindingId: binding._id,
      step: "runtime_projected",
      idempotencyKey: `projected:${input.projectionRef}`,
      now: input.now,
      runtimeProjectionRef: input.projectionRef,
    });
    if (advanced.outcome === "rejected") return { outcome: "rejected", step: advanced.step, code: advanced.denial.code };
    await ctx.db.patch("agentTurnBinding", binding._id, { outboxNextAttemptAt: undefined, outboxLastError: undefined, updatedAt: input.now });
    // A committed binding reaches this end or the exhausted one, and no sweep
    // target covers it: a host that died after the commit left the turn's
    // reservation held, so it is released here. Its real provider cost died
    // with the host, so nothing is booked as spent.
    await settleTurnSpendOnceWithCtx(ctx, { bindingId: binding._id, actualCostUnits: 0, now: input.now });
    return { outcome: advanced.outcome === "advanced" ? "projected" : "already_projected", step: "runtime_projected" };
  }

  async function recordProjectionFailureWithCtx(
    ctx: MutationCtx,
    input: { bindingId: Id<"agentTurnBinding">; error: string; now: number },
  ): Promise<{ outcome: "scheduled" | "exhausted" | "not_found"; attempts?: number; nextAttemptAt?: number }> {
    const binding = await ctx.db.get("agentTurnBinding", input.bindingId);
    if (!binding) return { outcome: "not_found" };
    const attempts = (binding.outboxAttempts ?? 0) + 1;
    if (attempts > AGENT_OUTBOX_MAX_ATTEMPTS) {
      // No due time: the binding leaves the outbox for good. The committed
      // answer stays released; only the runtime mirror is given up, and the
      // reason stays on the row for the operator-facing resume path.
      await ctx.db.patch("agentTurnBinding", binding._id, {
        outboxAttempts: attempts,
        outboxNextAttemptAt: undefined,
        outboxLastError: `${AGENT_OUTBOX_EXHAUSTED_PREFIX}${input.error}`.slice(0, 200),
        updatedAt: input.now,
      });
      // The other end a committed binding can reach: the turn is over for good,
      // so its reservation is released here on the same terms as a projection.
      await settleTurnSpendOnceWithCtx(ctx, { bindingId: binding._id, actualCostUnits: 0, now: input.now });
      return { outcome: "exhausted", attempts };
    }
    const backoff = AGENT_OUTBOX_BACKOFF_MS[Math.min(attempts - 1, AGENT_OUTBOX_BACKOFF_MS.length - 1)];
    const nextAttemptAt = input.now + backoff;
    await ctx.db.patch("agentTurnBinding", binding._id, { outboxAttempts: attempts, outboxNextAttemptAt: nextAttemptAt, outboxLastError: input.error.slice(0, 200), updatedAt: input.now });
    return { outcome: "scheduled", attempts, nextAttemptAt };
  }

  /** Suppress a committed release and ask the adapter to purge its payloads; idempotent. */
  async function suppressReleaseWithCtx(
    ctx: MutationCtx,
    input: { bindingId: Id<"agentTurnBinding">; reason: string; now: number },
  ): Promise<{ outcome: "suppressed" | "already_suppressed" | "not_found"; cleanup?: Awaited<ReturnType<typeof requestRuntimeCleanupWithCtx>> }> {
    const binding = await ctx.db.get("agentTurnBinding", input.bindingId);
    if (!binding) return { outcome: "not_found" };
    const already = binding.releaseSuppressedAt !== undefined;
    if (!already) {
      await ctx.db.patch("agentTurnBinding", binding._id, {
        releaseSuppressedAt: input.now,
        releaseSuppressedReason: input.reason,
        outboxNextAttemptAt: undefined,
        runtimeCleanupStatus: binding.runtimeCleanupStatus === "succeeded" ? "succeeded" : "pending",
        runtimeCleanupNextAttemptAt: binding.runtimeCleanupStatus === "succeeded" ? binding.runtimeCleanupNextAttemptAt : input.now,
        updatedAt: input.now,
      });
    }
    const cleanup = await requestRuntimeCleanupWithCtx(ctx, binding._id, input.now);
    return { outcome: already ? "already_suppressed" : "suppressed", cleanup };
  }

  /** Committed, unprojected, unsuppressed bindings whose retry time has come. */
  async function listOutboxDueWithCtx(ctx: ReadCtx, input: { now: number; limit?: number }): Promise<Id<"agentTurnBinding">[]> {
    const limit = Math.min(MAX_OUTBOX_LIMIT, Math.max(1, input.limit ?? DEFAULT_OUTBOX_LIMIT));
    const rows = await ctx.db
      .query("agentTurnBinding")
      .withIndex("by_step_outboxNextAttemptAt", (q) => q.eq("step", "athena_committed").gte("outboxNextAttemptAt", 0).lte("outboxNextAttemptAt", input.now))
      .take(limit);
    const due: Id<"agentTurnBinding">[] = [];
    for (const row of rows) {
      if (row.runtimeProjectionRef || row.releaseSuppressedAt !== undefined || row.abandonedAt !== undefined) continue;
      const run = await ctx.db.get("intelligenceRun", row.runId);
      if (!run || run.status !== "completed" || !isTerminalRunStatus(run.status)) continue;
      due.push(row._id);
    }
    return due;
  }

  const functions = {
    prepareCompletion: internalMutation({
      args: { bindingId: v.id("agentTurnBinding"), runId: v.id("intelligenceRun"), preparedCompletionRef: v.string(), now: v.optional(v.number()) },
      handler: async (ctx, args) => prepareCompletionWithCtx(ctx, { ...args, now: args.now ?? Date.now() }),
    }),
    loadProjection: internalQuery({
      args: { bindingId: v.id("agentTurnBinding"), now: v.optional(v.number()) },
      handler: async (ctx, args) => loadProjectionWithCtx(ctx, { bindingId: args.bindingId, now: args.now ?? Date.now() }),
    }),
    recordProjection: internalMutation({
      args: { bindingId: v.id("agentTurnBinding"), projectionRef: v.string(), now: v.optional(v.number()) },
      handler: async (ctx, args) => recordProjectionWithCtx(ctx, { ...args, now: args.now ?? Date.now() }),
    }),
    recordProjectionFailure: internalMutation({
      args: { bindingId: v.id("agentTurnBinding"), error: v.string(), now: v.optional(v.number()) },
      handler: async (ctx, args) => recordProjectionFailureWithCtx(ctx, { ...args, now: args.now ?? Date.now() }),
    }),
    suppressRelease: internalMutation({
      args: { bindingId: v.id("agentTurnBinding"), reason: v.string(), now: v.optional(v.number()) },
      handler: async (ctx, args) => suppressReleaseWithCtx(ctx, { ...args, now: args.now ?? Date.now() }),
    }),
    listOutboxDue: internalQuery({
      args: { now: v.optional(v.number()), limit: v.optional(v.number()) },
      handler: async (ctx, args) => listOutboxDueWithCtx(ctx, { now: args.now ?? Date.now(), limit: args.limit }),
    }),
  };

  return {
    config,
    prepareCompletionWithCtx,
    loadProjectionWithCtx,
    recordProjectionWithCtx,
    recordProjectionFailureWithCtx,
    suppressReleaseWithCtx,
    listOutboxDueWithCtx,
    functions,
  };
}

export type CompletionOutbox = ReturnType<typeof createCompletionOutbox>;

// ---------------------------------------------------------------------------
// Production binding (composition root admission)
// ---------------------------------------------------------------------------

export const agentCompletionOutbox = createCompletionOutbox({ admission: agentDelegatedAdmission });

export const prepareCompletion = agentCompletionOutbox.functions.prepareCompletion;
export const loadProjection = agentCompletionOutbox.functions.loadProjection;
export const recordProjection = agentCompletionOutbox.functions.recordProjection;
export const recordProjectionFailure = agentCompletionOutbox.functions.recordProjectionFailure;
export const suppressRelease = agentCompletionOutbox.functions.suppressRelease;
export const listOutboxDue = agentCompletionOutbox.functions.listOutboxDue;
