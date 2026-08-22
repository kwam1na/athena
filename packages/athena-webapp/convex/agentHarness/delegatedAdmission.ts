/**
 * Delegated admission (kernel; product-neutral).
 *
 * Authority boundary: every capability read a program triggers passes through
 * here twice — `admitCapabilityCallWithCtx` before dispatch and
 * `releaseCapabilityResultWithCtx` before anything becomes program-visible —
 * and citations and completion pass through `reauthorizeCitationsWithCtx` and
 * `reauthorizeCompletionWithCtx`. Each pass re-derives the effective grant
 * (`grants.ts`) and consults the closed read-port map (`readPorts.ts`). A
 * refusal is typed in the bridge vocabulary, recorded exactly once on the
 * call row through the harness lifecycle (denied calls consume a call attempt and
 * nothing else), and never retried against a weaker actor: there is no chain.
 * A result invalidated by a later shrink is settled as evidence only — hash,
 * timing, completeness, reason — and its payload is never released.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { hashCanonical } from "../../shared/agentHarness/agentRuntime";
import type { AgentCapabilityRequest } from "../../shared/agentHarness/bridge";
import {
  budgetVector,
  type AgentCallSettlementOutcome,
  type AgentCapabilityCallStatus,
  type AgentHarnessDenial,
  type BudgetVector,
} from "../../shared/agentHarness/execution";
import { namespacePath, omitUngrantedFields } from "../../shared/agentHarness/manifest";
import type { AgentReadPortDefinition } from "../../shared/agentHarness/readPort";
import { validateReadEnvelope, type AgentReadEnvelope } from "../../shared/agentHarness/results";
import { findDisallowedFields } from "./conformance";
import type { AgentRuntimeGrant } from "./discovery";
import {
  describeGrantForModel,
  encodeDelegatedActorRef,
  materializeRunGrantWithCtx,
  prepareDelegatedRunGrantWithCtx,
  reauthorizeGrantWithCtx,
  type AgentCapabilityRefusal,
  type DelegatedAuthorityAuthorized,
  type DelegatedAuthorityRefusal,
  type DelegatedAuthorityVerdict,
  type DelegatedGrantConfig,
  type DelegatedRunGrantRequest,
  type MaterializeRunGrantInput,
  type ReadCtx,
  type ReauthorizeGrantInput,
} from "./grants";
import {
  admitCapabilityCallWithCtx,
  markCapabilityCallExecutingWithCtx,
  settleCapabilityCallWithCtx,
} from "./lifecycle";
import {
  AGENT_READ_PORT_INVOCATION_FIELDS,
  computeReadResultHash,
  createAgentReadPortQueryDefiner,
  dispatchAgentReadPort,
  resolveAgentCursor,
  resolveAgentReadPortHandler,
  validateAgentReadRequestArgs,
  type AgentReadPortInvocation,
  type AgentReadPortRegistry,
  type AgentReadPortResponse,
} from "./readPorts";

export type DelegatedAdmissionConfig = DelegatedGrantConfig & {
  readonly readPorts: AgentReadPortRegistry;
};

type CallDelegation = NonNullable<Doc<"agentCapabilityCall">["delegation"]>;
type SourceRef = Doc<"agentCapabilityCall">["sourceRefs"][number];

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

export type DelegatedCallAdmission =
  | {
      readonly outcome: "admitted";
      readonly callId: Id<"agentCapabilityCall">;
      readonly reservationId: Id<"agentBudgetReservation">;
      /**
       * Dispatch with `dispatchAgentReadPort(ctx, readPorts, invocation)` from
       * the executor's action. The handler reference itself is deliberately not
       * returned: function references do not survive a `runMutation` boundary,
       * and the closed registry is the only place a handler may come from.
       */
      readonly invocation: AgentReadPortInvocation;
      readonly port: AgentReadPortDefinition;
      readonly remaining: BudgetVector;
    }
  | { readonly outcome: "resumed"; readonly callId: Id<"agentCapabilityCall">; readonly status: AgentCapabilityCallStatus }
  | {
      readonly outcome: "refused";
      readonly callId?: Id<"agentCapabilityCall">;
      readonly stage: string;
      readonly reason: string;
      readonly result: AgentCapabilityRefusal;
    };

export type DelegatedCallRelease =
  | {
      readonly outcome: "released";
      readonly callId: Id<"agentCapabilityCall">;
      readonly envelope: AgentReadEnvelope<unknown>;
      readonly resultHash: string;
      readonly charged: BudgetVector;
      readonly authorityShrunk: boolean;
    }
  | { readonly outcome: "withheld"; readonly callId: Id<"agentCapabilityCall">; readonly reason: string; readonly result: AgentCapabilityRefusal }
  | { readonly outcome: "already_settled"; readonly callId: Id<"agentCapabilityCall">; readonly status: AgentCapabilityCallStatus }
  | { readonly outcome: "rejected"; readonly callId: Id<"agentCapabilityCall">; readonly denial: AgentHarnessDenial };

export type DelegatedCitationVerdict =
  | {
      readonly kind: "authorized";
      readonly calls: readonly { readonly callId: Id<"agentCapabilityCall">; readonly resultHash: string; readonly capabilityId: string }[];
      readonly runtimeGrant: AgentRuntimeGrant;
    }
  | { readonly kind: "refused"; readonly callId?: Id<"agentCapabilityCall">; readonly stage: string; readonly reason: string; readonly result: AgentCapabilityRefusal };

export type DelegatedCompletionVerdict =
  | { readonly kind: "authorized"; readonly verdict: DelegatedAuthorityAuthorized; readonly runtimeGrant: AgentRuntimeGrant }
  | DelegatedAuthorityRefusal;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const deniedResult = (
  code: Extract<AgentCapabilityRefusal, { kind: "denied" }>["code"],
  message: string,
  detail?: Extract<AgentCapabilityRefusal, { kind: "denied" }>["detail"],
): AgentCapabilityRefusal => ({ kind: "denied", code, message, retryable: false, detail });

function harnessDenialToResult(denial: AgentHarnessDenial): AgentCapabilityRefusal {
  switch (denial.code) {
    case "budget_exceeded":
    case "attempt_cap_exceeded":
      return { kind: "denied", code: "budget_exceeded", message: denial.message, retryable: false, detail: denial.detail };
    case "attempt_not_executing":
    case "attempt_not_found":
    case "attempt_terminal":
    case "attempt_not_owned_by_run":
      return { kind: "denied", code: "attempt_not_executing", message: denial.message, retryable: false, detail: denial.detail };
    case "compatibility_epoch_fenced":
      return { kind: "denied", code: "compatibility_epoch_fenced", message: denial.message, retryable: false, detail: denial.detail };
    default:
      return { kind: "denied", code: "run_not_running", message: denial.message, retryable: denial.retryable, detail: denial.detail };
  }
}

function refusalErrorCode(result: AgentCapabilityRefusal): string {
  switch (result.kind) {
    case "unauthorized":
    case "denied":
      return result.code;
    case "unavailable":
      return "unavailable";
    case "failed":
      return result.error.code;
    case "canceled":
      return "canceled";
  }
}

function settlementFor(result: AgentCapabilityRefusal): AgentCallSettlementOutcome {
  switch (result.kind) {
    case "unavailable":
      return "unavailable";
    case "failed":
      return "failed";
    case "canceled":
      return "canceled";
    default:
      return "denied";
  }
}

function toIntelligenceSourceRefs(envelope: AgentReadEnvelope<unknown>): SourceRef[] {
  return envelope.sourceRefs.map((ref) => ({
    table: "opaque_source",
    id: ref.ref,
    label: ref.label,
    surface: ref.kind,
  }));
}

function delegationRecord(input: {
  readonly verdict: DelegatedAuthorityVerdict;
  readonly portKey: string;
  readonly handlerPath: string;
  readonly grantedProjections: readonly string[];
}): CallDelegation | undefined {
  const { verdict } = input;
  const grant = verdict.kind === "authorized" ? verdict.grant : verdict.context?.grant;
  const delegation = verdict.kind === "authorized" ? verdict.delegation : verdict.context?.delegation;
  if (!grant || !delegation) return undefined;
  const authorizationEpoch = verdict.kind === "authorized" ? verdict.authorizationEpoch : verdict.context?.authorizationEpoch ?? delegation.authorizationEpoch;
  return {
    grantId: grant._id,
    grantDigest: grant.grantDigest,
    portKey: input.portKey,
    handlerPath: input.handlerPath,
    operatorKind: delegation.operatorKind,
    actorRef: encodeDelegatedActorRef({ kind: delegation.operatorKind, athenaUserId: delegation.athenaUserId }),
    authorizationEpoch,
    authorityDigest: verdict.kind === "authorized" ? verdict.authorityDigest : delegation.authorityDigest,
    grantedProjections: [...input.grantedProjections],
    admission: verdict.kind === "authorized" ? "authorized" : "refused",
    refusal:
      verdict.kind === "refused"
        ? { stage: verdict.stage, code: refusalErrorCode(verdict.result), reason: verdict.reason }
        : undefined,
  };
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

export function createDelegatedAdmission(config: DelegatedAdmissionConfig) {
  const { registry, readPorts } = config;
  const defineAgentReadPortQuery = createAgentReadPortQueryDefiner(config);

  /**
   * Admit one capability call. Order: request shape → authority (pure) →
   * lifecycle admission (budget reservation under the idempotency key, with the
   * delegated provenance on the row) → settle immediately as denied /
   * unavailable when refused → otherwise hand back the bound handler and the
   * invocation. A non-running or fenced run is refused before any row exists,
   * which is also what the lifecycle would do.
   */
  async function admitCapabilityCallWithCtxBound(
    ctx: MutationCtx,
    input: {
      readonly runId: Id<"intelligenceRun">;
      readonly attemptId: Id<"agentProgramAttempt">;
      readonly callIdempotencyKey: string;
      readonly request: AgentCapabilityRequest;
      readonly now: number;
    },
  ): Promise<DelegatedCallAdmission> {
    const { request } = input;
    const manifest = registry.capabilities[request.capabilityId];
    const portKey = manifest ? registry.portByCapability[manifest.capabilityId] : undefined;
    const resolution = portKey ? resolveAgentReadPortHandler(readPorts, portKey) : undefined;
    const port = resolution && resolution.kind === "bound" ? resolution.port : portKey ? registry.readPorts[portKey] : undefined;
    const requested = port ? budgetVector(port.declaredCost) : budgetVector({ calls: 1 });

    // 1. Request shape (pure). Unknown capability reads as unauthorized so
    //    discovery cannot be probed through error codes.
    let requestRefusal: { stage: string; reason: string; result: AgentCapabilityRefusal } | undefined;
    let cursorOk = true;
    if (!manifest) {
      requestRefusal = {
        stage: "capability",
        reason: "capability_unknown",
        result: { kind: "unauthorized", code: "unauthorized_capability", message: "This capability is not available to this run." },
      };
    } else if (namespacePath(manifest.namespace) !== request.namespace) {
      requestRefusal = { stage: "request", reason: "namespace_mismatch", result: deniedResult("invalid_arguments", "The namespace does not name this capability.") };
    } else if (!manifest.operations[request.verb]) {
      requestRefusal = { stage: "request", reason: "verb_unsupported", result: deniedResult("unsupported_verb", `This capability does not support ${request.verb}.`) };
    } else {
      const argsValidation = validateAgentReadRequestArgs(manifest, request.verb, request.args);
      if (!argsValidation.ok) {
        requestRefusal = {
          stage: "request",
          reason: "args_invalid",
          // Name the offending argument in the message, not only in the
          // detail: the message is what a model actually reads, and an
          // unactionable denial is what makes it guess.
          result: deniedResult(
            "invalid_arguments",
            `The arguments do not match the capability's filters (${argsValidation.issues
              .map((issue) => `${issue.code} at ${issue.path}`)
              .join("; ")}). Pass only the filters this capability declares; the store is taken from the run, never from arguments.`,
            { issues: argsValidation.issues.map((issue) => `${issue.code}@${issue.path}`) },
          ),
        };
      } else if (request.cursor !== undefined) {
        const resolved = request.verb === "list" && portKey ? resolveAgentCursor(request.cursor, { runId: input.runId, portKey }) : null;
        const operation = manifest.operations.list;
        const maxPages = operation && operation.bounds.kind === "collection" ? operation.bounds.maxPagesPerRun : 1;
        if (!resolved) {
          cursorOk = false;
          requestRefusal = { stage: "request", reason: "cursor_invalid", result: deniedResult("invalid_arguments", "The cursor does not belong to this run and capability.") };
        } else if (resolved.pageIndex >= maxPages) {
          cursorOk = false;
          requestRefusal = { stage: "request", reason: "page_budget_exhausted", result: deniedResult("invalid_arguments", "This run's page budget for the capability is spent.") };
        }
      }
    }

    // 2. Authority (pure reads).
    const verdict = await reauthorizeGrantWithCtx(ctx, config, {
      runId: input.runId,
      purpose: "dispatch",
      capabilityId: manifest?.capabilityId,
      requestedProjections: request.projections,
      now: input.now,
    });
    if (verdict.kind === "refused" && (verdict.stage === "run" || verdict.stage === "fence" || verdict.stage === "registry")) {
      return { outcome: "refused", stage: verdict.stage, reason: verdict.reason, result: verdict.result };
    }

    // 3. Lifecycle admission: reserves the declared worst case and records provenance.
    const grantedProjections = verdict.kind === "authorized" ? verdict.grantedProjections : [];
    const delegation = delegationRecord({
      verdict,
      portKey: portKey ?? "",
      handlerPath: resolution && resolution.kind === "bound" ? resolution.handlerPath : port?.handler.functionPath ?? "",
      grantedProjections,
    });
    const admitted = await admitCapabilityCallWithCtx(ctx, {
      runId: input.runId,
      attemptId: input.attemptId,
      callIdempotencyKey: input.callIdempotencyKey,
      capabilityId: request.capabilityId,
      normalizedArgsHash: hashCanonical({
        capabilityId: request.capabilityId,
        verb: request.verb,
        args: request.args,
        projections: [...(request.projections ?? [])].sort(),
        cursor: request.cursor,
      }),
      normalizedArgs: { ...request.args },
      requested,
      now: input.now,
      delegation,
    });
    if (admitted.outcome === "denied") {
      return { outcome: "refused", callId: admitted.callId, stage: "budget", reason: admitted.denial.code, result: harnessDenialToResult(admitted.denial) };
    }
    if (admitted.outcome === "resumed") {
      return { outcome: "resumed", callId: admitted.callId, status: admitted.status };
    }

    // 4. Record a refusal exactly once and stop.
    const refusal = requestRefusal ?? (verdict.kind === "refused" ? { stage: verdict.stage, reason: verdict.reason, result: verdict.result } : undefined);
    if (refusal) {
      await settleCapabilityCallWithCtx(ctx, {
        callId: admitted.callId,
        outcome: settlementFor(refusal.result),
        error: { code: refusal.reason, message: refusal.result.kind === "unavailable" ? refusal.result.reason : refusalErrorCode(refusal.result), retryable: false },
        now: input.now,
        delegation: delegation
          ? { ...delegation, admission: "refused", refusal: { stage: refusal.stage, code: refusalErrorCode(refusal.result), reason: refusal.reason } }
          : undefined,
      });
      return { outcome: "refused", callId: admitted.callId, stage: refusal.stage, reason: refusal.reason, result: refusal.result };
    }
    if (verdict.kind !== "authorized" || !manifest || !portKey || !cursorOk) {
      // Unreachable by construction; keep the type narrow and fail closed.
      return { outcome: "refused", callId: admitted.callId, stage: "request", reason: "admission_invariant", result: deniedResult("invalid_arguments", "The call could not be admitted.") };
    }

    // 5. Only an explicitly bound port is reachable.
    if (!resolution || resolution.kind !== "bound") {
      const reason = resolution?.kind === "unbound" ? "port_unbound" : "port_unregistered";
      const result: AgentCapabilityRefusal = { kind: "unavailable", reason, retryable: false };
      await settleCapabilityCallWithCtx(ctx, {
        callId: admitted.callId,
        outcome: "unavailable",
        error: { code: reason, message: "The capability's read port is not reachable.", retryable: false },
        now: input.now,
        delegation: delegation ? { ...delegation, admission: "refused", refusal: { stage: "port", code: reason, reason } } : undefined,
      });
      return { outcome: "refused", callId: admitted.callId, stage: "port", reason, result };
    }

    const invocation: AgentReadPortInvocation = {
      contractVersion: 1,
      runId: input.runId,
      grantId: verdict.grant._id,
      attemptId: input.attemptId,
      callId: admitted.callId,
      portKey,
      capabilityId: manifest.capabilityId,
      verb: request.verb,
      args: { ...request.args },
      cursor: request.cursor,
      grantedProjections: [...verdict.grantedProjections],
      authorizationEpoch: verdict.authorizationEpoch,
      admittedAt: input.now,
    };
    // The call is about to be dispatched: record that truthfully so a crash
    // between admission and release is recoverable as a stale executing call.
    const executing = await markCapabilityCallExecutingWithCtx(ctx, { callId: admitted.callId, now: input.now });
    if (executing.outcome === "rejected" || executing.outcome === "already_terminal") {
      return { outcome: "refused", callId: admitted.callId, stage: "request", reason: "call_not_dispatchable", result: deniedResult("invalid_arguments", "The call could not be dispatched.") };
    }
    return {
      outcome: "admitted",
      callId: admitted.callId,
      reservationId: admitted.reservationId,
      invocation,
      port: resolution.port,
      remaining: admitted.remaining,
    };
  }

  /**
   * Release one port response. Reauthorizes first; a refused verdict settles
   * the call as evidence only (hash and metadata, no payload, typed reason)
   * and withholds the result. An envelope that survives is re-stripped under
   * the NOW-effective projections, re-validated, hashed, and settled as
   * succeeded/partial with actual usage.
   */
  async function releaseCapabilityResultWithCtxBound(
    ctx: MutationCtx,
    input: {
      readonly callId: Id<"agentCapabilityCall">;
      readonly response: AgentReadPortResponse;
      readonly now: number;
      readonly elapsedMs?: number;
    },
  ): Promise<DelegatedCallRelease> {
    const call = await ctx.db.get("agentCapabilityCall", input.callId);
    if (!call) {
      return { outcome: "rejected", callId: input.callId, denial: { code: "call_not_found", message: "The capability call does not exist.", retryable: false } };
    }
    if (call.status !== "admitted" && call.status !== "executing") {
      return { outcome: "already_settled", callId: call._id, status: call.status };
    }
    const admissionRecord = call.delegation;
    if (!admissionRecord || admissionRecord.admission !== "authorized") {
      return { outcome: "rejected", callId: call._id, denial: { code: "call_not_owned_by_run", message: "The call was never admitted through delegated admission.", retryable: false } };
    }
    const manifest = registry.capabilities[call.capabilityId];
    const port = registry.readPorts[admissionRecord.portKey];
    const { response } = input;
    const elapsedMs = input.elapsedMs ?? 0;

    const verdict = await reauthorizeGrantWithCtx(ctx, config, {
      runId: call.runId,
      purpose: "release",
      capabilityId: call.capabilityId,
      now: input.now,
    });

    const withhold = async (
      requestedOutcome: AgentCallSettlementOutcome,
      reason: string,
      result: AgentCapabilityRefusal,
      extra: { resultHash?: string; actual?: Partial<BudgetVector>; outputOmittedReason?: string; authorizationEpoch: number },
    ): Promise<DelegatedCallRelease> => {
      // `denied` is an admission-time terminal in the lifecycle machine; a call that was
      // already dispatched and then refused is clamped as `canceled`. The reason
      // survives on the error and on the release record.
      const outcome: AgentCallSettlementOutcome = requestedOutcome === "denied" && call.status === "executing" ? "canceled" : requestedOutcome;
      const settled = await settleCapabilityCallWithCtx(ctx, {
        callId: call._id,
        outcome,
        actual: extra.actual,
        resultHash: extra.resultHash,
        outputOmittedReason: extra.outputOmittedReason,
        error: { code: reason, message: refusalErrorCode(result), retryable: result.kind === "unavailable" ? result.retryable : false },
        now: input.now,
        delegation: {
          ...admissionRecord,
          release: { verdict: "withheld", reason, authorityShrunk: false, authorizationEpoch: extra.authorizationEpoch, at: input.now },
        },
      });
      if (settled.outcome === "rejected") return { outcome: "rejected", callId: call._id, denial: settled.denial };
      if (settled.outcome === "already_settled") return { outcome: "already_settled", callId: call._id, status: settled.status };
      return { outcome: "withheld", callId: call._id, reason, result };
    };

    const releaseEpoch = verdict.kind === "authorized" ? verdict.authorizationEpoch : verdict.context?.authorizationEpoch ?? admissionRecord.authorizationEpoch;

    // Responses that carry no data settle by their own kind: there is nothing
    // to withhold, and the port's refusal is the truthful reason.
    if (response.kind === "refused") {
      return withhold(settlementFor(response.result), response.reason, response.result, { authorizationEpoch: releaseEpoch });
    }
    if (response.kind === "unavailable") {
      return withhold("unavailable", response.reason, { kind: "unavailable", reason: response.reason, retryable: response.retryable, sourceKey: response.sourceKey }, {
        actual: { calls: 1, elapsedMs },
        authorizationEpoch: releaseEpoch,
      });
    }
    if (response.kind === "failed") {
      return withhold("failed", response.error.code, { kind: "failed", error: response.error }, { actual: { calls: 1, elapsedMs }, authorizationEpoch: releaseEpoch });
    }

    if (verdict.kind === "refused") {
      // Revoked between dispatch and release: the payload never leaves; only
      // redacted evidence (hash, usage, reason) is kept.
      return withhold("canceled", verdict.reason, verdict.result, {
        resultHash: response.envelope.resultHash,
        actual: { ...response.usage, calls: 1, costUnits: port?.declaredCost.costUnits ?? 0, elapsedMs },
        outputOmittedReason: "authorization_revoked_before_release",
        authorizationEpoch: releaseEpoch,
      });
    }

    if (!manifest || !port) {
      return withhold("failed", "port_unregistered", { kind: "failed", error: { code: "port_unregistered", message: "The call's port is no longer registered." } }, { authorizationEpoch: verdict.authorizationEpoch });
    }
    const envelope = response.envelope;
    if (envelope.capabilityId !== call.capabilityId || !port.verbs.includes(envelope.verb)) {
      return withhold("failed", "port_contract_violation", { kind: "failed", error: { code: "port_contract_violation", message: "The envelope names a different capability or verb." } }, { authorizationEpoch: verdict.authorizationEpoch });
    }

    // Shrink overlay at release: strip again under the projections granted NOW.
    const grantedNow = new Set(verdict.grantedProjections);
    const authorityShrunk = verdict.authorityShrunk || response.grantedProjections.some((projection) => !grantedNow.has(projection));
    const data = omitUngrantedFields(manifest.result.fields, verdict.grantedProjections, envelope.data);
    const findings = findDisallowedFields(manifest.result.fields, verdict.grantedProjections, data);
    if (findings.ungranted.length > 0 || findings.unknown.length > 0) {
      return withhold("failed", "port_contract_violation", { kind: "failed", error: { code: "port_contract_violation", message: "The envelope carried fields outside the grant." } }, { authorizationEpoch: verdict.authorizationEpoch });
    }
    const released: AgentReadEnvelope<unknown> = { ...envelope, data } as AgentReadEnvelope<unknown>;
    const validation = validateReadEnvelope(released);
    if (!validation.ok) {
      return withhold("failed", "port_contract_violation", { kind: "failed", error: { code: "port_contract_violation", message: "The envelope failed validation at release." } }, { authorizationEpoch: verdict.authorizationEpoch });
    }
    const resultHash = authorityShrunk ? computeReadResultHash(released) : envelope.resultHash ?? computeReadResultHash(released);
    const finalEnvelope: AgentReadEnvelope<unknown> = { ...released, resultHash };
    const settlement: AgentCallSettlementOutcome = finalEnvelope.completeness.status === "complete" ? "succeeded" : "partial";
    const settled = await settleCapabilityCallWithCtx(ctx, {
      callId: call._id,
      outcome: settlement,
      actual: { calls: 1, rows: response.usage.rows, bytes: response.usage.bytes, costUnits: port.declaredCost.costUnits, elapsedMs },
      resultHash,
      output: finalEnvelope,
      observedAt: finalEnvelope.observedAt,
      capturedAt: finalEnvelope.capturedAt,
      freshness: finalEnvelope.freshness.class,
      completeness: finalEnvelope.completeness.status,
      sourceRefs: toIntelligenceSourceRefs(finalEnvelope),
      now: input.now,
      delegation: {
        ...admissionRecord,
        grantedProjections: [...verdict.grantedProjections],
        release: { verdict: "released", authorityShrunk, authorizationEpoch: verdict.authorizationEpoch, at: input.now },
      },
    });
    if (settled.outcome === "rejected") {
      return { outcome: "rejected", callId: call._id, denial: settled.denial };
    }
    if (settled.outcome === "already_settled") {
      return { outcome: "already_settled", callId: call._id, status: settled.status };
    }
    if (settled.fenced) {
      return { outcome: "withheld", callId: call._id, reason: "compatibility_epoch_fenced", result: deniedResult("compatibility_epoch_fenced", "This run belongs to an older release and can no longer proceed.") };
    }
    return { outcome: "released", callId: call._id, envelope: finalEnvelope, resultHash, charged: settled.charged, authorityShrunk };
  }

  /**
   * Before minting citations: every call must belong to the run, have
   * released data, and its capability must still be authorized and enabled.
   */
  async function reauthorizeCitationsWithCtxBound(
    ctx: ReadCtx,
    input: { readonly runId: Id<"intelligenceRun">; readonly callIds: readonly Id<"agentCapabilityCall">[]; readonly now: number },
  ): Promise<DelegatedCitationVerdict> {
    const calls: { callId: Id<"agentCapabilityCall">; resultHash: string; capabilityId: string }[] = [];
    let runtimeGrant: AgentRuntimeGrant | undefined;
    for (const callId of input.callIds) {
      const call = await ctx.db.get("agentCapabilityCall", callId);
      if (!call || call.runId !== input.runId) {
        return { kind: "refused", callId, stage: "citation", reason: "call_not_owned_by_run", result: { kind: "failed", error: { code: "call_not_owned_by_run", message: "The call does not belong to this run." } } };
      }
      if ((call.status !== "succeeded" && call.status !== "partial") || !call.resultHash || call.delegation?.release?.verdict !== "released") {
        return { kind: "refused", callId, stage: "citation", reason: "call_not_released", result: { kind: "failed", error: { code: "call_not_released", message: "Only released calls can be cited." } } };
      }
      const verdict = await reauthorizeGrantWithCtx(ctx, config, { runId: input.runId, purpose: "citation", capabilityId: call.capabilityId, now: input.now });
      if (verdict.kind === "refused") {
        return { kind: "refused", callId, stage: verdict.stage, reason: verdict.reason, result: verdict.result };
      }
      runtimeGrant = describeGrantForModel(verdict);
      calls.push({ callId, resultHash: call.resultHash, capabilityId: call.capabilityId });
    }
    if (!runtimeGrant) {
      const verdict = await reauthorizeGrantWithCtx(ctx, config, { runId: input.runId, purpose: "citation", now: input.now });
      if (verdict.kind === "refused") return { kind: "refused", stage: verdict.stage, reason: verdict.reason, result: verdict.result };
      runtimeGrant = describeGrantForModel(verdict);
    }
    return { kind: "authorized", calls, runtimeGrant };
  }

  /** Before `completeAgentRunWithCtx`, in the same transaction. */
  async function reauthorizeCompletionWithCtxBound(
    ctx: ReadCtx,
    input: { readonly runId: Id<"intelligenceRun">; readonly now: number },
  ): Promise<DelegatedCompletionVerdict> {
    const verdict = await reauthorizeGrantWithCtx(ctx, config, { runId: input.runId, purpose: "completion", now: input.now });
    if (verdict.kind === "refused") return verdict;
    return { kind: "authorized", verdict, runtimeGrant: describeGrantForModel(verdict) };
  }

  return {
    config,
    registry,
    readPorts,
    /** Field names of a port invocation — proof there is no ctx/db/scope in it. */
    invocationShape: AGENT_READ_PORT_INVOCATION_FIELDS,
    defineAgentReadPortQuery,
    prepareRunGrantWithCtx: (ctx: ReadCtx, request: DelegatedRunGrantRequest) => prepareDelegatedRunGrantWithCtx(ctx, config, request),
    materializeRunGrantWithCtx: (ctx: MutationCtx, input: MaterializeRunGrantInput) => materializeRunGrantWithCtx(ctx, config, input),
    reauthorizeGrantWithCtx: (ctx: ReadCtx, input: ReauthorizeGrantInput) => reauthorizeGrantWithCtx(ctx, config, input),
    describeGrantForModel,
    admitCapabilityCallWithCtx: admitCapabilityCallWithCtxBound,
    /** Executor side (the program executor, from an action): run the admitted invocation against the closed map. */
    dispatchReadPort: (ctx: Parameters<typeof dispatchAgentReadPort>[0], invocation: AgentReadPortInvocation) =>
      dispatchAgentReadPort(ctx, readPorts, invocation),
    releaseCapabilityResultWithCtx: releaseCapabilityResultWithCtxBound,
    reauthorizeCitationsWithCtx: reauthorizeCitationsWithCtxBound,
    reauthorizeCompletionWithCtx: reauthorizeCompletionWithCtxBound,
  };
}

export type DelegatedAdmission = ReturnType<typeof createDelegatedAdmission>;
