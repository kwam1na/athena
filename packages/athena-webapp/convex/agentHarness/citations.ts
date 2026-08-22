/**
 * Citations (kernel; V8-safe).
 *
 * Authority boundary: a citation is an opaque reference the model receives
 * only for data a successful attempt actually returned, minted here from the
 * run, attempt, call, and sanitized result hash — never from model-supplied
 * values. `completeRun` resolves references back through this module: a
 * reference is accepted only when it parses, names a call of THIS run, that
 * call belongs to an attempt in the explicit successful-attempt set, the call
 * released data, the hash still matches, and the binding digest recomputed
 * from the run's own ids reproduces the reference. Forged, stale-attempt,
 * cross-run, and unreleased references are rejected with typed reasons;
 * unauthorized ones are refused by delegated reauthorization, which callers run
 * after resolution. Evidence lookup for a viewer reauthorizes the viewer
 * through the registered authority port and returns lineage without raw ids.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { sha256Hex } from "../../shared/agentHarness/digest";
import type { AgentCapabilityManifest } from "../../shared/agentHarness/manifest";
import type { AgentReadEnvelope, AgentSourceRef } from "../../shared/agentHarness/results";
import { opaqueRef, parseOpaqueRef, type AgentEgressClass, type OpaqueRef } from "../../shared/agentHarness/values";
import type { DelegatedOperator } from "../operationAdmission/types";
import { egressClassForCall } from "./evidence";
import type { DelegatedGrantConfig } from "./grants";
import { loadRunGrantWithCtx } from "./grants";
import { readCitationEvidenceWithCtx, type CitationEvidenceView } from "./retention";

type ReadCtx = QueryCtx | MutationCtx;

const CITATION_VERSION = "v1";
const ATTEMPT_REF_PREFIX = "attempt_v1";
const BINDING_DIGEST_LENGTH = 32;

// ---------------------------------------------------------------------------
// Minting
// ---------------------------------------------------------------------------

export type AgentCitationBindingInput = {
  readonly runId: Id<"intelligenceRun">;
  readonly attemptId: Id<"agentProgramAttempt">;
  readonly attemptSequence: number;
  readonly callId: Id<"agentCapabilityCall">;
  readonly callSequence: number;
  readonly resultHash: string;
};

function citationBindingDigest(input: AgentCitationBindingInput): string {
  return sha256Hex(
    ["citation", CITATION_VERSION, input.runId, input.attemptId, input.attemptSequence, input.callId, input.callSequence, input.resultHash].join("|"),
  ).slice(0, BINDING_DIGEST_LENGTH);
}

/** `citation:v1.<attemptSeq>.<callSeq>.<digest>` — opaque, run-bound, hash-bound. */
export function mintCitationRef(input: AgentCitationBindingInput): OpaqueRef<"citation"> {
  return opaqueRef("citation", `${CITATION_VERSION}.${input.attemptSequence}.${input.callSequence}.${citationBindingDigest(input)}`);
}

export type ParsedCitationRef = { readonly attemptSequence: number; readonly callSequence: number; readonly digest: string };

export function parseCitationRef(ref: string): ParsedCitationRef | null {
  const parsed = parseOpaqueRef(ref);
  if (!parsed || parsed.kind !== "citation") return null;
  const parts = parsed.token.split(".");
  if (parts.length !== 4 || parts[0] !== CITATION_VERSION) return null;
  const attemptSequence = Number(parts[1]);
  const callSequence = Number(parts[2]);
  if (!Number.isInteger(attemptSequence) || attemptSequence < 1 || !Number.isInteger(callSequence) || callSequence < 1) return null;
  if (!/^[0-9a-f]+$/.test(parts[3]) || parts[3].length !== BINDING_DIGEST_LENGTH) return null;
  return { attemptSequence, callSequence, digest: parts[3] };
}

export type AgentAttemptRefInput = {
  readonly runId: Id<"intelligenceRun">;
  readonly attemptId: Id<"agentProgramAttempt">;
  readonly sequence: number;
  readonly resultHash: string;
};

function attemptRefDigest(input: AgentAttemptRefInput): string {
  return sha256Hex(["attempt", input.runId, input.attemptId, input.sequence, input.resultHash].join("|")).slice(0, BINDING_DIGEST_LENGTH);
}

/** `attempt_v1.<sequence>.<digest>` — how the model names a successful attempt back to `completeRun`. */
export function mintAttemptRef(input: AgentAttemptRefInput): string {
  return `${ATTEMPT_REF_PREFIX}.${input.sequence}.${attemptRefDigest(input)}`;
}

export function parseAttemptRef(ref: string): { readonly sequence: number; readonly digest: string } | null {
  const parts = ref.split(".");
  if (parts.length !== 3 || parts[0] !== ATTEMPT_REF_PREFIX) return null;
  const sequence = Number(parts[1]);
  if (!Number.isInteger(sequence) || sequence < 1) return null;
  if (!/^[0-9a-f]+$/.test(parts[2]) || parts[2].length !== BINDING_DIGEST_LENGTH) return null;
  return { sequence, digest: parts[2] };
}

// ---------------------------------------------------------------------------
// Candidates the model may cite (per successful attempt)
// ---------------------------------------------------------------------------

export type AgentCitationCandidate = {
  readonly citation: OpaqueRef<"citation">;
  readonly namespace: string;
  readonly verb: "get" | "list";
  readonly resultHash: string;
  readonly sourceRefs: readonly AgentSourceRef[];
  readonly observedAt?: number;
  readonly freshness?: string;
  readonly completeness?: string;
  readonly egressClass: AgentEgressClass;
};

/**
 * Citation candidates of one attempt: every call that released data, with
 * its opaque source refs and hashes. Nothing here carries a document id.
 */
export async function listCitationCandidatesWithCtx(
  ctx: ReadCtx,
  input: {
    readonly attempt: Pick<Doc<"agentProgramAttempt">, "_id" | "runId" | "sequence">;
    readonly manifests: { readonly [capabilityId: string]: AgentCapabilityManifest };
  },
): Promise<{ readonly candidates: readonly AgentCitationCandidate[]; readonly calls: readonly Doc<"agentCapabilityCall">[] }> {
  const calls: Doc<"agentCapabilityCall">[] = [];
  for (const status of ["succeeded", "partial"] as const) {
    const rows = await ctx.db
      .query("agentCapabilityCall")
      .withIndex("by_attemptId_status", (q) => q.eq("attemptId", input.attempt._id).eq("status", status))
      .take(500);
    calls.push(...rows);
  }
  calls.sort((a, b) => a.sequence - b.sequence);
  const candidates: AgentCitationCandidate[] = [];
  for (const call of calls) {
    if (!call.resultHash || call.delegation?.release?.verdict !== "released") continue;
    const manifest = input.manifests[call.capabilityId];
    if (!manifest) continue;
    const payload = call.replayPayloadId ? await ctx.db.get("agentReplayPayload", call.replayPayloadId) : null;
    const envelope = payload ? (payload.content as AgentReadEnvelope<unknown>) : null;
    candidates.push({
      citation: mintCitationRef({
        runId: input.attempt.runId,
        attemptId: input.attempt._id,
        attemptSequence: input.attempt.sequence,
        callId: call._id,
        callSequence: call.sequence,
        resultHash: call.resultHash,
      }),
      namespace: envelope?.namespace ?? `${manifest.namespace.package}.${manifest.namespace.resource}`,
      verb: envelope?.verb ?? "get",
      resultHash: call.resultHash,
      sourceRefs: envelope?.sourceRefs ?? [],
      ...(call.observedAt !== undefined ? { observedAt: call.observedAt } : {}),
      ...(call.freshness ? { freshness: call.freshness } : {}),
      ...(call.completeness ? { completeness: call.completeness } : {}),
      egressClass: egressClassForCall(manifest, call),
    });
  }
  return { candidates, calls };
}

// ---------------------------------------------------------------------------
// Resolution (completeRun)
// ---------------------------------------------------------------------------

export type AgentCitationRejectionReason =
  | "malformed"
  | "unknown_call"
  | "stale_attempt"
  | "not_released"
  | "binding_mismatch";

export type AgentResolvedCitation = {
  readonly ref: string;
  readonly call: Doc<"agentCapabilityCall">;
  readonly attempt: Doc<"agentProgramAttempt">;
};

export type AgentCitationResolution =
  | { readonly kind: "resolved"; readonly citations: readonly AgentResolvedCitation[] }
  | { readonly kind: "rejected"; readonly ref: string; readonly reason: AgentCitationRejectionReason; readonly message: string };

/**
 * Resolve citation references for `completeRun`. The cited-attempt set is the
 * explicit allowed set for this run; a reference to any other attempt is
 * stale even if the attempt succeeded. Cross-run and forged references fail
 * the binding digest because it is recomputed from this run's own ids.
 */
export async function resolveCitationRefsWithCtx(
  ctx: ReadCtx,
  input: {
    readonly runId: Id<"intelligenceRun">;
    readonly refs: readonly string[];
    readonly citedAttempts: ReadonlyMap<Id<"agentProgramAttempt">, Doc<"agentProgramAttempt">>;
  },
): Promise<AgentCitationResolution> {
  const citations: AgentResolvedCitation[] = [];
  for (const ref of input.refs) {
    const parsed = parseCitationRef(ref);
    if (!parsed) return { kind: "rejected", ref, reason: "malformed", message: "The citation reference is not one this harness minted." };
    const call = await ctx.db
      .query("agentCapabilityCall")
      .withIndex("by_runId_sequence", (q) => q.eq("runId", input.runId).eq("sequence", parsed.callSequence))
      .unique();
    if (!call) return { kind: "rejected", ref, reason: "unknown_call", message: "The citation names a read this run never made." };
    const attempt = input.citedAttempts.get(call.attemptId);
    if (!attempt || attempt.sequence !== parsed.attemptSequence) {
      return { kind: "rejected", ref, reason: "stale_attempt", message: "The citation belongs to an attempt outside the cited set." };
    }
    if ((call.status !== "succeeded" && call.status !== "partial") || !call.resultHash || call.delegation?.release?.verdict !== "released") {
      return { kind: "rejected", ref, reason: "not_released", message: "Only data a call actually released can be cited." };
    }
    const expected = citationBindingDigest({
      runId: input.runId,
      attemptId: attempt._id,
      attemptSequence: attempt.sequence,
      callId: call._id,
      callSequence: call.sequence,
      resultHash: call.resultHash,
    });
    if (expected !== parsed.digest) {
      return { kind: "rejected", ref, reason: "binding_mismatch", message: "The citation is not bound to this run's read and result." };
    }
    citations.push({ ref, call, attempt });
  }
  return { kind: "resolved", citations };
}

export type AgentAttemptRefResolution =
  | { readonly kind: "resolved"; readonly attempts: ReadonlyMap<Id<"agentProgramAttempt">, Doc<"agentProgramAttempt">> }
  | { readonly kind: "rejected"; readonly ref: string; readonly reason: "malformed" | "unknown_attempt" | "not_successful" | "binding_mismatch"; readonly message: string };

/** Resolve the explicit successful-attempt set named by opaque attempt refs. */
export async function resolveAttemptRefsWithCtx(
  ctx: ReadCtx,
  input: { readonly runId: Id<"intelligenceRun">; readonly refs: readonly string[] },
): Promise<AgentAttemptRefResolution> {
  const attempts = new Map<Id<"agentProgramAttempt">, Doc<"agentProgramAttempt">>();
  for (const ref of input.refs) {
    const parsed = parseAttemptRef(ref);
    if (!parsed) return { kind: "rejected", ref, reason: "malformed", message: "The attempt reference is not one this harness minted." };
    const attempt = await ctx.db
      .query("agentProgramAttempt")
      .withIndex("by_runId_sequence", (q) => q.eq("runId", input.runId).eq("sequence", parsed.sequence))
      .unique();
    if (!attempt) return { kind: "rejected", ref, reason: "unknown_attempt", message: "The attempt reference names no attempt of this run." };
    if (attempt.status !== "result_produced" || !attempt.resultHash) {
      return { kind: "rejected", ref, reason: "not_successful", message: "Only attempts that produced a result can be cited." };
    }
    if (attemptRefDigest({ runId: input.runId, attemptId: attempt._id, sequence: attempt.sequence, resultHash: attempt.resultHash }) !== parsed.digest) {
      return { kind: "rejected", ref, reason: "binding_mismatch", message: "The attempt reference is not bound to this run's attempt and result." };
    }
    attempts.set(attempt._id, attempt);
  }
  return { kind: "resolved", attempts };
}

// ---------------------------------------------------------------------------
// Viewer evidence lookup (reauthorized, no raw identifiers)
// ---------------------------------------------------------------------------

export type AgentCitationEvidenceForViewer =
  | {
      readonly kind: "evidence";
      readonly state: CitationEvidenceView["state"];
      readonly citation: {
        readonly citationRef: string;
        readonly namespace?: string;
        /** Opaque capability identity (`cap_…`); named without the `Id` suffix so raw-id scans stay meaningful. */
        readonly capability?: string;
        readonly resultHash: string;
        readonly claimDigest?: string;
        readonly sourceRef: { readonly ref: string; readonly kind?: string; readonly label?: string };
        readonly normalizedArgsHash?: string;
        readonly observedAt?: number;
        readonly capturedAt?: number;
        readonly freshness?: string;
        readonly completeness?: string;
        readonly sourceRefCount?: number;
        readonly claimSupport?: { readonly extractorKey: string; readonly extractorVersion: string; readonly slice: Record<string, unknown> };
        readonly immutableRevisionRef?: string;
      };
    }
  | { readonly kind: "not_found" }
  | { readonly kind: "unauthorized"; readonly reason: string };

/**
 * Evidence lookup for an operator: reauthorize the viewer through the
 * registered authority port for their kind (current membership and scope),
 * require that they still hold the read intents the cited capability binds,
 * then resolve lineage through the harness lifecycle (which audits the access) and strip every
 * document id from the view.
 */
export async function readCitationEvidenceForViewerWithCtx(
  ctx: MutationCtx,
  config: Pick<DelegatedGrantConfig, "registry" | "authorityPorts">,
  input: {
    readonly runId: Id<"intelligenceRun">;
    readonly citationRef: string;
    readonly viewer: DelegatedOperator;
    readonly purpose: string;
    readonly now: number;
  },
): Promise<AgentCitationEvidenceForViewer> {
  const binding = await ctx.db
    .query("agentCitationBinding")
    .withIndex("by_runId_citationKey", (q) => q.eq("runId", input.runId).eq("citationKey", input.citationRef))
    .unique();
  if (!binding) return { kind: "not_found" };
  const located = await loadRunGrantWithCtx(ctx, input.runId);
  if (!located) return { kind: "not_found" };
  const port = config.authorityPorts[input.viewer.kind];
  if (!port) return { kind: "unauthorized", reason: "authority_port_missing" };
  const authority = await port.resolve(ctx, {
    operator: input.viewer,
    organizationId: located.grant.organizationId,
    storeId: located.grant.storeId,
    now: input.now,
  });
  if (authority.kind === "denied") return { kind: "unauthorized", reason: authority.reason };
  const call = await ctx.db.get("agentCapabilityCall", binding.callId);
  const manifest = call ? config.registry.capabilities[call.capabilityId] : undefined;
  if (manifest) {
    const held = new Set<string>(authority.authority.heldReadIntents);
    if (!manifest.binding.readIntents.every((intent) => held.has(intent))) {
      return { kind: "unauthorized", reason: "read_intent_not_held" };
    }
  }
  const view = await readCitationEvidenceWithCtx(ctx, {
    citationBindingId: binding._id,
    viewer: { principalKind: "athenaUser", actorRef: `${input.viewer.kind === "shared_demo" ? "sharedDemo" : "athenaUser"}:${input.viewer.athenaUserId}` },
    purpose: input.purpose,
    now: input.now,
  });
  if (!view) return { kind: "not_found" };
  return {
    kind: "evidence",
    state: view.state,
    citation: {
      citationRef: view.citation.citationKey,
      ...(manifest ? { namespace: `${manifest.namespace.package}.${manifest.namespace.resource}` } : {}),
      ...(view.citation.capabilityId ? { capability: view.citation.capabilityId } : {}),
      resultHash: view.citation.resultHash,
      ...(view.citation.claimDigest ? { claimDigest: view.citation.claimDigest } : {}),
      sourceRef: {
        ref: view.citation.sourceRef.id,
        ...(view.citation.sourceRef.surface ? { kind: view.citation.sourceRef.surface } : {}),
        ...(view.citation.sourceRef.label ? { label: view.citation.sourceRef.label } : {}),
      },
      ...(view.citation.normalizedArgsHash ? { normalizedArgsHash: view.citation.normalizedArgsHash } : {}),
      ...(view.citation.observedAt !== undefined ? { observedAt: view.citation.observedAt } : {}),
      ...(view.citation.capturedAt !== undefined ? { capturedAt: view.citation.capturedAt } : {}),
      ...(view.citation.freshness ? { freshness: view.citation.freshness } : {}),
      ...(view.citation.completeness ? { completeness: view.citation.completeness } : {}),
      ...(view.citation.sourceRefCount !== undefined ? { sourceRefCount: view.citation.sourceRefCount } : {}),
      ...(view.citation.claimSupport ? { claimSupport: view.citation.claimSupport } : {}),
      ...(view.citation.immutableRevisionRef ? { immutableRevisionRef: view.citation.immutableRevisionRef } : {}),
    },
  };
}
