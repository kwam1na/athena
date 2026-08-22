/**
 * Turns (kernel; V8): operator intent → U1 turn-binding ladder → runtime host,
 * plus the operator-facing public entry points the reusable host (U9) calls.
 *
 * Authority boundary:
 * - Every public function is admitted by the operation rail and then
 *   reauthorizes the viewer itself: the initiating operator (pinned on the
 *   grant) must be the caller, and the composition root's delegated authority
 *   port must still admit them to the store under an enabled profile. Nothing
 *   here trusts runtime metadata; runtime refs are opaque strings.
 * - `startTurn` validates the prompt (no partial persistence), admits the run
 *   (profile switch, grant, provider egress, active-run limit, one active turn
 *   per thread, spend ceiling), records intent through U1 in one transaction,
 *   and schedules the internal host action. One turn owns one run; many turns
 *   share one Athena thread key; a terminal run never reopens.
 * - The seams the host uses (`prepareTurn`, `markTurnRunning`, …) compare the
 *   pinned and current compatibility epoch and the live profile switch before
 *   any runtime or provider work, project Athena-authored history, and select
 *   the provider for the turn's maximum egress class. Usage settles once into
 *   provider-invocation evidence and the spend window; late usage is evidence.
 */
import { v } from "convex/values";

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "../_generated/server";
import type { AgentModelSelection, AgentProgressMilestone, AgentProjectedHistory, AgentProjectedPrompt, AgentTurnLimits } from "../../shared/agentHarness/agentRuntime";
import { AGENT_PROGRESS_MILESTONES } from "../../shared/agentHarness/agentRuntime";
import { sha256Hex } from "../../shared/agentHarness/digest";
import { isBindingStepAtOrBeyond, isTerminalRunStatus, type AgentTurnBindingStep } from "../../shared/agentHarness/execution";
import { egressClassRank, opaqueRef, type AgentEgressClass } from "../../shared/agentHarness/values";
import {
  acknowledgeTurnAnswerOperationDefinition,
  cancelTurnOperationDefinition,
  inspectCitationEvidenceOperationDefinition,
  resumeTurnOperationDefinition,
  startTurnOperationDefinition,
} from "../operationAdmission/domains/agentHarness_definitions";
import {
  getThreadHistoryReadDefinition,
  getTurnAnswerReadDefinition,
  getTurnViewReadDefinition,
} from "../operationAdmission/domains/agentHarness_readDefinitions";
import type { DelegatedOperator, OperationActor } from "../operationAdmission/types";
import { admitPublicMutation, admitPublicQuery, agentDelegatedAdmission } from "../platform/operationAdmission";
import { buildConvexAgentInvocationSummary } from "../intelligence/providers/convexAgent";
import { agentCompletionOutbox, type CompletionOutbox } from "./completionOutbox";
import type { DelegatedAdmission } from "./delegatedAdmission";
import { describeProviderSelectionForEvidence, redactProviderSecrets, resolveTurnEgressClass, selectProviderForEgress, type AgentProviderEvidence } from "./egressPolicy";
import type { AgentCitationEvidenceForViewer } from "./citations";
import { agentExecutorSeams } from "./executorSeams";
import {
  assembleTurnPrompt,
  historyEgressClass,
  parseAnswerPayload,
  projectThreadHistoryWithCtx,
  resolveViewerAuthorityWithCtx,
  toModelHistory,
  type AgentThreadHistoryEntry,
} from "./historyProjection";
import { cancelAgentRunWithCtx, failAgentRunWithCtx, checkRunEpochFenceWithCtx } from "./lifecycle";
import { AGENT_PROGRAM_RUNTIME_CEILINGS } from "./programRuntime/types";
import { requestRuntimeCleanupWithCtx } from "./retention";
import { admitTurnStartWithCtx, settleTurnSpendWithCtx, spendWindowKey, validateOperatorPrompt } from "./runAdmission";
import { acknowledgeOperatorViewWithCtx, advanceTurnBindingWithCtx, recordTurnIntentWithCtx, resolveTurnWithCtx, resumeTurnBindingWithCtx } from "./turnBindings";
import type { AgentDescribeGrantOutcome } from "./tools";

type ReadCtx = QueryCtx | MutationCtx;

// ---------------------------------------------------------------------------
// Identity helpers
// ---------------------------------------------------------------------------

export const AGENT_THREAD_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
export const AGENT_CONTEXT_MAX_KEYS = 8;
export const AGENT_CONTEXT_VALUE_MAX_BYTES = 256;
export const AGENT_TURN_PROGRESS_CAP = 24;
/** Turn elapsed headroom above the program ceiling so a running program is never raced by the turn timer. */
export const AGENT_TURN_ELAPSED_HEADROOM_MS = 30_000;

/** The runtime adapter's thread key: profile + store + operator + client thread key. Hashed by the adapter. */
export function athenaThreadKeyFor(input: { profileId: string; storeId: Id<"store">; actorRef: string; threadKey: string }): string {
  return `agent-thread:v1|${input.profileId}|${input.storeId}|${input.actorRef}|${input.threadKey}`;
}

export function turnKeyFor(bindingId: Id<"agentTurnBinding">): string {
  return `turn:${sha256Hex(`turn:${bindingId}`).slice(0, 24)}`;
}

export function contextBindingRefFor(athenaThreadKey: string) {
  return opaqueRef("context_binding", sha256Hex(athenaThreadKey).slice(0, 24));
}

/** Correlation only (never authorization); a digest so no raw id reaches runtime metadata. */
export function operatorCorrelationRef(actorRef: string): string {
  return `operator:${sha256Hex(actorRef).slice(0, 24)}`;
}

/** Provider cost units reserved per turn before any provider work. */
export function turnProviderCostReservation(): number {
  return AGENT_PROGRAM_RUNTIME_CEILINGS.maxProviderCostUnits;
}

export function operatorFromActor(actor: OperationActor): DelegatedOperator | null {
  switch (actor.kind) {
    case "normal_user":
      return { kind: "normal_user", athenaUserId: actor.athenaUserId };
    case "shared_demo":
      return { kind: "shared_demo", athenaUserId: actor.athenaUserId, authUserId: actor.authUserId };
    default:
      return null;
  }
}

export function validateContextValues(context: { [key: string]: string } | undefined): { ok: true; context: { [key: string]: string } } | { ok: false; message: string } {
  if (context === undefined) return { ok: true, context: {} };
  const entries = Object.entries(context);
  if (entries.length > AGENT_CONTEXT_MAX_KEYS) return { ok: false, message: "Too many context fields." };
  const out: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/.test(key)) return { ok: false, message: "A context field name is not allowed." };
    const validated = validateOperatorPrompt(value, { maxPromptBytes: AGENT_CONTEXT_VALUE_MAX_BYTES });
    if (!validated.ok) return { ok: false, message: "A context value is not allowed." };
    out[key] = validated.text;
  }
  return { ok: true, context: out };
}

// ---------------------------------------------------------------------------
// Operator copy for terminal outcomes (calm, no raw backend wording)
// ---------------------------------------------------------------------------

export function describeTurnErrorForOperator(code: string | undefined): string {
  switch (code) {
    case undefined:
      return "Athena couldn't complete this request.";
    case "completion_missing":
      return "Athena didn't reach an answer. Ask again.";
    case "provider_failure":
    case "runtime_adapter_error":
    case "model_unresolvable":
      return "The answer service didn't respond. Try again in a moment.";
    case "turn_elapsed_ceiling":
      return "This took too long. Try a narrower question.";
    case "compatibility_epoch_fenced":
      return "Athena was updated while this was running. Ask again.";
    case "authority_revoked":
    case "membership_revoked":
    case "profile_disabled":
    case "store_out_of_scope":
      return "This answer is no longer available to you.";
    case "no_compatible_provider":
      return "Athena can't answer this safely right now.";
    case "turn_binding_stalled":
    case "prompt_unavailable":
      return "The request didn't start in time. Ask again.";
    case "canceled":
      return "Stopped.";
    default:
      return "Athena couldn't complete this request.";
  }
}

// ---------------------------------------------------------------------------
// Seams
// ---------------------------------------------------------------------------

export type AgentTurnSeamConfig = {
  readonly admission: DelegatedAdmission;
  readonly outbox: CompletionOutbox;
  /** Credential presence per provider id (names only). Production reads the environment. */
  readonly isProviderConfigured?: (providerId: string) => boolean;
};

export type AgentTurnPlan = {
  readonly bindingId: Id<"agentTurnBinding">;
  readonly runId: Id<"intelligenceRun">;
  readonly storeId: Id<"store">;
  readonly organizationId: Id<"organization">;
  readonly profileId: string;
  readonly actorRef: string;
  readonly threadKey: string;
  readonly step: AgentTurnBindingStep;
  readonly adapterKind: string;
  readonly adapterVersion: string;
  readonly adapter: { readonly threadKey: string; readonly contextBindingRef: string; readonly correlation: { readonly operatorRef: string; readonly profileId: string }; readonly turnKey: string };
  readonly prompt: AgentProjectedPrompt;
  readonly history: AgentProjectedHistory;
  readonly model: AgentModelSelection;
  readonly egressClass: AgentEgressClass;
  readonly provider: AgentProviderEvidence;
  readonly limits: AgentTurnLimits;
  readonly recorded: { readonly runtimeThreadRef?: string; readonly runtimeInputRef?: string; readonly runtimeScheduleRef?: string; readonly runtimeTurnRef?: string };
};

export type AgentTurnPreparation =
  | { readonly kind: "ready"; readonly plan: AgentTurnPlan }
  | { readonly kind: "terminal"; readonly runStatus: Doc<"intelligenceRun">["status"]; readonly step: AgentTurnBindingStep }
  | { readonly kind: "refused"; readonly code: string; readonly message: string }
  | { readonly kind: "not_found" };

export type AgentTurnUsageSettlement = {
  readonly tokens: { readonly input: number; readonly output: number; readonly cachedInput: number; readonly reasoning: number };
  readonly streams: number;
  readonly conservative: boolean;
  readonly settledBy: readonly string[];
  readonly lateEventCount: number;
  readonly costUnits: number;
};

export type AgentFinalizeTurnOutcome = { readonly outcome: "completed" | "failed" | "canceled" | "already_terminal"; readonly runStatus: Doc<"intelligenceRun">["status"] | null };

function defaultProviderConfigured(providerId: string): boolean {
  if (providerId === "openai") return typeof process.env.OPENAI_API_KEY === "string" && process.env.OPENAI_API_KEY.length > 0;
  return false;
}

export function createAgentTurnSeams(config: AgentTurnSeamConfig) {
  const { admission, outbox } = config;
  const registry = admission.registry;
  const isProviderConfigured = config.isProviderConfigured ?? defaultProviderConfigured;

  async function loadTurn(ctx: ReadCtx, bindingId: Id<"agentTurnBinding">) {
    const binding = await ctx.db.get("agentTurnBinding", bindingId);
    if (!binding) return null;
    const run = await ctx.db.get("intelligenceRun", binding.runId);
    if (!run || run.harnessKind !== "agent") return null;
    const grant = run.runGrantId ? await ctx.db.get("agentRunGrant", run.runGrantId) : null;
    if (!grant) return null;
    return { binding, run, grant };
  }

  // ----- describeGrant (query) ------------------------------------------------

  async function describeGrantWithCtx(ctx: ReadCtx, input: { runId: Id<"intelligenceRun">; now: number }): Promise<AgentDescribeGrantOutcome> {
    const verdict = await admission.reauthorizeGrantWithCtx(ctx, { runId: input.runId, purpose: "dispatch", now: input.now });
    if (verdict.kind === "refused") return { kind: "refused", stage: verdict.stage, reason: verdict.reason };
    return { kind: "authorized", grant: admission.describeGrantForModel(verdict) };
  }

  // ----- prepareTurn (mutation) -----------------------------------------------

  async function prepareTurnWithCtx(ctx: MutationCtx, input: { bindingId: Id<"agentTurnBinding">; now: number }): Promise<AgentTurnPreparation> {
    const loaded = await loadTurn(ctx, input.bindingId);
    if (!loaded) return { kind: "not_found" };
    const { binding, run, grant } = loaded;
    if (isTerminalRunStatus(run.status) || binding.abandonedAt !== undefined) return { kind: "terminal", runStatus: run.status, step: binding.step };

    const refuse = async (code: string, message: string, retryable: boolean): Promise<AgentTurnPreparation> => {
      await failAgentRunWithCtx(ctx, { runId: run._id, idempotencyKey: `host-refused:${code}`, error: { code, message, retryable }, now: input.now });
      return { kind: "refused", code, message };
    };

    const fence = await checkRunEpochFenceWithCtx(ctx, run);
    if (fence.fenced) return refuse("compatibility_epoch_fenced", "This run belongs to an older release and can no longer proceed.", true);
    const delegation = grant.delegation;
    if (!delegation) return refuse("delegation_missing", "The run carries no delegated grant.", false);
    const profile = registry.profiles[grant.profileKey];
    if (!profile) return refuse("profile_disabled", "This profile is not available.", false);
    const viewer: DelegatedOperator = { kind: delegation.operatorKind, athenaUserId: delegation.athenaUserId, authUserId: delegation.authUserId };
    const authority = await resolveViewerAuthorityWithCtx(ctx, admission.config, { viewer, storeId: grant.storeId, organizationId: grant.organizationId, profileId: grant.profileKey, now: input.now });
    if (authority.kind === "unauthorized") {
      const code = authority.reason === "profile_disabled" || authority.reason === "profile_unpublished" || authority.reason === "profile_unknown" ? "profile_disabled" : "authority_revoked";
      return refuse(code, `Authority check failed: ${authority.reason}.`, false);
    }
    const promptRow = grant.promptPayloadId ? await ctx.db.get("agentPromptPayload", grant.promptPayloadId) : null;
    const question = promptRow && typeof promptRow.payload.question === "string" ? promptRow.payload.question : null;
    if (!promptRow || question === null || promptRow.expiresAt <= input.now) return refuse("prompt_unavailable", "The question is no longer available.", false);
    const contextRaw = promptRow.payload.context;
    const context: Record<string, string> = {};
    if (contextRaw && typeof contextRaw === "object" && !Array.isArray(contextRaw)) {
      for (const [key, value] of Object.entries(contextRaw as Record<string, unknown>)) if (typeof value === "string") context[key] = value;
    }

    const threadKey = binding.threadKey ?? `binding:${binding._id}`;
    const projection = await projectThreadHistoryWithCtx(ctx, admission.config, {
      storeId: grant.storeId,
      organizationId: grant.organizationId,
      profileId: grant.profileKey,
      threadKey,
      viewer,
      now: input.now,
      excludeBindingId: binding._id,
    });
    if (projection.kind === "unauthorized") return refuse("authority_revoked", `History could not be reauthorized: ${projection.reason}.`, false);
    const history = toModelHistory(projection);

    const egressClass = resolveTurnEgressClass({ prompt: "operational", context: "operational", grant: grant.egressClass as AgentEgressClass, history: historyEgressClass(history) });
    const selected = selectProviderForEgress(profile.egressPolicy, egressClass, { isConfigured: isProviderConfigured });
    if (selected.kind !== "selected") return refuse("no_compatible_provider", "No allowlisted provider covers this turn's egress class.", false);

    const prompt = assembleTurnPrompt({ profileId: grant.profileKey, intent: profile.promptPolicy.intent, untrustedDataLabel: profile.promptPolicy.untrustedDataLabel, context, question, egressClass: "operational" });
    const provider = describeProviderSelectionForEvidence(selected, egressClass);

    const existingInvocation = await ctx.db.query("intelligenceProviderInvocation").withIndex("by_runId", (q) => q.eq("runId", run._id)).take(1);
    if (existingInvocation.length === 0) {
      await ctx.db.insert("intelligenceProviderInvocation", {
        storeId: grant.storeId,
        organizationId: grant.organizationId,
        runId: run._id,
        providerKey: grant.adapterKind,
        providerModel: `${provider.providerId}/${provider.modelId}`,
        capability: run.capability,
        status: "started",
        requestSummary: {
          ...provider,
          adapterVersion: grant.adapterVersion,
          promptHash: prompt.promptHash,
          historyDigest: history.projectionDigest,
          historyMessages: history.messages.length,
          egressClass,
        },
        rawPayloadStored: false,
        startedAt: input.now,
      });
    }

    const elapsed = Math.max(grant.budgetPolicy.runLimits.elapsedMs, AGENT_PROGRAM_RUNTIME_CEILINGS.maxElapsedMs) + AGENT_TURN_ELAPSED_HEADROOM_MS;
    const athenaThreadKey = athenaThreadKeyFor({ profileId: grant.profileKey, storeId: grant.storeId, actorRef: grant.initiatingActorRef, threadKey });
    return {
      kind: "ready",
      plan: {
        bindingId: binding._id,
        runId: run._id,
        storeId: grant.storeId,
        organizationId: grant.organizationId,
        profileId: grant.profileKey,
        actorRef: grant.initiatingActorRef,
        threadKey,
        step: binding.step,
        adapterKind: grant.adapterKind,
        adapterVersion: grant.adapterVersion,
        adapter: {
          threadKey: athenaThreadKey,
          contextBindingRef: contextBindingRefFor(athenaThreadKey),
          correlation: { operatorRef: operatorCorrelationRef(grant.initiatingActorRef), profileId: grant.profileKey },
          turnKey: turnKeyFor(binding._id),
        },
        prompt,
        history,
        model: selected.selection,
        egressClass,
        provider,
        limits: { maxToolCalls: grant.budgetPolicy.maxAttempts * 2 + 4, maxElapsedMs: elapsed },
        recorded: {
          runtimeThreadRef: binding.runtimeThreadRef,
          runtimeInputRef: binding.runtimeInputRef,
          runtimeScheduleRef: binding.runtimeScheduleRef,
          runtimeTurnRef: binding.runtimeTurnRef,
        },
      },
    };
  }

  // ----- markTurnRunning (mutation) -------------------------------------------

  async function markTurnRunningWithCtx(ctx: MutationCtx, input: { bindingId: Id<"agentTurnBinding">; now: number }): Promise<{ outcome: "running" | "already_running" | "rejected"; code?: string }> {
    const binding = await ctx.db.get("agentTurnBinding", input.bindingId);
    if (!binding) return { outcome: "rejected", code: "binding_not_found" };
    if (isBindingStepAtOrBeyond(binding.step, "running")) return { outcome: "already_running" };
    if (binding.step === "runtime_input_saved") {
      const scheduled = await advanceTurnBindingWithCtx(ctx, {
        bindingId: binding._id,
        step: "scheduled",
        idempotencyKey: `scheduled:${binding.repairCount}`,
        now: input.now,
        runtimeScheduleRef: `runtime_schedule:host.${sha256Hex(`${binding._id}:${binding.repairCount}`).slice(0, 24)}`,
      });
      if (scheduled.outcome === "rejected") return { outcome: "rejected", code: scheduled.denial.code };
    }
    const running = await advanceTurnBindingWithCtx(ctx, { bindingId: binding._id, step: "running", idempotencyKey: "running", now: input.now });
    if (running.outcome === "rejected") return { outcome: "rejected", code: running.denial.code };
    return { outcome: running.outcome === "advanced" ? "running" : "already_running" };
  }

  /**
   * Record the runtime turn and the adapter that actually holds this turn's
   * runtime payloads. The grant keeps the registry's pinned adapter token for
   * compatibility identity; the binding names the adapter retention must ask.
   */
  async function recordRuntimeTurnRefWithCtx(
    ctx: MutationCtx,
    input: { bindingId: Id<"agentTurnBinding">; runtimeTurnRef: string; adapterKind?: string; adapterVersion?: string; now: number },
  ): Promise<void> {
    const binding = await ctx.db.get("agentTurnBinding", input.bindingId);
    if (!binding) return;
    const patch: Partial<Doc<"agentTurnBinding">> = {};
    if (binding.runtimeTurnRef !== input.runtimeTurnRef) patch.runtimeTurnRef = input.runtimeTurnRef;
    if (input.adapterKind && binding.adapterKind !== input.adapterKind) patch.adapterKind = input.adapterKind;
    if (input.adapterVersion && binding.adapterVersion !== input.adapterVersion) patch.adapterVersion = input.adapterVersion;
    if (Object.keys(patch).length === 0) return;
    await ctx.db.patch("agentTurnBinding", binding._id, { ...patch, updatedAt: input.now });
  }

  async function recordTurnProgressWithCtx(ctx: MutationCtx, input: { bindingId: Id<"agentTurnBinding">; milestone: AgentProgressMilestone; now: number }): Promise<void> {
    const binding = await ctx.db.get("agentTurnBinding", input.bindingId);
    if (!binding || binding.abandonedAt !== undefined) return;
    const progress = [...(binding.progress ?? []), { milestone: input.milestone, at: input.now }].slice(-AGENT_TURN_PROGRESS_CAP);
    await ctx.db.patch("agentTurnBinding", binding._id, { progress, updatedAt: input.now });
  }

  async function peekTurnStateWithCtx(ctx: ReadCtx, bindingId: Id<"agentTurnBinding">) {
    const loaded = await loadTurn(ctx, bindingId);
    if (!loaded) return { found: false as const };
    return {
      found: true as const,
      runStatus: loaded.run.status,
      step: loaded.binding.step,
      abandoned: loaded.binding.abandonedAt !== undefined,
      committed: loaded.binding.operatorReleaseCommittedAt !== undefined,
      projected: loaded.binding.runtimeProjectionRef !== undefined,
      suppressed: loaded.binding.releaseSuppressedAt !== undefined,
      errorCode: loaded.run.error?.code,
    };
  }

  // ----- finalizeTurn (mutation) ----------------------------------------------

  async function finalizeTurnWithCtx(
    ctx: MutationCtx,
    input: {
      bindingId: Id<"agentTurnBinding">;
      outcome: "completed" | "failed" | "canceled";
      error?: { code: string; message: string; retryable: boolean };
      usage?: AgentTurnUsageSettlement;
      purgeRuntime?: boolean;
      now: number;
    },
  ): Promise<AgentFinalizeTurnOutcome> {
    const loaded = await loadTurn(ctx, input.bindingId);
    if (!loaded) return { outcome: "already_terminal", runStatus: null };
    const { binding, run, grant } = loaded;
    let outcome: AgentFinalizeTurnOutcome["outcome"] = "already_terminal";
    if (!isTerminalRunStatus(run.status)) {
      if (input.outcome === "completed") {
        const committed = binding.operatorReleaseCommittedAt !== undefined;
        if (!committed) {
          await failAgentRunWithCtx(ctx, { runId: run._id, idempotencyKey: "completion_missing", error: { code: "completion_missing", message: "The turn ended without athena.completeRun.", retryable: true }, now: input.now });
          outcome = "failed";
        }
      } else if (input.outcome === "failed") {
        const error = input.error ?? { code: "turn_failed", message: "The turn failed.", retryable: false };
        await failAgentRunWithCtx(ctx, { runId: run._id, idempotencyKey: `turn-failed:${error.code}`, error: { ...error, message: redactProviderSecrets(error.message).slice(0, 500) }, now: input.now });
        outcome = "failed";
      } else {
        await cancelAgentRunWithCtx(ctx, { runId: run._id, idempotencyKey: `turn-canceled:${input.error?.code ?? "canceled"}`, reason: input.error?.code ?? "canceled", now: input.now });
        outcome = "canceled";
      }
    } else if (run.status === "completed") {
      outcome = "completed";
    }
    const refreshed = await ctx.db.get("intelligenceRun", run._id);

    // Usage settles exactly once: the provider invocation row records it and the spend window settles with it.
    const invocations = await ctx.db.query("intelligenceProviderInvocation").withIndex("by_runId", (q) => q.eq("runId", run._id)).take(1);
    const invocation = invocations[0];
    if (invocation && invocation.status === "started") {
      const usage = input.usage ?? { tokens: { input: 0, output: 0, cachedInput: 0, reasoning: 0 }, streams: 0, conservative: true, settledBy: [], lateEventCount: 0, costUnits: 0 };
      const finalOutcome = refreshed?.status === "completed" ? "completed" : refreshed?.status === "canceled" ? "canceled" : "failed";
      await ctx.db.patch("intelligenceProviderInvocation", invocation._id, {
        status: finalOutcome === "completed" ? "succeeded" : "failed",
        responseSummary: buildConvexAgentInvocationSummary(usage, finalOutcome),
        error: input.error ? { code: input.error.code, message: redactProviderSecrets(input.error.message).slice(0, 500), retryable: input.error.retryable } : undefined,
        completedAt: input.now,
      });
      await settleTurnSpendWithCtx(ctx, {
        actorRef: grant.initiatingActorRef,
        storeId: grant.storeId,
        windowKey: spendWindowKey(run.createdAt),
        reservedCostUnits: turnProviderCostReservation(),
        actualCostUnits: usage.costUnits,
        now: input.now,
      });
    }
    if (input.purgeRuntime) {
      const current = await ctx.db.get("agentTurnBinding", binding._id);
      if (current && current.runtimeCleanupStatus !== "succeeded") {
        await ctx.db.patch("agentTurnBinding", binding._id, { runtimeCleanupStatus: "pending", runtimeCleanupNextAttemptAt: input.now, updatedAt: input.now });
        await requestRuntimeCleanupWithCtx(ctx, binding._id, input.now);
      }
    }
    return { outcome, runStatus: refreshed?.status ?? null };
  }

  const milestoneValidator = v.union(...AGENT_PROGRESS_MILESTONES.map((milestone) => v.literal(milestone)));

  const functions = {
    describeGrant: internalQuery({
      args: { runId: v.id("intelligenceRun"), now: v.optional(v.number()) },
      handler: async (ctx, args) => describeGrantWithCtx(ctx, { runId: args.runId, now: args.now ?? Date.now() }),
    }),
    prepareTurn: internalMutation({
      args: { bindingId: v.id("agentTurnBinding"), now: v.optional(v.number()) },
      handler: async (ctx, args) => prepareTurnWithCtx(ctx, { bindingId: args.bindingId, now: args.now ?? Date.now() }),
    }),
    markTurnRunning: internalMutation({
      args: { bindingId: v.id("agentTurnBinding"), now: v.optional(v.number()) },
      handler: async (ctx, args) => markTurnRunningWithCtx(ctx, { bindingId: args.bindingId, now: args.now ?? Date.now() }),
    }),
    recordRuntimeTurnRef: internalMutation({
      args: { bindingId: v.id("agentTurnBinding"), runtimeTurnRef: v.string(), adapterKind: v.optional(v.string()), adapterVersion: v.optional(v.string()), now: v.optional(v.number()) },
      handler: async (ctx, args) => recordRuntimeTurnRefWithCtx(ctx, { ...args, now: args.now ?? Date.now() }),
    }),
    recordTurnProgress: internalMutation({
      args: { bindingId: v.id("agentTurnBinding"), milestone: milestoneValidator, now: v.optional(v.number()) },
      handler: async (ctx, args) => recordTurnProgressWithCtx(ctx, { ...args, now: args.now ?? Date.now() }),
    }),
    peekTurnState: internalQuery({
      args: { bindingId: v.id("agentTurnBinding") },
      handler: async (ctx, args) => peekTurnStateWithCtx(ctx, args.bindingId),
    }),
    finalizeTurn: internalMutation({
      args: {
        bindingId: v.id("agentTurnBinding"),
        outcome: v.union(v.literal("completed"), v.literal("failed"), v.literal("canceled")),
        error: v.optional(v.object({ code: v.string(), message: v.string(), retryable: v.boolean() })),
        usage: v.optional(
          v.object({
            tokens: v.object({ input: v.number(), output: v.number(), cachedInput: v.number(), reasoning: v.number() }),
            streams: v.number(),
            conservative: v.boolean(),
            settledBy: v.array(v.string()),
            lateEventCount: v.number(),
            costUnits: v.number(),
          }),
        ),
        purgeRuntime: v.optional(v.boolean()),
        now: v.optional(v.number()),
      },
      handler: async (ctx, args) => finalizeTurnWithCtx(ctx, { ...args, now: args.now ?? Date.now() }),
    }),
  };

  return {
    config,
    describeGrantWithCtx,
    prepareTurnWithCtx,
    markTurnRunningWithCtx,
    recordRuntimeTurnRefWithCtx,
    recordTurnProgressWithCtx,
    peekTurnStateWithCtx,
    finalizeTurnWithCtx,
    outbox,
    functions,
  };
}

export type AgentTurnSeams = ReturnType<typeof createAgentTurnSeams>;

// ---------------------------------------------------------------------------
// Production binding
// ---------------------------------------------------------------------------

export const agentTurnSeams = createAgentTurnSeams({ admission: agentDelegatedAdmission, outbox: agentCompletionOutbox });

export const describeGrant = agentTurnSeams.functions.describeGrant;
export const prepareTurn = agentTurnSeams.functions.prepareTurn;
export const markTurnRunning = agentTurnSeams.functions.markTurnRunning;
export const recordRuntimeTurnRef = agentTurnSeams.functions.recordRuntimeTurnRef;
export const recordTurnProgress = agentTurnSeams.functions.recordTurnProgress;
export const peekTurnState = agentTurnSeams.functions.peekTurnState;
export const finalizeTurn = agentTurnSeams.functions.finalizeTurn;

// ---------------------------------------------------------------------------
// Entry points (operation-admitted; U9 consumes these)
//
// The handlers are built by `createAgentTurnEntryPoints(seams)` so the test
// package can prove them end to end; the public functions below bind the
// production seams. Every handler reauthorizes the viewer itself.
// ---------------------------------------------------------------------------

export type AgentTurnEntryPointConfig = {
  readonly seams: AgentTurnSeams;
  readonly readCitationEvidence: (ctx: MutationCtx, input: { runId: Id<"intelligenceRun">; citationRef: string; viewer: DelegatedOperator; purpose: string; now: number }) => Promise<AgentCitationEvidenceForViewer>;
  readonly scheduleDriveTurn: (ctx: MutationCtx, bindingId: Id<"agentTurnBinding">) => Promise<void>;
  readonly scheduleOutboxRepair: (ctx: MutationCtx, bindingId: Id<"agentTurnBinding">) => Promise<void>;
  readonly now?: () => number;
};

type AdmittedMutationCtx = MutationCtx & { operationAdmission: { actor: OperationActor } };
type AdmittedQueryCtx = QueryCtx & { operationAdmission: { actor: OperationActor } };

export type StartTurnArgs = { storeId: Id<"store">; profileId: string; threadKey: string; turnIdempotencyKey: string; prompt: string; context?: { [key: string]: string } };
type TurnArgs = { storeId: Id<"store">; bindingId: Id<"agentTurnBinding"> };

const deniedResult = (code: string, message: string, retryable = false) => ({ outcome: "denied" as const, code, message, retryable });
const unavailable = (reason: string) => ({ kind: "unavailable" as const, reason });

type TurnAccess =
  | { kind: "ok"; binding: Doc<"agentTurnBinding">; run: Doc<"intelligenceRun">; grant: Doc<"agentRunGrant">; viewer: DelegatedOperator; viewerEgressClass: AgentEgressClass }
  | { kind: "unavailable"; reason: string };

function phaseOf(status: Doc<"intelligenceRun">["status"]): "queued" | "running" | "completed" | "failed" | "canceled" {
  switch (status) {
    case "queued":
    case "context_captured":
      return "queued";
    default:
      return status;
  }
}

async function promptStateOf(ctx: ReadCtx, grant: Doc<"agentRunGrant">, now: number) {
  const row = grant.promptPayloadId ? await ctx.db.get("agentPromptPayload", grant.promptPayloadId) : null;
  const retained = row !== null && row.expiresAt > now;
  const state: "retained" | "expired" | "deleted" = retained ? "retained" : grant.promptPayloadState === "deleted_by_lifecycle" ? "deleted" : "expired";
  const question = retained && typeof row.payload.question === "string" ? row.payload.question : undefined;
  const contextRaw = retained ? row.payload.context : undefined;
  const context: Record<string, string> | undefined = contextRaw && typeof contextRaw === "object" && !Array.isArray(contextRaw)
    ? Object.fromEntries(Object.entries(contextRaw as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
    : undefined;
  return { state, question, context };
}

function toHistoryEntryView(entry: AgentThreadHistoryEntry) {
  return {
    bindingId: entry.bindingId,
    runId: entry.runId,
    createdAt: entry.createdAt,
    runStatus: entry.runStatus,
    state: entry.state,
    questionState: entry.questionState,
    ...(entry.question !== undefined ? { question: entry.question } : {}),
    ...(entry.context ? { context: entry.context } : {}),
    ...(entry.answer ? { answer: { ...entry.answer, citations: entry.answer.citations.map((citation) => ({ ...citation })) } } : {}),
    ...(entry.omittedReason ? { omittedReason: entry.omittedReason } : {}),
    ...(entry.error ? { error: entry.error } : {}),
  };
}

export function createAgentTurnEntryPoints(config: AgentTurnEntryPointConfig) {
  const { seams } = config;
  const admission = seams.config.admission;
  const registry = admission.registry;
  const now = () => config.now?.() ?? Date.now();
  const isProviderConfigured = seams.config.isProviderConfigured ?? defaultProviderConfigured;

  async function reauthorizeTurnAccess(ctx: ReadCtx, actor: OperationActor, storeId: Id<"store">, bindingId: Id<"agentTurnBinding">, at: number): Promise<TurnAccess> {
    const viewer = operatorFromActor(actor);
    if (!viewer) return { kind: "unavailable", reason: "operator_unauthorized" };
    const binding = await ctx.db.get("agentTurnBinding", bindingId);
    if (!binding || binding.storeId !== storeId) return { kind: "unavailable", reason: "not_found" };
    const run = await ctx.db.get("intelligenceRun", binding.runId);
    const grant = run?.runGrantId ? await ctx.db.get("agentRunGrant", run.runGrantId) : null;
    if (!run || !grant || !grant.delegation) return { kind: "unavailable", reason: "not_found" };
    if (grant.delegation.athenaUserId !== viewer.athenaUserId) return { kind: "unavailable", reason: "not_your_turn" };
    const authority = await resolveViewerAuthorityWithCtx(ctx, admission.config, { viewer, storeId, organizationId: grant.organizationId, profileId: grant.profileKey, now: at });
    if (authority.kind === "unauthorized") return { kind: "unavailable", reason: authority.reason };
    return { kind: "ok", binding, run, grant, viewer, viewerEgressClass: authority.egressClass };
  }

  async function loadAuthorizedAnswer(ctx: ReadCtx, access: Extract<TurnAccess, { kind: "ok" }>) {
    const { binding, run } = access;
    if (binding.releaseSuppressedAt !== undefined) return unavailable("suppressed");
    if (run.status !== "completed" || !run.artifactId || binding.operatorReleaseCommittedAt === undefined) return unavailable("not_ready");
    const artifact = await ctx.db.get("intelligenceArtifact", run.artifactId);
    const payload = artifact ? parseAnswerPayload(artifact.payload) : null;
    if (!artifact || artifact.status !== "ready" || !payload) return unavailable("not_ready");
    if (egressClassRank(payload.egressClass) > egressClassRank(access.viewerEgressClass)) return unavailable("egress_beyond_authority");
    return {
      kind: "answer" as const,
      outcome: payload.outcome,
      ...(artifact.title ? { title: artifact.title } : {}),
      ...(artifact.summary ? { summary: artifact.summary } : {}),
      narrative: payload.narrative,
      egressClass: payload.egressClass,
      ...(artifact.confidence !== undefined ? { confidence: artifact.confidence } : {}),
      ...(artifact.limitedEvidence !== undefined ? { limitedEvidence: artifact.limitedEvidence } : {}),
      committedAt: binding.operatorReleaseCommittedAt,
      ...(binding.operatorViewedAt !== undefined ? { viewedAt: binding.operatorViewedAt } : {}),
      citations: payload.citations.map((citation) => ({ citationRef: citation.ref, ...(citation.namespace ? { namespace: citation.namespace } : {}), ...(citation.label ? { label: citation.label } : {}) })),
    };
  }

  /**
   * Start a turn. Order: profile → prompt → operator → store → thread key →
   * context → idempotent resume → grant (switch, authority, projection) →
   * zero capabilities → provider egress → admission (limits, thread, spend) →
   * intent (one transaction) → schedule the host. A denial persists nothing.
   */
  async function startTurn(ctx: AdmittedMutationCtx, args: StartTurnArgs) {
    const at = now();
    const profile = registry.profiles[args.profileId];
    if (!profile) return deniedResult("profile_unavailable", "Ask Athena isn't available here yet.");
    const validated = validateOperatorPrompt(args.prompt, { maxPromptBytes: profile.promptPolicy.maxPromptBytes, maxPromptTokens: profile.promptPolicy.maxPromptTokens });
    if (!validated.ok) return deniedResult(`prompt_${validated.code}`, validated.message);
    const operator = operatorFromActor(ctx.operationAdmission.actor);
    if (!operator) return deniedResult("operator_unauthorized", "Sign in to ask Athena.");
    const store = await ctx.db.get("store", args.storeId);
    if (!store) return deniedResult("store_unavailable", "This store isn't available.");
    if (!AGENT_THREAD_KEY_PATTERN.test(args.threadKey) || !AGENT_THREAD_KEY_PATTERN.test(args.turnIdempotencyKey)) {
      return deniedResult("thread_key_invalid", "The conversation reference is not valid.");
    }
    const context = validateContextValues(args.context);
    if (!context.ok) return deniedResult("context_invalid", context.message);

    const existing = await resolveTurnWithCtx(ctx, { storeId: args.storeId, turnIdempotencyKey: args.turnIdempotencyKey });
    if (existing.kind !== "none") {
      const binding = await ctx.db.get("agentTurnBinding", existing.bindingId);
      return { outcome: "resumed" as const, bindingId: existing.bindingId, runId: existing.runId, threadKey: binding?.threadKey ?? args.threadKey, step: existing.step, runStatus: existing.runStatus, terminal: existing.kind === "terminal" };
    }

    const prepared = await admission.prepareRunGrantWithCtx(ctx, { operator, profileId: args.profileId, organizationId: store.organizationId, storeId: args.storeId, now: at });
    if (prepared.kind === "refused") {
      if (prepared.stage === "enablement") return deniedResult("profile_unavailable", "Ask Athena isn't available here right now.");
      if (prepared.stage === "operator") return deniedResult("operator_unauthorized", "You don't have access to this store.");
      return deniedResult(prepared.reason, "Ask Athena isn't available right now.", prepared.retryable);
    }
    if (prepared.projection.capabilities.length === 0) return deniedResult("no_granted_capabilities", "There's nothing Athena can read for you in this store.");
    const egressClass = resolveTurnEgressClass({ prompt: "operational", context: "operational", grant: prepared.projection.egressClass, history: "operational" });
    const selected = selectProviderForEgress(profile.egressPolicy, egressClass, { isConfigured: isProviderConfigured });
    if (selected.kind !== "selected") return deniedResult("no_compatible_provider", "Athena can't answer this safely right now.");

    const admitted = await admitTurnStartWithCtx(ctx, { actorRef: prepared.runInput.actorRef, storeId: args.storeId, threadKey: args.threadKey, maxProviderCostUnits: turnProviderCostReservation(), now: at });
    if (!admitted.ok) return deniedResult(admitted.code, admitted.message, admitted.retryable);

    const intent = await recordTurnIntentWithCtx(ctx, {
      ...prepared.runInput,
      turnIdempotencyKey: args.turnIdempotencyKey,
      threadKey: args.threadKey,
      promptPayload: { question: validated.text, context: context.context, normalizations: [...validated.normalizations], estimatedTokens: validated.estimatedTokens },
      now: at,
    });
    if (intent.outcome === "rejected") {
      // Roll back the spend reservation with the transaction: nothing partial survives.
      throw new Error(`Turn intent rejected after admission: ${intent.denial.code}`);
    }
    if (intent.outcome === "resumed") {
      return { outcome: "resumed" as const, bindingId: intent.bindingId, runId: intent.runId, threadKey: args.threadKey, step: intent.step, runStatus: intent.runStatus, terminal: isTerminalRunStatus(intent.runStatus) };
    }
    await config.scheduleDriveTurn(ctx, intent.bindingId);
    return { outcome: "started" as const, bindingId: intent.bindingId, runId: intent.runId, threadKey: args.threadKey };
  }

  /** Reactive run/turn view: status, server-authored milestones, context label inputs, terminal outcome availability. */
  async function getTurnView(ctx: AdmittedQueryCtx, args: TurnArgs) {
    const at = now();
    const access = await reauthorizeTurnAccess(ctx, ctx.operationAdmission.actor, args.storeId, args.bindingId, at);
    if (access.kind === "unavailable") return unavailable(access.reason);
    const { binding, run, grant } = access;
    const prompt = await promptStateOf(ctx, grant, at);
    const artifact = run.status === "completed" && run.artifactId ? await ctx.db.get("intelligenceArtifact", run.artifactId) : null;
    const payload = artifact ? parseAnswerPayload(artifact.payload) : null;
    const suppressed = binding.releaseSuppressedAt !== undefined;
    const available = !suppressed && payload !== null && binding.operatorReleaseCommittedAt !== undefined && egressClassRank(payload.egressClass) <= egressClassRank(access.viewerEgressClass);
    const terminal = isTerminalRunStatus(run.status);
    return {
      kind: "view" as const,
      bindingId: binding._id,
      runId: run._id,
      profileId: grant.profileKey,
      threadKey: binding.threadKey ?? "",
      createdAt: binding.createdAt,
      updatedAt: Math.max(binding.updatedAt, run.updatedAt),
      phase: phaseOf(run.status),
      step: binding.step,
      milestones: (binding.progress ?? []).map((entry) => ({ milestone: entry.milestone, at: entry.at })),
      ...(prompt.question !== undefined ? { question: prompt.question } : {}),
      ...(prompt.context ? { context: prompt.context } : {}),
      promptState: prompt.state,
      answer: {
        available,
        ...(available && payload ? { outcome: payload.outcome } : {}),
        suppressed,
        ...(binding.operatorViewedAt !== undefined ? { viewedAt: binding.operatorViewedAt } : {}),
      },
      ...(terminal && run.status !== "completed"
        ? { error: { code: run.error?.code ?? run.status, retryable: run.error?.retryable === true, headline: describeTurnErrorForOperator(run.error?.code ?? run.status) } }
        : {}),
      canCancel: !terminal,
    };
  }

  /** Reauthorized answer read. Viewing is acknowledged separately (`acknowledgeTurnAnswer`). */
  async function getTurnAnswer(ctx: AdmittedQueryCtx, args: TurnArgs) {
    const access = await reauthorizeTurnAccess(ctx, ctx.operationAdmission.actor, args.storeId, args.bindingId, now());
    if (access.kind === "unavailable") return unavailable(access.reason);
    return loadAuthorizedAnswer(ctx, access);
  }

  /**
   * First authorized fetch records `operatorViewedAt` (browser receipt that
   * cannot be recalled). Authority lost after commit but before this call
   * suppresses release and asks the adapter to purge.
   */
  async function acknowledgeTurnAnswer(ctx: AdmittedMutationCtx, args: TurnArgs) {
    const at = now();
    const viewer = operatorFromActor(ctx.operationAdmission.actor);
    const binding = await ctx.db.get("agentTurnBinding", args.bindingId);
    if (!viewer || !binding || binding.storeId !== args.storeId) return unavailable("not_found");
    const access = await reauthorizeTurnAccess(ctx, ctx.operationAdmission.actor, args.storeId, args.bindingId, at);
    if (access.kind === "unavailable") {
      const committedUnviewed = binding.operatorReleaseCommittedAt !== undefined && binding.operatorViewedAt === undefined;
      const ownTurn = access.reason !== "not_found" && access.reason !== "not_your_turn" && access.reason !== "operator_unauthorized";
      if (committedUnviewed && ownTurn) {
        await seams.outbox.suppressReleaseWithCtx(ctx, { bindingId: binding._id, reason: access.reason, now: at });
        return { kind: "suppressed" as const, reason: access.reason };
      }
      return unavailable(access.reason);
    }
    const answer = await loadAuthorizedAnswer(ctx, access);
    if (answer.kind === "unavailable") {
      if (answer.reason === "egress_beyond_authority" && access.binding.operatorViewedAt === undefined) {
        await seams.outbox.suppressReleaseWithCtx(ctx, { bindingId: access.binding._id, reason: answer.reason, now: at });
        return { kind: "suppressed" as const, reason: answer.reason };
      }
      return answer;
    }
    const acknowledged = await acknowledgeOperatorViewWithCtx(ctx, { bindingId: access.binding._id, viewerActorRef: access.grant.initiatingActorRef, now: at });
    if (!acknowledged.acknowledged || acknowledged.operatorViewedAt === undefined) return unavailable("not_ready");
    return { kind: "acknowledged" as const, operatorViewedAt: acknowledged.operatorViewedAt, answer: { ...answer, viewedAt: acknowledged.operatorViewedAt } };
  }

  async function cancelTurn(ctx: AdmittedMutationCtx, args: TurnArgs) {
    const at = now();
    const access = await reauthorizeTurnAccess(ctx, ctx.operationAdmission.actor, args.storeId, args.bindingId, at);
    if (access.kind === "unavailable") return { outcome: "unavailable" as const, reason: access.reason };
    if (isTerminalRunStatus(access.run.status)) return { outcome: "already_terminal" as const, runStatus: access.run.status };
    const result = await cancelAgentRunWithCtx(ctx, { runId: access.run._id, idempotencyKey: `operator-cancel:${access.binding._id}`, reason: "operator_canceled", now: at });
    if (result.outcome === "advanced") return { outcome: "canceled" as const };
    return { outcome: "already_terminal" as const, runStatus: result.status ?? access.run.status };
  }

  /** Resume/reconnect by binding: repairs a stale rung or a pending projection without duplicating anything. */
  async function resumeTurn(ctx: AdmittedMutationCtx, args: TurnArgs) {
    const at = now();
    const access = await reauthorizeTurnAccess(ctx, ctx.operationAdmission.actor, args.storeId, args.bindingId, at);
    if (access.kind === "unavailable") return { outcome: "unavailable" as const, reason: access.reason };
    const resumed = await resumeTurnBindingWithCtx(ctx, { bindingId: access.binding._id, now: at });
    if (!resumed) return { outcome: "unavailable" as const, reason: "not_found" };
    switch (resumed.action) {
      case "retry_step":
        await config.scheduleDriveTurn(ctx, access.binding._id);
        return { outcome: "retry_scheduled" as const, step: resumed.step, runStatus: resumed.runStatus };
      case "await_projection":
        await config.scheduleOutboxRepair(ctx, access.binding._id);
        return { outcome: "projection_scheduled" as const, step: resumed.step, runStatus: resumed.runStatus };
      case "continue":
        return { outcome: "continue" as const, step: resumed.step, runStatus: resumed.runStatus };
      case "terminal":
        return { outcome: "terminal" as const, step: resumed.step, runStatus: resumed.runStatus };
      case "abandoned":
        return { outcome: "abandoned" as const, step: resumed.step, runStatus: resumed.runStatus };
    }
  }

  /** Reauthorized thread history: the Athena projection, never raw runtime messages. */
  async function getThreadHistory(ctx: AdmittedQueryCtx, args: { storeId: Id<"store">; profileId: string; threadKey: string; limit?: number }) {
    const at = now();
    const viewer = operatorFromActor(ctx.operationAdmission.actor);
    if (!viewer) return unavailable("operator_unauthorized");
    const store = await ctx.db.get("store", args.storeId);
    if (!store) return unavailable("not_found");
    const projection = await projectThreadHistoryWithCtx(ctx, admission.config, {
      storeId: args.storeId,
      organizationId: store.organizationId,
      profileId: args.profileId,
      threadKey: args.threadKey,
      viewer,
      now: at,
      limit: args.limit,
    });
    if (projection.kind === "unauthorized") return unavailable(projection.reason);
    return { kind: "history" as const, threadKey: args.threadKey, reauthorizedAt: projection.reauthorizedAt, entries: projection.entries.map(toHistoryEntryView) };
  }

  /** Source/evidence lookup for the operator (U6 viewer lookup; audited, reauthorized, no raw ids). */
  async function inspectCitationEvidence(ctx: AdmittedMutationCtx, args: TurnArgs & { citationRef: string }) {
    const at = now();
    const access = await reauthorizeTurnAccess(ctx, ctx.operationAdmission.actor, args.storeId, args.bindingId, at);
    if (access.kind === "unavailable") return { kind: "unauthorized" as const, reason: access.reason };
    return config.readCitationEvidence(ctx, { runId: access.run._id, citationRef: args.citationRef, viewer: access.viewer, purpose: "operator_evidence_panel", now: at });
  }

  return { startTurn, getTurnView, getTurnAnswer, acknowledgeTurnAnswer, cancelTurn, resumeTurn, getThreadHistory, inspectCitationEvidence };
}

export type AgentTurnEntryPoints = ReturnType<typeof createAgentTurnEntryPoints>;

export const agentTurnEntryPoints = createAgentTurnEntryPoints({
  seams: agentTurnSeams,
  readCitationEvidence: (ctx, input) => agentExecutorSeams.readCitationEvidenceWithCtx(ctx, input),
  scheduleDriveTurn: async (ctx, bindingId) => {
    await ctx.scheduler.runAfter(0, internal.agentHarness.runtimeHost.driveTurn, { bindingId });
  },
  scheduleOutboxRepair: async (ctx, bindingId) => {
    await ctx.scheduler.runAfter(0, internal.agentHarness.runtimeHost.repairCompletionOutbox, { bindingId });
  },
});

// ----- validators (the contract U9 compiles against) ---------------------------

const startTurnResult = v.union(
  v.object({ outcome: v.literal("started"), bindingId: v.id("agentTurnBinding"), runId: v.id("intelligenceRun"), threadKey: v.string() }),
  v.object({
    outcome: v.literal("resumed"),
    bindingId: v.id("agentTurnBinding"),
    runId: v.id("intelligenceRun"),
    threadKey: v.string(),
    step: v.string(),
    runStatus: v.string(),
    terminal: v.boolean(),
  }),
  v.object({ outcome: v.literal("denied"), code: v.string(), message: v.string(), retryable: v.boolean() }),
);

const turnViewResult = v.union(
  v.object({
    kind: v.literal("view"),
    bindingId: v.id("agentTurnBinding"),
    runId: v.id("intelligenceRun"),
    profileId: v.string(),
    threadKey: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    phase: v.union(v.literal("queued"), v.literal("running"), v.literal("completed"), v.literal("failed"), v.literal("canceled")),
    step: v.string(),
    milestones: v.array(v.object({ milestone: v.string(), at: v.number() })),
    question: v.optional(v.string()),
    context: v.optional(v.record(v.string(), v.string())),
    promptState: v.union(v.literal("retained"), v.literal("expired"), v.literal("deleted")),
    answer: v.object({
      available: v.boolean(),
      outcome: v.optional(v.union(v.literal("answer"), v.literal("no_usable_sources"))),
      suppressed: v.boolean(),
      viewedAt: v.optional(v.number()),
    }),
    error: v.optional(v.object({ code: v.string(), retryable: v.boolean(), headline: v.string() })),
    canCancel: v.boolean(),
  }),
  v.object({ kind: v.literal("unavailable"), reason: v.string() }),
);

const answerResult = v.union(
  v.object({
    kind: v.literal("answer"),
    outcome: v.union(v.literal("answer"), v.literal("no_usable_sources")),
    title: v.optional(v.string()),
    summary: v.optional(v.string()),
    narrative: v.string(),
    egressClass: v.string(),
    confidence: v.optional(v.number()),
    limitedEvidence: v.optional(v.boolean()),
    committedAt: v.number(),
    viewedAt: v.optional(v.number()),
    citations: v.array(v.object({ citationRef: v.string(), namespace: v.optional(v.string()), label: v.optional(v.string()) })),
  }),
  v.object({ kind: v.literal("unavailable"), reason: v.string() }),
);

const acknowledgeResult = v.union(
  v.object({ kind: v.literal("acknowledged"), operatorViewedAt: v.number(), answer: answerResult }),
  v.object({ kind: v.literal("suppressed"), reason: v.string() }),
  v.object({ kind: v.literal("unavailable"), reason: v.string() }),
);

const cancelResult = v.union(
  v.object({ outcome: v.literal("canceled") }),
  v.object({ outcome: v.literal("already_terminal"), runStatus: v.string() }),
  v.object({ outcome: v.literal("unavailable"), reason: v.string() }),
);

const resumeResult = v.union(
  v.object({ outcome: v.literal("continue"), step: v.string(), runStatus: v.string() }),
  v.object({ outcome: v.literal("retry_scheduled"), step: v.string(), runStatus: v.string() }),
  v.object({ outcome: v.literal("projection_scheduled"), step: v.string(), runStatus: v.string() }),
  v.object({ outcome: v.literal("terminal"), step: v.string(), runStatus: v.string() }),
  v.object({ outcome: v.literal("abandoned"), step: v.string(), runStatus: v.string() }),
  v.object({ outcome: v.literal("unavailable"), reason: v.string() }),
);

const historyEntry = v.object({
  bindingId: v.id("agentTurnBinding"),
  runId: v.id("intelligenceRun"),
  createdAt: v.number(),
  runStatus: v.string(),
  state: v.string(),
  questionState: v.union(v.literal("retained"), v.literal("expired"), v.literal("deleted")),
  question: v.optional(v.string()),
  context: v.optional(v.record(v.string(), v.string())),
  answer: v.optional(
    v.object({
      outcome: v.union(v.literal("answer"), v.literal("no_usable_sources")),
      title: v.optional(v.string()),
      summary: v.optional(v.string()),
      narrative: v.string(),
      egressClass: v.string(),
      confidence: v.optional(v.number()),
      limitedEvidence: v.optional(v.boolean()),
      committedAt: v.number(),
      citations: v.array(v.object({ citationRef: v.string(), label: v.optional(v.string()), namespace: v.optional(v.string()) })),
    }),
  ),
  omittedReason: v.optional(v.string()),
  error: v.optional(v.object({ code: v.string(), retryable: v.boolean() })),
});

const historyResult = v.union(
  v.object({ kind: v.literal("history"), threadKey: v.string(), reauthorizedAt: v.number(), entries: v.array(historyEntry) }),
  v.object({ kind: v.literal("unavailable"), reason: v.string() }),
);

const evidenceResult = v.union(
  v.object({
    kind: v.literal("evidence"),
    state: v.string(),
    citation: v.object({
      citationRef: v.string(),
      namespace: v.optional(v.string()),
      capability: v.optional(v.string()),
      resultHash: v.string(),
      claimDigest: v.optional(v.string()),
      sourceRef: v.object({ ref: v.string(), kind: v.optional(v.string()), label: v.optional(v.string()) }),
      normalizedArgsHash: v.optional(v.string()),
      observedAt: v.optional(v.number()),
      capturedAt: v.optional(v.number()),
      freshness: v.optional(v.string()),
      completeness: v.optional(v.string()),
      sourceRefCount: v.optional(v.number()),
      claimSupport: v.optional(v.object({ extractorKey: v.string(), extractorVersion: v.string(), slice: v.record(v.string(), v.any()) })),
      immutableRevisionRef: v.optional(v.string()),
    }),
  }),
  v.object({ kind: v.literal("not_found") }),
  v.object({ kind: v.literal("unauthorized"), reason: v.string() }),
);

// ----- public functions (production binding) ------------------------------------

export const startTurn = mutation({
  args: {
    storeId: v.id("store"),
    profileId: v.string(),
    threadKey: v.string(),
    turnIdempotencyKey: v.string(),
    prompt: v.string(),
    context: v.optional(v.record(v.string(), v.string())),
  },
  returns: startTurnResult,
  handler: admitPublicMutation(startTurnOperationDefinition, async (ctx, args: StartTurnArgs) => agentTurnEntryPoints.startTurn(ctx, args)),
});

export const getTurnView = query({
  args: { storeId: v.id("store"), bindingId: v.id("agentTurnBinding") },
  returns: turnViewResult,
  handler: admitPublicQuery(getTurnViewReadDefinition, async (ctx, args: TurnArgs) => agentTurnEntryPoints.getTurnView(ctx, args)),
});

export const getTurnAnswer = query({
  args: { storeId: v.id("store"), bindingId: v.id("agentTurnBinding") },
  returns: answerResult,
  handler: admitPublicQuery(getTurnAnswerReadDefinition, async (ctx, args: TurnArgs) => agentTurnEntryPoints.getTurnAnswer(ctx, args)),
});

export const acknowledgeTurnAnswer = mutation({
  args: { storeId: v.id("store"), bindingId: v.id("agentTurnBinding") },
  returns: acknowledgeResult,
  handler: admitPublicMutation(acknowledgeTurnAnswerOperationDefinition, async (ctx, args: TurnArgs) => agentTurnEntryPoints.acknowledgeTurnAnswer(ctx, args)),
});

export const cancelTurn = mutation({
  args: { storeId: v.id("store"), bindingId: v.id("agentTurnBinding") },
  returns: cancelResult,
  handler: admitPublicMutation(cancelTurnOperationDefinition, async (ctx, args: TurnArgs) => agentTurnEntryPoints.cancelTurn(ctx, args)),
});

export const resumeTurn = mutation({
  args: { storeId: v.id("store"), bindingId: v.id("agentTurnBinding") },
  returns: resumeResult,
  handler: admitPublicMutation(resumeTurnOperationDefinition, async (ctx, args: TurnArgs) => agentTurnEntryPoints.resumeTurn(ctx, args)),
});

export const getThreadHistory = query({
  args: { storeId: v.id("store"), profileId: v.string(), threadKey: v.string(), limit: v.optional(v.number()) },
  returns: historyResult,
  handler: admitPublicQuery(getThreadHistoryReadDefinition, async (ctx, args: { storeId: Id<"store">; profileId: string; threadKey: string; limit?: number }) =>
    agentTurnEntryPoints.getThreadHistory(ctx, args),
  ),
});

export const inspectCitationEvidence = mutation({
  args: { storeId: v.id("store"), bindingId: v.id("agentTurnBinding"), citationRef: v.string() },
  returns: evidenceResult,
  handler: admitPublicMutation(inspectCitationEvidenceOperationDefinition, async (ctx, args: TurnArgs & { citationRef: string }) => agentTurnEntryPoints.inspectCitationEvidence(ctx, args)),
});
