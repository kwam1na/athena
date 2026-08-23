"use node";
/**
 * Program executor (kernel; Node runtime — QuickJS lives here).
 *
 * Authority boundary: this is the one path the model's code executes through.
 * It validates the source with Athena's own validator, creates the attempt,
 * runs the QuickJS sandbox, and answers every `athena.<package>.<resource>`
 * call through ONE async bridge that only ever talks to the executor seams
 * (`executorSeams.ts`) and the closed read-port map:
 *   normalize → reserve+admit (mutation) → dispatch (query) → settle (mutation).
 * It holds no `ctx.db`, no `api.*`, no scheduler, no handler references. The
 * sandbox never sees host errors, raw ids, or data the release mutation did
 * not hand back. Identical reads are deduplicated only inside the attempt;
 * when the program ends, still-open calls settle conservatively and exactly
 * one `finishAttempt` records the result, the egress class, and the
 * `provider_egress_committed` boundary (or withholds it). Producing a result
 * terminalizes only the attempt; `completeRun` is a separate seam.
 */
import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import type { AgentCapabilityResult } from "../../shared/agentHarness/bridge";
import { computeSha256Digest } from "../../shared/agentHarness/digest";
import type { JsonValue } from "../../shared/agentHarness/manifest";
import type { AgentReadEnvelope } from "../../shared/agentHarness/results";
import { agentDelegatedAdmission } from "../platform/operationAdmission";
import { attemptCallIdempotencyKey } from "./budgets";
import { createReplayBridge, normalizeHostCall, programOutputHash, type AgentExecutionFacadeEntry } from "./evidence";
import type { AgentAttemptReplayInputs } from "./evidence";
import type {
  AgentAttemptEnd,
  AgentBeginAttemptOutcome,
  AgentExecutorSeamRefs,
  AgentFinishAttemptOutcome,
  AgentPrepareAttemptOutcome,
  AgentReserveCallOutcome,
  AgentSettleCallOutcome,
  AgentSettleCallResponse,
} from "./executorSeams";
// eslint-disable-next-line @convex-dev/import-wrong-runtime -- this module is "use node" too; the rule only inspects the imported file
import { collectProgramFieldAdvisories, validateProgramSource, type AgentProgramFieldAdvisory } from "./programRuntime/programValidation";
// eslint-disable-next-line @convex-dev/import-wrong-runtime -- this module is "use node" too; the rule only inspects the imported file
import { createQuickJsProgramRuntime } from "./programRuntime/quickJsRuntime";
import {
  AGENT_PROGRAM_RUNTIME_CEILINGS,
  type AgentProgramDiagnostics,
  type AgentProgramHostBridge,
  type AgentProgramHostCall,
  type AgentProgramOutcome,
  type AgentProgramRuntime,
  type AgentProgramRuntimeCeilings,
  type AgentProgramValidationIssue,
} from "./programRuntime/types";
import type { AgentReadPortDispatchCtx, AgentReadPortInvocation, AgentReadPortResponse } from "./readPorts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The only Convex reach the executor has: run a registered internal query or mutation. */
export type AgentExecutorCtx = {
  readonly runQuery: (reference: unknown, args: unknown) => Promise<unknown>;
  readonly runMutation: (reference: unknown, args: unknown) => Promise<unknown>;
};

export type AgentProgramExecutorConfig = {
  readonly runtime: AgentProgramRuntime;
  readonly seams: AgentExecutorSeamRefs;
  /** Closed read-port dispatch (delegated admission): the composition root's or the test package's. */
  readonly dispatchReadPort: (ctx: AgentReadPortDispatchCtx, invocation: AgentReadPortInvocation) => Promise<AgentReadPortResponse>;
  readonly clock?: () => number;
  /** Test hooks: narrow or stretch ceilings, and interpose between sandbox result and finish. */
  readonly ceilingOverrides?: Partial<AgentProgramRuntimeCeilings>;
  readonly hooks?: {
    readonly beforeFinish?: (input: { readonly attemptId: Id<"agentProgramAttempt">; readonly outcome: AgentProgramOutcome }) => Promise<void>;
  };
  readonly heartbeatMs?: number;
};

export type AgentExecuteProgramInput = {
  readonly runId: Id<"intelligenceRun">;
  readonly attemptIdempotencyKey: string;
  readonly source: string;
  readonly signal?: AbortSignal;
};

export type AgentExecutorCallRecord = {
  readonly callIndex: number;
  readonly namespace: string;
  readonly verb: "get" | "list";
  readonly outcome: AgentCapabilityResult<AgentReadEnvelope<unknown>>["kind"];
  readonly deduplicated: boolean;
  readonly callId?: Id<"agentCapabilityCall">;
  readonly truncation?: { readonly keptItems: number; readonly droppedItems: number };
  /**
   * Why a non-`result` call ended that way, in the bridge's own vocabulary.
   * The model authors the program but never sees the refusal the program
   * received unless the program happened to return it, so an unexplained
   * `denied` here reads to a model as "no access" and it guesses. Naming the
   * reason is what lets the next attempt be a correction rather than a repeat.
   */
  readonly reason?: string;
  readonly detail?: string;
};

export type AgentExecuteProgramResult =
  | (Extract<AgentFinishAttemptOutcome, { outcome: "result" }> & { readonly diagnostics: AgentProgramDiagnostics; readonly calls: readonly AgentExecutorCallRecord[]; readonly fieldAdvisories?: readonly AgentProgramFieldAdvisory[] })
  | (Extract<AgentFinishAttemptOutcome, { outcome: "withheld" }> & { readonly diagnostics: AgentProgramDiagnostics; readonly calls: readonly AgentExecutorCallRecord[] })
  | { readonly outcome: "rejected"; readonly attemptId?: Id<"agentProgramAttempt">; readonly issues: readonly AgentProgramValidationIssue[] }
  | { readonly outcome: "failed" | "canceled"; readonly attemptId: Id<"agentProgramAttempt">; readonly error: { code: string; message: string; retryable?: boolean }; readonly diagnostics: AgentProgramDiagnostics; readonly calls: readonly AgentExecutorCallRecord[] }
  | { readonly outcome: "denied"; readonly code: string; readonly message: string; readonly retryable: boolean }
  | { readonly outcome: "refused"; readonly stage: string; readonly reason: string }
  | { readonly outcome: "resumed"; readonly attemptId: Id<"agentProgramAttempt">; readonly status: string }
  | { readonly outcome: "already_terminal"; readonly attemptId: Id<"agentProgramAttempt">; readonly status: string };

export type AgentReplayAttemptResult =
  | {
      readonly kind: "replayed";
      readonly sourceMatches: boolean;
      readonly outputMatches: boolean;
      readonly outputHash: string;
      readonly storedOutputHash?: string;
      readonly missingInputs: number;
      readonly servedInputs: number;
      readonly outcome: AgentProgramOutcome;
    }
  | { readonly kind: "not_replayable"; readonly reason: "not_found" | "no_result" | "expired" | "deleted_by_lifecycle" | "validation_changed" | "facade_missing"; readonly detail?: string };

type Refusal = Exclude<AgentCapabilityResult<AgentReadEnvelope<unknown>>, { kind: "result" }>;

const EMPTY_DIAGNOSTICS: AgentProgramDiagnostics = { elapsedMs: 0, hostCalls: 0, maxInFlight: 0, bridgeArgsBytes: 0, bridgeOutputBytes: 0, resultBytes: 0, sourceBytes: 0 };

/** A third of the lifecycle's 60 s attempt lease (`AGENT_ATTEMPT_LEASE_MS`), so a live sandbox is never recovered as stale. */
export const AGENT_EXECUTOR_HEARTBEAT_MS = 20_000;

function toJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

/**
 * Guest-authored error text may carry data the program read; it is never
 * persisted or returned verbatim. The model gets the code, the error name,
 * and a digest it can correlate with the attempt row.
 */
function normalizeProgramFailure(outcome: Extract<AgentProgramOutcome, { status: "failed" }>): { code: string; message: string } {
  if (outcome.code !== "runtime_error") return { code: outcome.code, message: outcome.message };
  const separator = outcome.message.indexOf(":");
  const name = separator > 0 ? outcome.message.slice(0, separator) : "Error";
  return {
    code: "runtime_error",
    message: `Program raised ${name} (details withheld; digest ${computeSha256Digest(outcome.message).slice(7, 23)}).`,
  };
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export function createProgramExecutor(config: AgentProgramExecutorConfig) {
  const now = () => config.clock?.() ?? Date.now();
  const heartbeatMs = config.heartbeatMs ?? AGENT_EXECUTOR_HEARTBEAT_MS;

  async function executeProgram(ctx: AgentExecutorCtx, input: AgentExecuteProgramInput): Promise<AgentExecuteProgramResult> {
    const prepared = (await ctx.runQuery(config.seams.prepareAttempt, { runId: input.runId, now: now() })) as AgentPrepareAttemptOutcome;
    if (prepared.outcome === "refused") return { outcome: "refused", stage: prepared.stage, reason: prepared.reason };
    const ceilings: AgentProgramRuntimeCeilings = { ...prepared.ceilings, ...config.ceilingOverrides };
    const facade: readonly AgentExecutionFacadeEntry[] = prepared.facade;

    // Athena-owned static validation runs before any row exists; a rejected
    // program still creates a diagnostic attempt that consumes no read budget.
    const validation = validateProgramSource(input.source, {
      facade: facade.map((entry) => ({ package: entry.package, resource: entry.resource, verbs: entry.verbs })),
      maxSourceBytes: ceilings.maxSourceBytes,
    });
    // Advisory only: reads of undeclared result fields ride back on a successful
    // result so a `null` from a guessed field name reads as a misread, not as
    // missing data. Never blocks execution and never enters replay identity.
    const fieldAdvisories = validation.ok ? collectProgramFieldAdvisories(input.source, facade) : [];
    const begun = (await ctx.runMutation(config.seams.beginAttempt, {
      runId: input.runId,
      attemptIdempotencyKey: input.attemptIdempotencyKey,
      programSource: input.source,
      validation: validation.ok ? { ok: true, validatedSource: validation.source } : { ok: false, issues: [...validation.issues] },
      facade: [...facade],
      now: now(),
    })) as AgentBeginAttemptOutcome;
    if (begun.outcome === "denied") return { outcome: "denied", code: begun.code, message: begun.message, retryable: begun.retryable };
    if (begun.outcome === "resumed") return { outcome: "resumed", attemptId: begun.attemptId, status: begun.status };
    if (begun.outcome === "rejected") return { outcome: "rejected", attemptId: begun.attemptId, issues: begun.issues };
    const attemptId = begun.attemptId;

    const calls: AgentExecutorCallRecord[] = [];
    const inFlightByDigest = new Map<string, Promise<AgentCapabilityResult<AgentReadEnvelope<unknown>>>>();
    const openCallIds = new Set<Id<"agentCapabilityCall">>();
    const pendingDispatches = new Set<Promise<unknown>>();
    let programEnded = false;

    const settle = async (callId: Id<"agentCapabilityCall">, response: AgentSettleCallResponse, elapsedMs: number) => {
      const settled = (await ctx.runMutation(config.seams.settleCall, { callId, response, elapsedMs, now: now() })) as AgentSettleCallOutcome;
      openCallIds.delete(callId);
      return settled;
    };

    const invokeOnce = async (call: AgentProgramHostCall, record: { -readonly [K in keyof AgentExecutorCallRecord]: AgentExecutorCallRecord[K] }): Promise<AgentCapabilityResult<AgentReadEnvelope<unknown>>> => {
      const normalized = normalizeHostCall(facade, call);
      if (!normalized.ok) return normalized.result;
      const { request, requestDigest } = normalized.invocation;
      const reserved = (await ctx.runMutation(config.seams.reserveAndAdmitCall, {
        runId: input.runId,
        attemptId,
        callIdempotencyKey: attemptCallIdempotencyKey(attemptId, requestDigest),
        request,
        now: now(),
      })) as AgentReserveCallOutcome;
      if (reserved.outcome === "refused") {
        record.callId = reserved.callId;
        return reserved.result;
      }
      if (reserved.outcome === "resumed") {
        record.callId = reserved.callId;
        return { kind: "failed", error: { code: "call_resumed", message: "This read was already recorded for the attempt; start a new attempt to read again." } };
      }
      record.callId = reserved.callId;
      openCallIds.add(reserved.callId);
      if (programEnded || call.signal.aborted) {
        await settle(reserved.callId, { kind: "canceled", reason: "program_ended" }, 0);
        return { kind: "canceled", reason: "program_ended" };
      }
      const startedAt = now();
      const dispatch = config.dispatchReadPort({ runQuery: (reference, args) => ctx.runQuery(reference, args) as never }, reserved.invocation).then(
        (response) => ({ ok: true as const, response }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      pendingDispatches.add(dispatch);
      const dispatched = await dispatch;
      pendingDispatches.delete(dispatch);
      if (programEnded) {
        // The program already ended (timeout, abort, failure): the end path settles this call conservatively.
        return { kind: "canceled", reason: "program_ended" };
      }
      const response: AgentReadPortResponse = dispatched.ok
        ? dispatched.response
        : { kind: "failed", error: { code: "port_threw", message: "The read port failed." } };
      const settled = await settle(reserved.callId, response, Math.max(0, now() - startedAt));
      if (settled.outcome === "released") {
        if (settled.truncation) record.truncation = settled.truncation;
        return { kind: "result", envelope: settled.envelope };
      }
      if (settled.outcome === "withheld") return settled.result;
      if (settled.outcome === "already_settled") return { kind: "canceled", reason: "already_settled" };
      return { kind: "failed", error: { code: settled.code, message: settled.message } };
    };

    const bridge: AgentProgramHostBridge = {
      facade: facade.map((entry) => ({ package: entry.package, resource: entry.resource, verbs: entry.verbs })),
      invoke: async (call) => {
        const record: { -readonly [K in keyof AgentExecutorCallRecord]: AgentExecutorCallRecord[K] } = {
          callIndex: call.callIndex,
          namespace: `${call.package}.${call.resource}`,
          verb: call.verb,
          outcome: "failed",
          deduplicated: false,
        };
        calls.push(record);
        const normalized = normalizeHostCall(facade, call);
        const digest = normalized.ok ? normalized.invocation.requestDigest : undefined;
        let pending = digest ? inFlightByDigest.get(digest) : undefined;
        if (pending) {
          record.deduplicated = true;
        } else {
          pending = invokeOnce(call, record);
          if (digest) inFlightByDigest.set(digest, pending);
        }
        const outcome = await pending;
        record.outcome = outcome.kind;
        if (outcome.kind !== "result") {
          const refusal = outcome as { code?: string; reason?: string; error?: { code?: string; message?: string }; message?: string };
          const reason = refusal.code ?? refusal.reason ?? refusal.error?.code;
          if (typeof reason === "string") record.reason = reason;
          const detail = refusal.message ?? refusal.error?.message;
          if (typeof detail === "string") record.detail = detail.slice(0, 400);
        }
        if (record.deduplicated) {
          const original = calls.find((candidate) => candidate !== record && candidate.namespace === record.namespace && candidate.callId && !candidate.deduplicated);
          if (original) record.callId = original.callId;
        }
        // Only sanitized, released data crosses into the guest.
        return toJson(outcome);
      },
    };

    const heartbeat = setInterval(() => {
      void ctx.runMutation(config.seams.heartbeatAttempt, { attemptId, now: now() }).catch(() => undefined);
    }, heartbeatMs);
    let outcome: AgentProgramOutcome;
    try {
      outcome = await config.runtime.execute({ source: input.source, bridge, ceilings, signal: input.signal });
    } catch (error) {
      outcome = { status: "failed", code: "host_error", message: error instanceof Error ? error.name : "host_error", diagnostics: EMPTY_DIAGNOSTICS };
    } finally {
      clearInterval(heartbeat);
      programEnded = true;
    }
    // Late port results never reach the guest; wait for them so nothing dangles
    // past the action, then settle whatever is still open conservatively.
    await Promise.allSettled([...pendingDispatches]);
    await config.hooks?.beforeFinish?.({ attemptId, outcome });

    const diagnostics = outcome.status === "rejected" ? EMPTY_DIAGNOSTICS : outcome.diagnostics;
    if (outcome.status === "rejected") {
      // Unreachable: validation ran before the attempt existed. Fail closed.
      const finished = await finish(ctx, attemptId, { status: "failed", code: "validation_drift", message: "Validation disagreed after the attempt started.", diagnostics });
      return finished.outcome === "failed" || finished.outcome === "canceled" ? { ...finished, diagnostics, calls } : { outcome: "rejected", attemptId, issues: outcome.issues };
    }
    if (outcome.status === "completed") {
      const finished = await finish(ctx, attemptId, { status: "completed", output: outcome.output, diagnostics });
      return withDiagnostics(finished, diagnostics, calls, fieldAdvisories);
    }
    if (outcome.status === "canceled") {
      const finished = await finish(ctx, attemptId, { status: "canceled", reason: "aborted", diagnostics });
      return withDiagnostics(finished, diagnostics, calls, fieldAdvisories);
    }
    const failure = normalizeProgramFailure(outcome);
    const finished = await finish(ctx, attemptId, { status: "failed", code: failure.code, message: failure.message, diagnostics });
    return withDiagnostics(finished, diagnostics, calls, fieldAdvisories);
  }

  async function finish(ctx: AgentExecutorCtx, attemptId: Id<"agentProgramAttempt">, end: AgentAttemptEnd): Promise<AgentFinishAttemptOutcome> {
    return (await ctx.runMutation(config.seams.finishAttempt, { attemptId, end, now: now() })) as AgentFinishAttemptOutcome;
  }

  function withDiagnostics(
    finished: AgentFinishAttemptOutcome,
    diagnostics: AgentProgramDiagnostics,
    calls: readonly AgentExecutorCallRecord[],
    fieldAdvisories: readonly AgentProgramFieldAdvisory[] = [],
  ): AgentExecuteProgramResult {
    switch (finished.outcome) {
      case "result":
        return { ...finished, diagnostics, calls, ...(fieldAdvisories.length > 0 ? { fieldAdvisories } : {}) };
      case "withheld":
        return { ...finished, diagnostics, calls };
      case "failed":
      case "canceled":
        return { outcome: finished.outcome, attemptId: finished.attemptId, error: finished.error, diagnostics, calls };
      case "already_terminal":
        return { outcome: "already_terminal", attemptId: finished.attemptId, status: finished.status };
      case "rejected":
        return { outcome: "failed", attemptId: finished.attemptId, error: { code: finished.code, message: finished.message }, diagnostics, calls };
    }
  }

  /**
   * Investigator replay: re-validate the authored source (the validator is
   * deterministic, so the validated text must hash to what the attempt
   * pinned), then execute it against the complete stored inputs and compare
   * the output hash with the recorded one. Nothing here reads live data.
   */
  async function replayAttempt(ctx: AgentExecutorCtx, input: { readonly attemptId: Id<"agentProgramAttempt"> }): Promise<AgentReplayAttemptResult> {
    const loaded = (await ctx.runQuery(config.seams.loadAttemptReplayInputs, { attemptId: input.attemptId, now: now() })) as AgentAttemptReplayInputs;
    if (loaded.kind !== "available") return { kind: "not_replayable", reason: loaded.kind };
    if (!loaded.source.facade) return { kind: "not_replayable", reason: "facade_missing" };
    const validation = validateProgramSource(loaded.source.authored, {
      facade: loaded.source.facade.map((entry) => ({ package: entry.package, resource: entry.resource, verbs: entry.verbs })),
    });
    if (!validation.ok) return { kind: "not_replayable", reason: "validation_changed", detail: validation.issues.map((issue) => issue.code).join(",") };
    const sourceMatches = validation.source === loaded.source.validated && (loaded.validatedSourceHash === undefined || computeSha256Digest(validation.source) === loaded.validatedSourceHash);
    const bridge = createReplayBridge(loaded);
    const outcome = await config.runtime.execute({ source: loaded.source.authored, bridge, ceilings: { ...AGENT_PROGRAM_RUNTIME_CEILINGS, ...config.ceilingOverrides } });
    const outputHash = outcome.status === "completed" ? programOutputHash(outcome.output) : "";
    return {
      kind: "replayed",
      sourceMatches,
      outputMatches: outcome.status === "completed" && loaded.outputHash !== undefined && outputHash === loaded.outputHash,
      outputHash,
      ...(loaded.outputHash ? { storedOutputHash: loaded.outputHash } : {}),
      missingInputs: loaded.missingInputs,
      servedInputs: bridge.served().length,
      outcome,
    };
  }

  return { executeProgram, replayAttempt };
}

export type AgentProgramExecutor = ReturnType<typeof createProgramExecutor>;

// ---------------------------------------------------------------------------
// Production binding (composition root seams + QuickJS)
// ---------------------------------------------------------------------------

const PRODUCTION_SEAMS: AgentExecutorSeamRefs = {
  prepareAttempt: internal.agentHarness.executorSeams.prepareAttempt as unknown as AgentExecutorSeamRefs["prepareAttempt"],
  beginAttempt: internal.agentHarness.executorSeams.beginAttempt as unknown as AgentExecutorSeamRefs["beginAttempt"],
  reserveAndAdmitCall: internal.agentHarness.executorSeams.reserveAndAdmitCall as unknown as AgentExecutorSeamRefs["reserveAndAdmitCall"],
  settleCall: internal.agentHarness.executorSeams.settleCall as unknown as AgentExecutorSeamRefs["settleCall"],
  finishAttempt: internal.agentHarness.executorSeams.finishAttempt as unknown as AgentExecutorSeamRefs["finishAttempt"],
  heartbeatAttempt: internal.agentHarness.executorSeams.heartbeatAttempt as unknown as AgentExecutorSeamRefs["heartbeatAttempt"],
  loadAttemptReplayInputs: internal.agentHarness.executorSeams.loadAttemptReplayInputs as unknown as AgentExecutorSeamRefs["loadAttemptReplayInputs"],
};

let productionExecutor: Promise<AgentProgramExecutor> | undefined;

/** The production executor: QuickJS + the composition root's seams and read ports. The fixed `athena.executeProgram` tool handler calls this. */
export function getProductionProgramExecutor(): Promise<AgentProgramExecutor> {
  productionExecutor ??= createQuickJsProgramRuntime().then((runtime) =>
    createProgramExecutor({ runtime, seams: PRODUCTION_SEAMS, dispatchReadPort: agentDelegatedAdmission.dispatchReadPort }),
  );
  return productionExecutor;
}

/** `internal.agentHarness.executor.executeProgram` — one attempt, one result, never completes the run. */
export const executeProgram = internalAction({
  args: { runId: v.id("intelligenceRun"), attemptIdempotencyKey: v.string(), source: v.string() },
  returns: v.any(),
  handler: async (ctx, args): Promise<AgentExecuteProgramResult> => {
    const executor = await getProductionProgramExecutor();
    return executor.executeProgram({ runQuery: ctx.runQuery as AgentExecutorCtx["runQuery"], runMutation: ctx.runMutation as AgentExecutorCtx["runMutation"] }, args);
  },
});

/** `internal.agentHarness.executor.replayAttempt` — investigator replay inside the short-lived window. */
export const replayAttempt = internalAction({
  args: { attemptId: v.id("agentProgramAttempt") },
  returns: v.any(),
  handler: async (ctx, args): Promise<AgentReplayAttemptResult> => {
    const executor = await getProductionProgramExecutor();
    return executor.replayAttempt({ runQuery: ctx.runQuery as AgentExecutorCtx["runQuery"], runMutation: ctx.runMutation as AgentExecutorCtx["runMutation"] }, args);
  },
});
