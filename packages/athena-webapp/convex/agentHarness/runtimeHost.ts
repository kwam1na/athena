"use node";
/**
 * Runtime host (kernel; Node runtime): drives ONE operator turn through the
 * Athena runtime adapter contract.
 *
 * Authority boundary (plan decisions 8, 10, 12): the host consumes only the
 * shared `AgentRuntimeAdapter` contract, opaque runtime refs, and normalized events. It never
 * imports the runtime component, native messages, or provider session types;
 * the production adapter is constructed by the adapter directory's factory.
 * Per turn it: prepares through the V8 seams (epoch fence, live profile switch,
 * Athena-authored history projection, provider selection for the maximum
 * egress class), binds the runtime thread and input (ladder rungs with opaque
 * refs, idempotent on resume), marks the run running, starts the turn with the
 * fixed tool catalog behind the adapter dispatch ledger, ingests usage into
 * the adapter usage reconciler, observes external cancellation, and on completion settles usage
 * exactly once and hands the committed artifact to the outbox. A revocation
 * after provider exposure cancels the turn, suppresses release, and asks the
 * adapter to purge while the exposure audit stays on the attempt rows.
 */
import { v } from "convex/values";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction } from "../_generated/server";
import {
  calculateUsageCost,
  createAgentToolDispatchLedger,
  createUsageReconciler,
  type AgentRuntimeAdapter,
  type AgentRuntimeEvent,
  type AgentRuntimeTurnHooks,
  type AgentToolDispatchResult,
  type AgentToolLedgerEntry,
  type AgentUsageRateCard,
  type AgentUsageSettlementReason,
  type RuntimeTurnRef,
} from "../../shared/agentHarness/agentRuntime";
import { isBindingStepAtOrBeyond } from "../../shared/agentHarness/execution";
import type { AgentProgressMilestone } from "../../shared/agentHarness/agentRuntime";
import type { AgentPrepareCompletionOutcome, AgentProjectionLoad, AgentRecordProjectionOutcome } from "./completionOutbox";
// eslint-disable-next-line @convex-dev/import-wrong-runtime -- this module is "use node" too; the rule only inspects the imported file
import { createProductionConvexAgentRuntimeAdapter } from "./agentRuntime/convexAgentProduction";
import type { AgentCapabilitySchemaIndex } from "./discovery";
// eslint-disable-next-line @convex-dev/import-wrong-runtime -- this module is "use node" too; the rule only inspects the imported file
import { getProductionProgramExecutor, type AgentExecuteProgramResult, type AgentExecutorCtx } from "./executor";
// eslint-disable-next-line @convex-dev/import-wrong-runtime -- this module is "use node" too; the rule only inspects the imported file
import { createAthenaModelResolver, rateCardFor } from "./modelRegistry";
import { createAthenaToolRegistrations, AGENT_AUTHORITY_REVOCATION_REASONS, type AgentToolSeamRefs } from "./tools";
import type { AgentFinalizeTurnOutcome, AgentTurnPreparation, AgentTurnUsageSettlement } from "./turns";

// ---------------------------------------------------------------------------
// Dependencies (production or test-bound)
// ---------------------------------------------------------------------------

type AnyRef = unknown;

export type AgentTurnHostRefs = AgentToolSeamRefs & {
  readonly prepareTurn: AnyRef;
  readonly markTurnRunning: AnyRef;
  readonly recordRuntimeTurnRef: AnyRef;
  readonly recordTurnProgress: AnyRef;
  readonly peekTurnState: AnyRef;
  readonly finalizeTurn: AnyRef;
  readonly advanceTurnBinding: AnyRef;
  readonly loadProjection: AnyRef;
  readonly recordProjection: AnyRef;
  readonly recordProjectionFailure: AnyRef;
  readonly suppressRelease: AnyRef;
  readonly listOutboxDue: AnyRef;
};

export type AgentTurnHostDeps = {
  readonly ctx: AgentExecutorCtx;
  readonly adapter: AgentRuntimeAdapter & { readonly reportProgress?: (turnRef: RuntimeTurnRef, milestone: AgentProgressMilestone) => Promise<void> };
  readonly refs: AgentTurnHostRefs;
  readonly executeProgram: (input: { runId: Id<"intelligenceRun">; attemptIdempotencyKey: string; source: string; signal: AbortSignal }) => Promise<AgentExecuteProgramResult>;
  readonly rateCardFor?: (selection: { providerId: string; modelId: string }) => AgentUsageRateCard;
  readonly clock?: () => number;
  /** How often the host checks for external cancellation while the runtime turn runs. */
  readonly cancelPollMs?: number;
  readonly schemas?: AgentCapabilitySchemaIndex;
  /** Test seam: observe settled ledger entries (e.g. to cite refs minted earlier in the turn). */
  readonly observeDispatch?: (entry: AgentToolLedgerEntry) => void;
};

export const AGENT_HOST_CANCEL_POLL_MS = 2_000;

export type AgentTurnHostReport = {
  readonly bindingId: Id<"agentTurnBinding">;
  readonly outcome: "completed" | "failed" | "canceled" | "terminal" | "not_found" | "refused";
  readonly code?: string;
  readonly events: readonly AgentRuntimeEvent["kind"][];
  readonly dispatch: readonly string[];
  readonly usage?: AgentTurnUsageSettlement;
  readonly projection?: AgentProjectionLoad["kind"] | "projected";
  readonly finalize?: AgentFinalizeTurnOutcome;
  readonly timings: { readonly totalMs: number; readonly firstProgressMs: number | null; readonly completionMs: number | null };
};

type PeekState =
  | { found: false }
  | { found: true; runStatus: string; step: string; abandoned: boolean; committed: boolean; projected: boolean; suppressed: boolean; errorCode?: string };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createTurnHost(deps: AgentTurnHostDeps) {
  const now = () => deps.clock?.() ?? Date.now();
  const pollMs = deps.cancelPollMs ?? AGENT_HOST_CANCEL_POLL_MS;
  const { ctx, adapter, refs } = deps;

  async function advance(bindingId: Id<"agentTurnBinding">, step: string, extra: Record<string, string>) {
    return (await ctx.runMutation(refs.advanceTurnBinding, { bindingId, step, idempotencyKey: `${step}:host`, now: now(), ...extra })) as { outcome: string; denial?: { code: string } };
  }

  async function projectCommitted(bindingId: Id<"agentTurnBinding">): Promise<AgentProjectionLoad["kind"] | "projected"> {
    const loaded = (await ctx.runQuery(refs.loadProjection, { bindingId, now: now() })) as AgentProjectionLoad;
    if (loaded.kind === "suppressed") {
      await ctx.runMutation(refs.suppressRelease, { bindingId, reason: loaded.reason, now: now() });
      return "suppressed";
    }
    if (loaded.kind !== "ready") return loaded.kind;
    try {
      const projected = await adapter.projectCompletion({
        threadRef: loaded.threadRef as never,
        turnRef: loaded.turnRef as never,
        artifact: loaded.artifact,
        idempotencyKey: loaded.idempotencyKey,
      });
      if (projected.kind === "rejected") {
        await ctx.runMutation(refs.recordProjectionFailure, { bindingId, error: projected.reason, now: now() });
        return "not_committed";
      }
      const recorded = (await ctx.runMutation(refs.recordProjection, { bindingId, projectionRef: projected.projectionRef, now: now() })) as AgentRecordProjectionOutcome;
      return recorded.outcome === "rejected" ? "not_committed" : "projected";
    } catch (error) {
      await ctx.runMutation(refs.recordProjectionFailure, { bindingId, error: error instanceof Error ? error.name : "projection_failed", now: now() });
      return "not_committed";
    }
  }

  /** Drive one turn from wherever its binding stands. Idempotent on resume. */
  async function driveTurn(input: { bindingId: Id<"agentTurnBinding"> }): Promise<AgentTurnHostReport> {
    const startedAt = now();
    const { bindingId } = input;
    const events: AgentRuntimeEvent["kind"][] = [];
    const dispatch: string[] = [];
    const timings = { firstProgressMs: null as number | null, completionMs: null as number | null };
    const report = (outcome: AgentTurnHostReport["outcome"], extra: Partial<AgentTurnHostReport> = {}): AgentTurnHostReport => ({
      bindingId,
      outcome,
      events,
      dispatch,
      timings: { totalMs: now() - startedAt, ...timings },
      ...extra,
    });

    const prepared = (await ctx.runMutation(refs.prepareTurn, { bindingId, now: now() })) as AgentTurnPreparation;
    if (prepared.kind === "not_found") return report("not_found");
    if (prepared.kind === "terminal") return report("terminal", { code: prepared.runStatus });
    if (prepared.kind === "refused") return report("refused", { code: prepared.code });
    const { plan } = prepared;

    // Thread and input: resume-safe rungs recording opaque refs only.
    const thread = await adapter.ensureThread({ threadKey: plan.adapter.threadKey, contextBindingRef: plan.adapter.contextBindingRef as never, correlation: plan.adapter.correlation });
    const bound = await advance(bindingId, "runtime_thread_bound", { runtimeThreadRef: thread.threadRef });
    if (bound.outcome === "rejected") return report("refused", { code: bound.denial?.code });
    const inputSaved = await adapter.saveInput({ threadRef: thread.threadRef, turnKey: plan.adapter.turnKey, prompt: plan.prompt, history: plan.history });
    const saved = await advance(bindingId, "runtime_input_saved", { runtimeInputRef: inputSaved.inputRef });
    if (saved.outcome === "rejected") return report("refused", { code: saved.denial?.code });
    const running = (await ctx.runMutation(refs.markTurnRunning, { bindingId, now: now() })) as { outcome: string; code?: string };
    if (running.outcome === "rejected") return report("refused", { code: running.code });

    // Kernel-side protocol pieces: fixed tools behind the dispatch ledger, usage reconciler.
    const milestoneQueue: Promise<unknown>[] = [];
    const tools = createAthenaToolRegistrations({
      runId: plan.runId,
      bindingId,
      ctx,
      refs,
      executeProgram: deps.executeProgram,
      // Milestones are server-authored by the tool handlers: recorded durably
      // here (the reactive view reads them) and mirrored into the adapter's
      // event stream when it supports progress events.
      reportProgress: async (milestone) => {
        if (timings.firstProgressMs === null) timings.firstProgressMs = now() - startedAt;
        milestoneQueue.push(ctx.runMutation(refs.recordTurnProgress, { bindingId, milestone, now: now() }).catch(() => undefined));
        if (turnRef) await adapter.reportProgress?.(turnRef, milestone);
      },
      now,
      schemas: deps.schemas,
    });
    const ledger = createAgentToolDispatchLedger({ adapterVersion: adapter.descriptor.adapterVersion, tools: tools.registrations });
    const usage = createUsageReconciler();
    let turnRef: RuntimeTurnRef | undefined;
    let completed: Extract<AgentRuntimeEvent, { kind: "turn_completed" }> | undefined;
    let settle!: () => void;
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });

    const hooks: AgentRuntimeTurnHooks = {
      onEvent: async (event) => {
        events.push(event.kind);
        if (event.kind === "turn_started" || event.kind === "turn_resumed") ledger.beginTurn(event.turnRef);
        if (event.kind === "progress" && timings.firstProgressMs === null) timings.firstProgressMs = now() - startedAt;
        if (event.kind === "tool_call_requested" && timings.firstProgressMs === null) timings.firstProgressMs = now() - startedAt;
        if (event.kind === "usage") usage.record(event.usage);
        if (event.kind === "tool_call_completed") {
          const last = ledger.entries().find((entry) => entry.callId === event.callId);
          dispatch.push(last?.outcome ? `${event.toolId}:${last.outcome.kind}` : `${event.toolId}:${event.outcomeKind}`);
          if (last) deps.observeDispatch?.(last);
          // Authority revoked under the run: stop the provider loop now; the run is terminalized below.
          if (tools.state.authorityRevocations().length > 0 && turnRef) void adapter.cancelTurn({ turnRef, reason: "authority_revoked" });
        }
        if (event.kind === "turn_completed") {
          completed = event;
          timings.completionMs = now() - startedAt;
          ledger.terminalizeTurn(event.turnRef, `turn_${event.outcome}`);
          settle();
        }
      },
      dispatchTool: (request) => ledger.dispatch(request),
    };

    try {
      const started = await adapter.startTurn(
        { threadRef: thread.threadRef, inputRef: inputSaved.inputRef, turnKey: plan.adapter.turnKey, tools: tools.registrations.map((registration) => registration.definition), model: plan.model, limits: plan.limits },
        hooks,
      );
      turnRef = started.turnRef;
    } catch (error) {
      const code = typeof (error as { athenaCode?: unknown }).athenaCode === "string" ? (error as { athenaCode: string }).athenaCode : "runtime_adapter_error";
      const finalize = (await ctx.runMutation(refs.finalizeTurn, {
        bindingId,
        outcome: "failed",
        error: { code, message: "The runtime could not start the turn.", retryable: code !== "model_selection_locked" },
        usage: settlementOf(usage.settleAll("missing_final"), plan.model, deps.rateCardFor),
        now: now(),
      })) as AgentFinalizeTurnOutcome;
      return report("failed", { code, finalize });
    }
    await ctx.runMutation(refs.recordRuntimeTurnRef, { bindingId, runtimeTurnRef: turnRef, adapterKind: adapter.descriptor.adapterKind, adapterVersion: adapter.descriptor.adapterVersion, now: now() });

    // Observe external cancellation (operator, kill switch, fence repair) while the runtime turn runs.
    let stopPolling = false;
    const poll = (async () => {
      while (!stopPolling) {
        await sleep(pollMs);
        if (stopPolling) break;
        const state = (await ctx.runQuery(refs.peekTurnState, { bindingId })) as PeekState;
        if (!state.found || state.runStatus === "canceled" || state.runStatus === "failed" || state.abandoned) {
          await adapter.cancelTurn({ turnRef: turnRef!, reason: state.found ? `run_${state.runStatus}` : "binding_missing" });
          break;
        }
      }
    })();
    await settled;
    stopPolling = true;
    await poll.catch(() => undefined);
    await Promise.allSettled(milestoneQueue);

    const outcome = completed?.outcome ?? "failed";
    const reason: AgentUsageSettlementReason = outcome === "completed" ? "terminal_total" : outcome === "canceled" ? "cancel" : "missing_final";
    const settlement = settlementOf(usage.settleAll(reason), plan.model, deps.rateCardFor);
    const revoked = tools.state.authorityRevocations();
    const exposed = tools.state.attempts().some((attempt) => attempt.providerExposed);
    const state = (await ctx.runQuery(refs.peekTurnState, { bindingId })) as PeekState;
    const committed = state.found && state.committed;

    let finalize: AgentFinalizeTurnOutcome;
    let projection: AgentTurnHostReport["projection"];
    if (outcome === "completed" && committed) {
      finalize = (await ctx.runMutation(refs.finalizeTurn, { bindingId, outcome: "completed", usage: settlement, now: now() })) as AgentFinalizeTurnOutcome;
      projection = await projectCommitted(bindingId);
      return report("completed", { usage: settlement, finalize, projection });
    }
    if (revoked.length > 0) {
      finalize = (await ctx.runMutation(refs.finalizeTurn, {
        bindingId,
        outcome: "canceled",
        error: { code: "authority_revoked", message: `Authority changed during the turn: ${revoked[0]}.`, retryable: false },
        usage: settlement,
        purgeRuntime: exposed,
        now: now(),
      })) as AgentFinalizeTurnOutcome;
      return report("canceled", { code: "authority_revoked", usage: settlement, finalize });
    }
    if (outcome === "canceled") {
      finalize = (await ctx.runMutation(refs.finalizeTurn, { bindingId, outcome: "canceled", error: { code: completed?.reason ?? "canceled", message: "The turn was stopped.", retryable: false }, usage: settlement, now: now() })) as AgentFinalizeTurnOutcome;
      return report("canceled", { code: completed?.reason, usage: settlement, finalize });
    }
    const error =
      outcome === "completed"
        ? { code: "completion_missing", message: "The turn ended without athena.completeRun.", retryable: true }
        : { code: completed?.error?.code ?? "provider_failure", message: completed?.error?.message ?? "The turn failed.", retryable: completed?.error?.code === "turn_elapsed_ceiling" || completed?.error?.code === "provider_failure" };
    finalize = (await ctx.runMutation(refs.finalizeTurn, { bindingId, outcome: "failed", error, usage: settlement, now: now() })) as AgentFinalizeTurnOutcome;
    return report("failed", { code: error.code, usage: settlement, finalize });
  }

  /** Outbox repair: project committed, unprojected, still-authorized artifacts (bounded). */
  async function repairOutbox(input: { bindingId?: Id<"agentTurnBinding">; limit?: number }): Promise<{ attempted: number; projected: number; results: { bindingId: Id<"agentTurnBinding">; result: string }[] }> {
    const due = input.bindingId ? [input.bindingId] : ((await ctx.runQuery(refs.listOutboxDue, { now: now(), limit: input.limit ?? 50 })) as Id<"agentTurnBinding">[]);
    const results: { bindingId: Id<"agentTurnBinding">; result: string }[] = [];
    let projected = 0;
    for (const bindingId of due) {
      const result = await projectCommitted(bindingId);
      if (result === "projected" || result === "already_projected") projected += 1;
      results.push({ bindingId, result });
    }
    return { attempted: due.length, projected, results };
  }

  return { driveTurn, repairOutbox };
}

function settlementOf(
  settlement: ReturnType<ReturnType<typeof createUsageReconciler>["settleAll"]>,
  model: { providerId: string; modelId: string },
  rateCard: AgentTurnHostDeps["rateCardFor"],
): AgentTurnUsageSettlement {
  const card = rateCard ? rateCard(model) : rateCardFor(model);
  return {
    tokens: settlement.tokens,
    streams: settlement.streams.length,
    conservative: settlement.streams.some((stream) => stream.conservative),
    settledBy: [...new Set(settlement.streams.map((stream) => stream.settledBy))],
    lateEventCount: settlement.lateEventCount,
    costUnits: calculateUsageCost(settlement.tokens, card),
  };
}

export type AgentTurnHost = ReturnType<typeof createTurnHost>;

// ---------------------------------------------------------------------------
// Production binding
// ---------------------------------------------------------------------------

const PRODUCTION_REFS: AgentTurnHostRefs = {
  describeGrant: internal.agentHarness.turns.describeGrant as never,
  recordScratch: internal.agentHarness.executorSeams.recordScratch as never,
  prepareCompletion: internal.agentHarness.completionOutbox.prepareCompletion as never,
  completeRun: internal.agentHarness.executorSeams.completeRun as never,
  prepareTurn: internal.agentHarness.turns.prepareTurn,
  markTurnRunning: internal.agentHarness.turns.markTurnRunning,
  recordRuntimeTurnRef: internal.agentHarness.turns.recordRuntimeTurnRef,
  recordTurnProgress: internal.agentHarness.turns.recordTurnProgress,
  peekTurnState: internal.agentHarness.turns.peekTurnState,
  finalizeTurn: internal.agentHarness.turns.finalizeTurn,
  advanceTurnBinding: internal.agentHarness.turnBindings.advanceTurnBinding,
  loadProjection: internal.agentHarness.completionOutbox.loadProjection,
  recordProjection: internal.agentHarness.completionOutbox.recordProjection,
  recordProjectionFailure: internal.agentHarness.completionOutbox.recordProjectionFailure,
  suppressRelease: internal.agentHarness.completionOutbox.suppressRelease,
  listOutboxDue: internal.agentHarness.completionOutbox.listOutboxDue,
};

type HostActionCtx = { runQuery: AgentExecutorCtx["runQuery"]; runMutation: AgentExecutorCtx["runMutation"]; runAction?: unknown };

async function productionHost(ctx: HostActionCtx, bindingId?: Id<"agentTurnBinding">) {
  const executor = await getProductionProgramExecutor();
  const executorCtx: AgentExecutorCtx = { runQuery: ctx.runQuery, runMutation: ctx.runMutation };
  // The model resolver is bound per turn from the plan; the adapter asks for it at startTurn.
  let resolver: ReturnType<typeof createAthenaModelResolver> | undefined;
  const adapter = createProductionConvexAgentRuntimeAdapter({
    ctx: ctx as never,
    resolveModel: (selection, context) => {
      resolver ??= createAthenaModelResolver({ selection, turnKey: context.turnKey });
      return resolver(selection, context);
    },
    maxRetries: 1,
  });
  void bindingId;
  return createTurnHost({ ctx: executorCtx, adapter, refs: PRODUCTION_REFS, executeProgram: (input) => executor.executeProgram(executorCtx, input) });
}

/** `internal.agentHarness.runtimeHost.driveTurn` — scheduled by `turns.startTurn` / `resumeTurn`. */
export const driveTurn = internalAction({
  args: { bindingId: v.id("agentTurnBinding") },
  returns: v.any(),
  handler: async (ctx, args): Promise<AgentTurnHostReport> => {
    const host = await productionHost(ctx as unknown as HostActionCtx, args.bindingId);
    return host.driveTurn({ bindingId: args.bindingId });
  },
});

/** Outbox repair: cron-driven sweep, or one binding on `resumeTurn`. */
export const repairCompletionOutbox = internalAction({
  args: { bindingId: v.optional(v.id("agentTurnBinding")), limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, args) => {
    const host = await productionHost(ctx as unknown as HostActionCtx);
    return host.repairOutbox({ bindingId: args.bindingId, limit: args.limit });
  },
});

export { isBindingStepAtOrBeyond };
export type { AgentToolDispatchResult, AgentPrepareCompletionOutcome };
