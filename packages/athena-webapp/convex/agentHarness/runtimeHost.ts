import { opaqueRef } from "../../shared/agentHarness/values";
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

import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";

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
  type AgentPreExecutedExchange,
} from "../../shared/agentHarness/agentRuntime";
import { isBindingStepAtOrBeyond, type AgentTurnBindingStep } from "../../shared/agentHarness/execution";
import type { AgentProgressMilestone } from "../../shared/agentHarness/agentRuntime";
import type {
  AgentPrepareCompletionOutcome,
  AgentProjectionFailureOutcome,
  AgentProjectionLoad,
  AgentRecordProjectionOutcome,
  AgentSuppressReleaseOutcome,
} from "./completionOutbox";
// eslint-disable-next-line @convex-dev/import-wrong-runtime -- this module is "use node" too; the rule only inspects the imported file
import { createProductionConvexAgentRuntimeAdapter } from "./agentRuntime/convexAgentProduction";
import type { AgentCapabilitySchemaIndex } from "./discovery";
import { historyEgressClass } from "./historyProjection";
// eslint-disable-next-line @convex-dev/import-wrong-runtime -- this module is "use node" too; the rule only inspects the imported file
import { getProductionProgramExecutor, type AgentExecuteProgramResult, type AgentExecutorCtx } from "./executor";
// eslint-disable-next-line @convex-dev/import-wrong-runtime -- this module is "use node" too; the rule only inspects the imported file
import { createAthenaModelResolver, rateCardFor } from "./modelRegistry";
import { createAthenaToolRegistrations, completeRunTool, modelVisibleToolDefinitions, AGENT_AUTHORITY_REVOCATION_REASONS, type AgentToolSeamRefs } from "./tools";
import { profileLexicon } from "../../shared/agentHarness/productLexicon";
import type { AgentToneFinding } from "../../shared/agentHarness/productLexicon";
import type { AdvanceTurnBindingResult } from "./turnBindings";
import type { AgentFinalizeTurnOutcome, AgentProvisionalFlushOutcome, AgentRecordTurnTraceOutcome, AgentTurnPreparation, AgentTurnUsageSettlement } from "./turns";
import { AGENT_TURN_TRACE_MAX_EVENTS_PER_TURN, type AgentTurnTraceSource } from "./turnTrace";

// ---------------------------------------------------------------------------
// Dependencies (production or test-bound)
// ---------------------------------------------------------------------------

type BindingArgs = { bindingId: Id<"agentTurnBinding">; now?: number };

/** Opaque runtime refs one host rung may record on the binding. */
export type AgentTurnHostAdvanceRefs = {
  readonly runtimeThreadRef?: string;
  readonly runtimeInputRef?: string;
  readonly runtimeScheduleRef?: string;
  readonly preparedCompletionRef?: string;
  readonly runtimeProjectionRef?: string;
};

export type AgentTurnHostFinalizeRequest = {
  bindingId: Id<"agentTurnBinding">;
  outcome: "completed" | "failed" | "canceled";
  error?: { code: string; message: string; retryable: boolean };
  usage?: AgentTurnUsageSettlement;
  /** The turn's finished drafts, ascending. Sent only when the answer committed. */
  trail?: { draftOrdinal: number; text: string; truncated?: boolean }[];
  purgeRuntime?: boolean;
  now?: number;
};

/**
 * Internal function references the host calls (production or test-bound).
 * Typed like `AgentToolSeamRefs`: every result the host reads is derived from
 * the reference, so a drift in a seam's return shape surfaces here.
 */
export type AgentTurnHostRefs = AgentToolSeamRefs & {
  readonly prepareTurn: FunctionReference<"mutation", "internal", BindingArgs, AgentTurnPreparation>;
  readonly markTurnRunning: FunctionReference<"mutation", "internal", BindingArgs, { outcome: "running" | "already_running" | "rejected"; code?: string }>;
  readonly recordRuntimeTurnRef: FunctionReference<
    "mutation",
    "internal",
    { bindingId: Id<"agentTurnBinding">; runtimeTurnRef: string; adapterKind?: string; adapterVersion?: string; now?: number },
    null
  >;
  readonly recordTurnProgress: FunctionReference<"mutation", "internal", { bindingId: Id<"agentTurnBinding">; milestone: AgentProgressMilestone; now?: number }, null>;
  readonly peekTurnState: FunctionReference<"query", "internal", { bindingId: Id<"agentTurnBinding"> }, PeekState>;
  readonly finalizeTurn: FunctionReference<"mutation", "internal", AgentTurnHostFinalizeRequest, AgentFinalizeTurnOutcome>;
  /**
   * Host-only: overwrite the operator's provisional draft. Never public
   * ingress — it authorizes the grant's pinned operator, not its caller — and
   * every policy, authority, and egress decision lives behind it.
   */
  readonly flushProvisionalNarrative: FunctionReference<
    "mutation",
    "internal",
    { bindingId: Id<"agentTurnBinding">; draftOrdinal: number; text: string; now?: number },
    AgentProvisionalFlushOutcome
  >;
  /**
   * Host-only: the engineer's turn trace. Never public ingress and never read
   * by an operator surface — it holds the deltas, the tool arguments, and the
   * outcomes so a turn can be replayed offline while the agent is refined.
   */
  readonly recordTurnTrace: FunctionReference<
    "mutation",
    "internal",
    { bindingId: Id<"agentTurnBinding">; events: readonly AgentTurnTraceRow[]; now?: number },
    AgentRecordTurnTraceOutcome
  >;
  readonly advanceTurnBinding: FunctionReference<
    "mutation",
    "internal",
    { bindingId: Id<"agentTurnBinding">; step: AgentTurnBindingStep; idempotencyKey: string; now?: number } & AgentTurnHostAdvanceRefs,
    AdvanceTurnBindingResult
  >;
  readonly loadProjection: FunctionReference<"query", "internal", BindingArgs, AgentProjectionLoad>;
  readonly recordProjection: FunctionReference<"mutation", "internal", { bindingId: Id<"agentTurnBinding">; projectionRef: string; now?: number }, AgentRecordProjectionOutcome>;
  readonly recordProjectionFailure: FunctionReference<"mutation", "internal", { bindingId: Id<"agentTurnBinding">; error: string; now?: number }, AgentProjectionFailureOutcome>;
  readonly suppressRelease: FunctionReference<"mutation", "internal", { bindingId: Id<"agentTurnBinding">; reason: string; now?: number }, AgentSuppressReleaseOutcome>;
  readonly listOutboxDue: FunctionReference<"query", "internal", { now?: number; limit?: number }, Id<"agentTurnBinding">[]>;
};

/** One buffered trace row as the host hands it to the recording mutation. */
export type AgentTurnTraceRow = {
  readonly source: AgentTurnTraceSource;
  readonly sequence: number;
  readonly at: number;
  readonly kind: string;
  readonly payload: unknown;
};

/** Rows per recording mutation: a narrated turn buffers hundreds between tool calls. */
export const AGENT_TURN_TRACE_FLUSH_BATCH = 200;

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
  /** Tone-sensor policy for completeRun narratives; default "warn" (telemetry only). */
  readonly tonePolicy?: "warn" | "enforce";
  /** Test seam: observe settled ledger entries (e.g. to cite refs minted earlier in the turn). */
  readonly observeDispatch?: (entry: AgentToolLedgerEntry) => void;
};

export const AGENT_HOST_CANCEL_POLL_MS = 2_000;

/** What one projection attempt did; `projection_exhausted` is the outbox giving up on the runtime mirror. */
export type AgentProjectionResult = AgentProjectionLoad["kind"] | "projected" | "projection_exhausted";

export type AgentTurnHostReport = {
  readonly bindingId: Id<"agentTurnBinding">;
  readonly outcome: "completed" | "failed" | "canceled" | "terminal" | "not_found" | "refused";
  readonly code?: string;
  readonly events: readonly AgentRuntimeEvent["kind"][];
  readonly dispatch: readonly string[];
  readonly usage?: AgentTurnUsageSettlement;
  readonly projection?: AgentProjectionResult;
  readonly finalize?: AgentFinalizeTurnOutcome;
  readonly timings: {
    readonly totalMs: number;
    readonly firstDeltaMs: number | null;
    readonly firstProgressMs: number | null;
    readonly completionMs: number | null;
  };
  /** What the engineer-only trace captured, and whether the deployment captures at all. */
  readonly trace?: { readonly enabled: boolean; readonly recorded: number; readonly capped: boolean };
};

/**
 * `["a","b","b","b"]` becomes `"a,b×3"`. A narrated turn emits hundreds of
 * deltas; run-length collapsing keeps the operator log line one readable line
 * while preserving the order the kinds arrived in.
 */
export function collapseEventKinds(kinds: readonly AgentRuntimeEvent["kind"][]): string {
  const runs: { kind: string; count: number }[] = [];
  for (const kind of kinds) {
    const last = runs.at(-1);
    if (last && last.kind === kind) last.count += 1;
    else runs.push({ kind, count: 1 });
  }
  return runs.map((run) => (run.count === 1 ? run.kind : `${run.kind}×${run.count}`)).join(",");
}

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

  // The executor ctx is untyped on purpose (the test backend stands in for
  // it); the refs carry the function types, so every result the host reads is
  // derived from its reference here and asserted nowhere else.
  const runQuery = <Ref extends FunctionReference<"query", "internal">>(reference: Ref, args: FunctionArgs<Ref>) =>
    ctx.runQuery(reference, args) as Promise<FunctionReturnType<Ref>>;
  const runMutation = <Ref extends FunctionReference<"mutation", "internal">>(reference: Ref, args: FunctionArgs<Ref>) =>
    ctx.runMutation(reference, args) as Promise<FunctionReturnType<Ref>>;

  async function advance(bindingId: Id<"agentTurnBinding">, step: AgentTurnBindingStep, extra: AgentTurnHostAdvanceRefs) {
    return runMutation(refs.advanceTurnBinding, { bindingId, step, idempotencyKey: `${step}:host`, now: now(), ...extra });
  }

  async function recordProjectionFailure(bindingId: Id<"agentTurnBinding">, error: string): Promise<AgentProjectionResult> {
    const failure = await runMutation(refs.recordProjectionFailure, { bindingId, error, now: now() });
    return failure.outcome === "exhausted" ? "projection_exhausted" : "not_committed";
  }

  async function projectCommitted(bindingId: Id<"agentTurnBinding">): Promise<AgentProjectionResult> {
    const loaded = await runQuery(refs.loadProjection, { bindingId, now: now() });
    if (loaded.kind === "suppressed") {
      await runMutation(refs.suppressRelease, { bindingId, reason: loaded.reason, now: now() });
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
      if (projected.kind === "rejected") return recordProjectionFailure(bindingId, projected.reason);
      const recorded = await runMutation(refs.recordProjection, { bindingId, projectionRef: projected.projectionRef, now: now() });
      return recorded.outcome === "rejected" ? "not_committed" : "projected";
    } catch (error) {
      return recordProjectionFailure(bindingId, error instanceof Error ? error.name : "projection_failed");
    }
  }

  /** Drive one turn from wherever its binding stands. Idempotent on resume. */
  async function driveTurn(input: { bindingId: Id<"agentTurnBinding"> }): Promise<AgentTurnHostReport> {
    const startedAt = now();
    const { bindingId } = input;
    const events: AgentRuntimeEvent["kind"][] = [];
    const dispatch: string[] = [];
    const timings = { firstDeltaMs: null as number | null, firstProgressMs: null as number | null, completionMs: null as number | null };
    let runId: Id<"intelligenceRun"> | undefined;

    /** Settle without rethrowing, the same shape the milestone queue uses. */
    const settleQuietly = (work: Promise<unknown> | null): Promise<void> => (work ? work.then(() => undefined, () => undefined) : Promise.resolve());

    // ----- turn trace: engineer-only capture, batched flush ------------------
    //
    // Everything the model and the harness exchanged, in order, so a turn can
    // be replayed offline while the agent is being refined: the runtime
    // events, the narrative deltas, each tool call's exact arguments and the
    // outcome the model read back, the flush outcomes for the operator's
    // draft, and the turn's own report.
    //
    // It is a diagnostic, so it is subordinate to the turn in every way. Rows
    // are buffered in memory and written in batches — never inside the commit
    // transaction — at each tool call and once before finalize, so a crash
    // after finalize cannot lose the turn's record. Every write goes through
    // the settle-never-rethrow wrapper: a failed trace write must never fail
    // the turn. Past the per-turn bound the host stops buffering and records
    // one `trace_capped` row instead, so a runaway turn cannot write forever.
    const trace = {
      buffer: [] as AgentTurnTraceRow[],
      /** The host's own monotone counter, kept at or past the last adapter sequence so one sort replays the turn. */
      hostSequence: 0,
      pushed: 0,
      recorded: 0,
      capped: false,
      /** Assume on: the deployment answers on the first flush, and `off` stops the buffering too. */
      enabled: true,
      inFlight: null as Promise<void> | null,
    };

    function pushTrace(row: AgentTurnTraceRow): void {
      if (!trace.enabled) return;
      if (row.sequence > trace.hostSequence) trace.hostSequence = row.sequence;
      // The turn's own summary row is never capped: it is the one row an
      // engineer reads first, and it is the last one pushed.
      // The COMMITTED terminal dispatch row is the durable record of the
      // model-submitted answer; like turn_report, it is never capped. Denied
      // submissions stay cappable so the exemption is exactly one row.
      const terminalPayload = row.payload as { toolId?: string; outcome?: { kind?: string } } | undefined;
      const terminalDispatch = row.kind === "tool_dispatch" && terminalPayload?.toolId === completeRunTool.toolId && terminalPayload?.outcome?.kind === "success";
      if (trace.pushed >= AGENT_TURN_TRACE_MAX_EVENTS_PER_TURN && row.kind !== "turn_report" && !terminalDispatch) {
        if (trace.capped) return;
        trace.capped = true;
        trace.buffer.push({ source: "host", sequence: (trace.hostSequence += 1), at: now(), kind: "trace_capped", payload: { limit: AGENT_TURN_TRACE_MAX_EVENTS_PER_TURN, droppedFrom: row.kind } });
        return;
      }
      trace.pushed += 1;
      trace.buffer.push(row);
    }

    const pushHostTrace = (kind: string, payload: unknown) => pushTrace({ source: "host", sequence: (trace.hostSequence += 1), at: now(), kind, payload });

    async function flushTrace(): Promise<void> {
      while (trace.enabled && trace.buffer.length > 0) {
        const batch = trace.buffer.splice(0, AGENT_TURN_TRACE_FLUSH_BATCH);
        const written = await runMutation(refs.recordTurnTrace, { bindingId, events: batch, now: now() });
        trace.recorded += written.recorded;
        if (!written.enabled) {
          // The deployment does not capture: stop buffering for the rest of the turn.
          trace.enabled = false;
          trace.buffer.length = 0;
        }
      }
    }

    /**
     * A trace write that fails is dropped, never rethrown — the diagnostic
     * must not change the turn's outcome — but it is logged, so a deployment
     * that rejects every batch is visible rather than merely thin.
     */
    const flushTraceQuietly = async (): Promise<void> => {
      const pending = trace.buffer.length;
      try {
        await flushTrace();
      } catch (error) {
        // The class only: a validation error's message can quote the batch.
        console.log(`[agentHarness:turnTrace] ${JSON.stringify({ turnId: bindingId, trace: "flush_failed", dropped: pending - trace.buffer.length, error: error instanceof Error ? error.name : "unknown" })}`);
      }
    };

    /** Single-flight, fire-and-forget: newer rows coalesce behind the write in flight. */
    function pumpTrace(): void {
      if (trace.inFlight || trace.buffer.length === 0) return;
      trace.inFlight = flushTraceQuietly().then(() => {
        trace.inFlight = null;
      });
    }

    /** Drain everything buffered. Awaited before finalize, and never rethrows. */
    const drainTrace = async (): Promise<void> => {
      await settleQuietly(trace.inFlight);
      await flushTraceQuietly();
    };

    /**
     * The turn's own row: the same payload as the operator log line, plus the
     * dispatch outcomes. Written BEFORE finalize, so a crash between the two
     * loses the finalize, not the record of what the model did.
     */
    let toneFindingsAtReport: (() => readonly AgentToneFinding[]) | undefined;
    const traceTurnReport = async (outcome: AgentTurnHostReport["outcome"], code?: string): Promise<void> => {
      pushHostTrace("turn_report", {
        turnId: bindingId,
        runId,
        outcome,
        code,
        events: collapseEventKinds(events),
        dispatch: [...dispatch],
        firstDeltaMs: timings.firstDeltaMs,
        firstProgressMs: timings.firstProgressMs,
        completionMs: timings.completionMs,
        elapsedMs: now() - startedAt,
        tone: toneFindingsAtReport?.() ?? [],
      });
      await drainTrace();
    };

    const report = (outcome: AgentTurnHostReport["outcome"], extra: Partial<AgentTurnHostReport> = {}): AgentTurnHostReport => {
      const built: AgentTurnHostReport = {
        bindingId,
        outcome,
        events,
        dispatch,
        timings: { totalMs: now() - startedAt, ...timings },
        trace: { enabled: trace.enabled, recorded: trace.recorded, capped: trace.capped },
        ...extra,
      };
      // One line per driven turn. `driveTurn` is a scheduled action whose
      // return value the scheduler discards, so this is the only read path for
      // what the turn did — ordered event kinds, time to the first narrative
      // delta, and completion latency — through `bunx convex logs`. Opaque
      // refs and kinds only: no prompt text and no narrative text.
      console.log(
        `[agentHarness:driveTurn] ${JSON.stringify({
          turnId: bindingId,
          runId,
          outcome: built.outcome,
          code: built.code,
          events: collapseEventKinds(events),
          firstDeltaMs: built.timings.firstDeltaMs,
          firstProgressMs: built.timings.firstProgressMs,
          completionMs: built.timings.completionMs,
          elapsedMs: built.timings.totalMs,
        })}`,
      );
      return built;
    };

    // Every exit before the runtime turn starts still finalizes: the turn's
    // provider-spend reservation is released by finalize, not by the provider
    // invocation row, and an unfinalized turn would hold it for the whole day.
    const finalizeUnstarted = (outcome: "canceled" | "failed", code: string) =>
      runMutation(refs.finalizeTurn, {
        bindingId,
        outcome,
        error: { code, message: "The turn could not start.", retryable: true },
        now: now(),
      });
    const refused = async (code: string | undefined) => {
      const resolved = code ?? "turn_binding_stalled";
      // The trace lands before finalize on every exit, this one included: a
      // turn that never started is exactly the turn an engineer asks about.
      await traceTurnReport("refused", resolved);
      return report("refused", { code: resolved, finalize: await finalizeUnstarted("failed", resolved) });
    };

    const prepared = await runMutation(refs.prepareTurn, { bindingId, now: now() });
    if (prepared.kind === "not_found") return report("not_found");
    // The run is already terminal; finalize is a no-op for it and settles the reservation.
    if (prepared.kind === "terminal") {
      await traceTurnReport("terminal", prepared.runStatus);
      return report("terminal", { code: prepared.runStatus, finalize: await finalizeUnstarted("canceled", prepared.runStatus) });
    }
    if (prepared.kind === "refused") return refused(prepared.code);
    const { plan } = prepared;
    runId = plan.runId;

    // Thread and input: resume-safe rungs recording opaque refs only.
    const thread = await adapter.ensureThread({ threadKey: plan.adapter.threadKey, contextBindingRef: plan.adapter.contextBindingRef as never, correlation: plan.adapter.correlation });
    const bound = await advance(bindingId, "runtime_thread_bound", { runtimeThreadRef: thread.threadRef });
    if (bound.outcome === "rejected") return refused(bound.denial?.code);
    const inputSaved = await adapter.saveInput({ threadRef: thread.threadRef, turnKey: plan.adapter.turnKey, prompt: plan.prompt, history: plan.history });
    const saved = await advance(bindingId, "runtime_input_saved", { runtimeInputRef: inputSaved.inputRef });
    if (saved.outcome === "rejected") return refused(saved.denial?.code);
    const running = await runMutation(refs.markTurnRunning, { bindingId, now: now() });
    if (running.outcome === "rejected") return refused(running.code);

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
        milestoneQueue.push(runMutation(refs.recordTurnProgress, { bindingId, milestone, now: now() }).catch(() => undefined));
        if (turnRef) await adapter.reportProgress?.(turnRef, milestone);
      },
      now,
      // The provider was replayed this turn's projected history, so an answer
      // written from it cannot be classed below what that history carried.
      egressFloor: historyEgressClass(plan.history),
      schemas: deps.schemas,
      question: plan.question,
      lexicon: profileLexicon(plan.profileId),
      tonePolicy: deps.tonePolicy ?? "warn",
    });
    toneFindingsAtReport = () => tools.state.toneFindings();
    const ledger = createAgentToolDispatchLedger({ adapterVersion: adapter.descriptor.adapterVersion, tools: tools.registrations });
    const usage = createUsageReconciler();

    let turnRef: RuntimeTurnRef | undefined;
    let completed: Extract<AgentRuntimeEvent, { kind: "turn_completed" }> | undefined;
    let settle!: () => void;
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });

    // ----- curated pre-execution (starter-intent turns) ---------------------
    //
    // The registered executeProgram handler runs the curated source through
    // the production executor under the run's own grant — attempt 1, real
    // charges, the egress checkpoint at finishAttempt exactly as a dispatched
    // call. The outcome seeds the adapter transcript as a synthetic exchange;
    // every failure downgrades to today's free-form flow with a trace, and an
    // authority signal cancels the turn before any provider invocation.
    let preExecutedExchange: AgentPreExecutedExchange | undefined;
    if (plan.preExecution) {
      if ("skip" in plan.preExecution) {
        pushHostTrace("starter_intent_preexec_skipped", { starterIntentId: plan.preExecution.starterIntentId, outcome: plan.preExecution.skip });
      } else {
        if (timings.firstProgressMs === null) timings.firstProgressMs = now() - startedAt;
        milestoneQueue.push(runMutation(refs.recordTurnProgress, { bindingId, milestone: "reading_ahead", now: now() }).catch(() => undefined));
        const registration = tools.registrations.find((candidate) => candidate.definition.toolId === "athena.executeProgram");
        let preexecFailure: string | undefined;
        let outcome: Awaited<ReturnType<NonNullable<typeof registration>["handler"]>> | undefined;
        try {
          outcome = registration
            ? await registration.handler({ source: plan.preExecution.source } as never, {
                turnRef: opaqueRef("runtime_turn", `preexec-${bindingId}`),
                callId: `preexec-${bindingId}`,
                idempotencyKey: `preexec:${bindingId}`,
                signal: new AbortController().signal,
              })
            : undefined;
        } catch (error) {
          outcome = undefined;
          preexecFailure = error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300);
        }
        if (outcome && outcome.kind === "success") {
          preExecutedExchange = {
            toolId: "athena.executeProgram",
            exchangeKey: "1",
            args: { source: plan.preExecution.source },
            result: outcome.result as never,
          };
          const seededResult = outcome.result as { attemptRef?: string; citations?: readonly { ref: string }[] };
          pushHostTrace("starter_intent_preexec", {
            starterIntentId: plan.preExecution.starterIntentId,
            outcome: "seeded",
            attemptRef: seededResult.attemptRef,
            citations: (seededResult.citations ?? []).slice(0, 8).map((citation) => citation.ref),
          });
        } else {
          const code =
            outcome === undefined
              ? "handler_failed"
              : outcome.kind === "denied"
                ? outcome.denial.code
                : outcome.kind === "failure"
                  ? outcome.error.code
                  : outcome.kind;
          pushHostTrace("starter_intent_preexec_skipped", { starterIntentId: plan.preExecution.starterIntentId, outcome: code, ...(preexecFailure ? { failure: preexecFailure } : {}) });
        }
        // The pre-exec record must survive a host crash before the provider
        // turn: flush it durably now (also what lets an investigator see the
        // seeding immediately).
        await flushTrace();
        const revokedEarly = tools.state.authorityRevocations();
        if (revokedEarly.length > 0) {
          // Authority signal, not an executor failure: cancel exactly as a
          // mid-turn revocation does; no provider invocation follows.
          await traceTurnReport("canceled", "authority_revoked");
          const settlementEarly = settlementOf(usage.settleAll("cancel"), plan.model, deps.rateCardFor);
          const finalizeEarly = await runMutation(refs.finalizeTurn, {
            bindingId,
            outcome: "canceled",
            error: { code: "authority_revoked", message: `Authority changed during the turn: ${revokedEarly[0]}.`, retryable: false },
            usage: settlementEarly,
            now: now(),
          });
          return report("canceled", { code: "authority_revoked", usage: settlementEarly, finalize: finalizeEarly });
        }
      }
    }

    // ----- provisional narrative: in-memory coalescer, single-flight flush ---
    //
    // Deltas arrive at token rate; the row must not. The draft is accumulated
    // here and written whole, one flush at a time, with newer text coalesced
    // behind the one in flight — so the row is always an overwrite, a new
    // draft replaces the previous one, and a dropped flush loses nothing (the
    // next carries the full text). Nothing here decides whether the operator
    // may see the draft: `flushProvisionalNarrative` is the enforcement point,
    // and its `refused` verdict is the host's signal to stop offering text.
    const provisional = {
      draftOrdinal: -1,
      draftText: "",
      /**
       * Every draft this turn finished, by ordinal, holding the ordinal's full
       * coalesced text. The live row is overwritten per draft and deleted at
       * finalize; this is what a COMMITTED turn hands to finalize so the
       * operator can still read how the answer was reached after a reload.
       */
      drafts: new Map<number, { text: string; truncated: boolean }>(),
      /** The newest whole draft not yet handed to a flush. */
      pending: null as { draftOrdinal: number; text: string } | null,
      inFlight: null as Promise<void> | null,
      /** Set at the completeRun request so the commit transaction is never contended. */
      stopped: false,
      /** The kernel withdrew the draft; it deleted the row, so stop writing for this turn. */
      refused: false,
    };


    function pumpProvisional(): void {
      if (provisional.inFlight || provisional.stopped || provisional.refused) return;
      const next = provisional.pending;
      if (!next) return;
      provisional.pending = null;
      provisional.inFlight = (async () => {
        try {
          const flushed = await runMutation(refs.flushProvisionalNarrative, { bindingId, draftOrdinal: next.draftOrdinal, text: next.text, now: now() });
          if (flushed.outcome === "refused") provisional.refused = true;
          else {
            // The kernel's verdict on this draft's size, carried onto the
            // remembered draft so the durable trail reports the truncation the
            // pane already showed. The TEXT comes from the delta stream, not
            // from here: a draft's last slice can end without a flush.
            const remembered = provisional.drafts.get(next.draftOrdinal);
            if (remembered && flushed.truncated) remembered.truncated = true;
          }
          // The outcome only: the deltas already carry the text, and a second
          // copy per flush would be the same draft written over and over.
          pushHostTrace("provisional_flush", {
            draftOrdinal: next.draftOrdinal,
            outcome: flushed.outcome,
            reason: flushed.outcome === "refused" ? flushed.reason : undefined,
            truncated: flushed.truncated,
          });
        } catch {
          // OCC against a concurrent turn writer, or a transport failure: this
          // flush is dropped and the next one carries the whole draft again.
          pushHostTrace("provisional_flush", { draftOrdinal: next.draftOrdinal, outcome: "dropped" });
        } finally {
          provisional.inFlight = null;
        }
        pumpProvisional();
      })();
    }

    /**
     * The full envelope of one runtime event, kind-specific fields included.
     * `tool_call_completed` is enriched with the LEDGER's outcome object — the
     * kernel result, denial, or violation the model actually read back — which
     * the normalized event carries only as a kind.
     */
    const traceEventPayload = (event: AgentRuntimeEvent): Record<string, unknown> => {
      const base: Record<string, unknown> = { kind: event.kind, sequence: event.sequence, turnRef: event.turnRef, at: event.at, sinceStartMs: now() - startedAt };
      switch (event.kind) {
        case "progress":
          return { ...base, milestone: event.milestone };
        case "narrative_delta":
          return { ...base, draftOrdinal: event.draftOrdinal, text: event.text };
        case "tool_call_requested":
          return { ...base, callId: event.callId, toolId: event.toolId, ...(requestedArgs.get(event.callId) ?? {}) };
        case "tool_call_completed": {
          const entry = ledger.entries().find((candidate) => candidate.callId === event.callId);
          return {
            ...base,
            callId: event.callId,
            toolId: event.toolId,
            outcomeKind: event.outcomeKind,
            idempotencyKey: entry?.idempotencyKey,
            argsHash: entry?.argsHash,
            resultHash: entry?.resultHash,
            outcome: entry?.outcome,
            lateOutcome: entry?.lateOutcome,
          };
        }
        case "usage":
          return { ...base, usage: event.usage };
        case "turn_completed":
          return { ...base, outcome: event.outcome, narrative: event.narrative, error: event.error, reason: event.reason };
        case "completion_projected":
          return { ...base, projectionRef: event.projectionRef };
        case "cleanup_completed":
          return { ...base, deleted: event.deleted };
        default:
          return base;
      }
    };

    /** Arguments seen at dispatch, so the request row can carry them on a replay. */
    const requestedArgs = new Map<string, { idempotencyKey: string; args: unknown }>();

    const hooks: AgentRuntimeTurnHooks = {
      onEvent: async (event) => {
        events.push(event.kind);
        pushTrace({ source: "adapter", sequence: event.sequence, at: event.at, kind: event.kind, payload: traceEventPayload(event) });
        if (event.kind === "turn_started" || event.kind === "turn_resumed") ledger.beginTurn(event.turnRef);
        if (event.kind === "narrative_delta" && timings.firstDeltaMs === null) timings.firstDeltaMs = now() - startedAt;
        if (event.kind === "narrative_delta") {
          if (event.draftOrdinal !== provisional.draftOrdinal) {
            provisional.draftOrdinal = event.draftOrdinal;
            provisional.draftText = "";
          }
          provisional.draftText += event.text;
          // Remember the ordinal's text as it grows, so the draft a committed
          // turn hands to finalize is the whole draft — including a last slice
          // the tool boundary left unflushed. Only text the pane was still
          // being offered is remembered: once the host has quiesced for the
          // commit, or the kernel has withdrawn the draft, whatever the model
          // keeps narrating was never the operator's to read and must not
          // become a durable record of the turn either.
          if (!provisional.stopped && !provisional.refused && provisional.draftText.trim().length > 0) {
            const remembered = provisional.drafts.get(provisional.draftOrdinal);
            if (remembered) remembered.text = provisional.draftText;
            else provisional.drafts.set(provisional.draftOrdinal, { text: provisional.draftText, truncated: false });
          }
          // Whitespace alone is not a draft: it would only be refused.
          if (provisional.draftText.trim().length > 0) {
            provisional.pending = { draftOrdinal: provisional.draftOrdinal, text: provisional.draftText };
            pumpProvisional();
          }
        }
        if (event.kind === "progress" && timings.firstProgressMs === null) timings.firstProgressMs = now() - startedAt;
        if (event.kind === "tool_call_requested" && timings.firstProgressMs === null) timings.firstProgressMs = now() - startedAt;
        if (event.kind === "tool_call_requested" && event.toolId === completeRunTool.toolId) {
          // Quiescence: the request is emitted before the tool runs and `emit`
          // awaits this hook, so stopping here and draining the one flight in
          // progress guarantees the commit transaction is never contended by
          // streaming. The drain must never reject the awaited `emit`.
          provisional.stopped = true;
          await settleQuietly(provisional.inFlight);
        }
        if (event.kind === "tool_call_completed" && event.toolId === completeRunTool.toolId && event.outcomeKind !== "success") {
          // Denied, retryably failed, or rejected as a protocol violation: the
          // turn continues, so the pane must not freeze. The next draft ordinal
          // arrives with the model's next step and overwrites the row.
          provisional.stopped = false;
          pumpProvisional();
        }
        if (event.kind === "usage") usage.record(event.usage);
        if (event.kind === "tool_call_completed") {
          const last = ledger.entries().find((entry) => entry.callId === event.callId);
          dispatch.push(last?.outcome ? `${event.toolId}:${last.outcome.kind}` : `${event.toolId}:${event.outcomeKind}`);
          if (last) deps.observeDispatch?.(last);
          // A batch per tool call: the buffer never grows past one tool step,
          // and the write is outside the commit transaction by construction.
          pumpTrace();
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
      dispatchTool: async (request) => {
        // The normalized `tool_call_requested` event carries no arguments —
        // they exist only here, on the way into the ledger — so this is the
        // one place the trace can record what the model actually asked for.
        requestedArgs.set(request.callId, { idempotencyKey: request.idempotencyKey, args: request.rawArgs });
        const requestedAt = now();
        const result = await ledger.dispatch(request);
        const entry = ledger.entries().find((candidate) => candidate.callId === request.callId);
        pushHostTrace("tool_dispatch", {
          callId: request.callId,
          toolId: request.toolId,
          idempotencyKey: request.idempotencyKey,
          args: request.rawArgs,
          resultKind: result.kind,
          outcome: result.kind === "outcome" ? result.outcome : undefined,
          violation: result.kind === "protocol_violation" ? { code: result.code, message: result.message } : undefined,
          replayed: result.kind === "outcome" ? result.replayed : undefined,
          argsHash: entry?.argsHash,
          resultHash: entry?.resultHash,
          elapsedMs: now() - requestedAt,
        });
        return result;
      },
    };

    try {
      const started = await adapter.startTurn(
        { threadRef: thread.threadRef, inputRef: inputSaved.inputRef, turnKey: plan.adapter.turnKey, tools: modelVisibleToolDefinitions(tools.registrations, plan.catalogEmbedded === true), model: plan.model, limits: plan.limits, ...(preExecutedExchange ? { preExecutedExchange } : {}) },
        hooks,
      );
      turnRef = started.turnRef;
      if (plan.catalogEmbedded === true) {
        // The removed discover round used to give the panel its first beat
        // within a second or two; with the catalog embedded the first tool
        // call sits behind the model's opening reasoning, so the host authors
        // the same truthful first milestone itself. Gated to embedded-catalog
        // turns: when discover is offered, its handler still owns this beat.
        if (timings.firstProgressMs === null) timings.firstProgressMs = now() - startedAt;
        milestoneQueue.push(runMutation(refs.recordTurnProgress, { bindingId, milestone: "checking_sources", now: now() }).catch(() => undefined));
        try {
          await adapter.reportProgress?.(turnRef, "checking_sources");
        } catch {
          // Progress is best-effort; the turn is already running, and a throw
          // here must not trip the could-not-start finalization below.
        }
      }
    } catch (error) {
      const code = typeof (error as { athenaCode?: unknown }).athenaCode === "string" ? (error as { athenaCode: string }).athenaCode : "runtime_adapter_error";
      await traceTurnReport("failed", code);
      const finalize = await runMutation(refs.finalizeTurn, {
        bindingId,
        outcome: "failed",
        error: { code, message: "The runtime could not start the turn.", retryable: code !== "model_selection_locked" },
        usage: settlementOf(usage.settleAll("missing_final"), plan.model, deps.rateCardFor),
        now: now(),
      });
      return report("failed", { code, finalize });
    }
    await runMutation(refs.recordRuntimeTurnRef, { bindingId, runtimeTurnRef: turnRef, adapterKind: adapter.descriptor.adapterKind, adapterVersion: adapter.descriptor.adapterVersion, now: now() });

    // Observe external cancellation (operator, kill switch, fence repair) while the runtime turn runs.
    let stopPolling = false;
    const poll = (async () => {
      while (!stopPolling) {
        await sleep(pollMs);
        if (stopPolling) break;
        const state = await runQuery(refs.peekTurnState, { bindingId });
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
    // Nothing may still be writing the draft when finalize deletes it.
    provisional.stopped = true;
    await settleQuietly(provisional.inFlight);

    const outcome = completed?.outcome ?? "failed";
    const reason: AgentUsageSettlementReason = outcome === "completed" ? "terminal_total" : outcome === "canceled" ? "cancel" : "missing_final";
    const settlement = settlementOf(usage.settleAll(reason), plan.model, deps.rateCardFor);
    const revoked = tools.state.authorityRevocations();
    const exposed = tools.state.attempts().some((attempt) => attempt.providerExposed);
    const state = await runQuery(refs.peekTurnState, { bindingId });
    const committed = state.found && state.committed;

    let finalize: AgentFinalizeTurnOutcome;
    let projection: AgentTurnHostReport["projection"];
    // Only a turn whose answer committed hands its drafts on: the trail is
    // released and withdrawn with the answer, so a turn without one has
    // nothing the operator is entitled to keep reading. The drafts ride with
    // the commit, not with the host's outcome — a provider that dies after
    // the answer landed still leaves the answer, and so its trail. A turn the
    // kernel ever refused hands on nothing at all: that draft was withdrawn
    // from the pane, and a durable copy would put it back. Finalize itself
    // writes the trail only for a completed, committed run.
    const trail =
      committed && !provisional.refused
        ? [...provisional.drafts.entries()]
            .sort((left, right) => left[0] - right[0])
            .map(([draftOrdinal, draft]) => ({ draftOrdinal, text: draft.text, truncated: draft.truncated }))
        : [];
    const trailArg = trail.length > 0 ? { trail } : {};
    if (outcome === "completed" && committed) {
      await traceTurnReport("completed");
      finalize = await runMutation(refs.finalizeTurn, { bindingId, outcome: "completed", usage: settlement, ...trailArg, now: now() });
      projection = await projectCommitted(bindingId);
      return report("completed", { usage: settlement, finalize, projection });
    }
    if (revoked.length > 0) {
      await traceTurnReport("canceled", "authority_revoked");
      finalize = await runMutation(refs.finalizeTurn, {
        bindingId,
        outcome: "canceled",
        error: { code: "authority_revoked", message: `Authority changed during the turn: ${revoked[0]}.`, retryable: false },
        usage: settlement,
        purgeRuntime: exposed,
        ...trailArg,
        now: now(),
      });
      return report("canceled", { code: "authority_revoked", usage: settlement, finalize });
    }
    if (outcome === "canceled") {
      await traceTurnReport("canceled", completed?.reason);
      finalize = await runMutation(refs.finalizeTurn, { bindingId, outcome: "canceled", error: { code: completed?.reason ?? "canceled", message: "The turn was stopped.", retryable: false }, usage: settlement, ...trailArg, now: now() });
      return report("canceled", { code: completed?.reason, usage: settlement, finalize });
    }
    const error =
      outcome === "completed"
        ? { code: "completion_missing", message: "The turn ended without athena.completeRun.", retryable: true }
        : { code: completed?.error?.code ?? "provider_failure", message: completed?.error?.message ?? "The turn failed.", retryable: completed?.error?.code === "turn_elapsed_ceiling" || completed?.error?.code === "provider_failure" };
    await traceTurnReport("failed", error.code);
    finalize = await runMutation(refs.finalizeTurn, { bindingId, outcome: "failed", error, usage: settlement, ...trailArg, now: now() });
    return report("failed", { code: error.code, usage: settlement, finalize });
  }

  /** Outbox repair: project committed, unprojected, still-authorized artifacts (bounded). */
  async function repairOutbox(input: { bindingId?: Id<"agentTurnBinding">; limit?: number }): Promise<{ attempted: number; projected: number; results: { bindingId: Id<"agentTurnBinding">; result: string }[] }> {
    const due = input.bindingId ? [input.bindingId] : await runQuery(refs.listOutboxDue, { now: now(), limit: input.limit ?? 50 });
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
  describeGrant: internal.agentHarness.turns.describeGrant,
  recordScratch: internal.agentHarness.executorSeams.recordScratch,
  prepareCompletion: internal.agentHarness.completionOutbox.prepareCompletion,
  completeRun: internal.agentHarness.executorSeams.completeRun,
  prepareTurn: internal.agentHarness.turns.prepareTurn,
  markTurnRunning: internal.agentHarness.turns.markTurnRunning,
  recordRuntimeTurnRef: internal.agentHarness.turns.recordRuntimeTurnRef,
  recordTurnProgress: internal.agentHarness.turns.recordTurnProgress,
  peekTurnState: internal.agentHarness.turns.peekTurnState,
  finalizeTurn: internal.agentHarness.turns.finalizeTurn,
  flushProvisionalNarrative: internal.agentHarness.turns.flushProvisionalNarrative,
  recordTurnTrace: internal.agentHarness.turns.recordTurnTrace,
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
  return createTurnHost({
    ctx: executorCtx,
    adapter,
    refs: PRODUCTION_REFS,
    executeProgram: (input) => executor.executeProgram(executorCtx, input),
    // Tone sensor rollout knob: warn (telemetry only) until the corpus replay
    // proves the false-positive rate, then enforce.
    // Measured 2026-08-24 on the 20-question set (rich day): labels+enforce
    // cut jargon density to 5.5 per 1k chars against 7.8 for labels alone and
    // 8.0 before this work, for ~4 s p50 and one extra invocation. Enforce is
    // the default; ATHENA_AGENT_TONE_POLICY=warn downgrades it to telemetry.
    tonePolicy: process.env.ATHENA_AGENT_TONE_POLICY === "warn" ? "warn" : "enforce",
  });
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
