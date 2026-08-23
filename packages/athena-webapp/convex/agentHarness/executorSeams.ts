/**
 * Executor seams (kernel; V8 runtime).
 *
 * Authority boundary: the program executor runs in a Node action that holds
 * no database handle. Everything durable it does goes through the internal
 * functions produced here, each one Athena transaction:
 * - `prepareAttempt`  reauthorizes the run and projects the facade + ceilings;
 * - `beginAttempt`    creates the attempt (diagnostic when validation failed,
 *                     consuming no read budget) and stores the exact validated
 *                     source with the authored text, short-lived;
 * - `reserveAndAdmitCall` reserves the declared worst case under the
 *                     invocation idempotency key and admits through
 *                     delegated admission;
 * - `settleCall`      fits the released envelope under the 240 KiB record
 *                     ceiling at its declared boundary, then releases through
 *                     delegated admission and settles through the harness
 *                     lifecycle exactly once; timeouts/cancels settle
 *                     conservatively with no payload;
 * - `finishAttempt`   accepts exactly one structured output, hashes it,
 *                     derives completeness/freshness/egress from the released
 *                     inputs, revalidates authority, and records the
 *                     irreversible `provider_egress_committed` boundary;
 * - `completeRun`     resolves attempt/citation refs, reauthorizes citations
 *                     and completion through delegated admission, mints claim
 *                     slices through the manifest extractor, and commits
 *                     through the harness lifecycle.
 * The factory takes the bound delegated admission so the composition root
 * (production) and the test package bind the same code path.
 */
import type { FunctionReference } from "convex/server";
import { v, type Infer } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "../_generated/server";
import type { AgentCapabilityRequest, AgentProgramResultEnvelope } from "../../shared/agentHarness/bridge";
import { computeSha256Digest } from "../../shared/agentHarness/digest";
import type {
  AgentCallSettlementOutcome,
  AgentProgramAttemptStatus,
  BudgetVector,
} from "../../shared/agentHarness/execution";
import {
  manifestEgressClass,
  summarizeCapability,
  type AgentCapabilityManifest,
  type JsonValue,
} from "../../shared/agentHarness/manifest";
import type { AgentReadEnvelope } from "../../shared/agentHarness/results";
import type { AgentEgressClass } from "../../shared/agentHarness/values";
import { agentDelegatedOperatorKindValidator } from "../schemas/agentHarness";
import { deriveExecutionCeilings, settlementOutcomeForProgramEnd } from "./budgets";
import {
  listCitationCandidatesWithCtx,
  mintAttemptRef,
  readCitationEvidenceForViewerWithCtx,
  resolveAttemptRefsWithCtx,
  resolveCitationRefsWithCtx,
  type AgentCitationCandidate,
} from "./citations";
import type { DelegatedAdmission, DelegatedCallAdmission } from "./delegatedAdmission";
import { AGENT_CAPABILITY_SCHEMAS, projectRunFacadeShape, type AgentCapabilitySchemaIndex } from "./discovery";
import {
  buildClaimSupport,
  egressClassForCall,
  fitEnvelopeForEvidence,
  immutableRevisionOf,
  isStructuredProgramOutput,
  loadAttemptReplayInputsWithCtx,
  programOutputHash,
  resolveAttemptExposure,
  summarizeAttemptInputs,
  type AgentAttemptExposure,
  type AgentAttemptInputSummary,
  type AgentEvidenceExtractorLookup,
  type AgentExecutionFacadeEntry,
  type AgentFreshnessSummary,
  type AgentReleasedInput,
} from "./evidence";
import type { AgentCapabilityRefusal } from "./grants";
import {
  AGENT_ATTEMPT_LEASE_MS,
  beginProgramAttemptWithCtx,
  completeAgentRunWithCtx,
  heartbeatProgramAttemptWithCtx,
  settleCapabilityCallWithCtx,
  transitionProgramAttemptWithCtx,
  type CompletionCitationInput,
} from "./lifecycle";
import type { AgentProgramDiagnostics, AgentProgramRuntimeCeilings, AgentProgramValidationIssue } from "./programRuntime/types";
import type { AgentReadPortInvocation, AgentReadPortResponse } from "./readPorts";
import { recordScratchDescriptorWithCtx } from "./retention";
import { agentDelegatedAdmission, resolveAgentEvidenceExtractor } from "../platform/operationAdmission";

type ReadCtx = QueryCtx | MutationCtx;
type IntelligenceError = NonNullable<Doc<"intelligenceRun">["error"]>;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export type AgentExecutorSeamConfig = {
  readonly admission: DelegatedAdmission;
  /** Model-projectable schemas; defaults to the generated index. Tests pass the test package's. */
  readonly schemas?: AgentCapabilitySchemaIndex;
  /** Manifest-declared evidence extractors by capability id (domain packages supply these; kernel never imports a domain). */
  readonly resolveEvidenceExtractor?: AgentEvidenceExtractorLookup;
};

/** Build a schema index from manifests (tests, direct-harness smoke). */
export function buildCapabilitySchemaIndex(manifests: readonly AgentCapabilityManifest[]): AgentCapabilitySchemaIndex {
  const declarations: Record<string, AgentCapabilitySchemaIndex["declarations"][string]> = {};
  const summaries: Record<string, AgentCapabilitySchemaIndex["summaries"][string]> = {};
  const namespaceIndex: Record<string, string> = {};
  const packageIndex: Record<string, string> = {};
  for (const manifest of manifests) {
    // The binding never reaches the model-visible index.
    const { binding: _binding, ...declaration } = manifest;
    declarations[manifest.capabilityId] = declaration;
    summaries[manifest.capabilityId] = summarizeCapability(manifest);
    namespaceIndex[`${manifest.namespace.package}.${manifest.namespace.resource}`] = manifest.capabilityId;
    packageIndex[manifest.capabilityId] = manifest.namespace.package;
  }
  return { declarations, summaries, namespaceIndex, packageIndex };
}

// ---------------------------------------------------------------------------
// Validators and argument types
// ---------------------------------------------------------------------------

const facadeEntryValidator = v.object({
  package: v.string(),
  resource: v.string(),
  verbs: v.array(v.union(v.literal("get"), v.literal("list"))),
  capabilityId: v.string(),
  namespace: v.string(),
  fields: v.optional(v.array(v.string())),
});

const validationIssueValidator = v.object({
  code: v.string(),
  message: v.string(),
  line: v.optional(v.number()),
  column: v.optional(v.number()),
});

const attemptValidationValidator = v.union(
  v.object({ ok: v.literal(true), validatedSource: v.string() }),
  v.object({ ok: v.literal(false), issues: v.array(validationIssueValidator) }),
);

const capabilityRequestValidator = v.object({
  capabilityId: v.string(),
  namespace: v.string(),
  verb: v.union(v.literal("get"), v.literal("list")),
  args: v.record(v.string(), v.any()),
  projections: v.optional(v.array(v.string())),
  cursor: v.optional(v.string()),
});

const diagnosticsValidator = v.object({
  elapsedMs: v.number(),
  hostCalls: v.number(),
  maxInFlight: v.number(),
  bridgeArgsBytes: v.number(),
  bridgeOutputBytes: v.number(),
  resultBytes: v.number(),
  sourceBytes: v.number(),
  memoryUsedBytes: v.optional(v.number()),
});

const attemptEndValidator = v.union(
  v.object({ status: v.literal("completed"), output: v.any(), diagnostics: diagnosticsValidator }),
  v.object({ status: v.literal("failed"), code: v.string(), message: v.string(), diagnostics: diagnosticsValidator }),
  v.object({ status: v.literal("canceled"), reason: v.string(), diagnostics: diagnosticsValidator }),
);

const completionCitationValidator = v.object({
  ref: v.string(),
  claim: v.optional(v.string()),
  claimShape: v.optional(v.string()),
});

const completionArtifactValidator = v.object({
  title: v.optional(v.string()),
  summary: v.optional(v.string()),
  payload: v.record(v.string(), v.any()),
  confidence: v.optional(v.number()),
  limitedEvidence: v.optional(v.boolean()),
});

const viewerValidator = v.object({
  kind: agentDelegatedOperatorKindValidator,
  athenaUserId: v.id("athenaUser"),
  authUserId: v.optional(v.id("users")),
});

/** Validator-shaped at the boundary; the issue codes are the validator's closed vocabulary. */
export type AgentAttemptValidation =
  | { readonly ok: true; readonly validatedSource: string }
  | { readonly ok: false; readonly issues: readonly AgentProgramValidationIssue[] };
export type AgentAttemptEnd = Infer<typeof attemptEndValidator>;
export type AgentCompletionCitationRequest = Infer<typeof completionCitationValidator>;
export type AgentCompletionArtifactRequest = Infer<typeof completionArtifactValidator>;

// ---------------------------------------------------------------------------
// Outcome types
// ---------------------------------------------------------------------------

export type AgentPrepareAttemptOutcome =
  | {
      readonly outcome: "ready";
      readonly facade: readonly AgentExecutionFacadeEntry[];
      readonly ceilings: AgentProgramRuntimeCeilings;
      readonly grantEgressClass: AgentEgressClass;
      readonly authorizationEpoch: number;
    }
  | { readonly outcome: "refused"; readonly stage: string; readonly reason: string; readonly result: AgentCapabilityRefusal };

export type AgentBeginAttemptOutcome =
  | { readonly outcome: "executing"; readonly attemptId: Id<"agentProgramAttempt">; readonly sequence: number }
  | { readonly outcome: "rejected"; readonly attemptId: Id<"agentProgramAttempt">; readonly sequence: number; readonly issues: readonly AgentProgramValidationIssue[] }
  | { readonly outcome: "resumed"; readonly attemptId: Id<"agentProgramAttempt">; readonly sequence: number; readonly status: AgentProgramAttemptStatus }
  | { readonly outcome: "denied"; readonly code: string; readonly message: string; readonly retryable: boolean };

export type AgentReserveCallOutcome =
  | {
      readonly outcome: "admitted";
      readonly callId: Id<"agentCapabilityCall">;
      readonly invocation: AgentReadPortInvocation;
      readonly remaining: BudgetVector;
      readonly egressClass: AgentEgressClass;
    }
  | { readonly outcome: "resumed"; readonly callId: Id<"agentCapabilityCall">; readonly status: Doc<"agentCapabilityCall">["status"] }
  | Extract<DelegatedCallAdmission, { outcome: "refused" }>;

/** What the executor may settle a call with: a port response or its own end state. */
export type AgentSettleCallResponse =
  | AgentReadPortResponse
  | { readonly kind: "timeout" }
  | { readonly kind: "canceled"; readonly reason: string };

export type AgentSettleCallOutcome =
  | {
      readonly outcome: "released";
      readonly callId: Id<"agentCapabilityCall">;
      readonly envelope: AgentReadEnvelope<unknown>;
      readonly resultHash: string;
      readonly charged: BudgetVector;
      readonly authorityShrunk: boolean;
      readonly egressClass: AgentEgressClass;
      readonly truncation?: { readonly keptItems: number; readonly droppedItems: number };
    }
  | { readonly outcome: "withheld"; readonly callId: Id<"agentCapabilityCall">; readonly reason: string; readonly result: AgentCapabilityRefusal }
  | { readonly outcome: "already_settled"; readonly callId: Id<"agentCapabilityCall">; readonly status: Doc<"agentCapabilityCall">["status"] }
  | { readonly outcome: "rejected"; readonly callId: Id<"agentCapabilityCall">; readonly code: string; readonly message: string };

export type AgentProgramResultRecord = AgentProgramResultEnvelope & {
  readonly outputHash: string;
  readonly freshness: AgentFreshnessSummary;
};

export type AgentFinishAttemptOutcome =
  | {
      readonly outcome: "result";
      readonly attemptId: Id<"agentProgramAttempt">;
      readonly attemptRef: string;
      readonly resultHash: string;
      readonly result: AgentProgramResultRecord;
      readonly citations: readonly AgentCitationCandidate[];
      readonly providerEgress: { readonly state: "committed"; readonly at: number; readonly authorizationEpoch: number };
      readonly replayed: boolean;
    }
  | {
      readonly outcome: "withheld";
      readonly attemptId: Id<"agentProgramAttempt">;
      readonly attemptRef: string;
      readonly resultHash: string;
      readonly reason: string;
      readonly result: AgentCapabilityRefusal;
      readonly providerEgress: { readonly state: "withheld"; readonly at: number; readonly authorizationEpoch: number };
    }
  | { readonly outcome: "failed" | "canceled"; readonly attemptId: Id<"agentProgramAttempt">; readonly error: IntelligenceError }
  | { readonly outcome: "already_terminal"; readonly attemptId: Id<"agentProgramAttempt">; readonly status: AgentProgramAttemptStatus }
  | { readonly outcome: "rejected"; readonly attemptId: Id<"agentProgramAttempt">; readonly code: string; readonly message: string };

export type AgentCompleteRunOutcome =
  | {
      readonly outcome: "completed";
      readonly artifactId: Id<"intelligenceArtifact">;
      readonly citationBindingIds: readonly Id<"agentCitationBinding">[];
      readonly citations: readonly { readonly ref: string; readonly support: "claim_support" | "provenance_only"; readonly reason?: string; readonly immutableRevisionRef?: string }[];
    }
  | { readonly outcome: "refused"; readonly stage: string; readonly reason: string; readonly result: AgentCapabilityRefusal }
  | { readonly outcome: "rejected"; readonly reason: string; readonly ref?: string; readonly message: string }
  | { readonly outcome: "already_terminal"; readonly status: Doc<"intelligenceRun">["status"]; readonly artifactId?: Id<"intelligenceArtifact"> };

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createAgentExecutorSeams(config: AgentExecutorSeamConfig) {
  const { admission } = config;
  const registry = admission.registry;
  const schemas = config.schemas ?? AGENT_CAPABILITY_SCHEMAS;

  const withheldDelegation = (call: Doc<"agentCapabilityCall">, reason: string, now: number) =>
    call.delegation
      ? {
          ...call.delegation,
          release: { verdict: "withheld" as const, reason, authorityShrunk: false, authorizationEpoch: call.delegation.authorizationEpoch, at: now },
        }
      : undefined;

  // -------------------------------------------------------------------------
  // prepareAttempt (query)
  // -------------------------------------------------------------------------

  async function prepareAttemptWithCtx(ctx: ReadCtx, input: { readonly runId: Id<"intelligenceRun">; readonly now: number }): Promise<AgentPrepareAttemptOutcome> {
    const verdict = await admission.reauthorizeGrantWithCtx(ctx, { runId: input.runId, purpose: "dispatch", now: input.now });
    if (verdict.kind === "refused") return { outcome: "refused", stage: verdict.stage, reason: verdict.reason, result: verdict.result };
    const shape = projectRunFacadeShape(verdict.runtimeGrant, { schemas });
    const facade: AgentExecutionFacadeEntry[] = [];
    for (const [pkg, entry] of Object.entries(shape.packages)) {
      for (const [resource, resourceShape] of Object.entries(entry.resources)) {
        facade.push({
          package: pkg,
          resource,
          verbs: [...resourceShape.verbs],
          capabilityId: resourceShape.capabilityId,
          namespace: `${pkg}.${resource}`,
          fields: Object.keys(resourceShape.resultFields),
        });
      }
    }
    facade.sort((a, b) => a.namespace.localeCompare(b.namespace));
    const profile = registry.profiles[verdict.grant.profileKey];
    const ceilings = deriveExecutionCeilings({
      runLimits: verdict.grant.budgetPolicy.runLimits,
      attemptLimits: verdict.grant.budgetPolicy.attemptLimits,
      maxAttempts: verdict.grant.budgetPolicy.maxAttempts,
      maxInFlightCalls: profile?.budgetPolicy.maxInFlightCalls,
    });
    return { outcome: "ready", facade, ceilings, grantEgressClass: verdict.runtimeGrant.egressClass, authorizationEpoch: verdict.authorizationEpoch };
  }

  // -------------------------------------------------------------------------
  // beginAttempt (mutation)
  // -------------------------------------------------------------------------

  async function beginAttemptWithCtx(
    ctx: MutationCtx,
    input: {
      readonly runId: Id<"intelligenceRun">;
      readonly attemptIdempotencyKey: string;
      readonly programSource: string;
      readonly validation: AgentAttemptValidation;
      readonly facade: readonly AgentExecutionFacadeEntry[];
      readonly now: number;
    },
  ): Promise<AgentBeginAttemptOutcome> {
    const begun = await beginProgramAttemptWithCtx(ctx, {
      runId: input.runId,
      attemptIdempotencyKey: input.attemptIdempotencyKey,
      programSource: input.programSource,
      programSourceHash: computeSha256Digest(input.programSource),
      ...(input.validation.ok
        ? { validatedSource: input.validation.validatedSource, validatedSourceHash: computeSha256Digest(input.validation.validatedSource), facade: input.facade }
        : {}),
      now: input.now,
    });
    if (begun.outcome === "denied") return { outcome: "denied", code: begun.denial.code, message: begun.denial.message, retryable: begun.denial.retryable };
    if (begun.outcome === "resumed") return { outcome: "resumed", attemptId: begun.attemptId, sequence: begun.sequence, status: begun.status };
    await transitionProgramAttemptWithCtx(ctx, { attemptId: begun.attemptId, to: "validating", now: input.now });
    if (!input.validation.ok) {
      await transitionProgramAttemptWithCtx(ctx, {
        attemptId: begun.attemptId,
        to: "rejected",
        now: input.now,
        error: { code: "program_rejected", message: "The program did not pass validation.", diagnostic: JSON.stringify(input.validation.issues), retryable: false },
      });
      return { outcome: "rejected", attemptId: begun.attemptId, sequence: begun.sequence, issues: input.validation.issues };
    }
    const executing = await transitionProgramAttemptWithCtx(ctx, { attemptId: begun.attemptId, to: "executing", now: input.now, leaseMs: AGENT_ATTEMPT_LEASE_MS });
    if (executing.outcome !== "advanced") {
      const denial = executing.outcome === "rejected" ? executing.denial : { code: "illegal_transition", message: "The attempt could not start.", retryable: false };
      await transitionProgramAttemptWithCtx(ctx, {
        attemptId: begun.attemptId,
        to: "canceled",
        now: input.now,
        error: { code: denial.code, message: denial.message, retryable: denial.retryable },
      });
      return { outcome: "denied", code: denial.code, message: denial.message, retryable: denial.retryable };
    }
    return { outcome: "executing", attemptId: begun.attemptId, sequence: begun.sequence };
  }

  // -------------------------------------------------------------------------
  // reserveAndAdmitCall (mutation)
  // -------------------------------------------------------------------------

  async function reserveAndAdmitCallWithCtx(
    ctx: MutationCtx,
    input: {
      readonly runId: Id<"intelligenceRun">;
      readonly attemptId: Id<"agentProgramAttempt">;
      readonly callIdempotencyKey: string;
      readonly request: AgentCapabilityRequest;
      readonly now: number;
    },
  ): Promise<AgentReserveCallOutcome> {
    const admitted = await admission.admitCapabilityCallWithCtx(ctx, input);
    if (admitted.outcome !== "admitted") return admitted;
    const manifest = registry.capabilities[admitted.invocation.capabilityId];
    return {
      outcome: "admitted",
      callId: admitted.callId,
      invocation: admitted.invocation,
      remaining: admitted.remaining,
      egressClass: manifest ? manifestEgressClass(manifest, admitted.invocation.grantedProjections) : "restricted",
    };
  }

  // -------------------------------------------------------------------------
  // settleCall (mutation)
  // -------------------------------------------------------------------------

  async function settleCallWithCtx(
    ctx: MutationCtx,
    input: { readonly callId: Id<"agentCapabilityCall">; readonly response: AgentSettleCallResponse; readonly elapsedMs: number; readonly now: number },
  ): Promise<AgentSettleCallOutcome> {
    const call = await ctx.db.get("agentCapabilityCall", input.callId);
    if (!call) return { outcome: "rejected", callId: input.callId, code: "call_not_found", message: "The capability call does not exist." };
    const { response } = input;

    if (response.kind === "timeout" || response.kind === "canceled") {
      if (call.status !== "admitted" && call.status !== "executing") return { outcome: "already_settled", callId: call._id, status: call.status };
      const outcome: AgentCallSettlementOutcome = response.kind;
      const reason = response.kind === "timeout" ? "timeout" : response.reason;
      const settled = await settleCapabilityCallWithCtx(ctx, {
        callId: call._id,
        outcome,
        error: { code: reason, message: response.kind === "timeout" ? "The program timed out before the read settled." : "The program ended before the read settled.", retryable: false },
        now: input.now,
        delegation: withheldDelegation(call, reason, input.now),
      });
      if (settled.outcome === "rejected") return { outcome: "rejected", callId: call._id, code: settled.denial.code, message: settled.denial.message };
      if (settled.outcome === "already_settled") return { outcome: "already_settled", callId: call._id, status: settled.status };
      return { outcome: "withheld", callId: call._id, reason, result: { kind: "canceled", reason } };
    }

    let truncation: { keptItems: number; droppedItems: number } | undefined;
    let portResponse: AgentReadPortResponse = response;
    if (response.kind === "envelope") {
      const fitted = fitEnvelopeForEvidence(response.envelope);
      if (fitted.kind === "rejected") {
        portResponse = {
          kind: "failed",
          error: { code: "evidence_payload_exceeds_ceiling", message: `The result is ${fitted.encodedBytes} bytes and has no collection boundary to cut at.` },
        };
      } else if (fitted.kind === "truncated") {
        truncation = { keptItems: fitted.truncation.keptItems, droppedItems: fitted.truncation.droppedItems };
        // Rows stay as the port read them; bytes are what actually crossed the
        // bridge and will be stored (the run byte ceiling bounds exactly that).
        portResponse = { ...response, envelope: fitted.envelope, usage: { rows: response.usage.rows, bytes: fitted.encodedBytes } };
      }
    }
    const released = await admission.releaseCapabilityResultWithCtx(ctx, { callId: call._id, response: portResponse, now: input.now, elapsedMs: input.elapsedMs });
    if (released.outcome === "rejected") return { outcome: "rejected", callId: call._id, code: released.denial.code, message: released.denial.message };
    if (released.outcome === "already_settled") return { outcome: "already_settled", callId: call._id, status: released.status };
    if (released.outcome === "withheld") return { outcome: "withheld", callId: call._id, reason: released.reason, result: released.result };
    const refreshed = await ctx.db.get("agentCapabilityCall", call._id);
    const manifest = registry.capabilities[call.capabilityId];
    return {
      outcome: "released",
      callId: call._id,
      envelope: released.envelope,
      resultHash: released.resultHash,
      charged: released.charged,
      authorityShrunk: released.authorityShrunk,
      egressClass: manifest && refreshed ? egressClassForCall(manifest, refreshed) : "restricted",
      ...(truncation ? { truncation } : {}),
    };
  }

  // -------------------------------------------------------------------------
  // finishAttempt (mutation)
  // -------------------------------------------------------------------------

  async function releasedInputsOf(ctx: ReadCtx, attempt: Doc<"agentProgramAttempt">) {
    const { candidates, calls } = await listCitationCandidatesWithCtx(ctx, { attempt, manifests: registry.capabilities });
    const inputs: AgentReleasedInput[] = [];
    for (const call of calls) {
      const manifest = registry.capabilities[call.capabilityId];
      if (!manifest || call.delegation?.release?.verdict !== "released") continue;
      const payload = call.replayPayloadId ? await ctx.db.get("agentReplayPayload", call.replayPayloadId) : null;
      if (!payload) continue;
      inputs.push({ envelope: payload.content as AgentReadEnvelope<unknown>, egressClass: egressClassForCall(manifest, call) });
    }
    return { candidates, inputs };
  }

  async function settleOpenCallsWithCtx(ctx: MutationCtx, attempt: Doc<"agentProgramAttempt">, outcome: AgentCallSettlementOutcome, programCode: string, now: number) {
    const reason = outcome === "timeout" ? "timeout" : "canceled";
    for (const status of ["admitted", "executing"] as const) {
      const open = await ctx.db
        .query("agentCapabilityCall")
        .withIndex("by_attemptId_status", (q) => q.eq("attemptId", attempt._id).eq("status", status))
        .take(500);
      for (const call of open) {
        await settleCapabilityCallWithCtx(ctx, {
          callId: call._id,
          outcome,
          error: { code: reason, message: `The program ended (${programCode}) before this read settled.`, retryable: false },
          now,
          delegation: withheldDelegation(call, reason, now),
        });
      }
    }
  }

  function diagnosticOf(diagnostics: AgentProgramDiagnostics): string {
    // Counters only: never data, never source, never secrets.
    return JSON.stringify(diagnostics);
  }

  async function replayStoredResult(ctx: ReadCtx, attempt: Doc<"agentProgramAttempt">): Promise<AgentFinishAttemptOutcome> {
    const resultHash = attempt.resultHash ?? "";
    const attemptRef = mintAttemptRef({ runId: attempt.runId, attemptId: attempt._id, sequence: attempt.sequence, resultHash });
    const egress = attempt.providerEgress;
    if (!egress) return { outcome: "already_terminal", attemptId: attempt._id, status: attempt.status };
    if (egress.state === "withheld") {
      return {
        outcome: "withheld",
        attemptId: attempt._id,
        attemptRef,
        resultHash,
        reason: egress.reason ?? "withheld",
        result: { kind: "denied", code: "run_not_running", message: "The result was withheld.", retryable: false },
        providerEgress: { state: "withheld", at: egress.at, authorizationEpoch: egress.authorizationEpoch },
      };
    }
    const payload = attempt.resultPayloadId ? await ctx.db.get("agentReplayPayload", attempt.resultPayloadId) : null;
    if (!payload) return { outcome: "already_terminal", attemptId: attempt._id, status: attempt.status };
    const { candidates } = await listCitationCandidatesWithCtx(ctx, { attempt, manifests: registry.capabilities });
    return {
      outcome: "result",
      attemptId: attempt._id,
      attemptRef,
      resultHash,
      result: payload.content as AgentProgramResultRecord,
      citations: candidates,
      providerEgress: { state: "committed", at: egress.at, authorizationEpoch: egress.authorizationEpoch },
      replayed: true,
    };
  }

  async function finishAttemptWithCtx(
    ctx: MutationCtx,
    input: { readonly attemptId: Id<"agentProgramAttempt">; readonly end: AgentAttemptEnd; readonly now: number },
  ): Promise<AgentFinishAttemptOutcome> {
    const attempt = await ctx.db.get("agentProgramAttempt", input.attemptId);
    if (!attempt) return { outcome: "rejected", attemptId: input.attemptId, code: "attempt_not_found", message: "The program attempt does not exist." };
    if (attempt.status === "result_produced") return replayStoredResult(ctx, attempt);
    if (attempt.status !== "executing") return { outcome: "already_terminal", attemptId: attempt._id, status: attempt.status };
    const { end } = input;

    const fail = async (to: "failed" | "canceled", error: IntelligenceError, settlement: AgentCallSettlementOutcome): Promise<AgentFinishAttemptOutcome> => {
      await settleOpenCallsWithCtx(ctx, attempt, settlement, error.code, input.now);
      const transition = await transitionProgramAttemptWithCtx(ctx, { attemptId: attempt._id, to, now: input.now, error });
      if (transition.outcome === "already_terminal") return { outcome: "already_terminal", attemptId: attempt._id, status: transition.status };
      return { outcome: to, attemptId: attempt._id, error };
    };

    if (end.status === "failed") {
      return fail(
        "failed",
        { code: `program_${end.code}`, message: end.message, diagnostic: diagnosticOf(end.diagnostics), retryable: end.code === "timeout" },
        settlementOutcomeForProgramEnd({ status: "failed", code: end.code }),
      );
    }
    if (end.status === "canceled") {
      return fail("canceled", { code: "program_canceled", message: end.reason, diagnostic: diagnosticOf(end.diagnostics), retryable: false }, "canceled");
    }
    if (!isStructuredProgramOutput(end.output)) {
      return fail(
        "failed",
        { code: "program_result_not_structured", message: "The program must return one structured object or array.", diagnostic: diagnosticOf(end.diagnostics), retryable: false },
        "canceled",
      );
    }

    const { candidates, inputs } = await releasedInputsOf(ctx, attempt);
    const summary: AgentAttemptInputSummary = summarizeAttemptInputs(inputs);
    const output = end.output as JsonValue;
    const record: AgentProgramResultRecord = {
      output,
      outputHash: programOutputHash(output),
      completeness: summary.completeness,
      egressClass: summary.egressClass,
      freshness: summary.freshness,
      derivedFromCallRefs: candidates.map((candidate) => candidate.citation),
    };
    const resultHash = computeSha256Digest(record);
    const produced = await transitionProgramAttemptWithCtx(ctx, {
      attemptId: attempt._id,
      to: "result_produced",
      now: input.now,
      result: { resultHash, payload: record },
    });
    if (produced.outcome !== "advanced") {
      return { outcome: "already_terminal", attemptId: attempt._id, status: produced.outcome === "rejected" ? attempt.status : produced.status };
    }
    await ctx.db.patch("agentProgramAttempt", attempt._id, {
      egressClass: summary.egressClass,
      completeness: summary.completeness.status,
      updatedAt: input.now,
    });
    const attemptRef = mintAttemptRef({ runId: attempt.runId, attemptId: attempt._id, sequence: attempt.sequence, resultHash });

    // Immediately before the result can be attached to a provider-visible
    // tool response: revalidate the authorization epoch and record the
    // irreversible boundary.
    const verdict = await admission.reauthorizeGrantWithCtx(ctx, { runId: attempt.runId, purpose: "release", now: input.now });
    if (verdict.kind === "refused") {
      const epoch = verdict.context?.authorizationEpoch ?? attempt.compatibilityEpoch;
      await ctx.db.patch("agentProgramAttempt", attempt._id, {
        providerEgress: { state: "withheld", at: input.now, authorizationEpoch: epoch, reason: verdict.reason },
        updatedAt: input.now,
      });
      return {
        outcome: "withheld",
        attemptId: attempt._id,
        attemptRef,
        resultHash,
        reason: verdict.reason,
        result: verdict.result,
        providerEgress: { state: "withheld", at: input.now, authorizationEpoch: epoch },
      };
    }
    await ctx.db.patch("agentProgramAttempt", attempt._id, {
      providerEgress: { state: "committed", at: input.now, authorizationEpoch: verdict.authorizationEpoch },
      updatedAt: input.now,
    });
    return {
      outcome: "result",
      attemptId: attempt._id,
      attemptRef,
      resultHash,
      result: record,
      citations: candidates,
      providerEgress: { state: "committed", at: input.now, authorizationEpoch: verdict.authorizationEpoch },
      replayed: false,
    };
  }

  // -------------------------------------------------------------------------
  // completeRun (mutation)
  // -------------------------------------------------------------------------

  async function completeRunWithCtx(
    ctx: MutationCtx,
    input: {
      readonly runId: Id<"intelligenceRun">;
      readonly idempotencyKey: string;
      readonly citedAttemptRefs: readonly string[];
      readonly citations: readonly AgentCompletionCitationRequest[];
      readonly artifact: AgentCompletionArtifactRequest;
      readonly now: number;
    },
  ): Promise<AgentCompleteRunOutcome> {
    const run = await ctx.db.get("intelligenceRun", input.runId);
    if (run && (run.status === "completed" || run.status === "failed" || run.status === "canceled")) {
      return { outcome: "already_terminal", status: run.status, artifactId: run.artifactId };
    }
    const completion = await admission.reauthorizeCompletionWithCtx(ctx, { runId: input.runId, now: input.now });
    if (completion.kind === "refused") return { outcome: "refused", stage: completion.stage, reason: completion.reason, result: completion.result };

    const attempts = await resolveAttemptRefsWithCtx(ctx, { runId: input.runId, refs: input.citedAttemptRefs });
    if (attempts.kind === "rejected") return { outcome: "rejected", reason: `attempt_${attempts.reason}`, ref: attempts.ref, message: attempts.message };
    const resolution = await resolveCitationRefsWithCtx(ctx, {
      runId: input.runId,
      refs: input.citations.map((citation) => citation.ref),
      citedAttempts: attempts.attempts,
    });
    if (resolution.kind === "rejected") return { outcome: "rejected", reason: `citation_${resolution.reason}`, ref: resolution.ref, message: resolution.message };

    const authorized = await admission.reauthorizeCitationsWithCtx(ctx, {
      runId: input.runId,
      callIds: [...new Set(resolution.citations.map((citation) => citation.call._id))],
      now: input.now,
    });
    if (authorized.kind === "refused") return { outcome: "refused", stage: authorized.stage, reason: authorized.reason, result: authorized.result };

    const citations: CompletionCitationInput[] = [];
    const support: Extract<AgentCompleteRunOutcome, { outcome: "completed" }>["citations"][number][] = [];
    for (const [index, resolved] of resolution.citations.entries()) {
      const request = input.citations[index];
      const manifest = registry.capabilities[resolved.call.capabilityId];
      if (!manifest) return { outcome: "rejected", reason: "citation_capability_unknown", ref: resolved.ref, message: "The cited capability is no longer registered." };
      const payload = resolved.call.replayPayloadId ? await ctx.db.get("agentReplayPayload", resolved.call.replayPayloadId) : null;
      const envelope = payload ? (payload.content as AgentReadEnvelope<unknown>) : null;
      const claim = buildClaimSupport({
        manifest,
        extractor: config.resolveEvidenceExtractor?.(resolved.call.capabilityId),
        call: resolved.call,
        envelope,
        claimShape: request.claimShape,
      });
      const immutableRevisionRef = immutableRevisionOf(envelope);
      const sourceRef = resolved.call.sourceRefs[0] ?? { table: "agent_capability_call", id: resolved.ref, synthetic: true };
      citations.push({
        citationKey: resolved.ref,
        callId: resolved.call._id,
        resultHash: resolved.call.resultHash!,
        sourceRef,
        ...(request.claim ? { claimDigest: computeSha256Digest(request.claim) } : {}),
        ...(claim.kind === "claim_support" ? { claimSupport: { extractorKey: claim.extractorKey, extractorVersion: claim.extractorVersion, slice: claim.slice } } : {}),
        ...(immutableRevisionRef ? { immutableRevisionRef } : {}),
      });
      support.push({
        ref: resolved.ref,
        support: claim.kind,
        ...(claim.kind === "provenance_only" ? { reason: claim.reason } : {}),
        ...(immutableRevisionRef ? { immutableRevisionRef } : {}),
      });
    }

    const completed = await completeAgentRunWithCtx(ctx, {
      runId: input.runId,
      idempotencyKey: input.idempotencyKey,
      now: input.now,
      citedAttemptIds: [...attempts.attempts.keys()],
      artifact: input.artifact,
      citations,
    });
    if (completed.outcome === "already_terminal") return { outcome: "already_terminal", status: completed.status, artifactId: completed.artifactId };
    if (completed.outcome === "rejected") return { outcome: "rejected", reason: completed.denial.code, message: completed.denial.message };
    return { outcome: "completed", artifactId: completed.artifactId, citationBindingIds: completed.citationBindingIds, citations: support };
  }

  // -------------------------------------------------------------------------
  // Exposure, scratch, heartbeat, replay, evidence
  // -------------------------------------------------------------------------

  async function describeAttemptExposureWithCtx(ctx: ReadCtx, attemptId: Id<"agentProgramAttempt">): Promise<AgentAttemptExposure | null> {
    const attempt = await ctx.db.get("agentProgramAttempt", attemptId);
    if (!attempt) return null;
    const run = await ctx.db.get("intelligenceRun", attempt.runId);
    if (!run) return null;
    const binding = run.turnBindingId ? await ctx.db.get("agentTurnBinding", run.turnBindingId) : null;
    return resolveAttemptExposure({ attempt, run, binding });
  }

  const functions = {
    prepareAttempt: internalQuery({
      args: { runId: v.id("intelligenceRun"), now: v.optional(v.number()) },
      handler: async (ctx, args) => prepareAttemptWithCtx(ctx, { runId: args.runId, now: args.now ?? Date.now() }),
    }),
    beginAttempt: internalMutation({
      args: {
        runId: v.id("intelligenceRun"),
        attemptIdempotencyKey: v.string(),
        programSource: v.string(),
        validation: attemptValidationValidator,
        facade: v.array(facadeEntryValidator),
        now: v.optional(v.number()),
      },
      handler: async (ctx, args) =>
        beginAttemptWithCtx(ctx, {
          ...args,
          validation: args.validation.ok ? args.validation : { ok: false, issues: args.validation.issues as AgentProgramValidationIssue[] },
          now: args.now ?? Date.now(),
        }),
    }),
    reserveAndAdmitCall: internalMutation({
      args: {
        runId: v.id("intelligenceRun"),
        attemptId: v.id("agentProgramAttempt"),
        callIdempotencyKey: v.string(),
        request: capabilityRequestValidator,
        now: v.optional(v.number()),
      },
      handler: async (ctx, args) => reserveAndAdmitCallWithCtx(ctx, { ...args, request: args.request as AgentCapabilityRequest, now: args.now ?? Date.now() }),
    }),
    settleCall: internalMutation({
      args: { callId: v.id("agentCapabilityCall"), response: v.any(), elapsedMs: v.number(), now: v.optional(v.number()) },
      handler: async (ctx, args) => settleCallWithCtx(ctx, { ...args, response: args.response as AgentSettleCallResponse, now: args.now ?? Date.now() }),
    }),
    finishAttempt: internalMutation({
      args: { attemptId: v.id("agentProgramAttempt"), end: attemptEndValidator, now: v.optional(v.number()) },
      handler: async (ctx, args) => finishAttemptWithCtx(ctx, { ...args, now: args.now ?? Date.now() }),
    }),
    completeRun: internalMutation({
      args: {
        runId: v.id("intelligenceRun"),
        idempotencyKey: v.string(),
        citedAttemptRefs: v.array(v.string()),
        citations: v.array(completionCitationValidator),
        artifact: completionArtifactValidator,
        now: v.optional(v.number()),
      },
      handler: async (ctx, args) => completeRunWithCtx(ctx, { ...args, now: args.now ?? Date.now() }),
    }),
    recordScratch: internalMutation({
      args: {
        runId: v.id("intelligenceRun"),
        attemptId: v.optional(v.id("agentProgramAttempt")),
        scratchKey: v.string(),
        content: v.any(),
        now: v.optional(v.number()),
      },
      handler: async (ctx, args) => recordScratchDescriptorWithCtx(ctx, { ...args, now: args.now ?? Date.now() }),
    }),
    heartbeatAttempt: internalMutation({
      args: { attemptId: v.id("agentProgramAttempt"), now: v.optional(v.number()), leaseMs: v.optional(v.number()) },
      handler: async (ctx, args) => heartbeatProgramAttemptWithCtx(ctx, { ...args, now: args.now ?? Date.now() }),
    }),
    loadAttemptReplayInputs: internalQuery({
      args: { attemptId: v.id("agentProgramAttempt"), now: v.optional(v.number()) },
      handler: async (ctx, args) => loadAttemptReplayInputsWithCtx(ctx, { attemptId: args.attemptId, now: args.now ?? Date.now() }),
    }),
    describeAttemptExposure: internalQuery({
      args: { attemptId: v.id("agentProgramAttempt") },
      handler: async (ctx, args) => describeAttemptExposureWithCtx(ctx, args.attemptId),
    }),
    readCitationEvidence: internalMutation({
      args: { runId: v.id("intelligenceRun"), citationRef: v.string(), viewer: viewerValidator, purpose: v.string(), now: v.optional(v.number()) },
      handler: async (ctx, args) =>
        readCitationEvidenceForViewerWithCtx(ctx, admission.config, { ...args, now: args.now ?? Date.now() }),
    }),
  };

  return {
    config,
    admission,
    schemas,
    prepareAttemptWithCtx,
    beginAttemptWithCtx,
    reserveAndAdmitCallWithCtx,
    settleCallWithCtx,
    finishAttemptWithCtx,
    completeRunWithCtx,
    describeAttemptExposureWithCtx,
    loadAttemptReplayInputsWithCtx: (ctx: ReadCtx, input: { attemptId: Id<"agentProgramAttempt">; now: number }) => loadAttemptReplayInputsWithCtx(ctx, input),
    readCitationEvidenceWithCtx: (ctx: MutationCtx, input: Parameters<typeof readCitationEvidenceForViewerWithCtx>[2]) =>
      readCitationEvidenceForViewerWithCtx(ctx, admission.config, input),
    /** Executor side: run an admitted invocation against the closed read-port map. */
    dispatchReadPort: admission.dispatchReadPort,
    functions,
  };
}

export type AgentExecutorSeams = ReturnType<typeof createAgentExecutorSeams>;

// ---------------------------------------------------------------------------
// Production binding: the composition root's delegated admission and the
// generated schemas. The runtime host's tool handlers call these through
// `internal.agentHarness.executorSeams.*` (or through `executor.ts`).
// Manifest-declared evidence extractors are resolved through the admission
// composition root (the only module that may reach both the kernel and a
// product package), so a cited call carries a deterministic minimal claim
// slice instead of degrading to provenance-only. A capability that declares no
// extractor still yields provenance-only, which is the honest default.
// ---------------------------------------------------------------------------

export const agentExecutorSeams = createAgentExecutorSeams({
  admission: agentDelegatedAdmission,
  resolveEvidenceExtractor: resolveAgentEvidenceExtractor,
});

export const prepareAttempt = agentExecutorSeams.functions.prepareAttempt;
export const beginAttempt = agentExecutorSeams.functions.beginAttempt;
export const reserveAndAdmitCall = agentExecutorSeams.functions.reserveAndAdmitCall;
export const settleCall = agentExecutorSeams.functions.settleCall;
export const finishAttempt = agentExecutorSeams.functions.finishAttempt;
export const completeRun = agentExecutorSeams.functions.completeRun;
export const recordScratch = agentExecutorSeams.functions.recordScratch;
export const heartbeatAttempt = agentExecutorSeams.functions.heartbeatAttempt;
export const loadAttemptReplayInputs = agentExecutorSeams.functions.loadAttemptReplayInputs;
export const describeAttemptExposure = agentExecutorSeams.functions.describeAttemptExposure;
export const readCitationEvidence = agentExecutorSeams.functions.readCitationEvidence;

/** Function references the Node executor calls; mirrors `functions` above. */
export type AgentExecutorSeamRefs = {
  readonly prepareAttempt: FunctionReference<"query", "internal", { runId: Id<"intelligenceRun">; now?: number }, AgentPrepareAttemptOutcome>;
  readonly beginAttempt: FunctionReference<
    "mutation",
    "internal",
    { runId: Id<"intelligenceRun">; attemptIdempotencyKey: string; programSource: string; validation: AgentAttemptValidation; facade: AgentExecutionFacadeEntry[]; now?: number },
    AgentBeginAttemptOutcome
  >;
  readonly reserveAndAdmitCall: FunctionReference<
    "mutation",
    "internal",
    { runId: Id<"intelligenceRun">; attemptId: Id<"agentProgramAttempt">; callIdempotencyKey: string; request: AgentCapabilityRequest; now?: number },
    AgentReserveCallOutcome
  >;
  readonly settleCall: FunctionReference<
    "mutation",
    "internal",
    { callId: Id<"agentCapabilityCall">; response: AgentSettleCallResponse; elapsedMs: number; now?: number },
    AgentSettleCallOutcome
  >;
  readonly finishAttempt: FunctionReference<"mutation", "internal", { attemptId: Id<"agentProgramAttempt">; end: AgentAttemptEnd; now?: number }, AgentFinishAttemptOutcome>;
  readonly heartbeatAttempt: FunctionReference<"mutation", "internal", { attemptId: Id<"agentProgramAttempt">; now?: number; leaseMs?: number }, { extended: boolean }>;
  readonly loadAttemptReplayInputs: FunctionReference<
    "query",
    "internal",
    { attemptId: Id<"agentProgramAttempt">; now?: number },
    Awaited<ReturnType<typeof loadAttemptReplayInputsWithCtx>>
  >;
};
