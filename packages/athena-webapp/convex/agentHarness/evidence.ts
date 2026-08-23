/**
 * Executor evidence (kernel; V8-safe).
 *
 * Authority boundary: this module owns what the harness keeps as evidence of
 * a program attempt and how honest that evidence is:
 * - every capability invocation is normalized here (facade path → capability,
 *   canonical args, opaque cursor) before it can be admitted;
 * - a released envelope is fitted under the persisted-record ceiling at its
 *   declared collection boundary BEFORE it is stored or becomes program
 *   visible, with typed truncation, a completeness downgrade, and a recomputed
 *   result hash (no chunking, no silent drops);
 * - the attempt's aggregate completeness, freshness mix, and egress class are
 *   derived from the inputs the host released — model code cannot declassify
 *   because it never computes these;
 * - claim-support slices come only from the manifest-declared deterministic
 *   extractor (checked by the conformance gate), fail-closed to provenance-only;
 * - the replay loader reconstructs the exact validated source and the
 *   complete bounded inputs inside the short-lived window, and reports
 *   expired / deleted states distinctly afterwards.
 * Nothing here reaches a product domain, `api.*`, or a mutation handle.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { hashCanonical } from "../../shared/agentHarness/agentRuntime";
import type { AgentCapabilityRequest } from "../../shared/agentHarness/bridge";
import { computeSha256Digest } from "../../shared/agentHarness/digest";
import { AGENT_CALL_EVIDENCE_BYTE_CEILING, isExpiredAt } from "../../shared/agentHarness/execution";
import {
  manifestEgressClass,
  type AgentCapabilityManifest,
  type JsonValue,
} from "../../shared/agentHarness/manifest";
import {
  deriveCompleteness,
  type AgentCompleteness,
  type AgentReadEnvelope,
  type AgentSourceCompleteness,
  type AgentWarning,
} from "../../shared/agentHarness/results";
import {
  isOpaqueRef,
  isPlainObject,
  maxEgressClass,
  type AgentEgressClass,
  type AgentFreshnessClass,
  type OpaqueRef,
} from "../../shared/agentHarness/values";
import { AGENT_CALL_EVIDENCE_METADATA_HEADROOM_BYTES } from "./budgets";
import { extractClaimSupport, type AgentEvidenceExtraction, type AgentEvidenceExtractor } from "./conformance";
import type { AgentCapabilityRefusal } from "./grants";
import { fitEncodedCallOutput, measureEncodedBytes, type AgentCallOutputTruncation } from "./programRuntime/outputCeiling";
import type { AgentProgramFacadeVerb, AgentProgramHostBridge, AgentProgramHostCall } from "./programRuntime/types";
import { computeReadResultHash } from "./readPorts";

type ReadCtx = QueryCtx | MutationCtx;

// ---------------------------------------------------------------------------
// Facade → request normalization
// ---------------------------------------------------------------------------

/** One `athena.<package>.<resource>` node the attempt may call, bound to its capability. */
export type AgentExecutionFacadeEntry = {
  readonly package: string;
  readonly resource: string;
  readonly verbs: readonly AgentProgramFacadeVerb[];
  readonly capabilityId: string;
  readonly namespace: string;
};

export type AgentNormalizedInvocation = {
  readonly request: AgentCapabilityRequest;
  /** Digest of the normalized request: the dedupe identity inside one attempt. */
  readonly requestDigest: string;
  readonly entry: AgentExecutionFacadeEntry;
};

export type AgentInvocationNormalization =
  | { readonly ok: true; readonly invocation: AgentNormalizedInvocation }
  | { readonly ok: false; readonly result: AgentCapabilityRefusal };

const deniedArguments = (message: string): AgentCapabilityRefusal => ({
  kind: "denied",
  code: "invalid_arguments",
  message,
  retryable: false,
});

/**
 * Normalize a host call from the sandbox into a capability request. The
 * facade index is the grant-projected shape, so a path outside it is
 * unauthorized (the sandbox already refuses it; this is the second lock).
 * `cursor` is lifted out of the arguments for `list`; everything else must be
 * a plain JSON object the manifest filters will validate at admission.
 */
export function normalizeHostCall(
  facade: readonly AgentExecutionFacadeEntry[],
  call: Pick<AgentProgramHostCall, "package" | "resource" | "verb" | "args">,
): AgentInvocationNormalization {
  const entry = facade.find((candidate) => candidate.package === call.package && candidate.resource === call.resource);
  if (!entry || !entry.verbs.includes(call.verb)) {
    return { ok: false, result: { kind: "unauthorized", code: "unauthorized_capability", message: "This capability is not available to this run." } };
  }
  if (!isPlainObject(call.args)) {
    return { ok: false, result: deniedArguments("Facade arguments must be a plain object.") };
  }
  const { cursor: rawCursor, ...rest } = call.args as Record<string, JsonValue>;
  let cursor: OpaqueRef<"cursor"> | undefined;
  if (rawCursor !== undefined) {
    if (call.verb !== "list" || !isOpaqueRef(rawCursor, "cursor")) {
      return { ok: false, result: deniedArguments("`cursor` must be the opaque cursor of a previous page.") };
    }
    cursor = rawCursor;
  }
  const args: Record<string, JsonValue> = {};
  for (const key of Object.keys(rest).sort()) {
    if (rest[key] !== undefined) args[key] = rest[key];
  }
  const request: AgentCapabilityRequest = {
    capabilityId: entry.capabilityId,
    namespace: entry.namespace,
    verb: call.verb,
    args,
    ...(cursor ? { cursor } : {}),
  };
  // Identical to the `normalizedArgsHash` delegated admission records on the call row, so the
  // dedupe identity, the stored row, and the replay lookup all agree.
  const requestDigest = normalizedRequestDigest(request);
  return { ok: true, invocation: { request, requestDigest, entry } };
}

/** The delegated-admission `normalizedArgsHash` formula (projections sorted, cursor as given). */
export function normalizedRequestDigest(request: AgentCapabilityRequest): string {
  return hashCanonical({
    capabilityId: request.capabilityId,
    verb: request.verb,
    args: request.args,
    projections: [...(request.projections ?? [])].sort(),
    cursor: request.cursor,
  });
}

// ---------------------------------------------------------------------------
// Envelope fitting (240 KiB per persisted call record, including metadata)
// ---------------------------------------------------------------------------

export const AGENT_EVIDENCE_TRUNCATION_WARNING = "evidence_payload_truncated" as const;
export const AGENT_EVIDENCE_TRUNCATION_REASON = "truncated_at_evidence_ceiling" as const;

export type AgentEnvelopeFit =
  | { readonly kind: "fits"; readonly envelope: AgentReadEnvelope<unknown>; readonly encodedBytes: number }
  | {
      readonly kind: "truncated";
      readonly envelope: AgentReadEnvelope<unknown>;
      readonly encodedBytes: number;
      readonly truncation: AgentCallOutputTruncation;
    }
  | { readonly kind: "rejected"; readonly encodedBytes: number; readonly truncation: AgentCallOutputTruncation };

/**
 * Fit a released envelope under the persisted-content ceiling. A `list`
 * envelope is cut at its item boundary (never inside an item or a multibyte
 * character); the kept page is marked `truncated` per source, its aggregate
 * completeness becomes `partial`, a typed warning names the dropped count,
 * and the result hash is recomputed over exactly what will be stored and
 * shown. A `get` envelope has no declared collection boundary, so an
 * oversized snapshot is rejected outright (typed) rather than chunked.
 */
export function fitEnvelopeForEvidence(
  envelope: AgentReadEnvelope<unknown>,
  options: { readonly ceilingBytes?: number; readonly metadataHeadroomBytes?: number } = {},
): AgentEnvelopeFit {
  const ceilingBytes = options.ceilingBytes ?? AGENT_CALL_EVIDENCE_BYTE_CEILING;
  const metadataHeadroomBytes = options.metadataHeadroomBytes ?? AGENT_CALL_EVIDENCE_METADATA_HEADROOM_BYTES;
  const fit = fitEncodedCallOutput({
    output: envelope,
    collectionPath: envelope.verb === "list" ? "data" : undefined,
    ceilingBytes,
    metadataHeadroomBytes,
  });
  if (fit.kind === "fits") return { kind: "fits", envelope, encodedBytes: fit.encodedBytes };
  if (fit.kind === "rejected") return { kind: "rejected", encodedBytes: fit.encodedBytes, truncation: fit.truncation };

  // The truncation warning and per-source markers add a few hundred bytes;
  // refit with that allowance reserved so the final record never crosses the
  // content budget.
  const refit = fitEncodedCallOutput({
    output: envelope,
    collectionPath: "data",
    ceilingBytes,
    metadataHeadroomBytes: metadataHeadroomBytes + AGENT_EVIDENCE_TRUNCATION_ALLOWANCE_BYTES,
  });
  if (refit.kind === "rejected") return { kind: "rejected", encodedBytes: refit.encodedBytes, truncation: refit.truncation };
  if (refit.kind === "fits") return { kind: "fits", envelope, encodedBytes: refit.encodedBytes };
  const kept = refit.output as AgentReadEnvelope<unknown> & { readonly verb: "list" };
  const sources: AgentSourceCompleteness[] = envelope.completeness.sources.map((source) => ({
    ...source,
    status: "truncated",
    reason: AGENT_EVIDENCE_TRUNCATION_REASON,
  }));
  const warnings: AgentWarning[] = [
    ...envelope.warnings,
    {
      code: AGENT_EVIDENCE_TRUNCATION_WARNING,
      message: `The page was cut at its item boundary to fit the evidence ceiling: ${refit.keptItems} kept, ${refit.droppedItems} dropped.`,
    },
  ];
  const truncated = {
    ...kept,
    completeness: { status: "partial" as const, sources },
    warnings,
    pagination: { ...kept.pagination, pageSize: refit.keptItems },
  };
  const withHash = { ...truncated, resultHash: computeReadResultHash(truncated) } as AgentReadEnvelope<unknown>;
  return { kind: "truncated", envelope: withHash, encodedBytes: measureEncodedBytes(withHash), truncation: refit.truncation };
}

/** Bytes reserved for the truncation warning and per-source markers on a cut page. */
export const AGENT_EVIDENCE_TRUNCATION_ALLOWANCE_BYTES = 1024;

// ---------------------------------------------------------------------------
// Attempt-level derivations (completeness, freshness, egress)
// ---------------------------------------------------------------------------

export type AgentFreshnessSummary = {
  readonly classes: readonly AgentFreshnessClass[];
  /** True when inputs carried more than one freshness class or observation time. */
  readonly mixed: boolean;
  readonly oldestObservedAt?: number;
  readonly newestObservedAt?: number;
};

export type AgentAttemptInputSummary = {
  readonly completeness: AgentCompleteness;
  readonly freshness: AgentFreshnessSummary;
  readonly egressClass: AgentEgressClass;
  readonly inputCount: number;
};

export type AgentReleasedInput = {
  readonly envelope: AgentReadEnvelope<unknown>;
  readonly egressClass: AgentEgressClass;
};

/**
 * Derive what the attempt as a whole may claim from everything it read.
 * Completeness is the minimum across every source of every input (no inputs
 * → partial, never overstated); freshness reports the mix honestly; egress
 * is the maximum class of any input, regardless of what the program did with
 * the values.
 */
export function summarizeAttemptInputs(inputs: readonly AgentReleasedInput[]): AgentAttemptInputSummary {
  const sources = inputs.flatMap((input) => input.envelope.completeness.sources);
  const classes = [...new Set(inputs.map((input) => input.envelope.freshness.class))].sort() as AgentFreshnessClass[];
  const observed = inputs.map((input) => input.envelope.observedAt);
  const oldest = observed.length > 0 ? Math.min(...observed) : undefined;
  const newest = observed.length > 0 ? Math.max(...observed) : undefined;
  return {
    completeness: deriveCompleteness(sources),
    freshness: {
      classes,
      mixed: classes.length > 1 || (oldest !== undefined && newest !== undefined && oldest !== newest),
      ...(oldest !== undefined ? { oldestObservedAt: oldest } : {}),
      ...(newest !== undefined ? { newestObservedAt: newest } : {}),
    },
    egressClass: maxEgressClass("operational", ...inputs.map((input) => input.egressClass)),
    inputCount: inputs.length,
  };
}

/** Egress class a released call carries: the manifest's class under the projections the call was granted. */
export function egressClassForCall(manifest: AgentCapabilityManifest, call: Pick<Doc<"agentCapabilityCall">, "delegation">): AgentEgressClass {
  return manifestEgressClass(manifest, call.delegation?.grantedProjections ?? []);
}

/** A structured program result is a JSON object or array, never a bare scalar or null. */
export function isStructuredProgramOutput(output: unknown): output is JsonValue {
  return Array.isArray(output) || isPlainObject(output);
}

// ---------------------------------------------------------------------------
// Claim support (deterministic manifest extractors only)
// ---------------------------------------------------------------------------

export type AgentEvidenceExtractorLookup = (capabilityId: string) => AgentEvidenceExtractor | undefined;

export type AgentClaimSupportOutcome =
  | {
      readonly kind: "claim_support";
      readonly extractorKey: string;
      readonly extractorVersion: string;
      readonly claimShape: string;
      readonly slice: Record<string, unknown>;
      readonly sliceDigest: string;
    }
  | { readonly kind: "provenance_only"; readonly reason: string };

/**
 * Mint the minimal claim-support slice for one cited call through the
 * registered extractor. Input is the sanitized envelope data the call
 * actually released; any gap (no extractor, unsupported shape, unauthorized
 * field, missing replay payload) downgrades to provenance-only.
 */
export function buildClaimSupport(input: {
  readonly manifest: AgentCapabilityManifest;
  readonly extractor: AgentEvidenceExtractor | undefined;
  readonly call: Pick<Doc<"agentCapabilityCall">, "capabilityId" | "resultHash" | "delegation">;
  readonly envelope: AgentReadEnvelope<unknown> | null;
  readonly claimShape?: string;
}): AgentClaimSupportOutcome {
  const policy = input.manifest.evidence;
  if (policy.mode !== "extractor") return { kind: "provenance_only", reason: policy.reason };
  if (!input.envelope) return { kind: "provenance_only", reason: "replay_payload_unavailable" };
  if (!input.call.resultHash) return { kind: "provenance_only", reason: "result_hash_missing" };
  const claimShape = input.claimShape ?? policy.claimShapes[0];
  const extraction: AgentEvidenceExtraction = extractClaimSupport(input.manifest, input.extractor, {
    capabilityId: input.call.capabilityId,
    verb: input.envelope.verb,
    resultHash: input.call.resultHash,
    data: input.envelope.data,
    grantedProjections: input.call.delegation?.grantedProjections ?? [],
    claimShape,
  });
  if (extraction.kind === "provenance_only") return extraction;
  const slice = isPlainObject(extraction.slice) ? (extraction.slice as Record<string, unknown>) : { claim: extraction.slice };
  return {
    kind: "claim_support",
    extractorKey: extraction.extractorKey,
    extractorVersion: extraction.extractorVersion,
    claimShape: extraction.claimShape,
    slice,
    sliceDigest: extraction.sliceDigest,
  };
}

/** The immutable revision a released envelope carries, if its authority is a record with a version. */
export function immutableRevisionOf(envelope: AgentReadEnvelope<unknown> | null): string | undefined {
  if (!envelope || envelope.freshness.authority !== "authoritative_record") return undefined;
  const versioned = envelope.sourceRefs.find((ref) => typeof ref.version === "string" && ref.version.length > 0);
  if (versioned) return `${versioned.ref}@${versioned.version}`;
  if (envelope.freshness.sourceVersion) return `${envelope.capabilityId}@${envelope.freshness.sourceVersion}`;
  return undefined;
}

// ---------------------------------------------------------------------------
// Exposure state (plan decision 12 / scenario 10)
// ---------------------------------------------------------------------------

export type AgentAttemptExposure = {
  readonly attemptStatus: Doc<"agentProgramAttempt">["status"];
  readonly runStatus: Doc<"intelligenceRun">["status"];
  /** Did a provider-visible tool response carry this attempt's result? Irreversible once true. */
  readonly providerExposed: boolean;
  readonly providerEgress: "not_reached" | "committed" | "withheld";
  readonly providerEgressAt?: number;
  readonly providerEgressReason?: string;
  /** Did one Athena transaction commit the answer for reauthorized query? */
  readonly operatorReleaseCommitted: boolean;
  readonly operatorReleaseCommittedAt?: number;
  /** Did an authorized fetch actually happen? Only this means browser receipt. */
  readonly operatorViewed: boolean;
  readonly operatorViewedAt?: number;
  /** The run ended (cancel/fail/kill switch) after the provider already saw the result. */
  readonly revokedAfterProviderExposure: boolean;
  readonly binding: "none" | "active" | "abandoned";
};

/** The run ended by cancellation or failure (kill switch, fence, operator stop, provider timeout): the coarse revocation basis every exposure flag shares. */
export function terminalRevoked(run: Pick<Doc<"intelligenceRun">, "status">): boolean {
  return run.status === "canceled" || run.status === "failed";
}

/**
 * Turn-keyed exposure: what the operator's pane may have shown and whether
 * authority was withdrawn afterwards. Presumed exposure is the release marker
 * (a flushed draft cannot be recalled from a screen); confirmed receipt is
 * the operator's own acknowledgement. Reachable for zero-attempt turns, where
 * the attempt-keyed view has nothing to hang on.
 */
export type AgentTurnExposure = {
  readonly runStatus: Doc<"intelligenceRun">["status"];
  readonly binding: "none" | "active" | "abandoned";
  /** Did one Athena transaction commit the answer for reauthorized query? */
  readonly operatorReleaseCommitted: boolean;
  readonly operatorReleaseCommittedAt?: number;
  /** Did an authorized fetch actually happen? Only this means browser receipt. */
  readonly operatorViewed: boolean;
  readonly operatorViewedAt?: number;
  /** The committed release was suppressed after the fact (authority shrank before an authorized fetch). */
  readonly releaseSuppressed: boolean;
  readonly releaseSuppressedAt?: number;
  /** Provisional text was flushed to the pane at least once; it is presumed seen. */
  readonly provisionalExposurePresumed: boolean;
  readonly provisionalReleasedAt?: number;
  /** The operator acknowledged painting provisional text (confirmed receipt). */
  readonly provisionalViewed: boolean;
  readonly provisionalViewedAt?: number;
  /** Authority was withdrawn after provisional text was presumed seen: the run was canceled/failed, or the release was suppressed. */
  readonly revokedAfterProvisionalExposure: boolean;
};

export function resolveTurnExposure(input: { readonly run: Doc<"intelligenceRun">; readonly binding: Doc<"agentTurnBinding"> | null }): AgentTurnExposure {
  const binding = input.binding;
  const provisionalExposurePresumed = binding?.provisionalReleasedAt !== undefined;
  return {
    runStatus: input.run.status,
    binding: !binding ? "none" : binding.abandonedAt !== undefined ? "abandoned" : "active",
    operatorReleaseCommitted: binding?.operatorReleaseCommittedAt !== undefined,
    ...(binding?.operatorReleaseCommittedAt !== undefined ? { operatorReleaseCommittedAt: binding.operatorReleaseCommittedAt } : {}),
    operatorViewed: binding?.operatorViewedAt !== undefined,
    ...(binding?.operatorViewedAt !== undefined ? { operatorViewedAt: binding.operatorViewedAt } : {}),
    releaseSuppressed: binding?.releaseSuppressedAt !== undefined,
    ...(binding?.releaseSuppressedAt !== undefined ? { releaseSuppressedAt: binding.releaseSuppressedAt } : {}),
    provisionalExposurePresumed,
    ...(binding?.provisionalReleasedAt !== undefined ? { provisionalReleasedAt: binding.provisionalReleasedAt } : {}),
    provisionalViewed: binding?.provisionalViewedAt !== undefined,
    ...(binding?.provisionalViewedAt !== undefined ? { provisionalViewedAt: binding.provisionalViewedAt } : {}),
    revokedAfterProvisionalExposure: provisionalExposurePresumed && (terminalRevoked(input.run) || binding?.releaseSuppressedAt !== undefined),
  };
}

/** Truthful exposure state: query visibility is never conflated with browser receipt. */
export function resolveAttemptExposure(input: {
  readonly attempt: Doc<"agentProgramAttempt">;
  readonly run: Doc<"intelligenceRun">;
  readonly binding: Doc<"agentTurnBinding"> | null;
}): AgentAttemptExposure {
  const egress = input.attempt.providerEgress;
  const providerExposed = egress?.state === "committed";
  const turn = resolveTurnExposure({ run: input.run, binding: input.binding });
  return {
    attemptStatus: input.attempt.status,
    runStatus: turn.runStatus,
    providerExposed,
    providerEgress: egress ? egress.state : "not_reached",
    ...(egress ? { providerEgressAt: egress.at } : {}),
    ...(egress?.reason ? { providerEgressReason: egress.reason } : {}),
    operatorReleaseCommitted: turn.operatorReleaseCommitted,
    ...(turn.operatorReleaseCommittedAt !== undefined ? { operatorReleaseCommittedAt: turn.operatorReleaseCommittedAt } : {}),
    operatorViewed: turn.operatorViewed,
    ...(turn.operatorViewedAt !== undefined ? { operatorViewedAt: turn.operatorViewedAt } : {}),
    revokedAfterProviderExposure: providerExposed && terminalRevoked(input.run),
    binding: turn.binding,
  };
}

// ---------------------------------------------------------------------------
// Replay (investigator path inside the short-lived window)
// ---------------------------------------------------------------------------

export type AgentStoredProgramSource = {
  readonly authored: string;
  readonly validated: string;
  readonly facade: readonly AgentExecutionFacadeEntry[] | null;
};

export type AgentReplayInput = {
  readonly requestDigest: string;
  readonly capabilityId: string;
  readonly namespace: string;
  readonly verb: "get" | "list";
  readonly status: Doc<"agentCapabilityCall">["status"];
  /** The complete bounded sanitized envelope the program saw, when still retained. */
  readonly envelope: AgentReadEnvelope<unknown> | null;
  readonly resultHash?: string;
};

export type AgentAttemptReplayInputs =
  | {
      readonly kind: "available";
      readonly attemptId: Id<"agentProgramAttempt">;
      readonly source: AgentStoredProgramSource;
      readonly programSourceHash: string;
      readonly validatedSourceHash?: string;
      readonly resultHash?: string;
      readonly outputHash?: string;
      readonly inputs: readonly AgentReplayInput[];
      /** Inputs whose stored output is gone; replay will see them as unavailable. */
      readonly missingInputs: number;
      readonly expiresAt: number;
    }
  | { readonly kind: "not_found" }
  | { readonly kind: "no_result"; readonly status: Doc<"agentProgramAttempt">["status"] }
  | { readonly kind: "expired"; readonly expiredAt: number }
  | { readonly kind: "deleted_by_lifecycle" };

function storedSourceOf(content: unknown): AgentStoredProgramSource | null {
  if (typeof content === "string") return { authored: content, validated: content, facade: null };
  if (!isPlainObject(content) || typeof content.authored !== "string" || typeof content.validated !== "string") return null;
  const facade = Array.isArray(content.facade) ? (content.facade as AgentExecutionFacadeEntry[]) : null;
  return { authored: content.authored, validated: content.validated, facade };
}

/**
 * Load everything an investigator needs to re-execute an attempt: the exact
 * validated source (with the facade it was validated against), the normalized
 * calls with their complete stored envelopes, and the result hashes. Expiry
 * of the source payload is reported as `expired`; a lifecycle-deleted grant
 * as `deleted_by_lifecycle`. Individual call outputs that are already gone
 * are counted, not invented.
 */
export async function loadAttemptReplayInputsWithCtx(
  ctx: ReadCtx,
  input: { readonly attemptId: Id<"agentProgramAttempt">; readonly now: number },
): Promise<AgentAttemptReplayInputs> {
  const attempt = await ctx.db.get("agentProgramAttempt", input.attemptId);
  if (!attempt) return { kind: "not_found" };
  const run = await ctx.db.get("intelligenceRun", attempt.runId);
  const grant = run?.runGrantId ? await ctx.db.get("agentRunGrant", run.runGrantId) : null;
  if (grant && grant.lifecycle === "deleted_by_lifecycle") return { kind: "deleted_by_lifecycle" };
  if (attempt.status !== "result_produced") return { kind: "no_result", status: attempt.status };
  const sourcePayload = attempt.sourcePayloadId ? await ctx.db.get("agentReplayPayload", attempt.sourcePayloadId) : null;
  if (!sourcePayload) return { kind: "expired", expiredAt: attempt.createdAt };
  if (isExpiredAt(sourcePayload.expiresAt, input.now)) return { kind: "expired", expiredAt: sourcePayload.expiresAt };
  const source = storedSourceOf(sourcePayload.content);
  if (!source) return { kind: "expired", expiredAt: sourcePayload.expiresAt };

  const inputs: AgentReplayInput[] = [];
  let missingInputs = 0;
  const calls = await ctx.db
    .query("agentCapabilityCall")
    .withIndex("by_attemptId_status", (q) => q.eq("attemptId", attempt._id))
    .take(500);
  for (const call of calls.sort((a, b) => a.sequence - b.sequence)) {
    const payload = call.replayPayloadId ? await ctx.db.get("agentReplayPayload", call.replayPayloadId) : null;
    const retained = payload !== null && !isExpiredAt(payload.expiresAt, input.now);
    const envelope = retained ? (payload.content as AgentReadEnvelope<unknown>) : null;
    if (!retained && (call.status === "succeeded" || call.status === "partial")) missingInputs += 1;
    const namespace = envelope?.namespace ?? "";
    inputs.push({
      // The row's normalized-args hash IS the executor's request digest.
      requestDigest: call.normalizedArgsHash,
      capabilityId: call.capabilityId,
      namespace,
      verb: envelope?.verb ?? "get",
      status: call.status,
      envelope,
      ...(call.resultHash ? { resultHash: call.resultHash } : {}),
    });
  }
  const resultPayload = attempt.resultPayloadId ? await ctx.db.get("agentReplayPayload", attempt.resultPayloadId) : null;
  const outputHash =
    resultPayload && isPlainObject(resultPayload.content) && typeof resultPayload.content.outputHash === "string"
      ? resultPayload.content.outputHash
      : undefined;
  return {
    kind: "available",
    attemptId: attempt._id,
    source,
    programSourceHash: attempt.programSourceHash,
    ...(attempt.validatedSourceHash ? { validatedSourceHash: attempt.validatedSourceHash } : {}),
    ...(attempt.resultHash ? { resultHash: attempt.resultHash } : {}),
    ...(outputHash ? { outputHash } : {}),
    inputs,
    missingInputs,
    expiresAt: sourcePayload.expiresAt,
  };
}

/**
 * A host bridge that answers every facade call from the stored inputs and
 * nothing else. The same normalization the executor used keys the lookup, so
 * an exact replay re-reads exactly what the original attempt read; a request
 * the attempt never made (or whose output expired) is `unavailable`.
 */
export function createReplayBridge(replay: Extract<AgentAttemptReplayInputs, { kind: "available" }>): AgentProgramHostBridge & {
  readonly served: () => readonly string[];
} {
  const facade = replay.source.facade ?? [];
  const byKey = new Map<string, AgentReplayInput>();
  for (const input of replay.inputs) byKey.set(`${input.capabilityId}|${input.requestDigest}`, input);
  const served: string[] = [];
  return {
    facade: facade.map((entry) => ({ package: entry.package, resource: entry.resource, verbs: entry.verbs })),
    invoke: (call) => {
      const normalized = normalizeHostCall(facade, call);
      if (!normalized.ok) return normalized.result as unknown as JsonValue;
      const key = `${normalized.invocation.request.capabilityId}|${normalized.invocation.requestDigest}`;
      const stored = byKey.get(key);
      served.push(key);
      if (!stored || !stored.envelope) {
        return { kind: "unavailable", reason: "replay_input_unavailable", retryable: false } as unknown as JsonValue;
      }
      return { kind: "result", envelope: stored.envelope } as unknown as JsonValue;
    },
    served: () => served,
  };
}

/** Digest of a program output, the value replay compares against. */
export function programOutputHash(output: JsonValue): string {
  return computeSha256Digest(output);
}
