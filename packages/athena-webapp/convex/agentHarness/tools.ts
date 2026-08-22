/**
 * The fixed Athena tool catalog (kernel; runtime-neutral).
 *
 * Authority boundary (plan decision 8, R11, R13): the model sees exactly five
 * tools — discover, describe, executeProgram, scratch, completeRun — defined
 * here as capability-SDK `AgentToolDefinition`s with Athena validators that
 * canonicalize arguments, and handlers that reach only grant-filtered
 * discovery (`discovery.ts`), the program executor and its seams, and the
 * completion outbox. No individual backend read is a tool. The runtime-adapter
 * dispatch ledger fingerprints every call (adapter version +
 * turn + tool + canonical args hash + call id): an exact replay returns the
 * recorded outcome; any mismatch fails without a handler. Model narrative is
 * never streamed; the only progress the browser sees are the server-authored
 * milestones these handlers report. Nothing here imports the runtime adapter
 * or a product domain.
 */
import type { FunctionReference } from "convex/server";

import type { Id } from "../_generated/dataModel";
import {
  canonicalize,
  type AgentAnyToolRegistration,
  type AgentProgressMilestone,
  type AgentToolDefinition,
  type AgentToolHandlerOutcome,
  type AgentToolRegistration,
} from "../../shared/agentHarness/agentRuntime";
import { AGENT_FIXED_TOOL_IDS } from "../../shared/agentHarness/bridge";
import { computeSha256Digest } from "../../shared/agentHarness/digest";
import { measureJsonByteLength } from "../../shared/agentHarness/execution";
import type { JsonValue } from "../../shared/agentHarness/manifest";
import { isPlainObject, maxEgressClass, type AgentEgressClass } from "../../shared/agentHarness/values";
import type { AgentPrepareCompletionOutcome } from "./completionOutbox";
import { createRunDiscoverySurface, type AgentCapabilitySchemaIndex, type AgentRuntimeGrant } from "./discovery";
// eslint-disable-next-line @convex-dev/import-wrong-runtime -- type-only import: nothing from the Node executor is bundled into this V8 module
import type { AgentExecuteProgramResult } from "./executor";
import type { AgentCompleteRunOutcome } from "./executorSeams";
import { buildAnswerArtifactPayload, type AgentAnswerOutcome } from "./historyProjection";

// ---------------------------------------------------------------------------
// Argument shapes and ceilings
// ---------------------------------------------------------------------------

export const AGENT_TOOL_SOURCE_MAX_BYTES = 32 * 1024;
export const AGENT_TOOL_SCRATCH_MAX_BYTES = 64 * 1024;
export const AGENT_TOOL_NARRATIVE_MAX_BYTES = 16 * 1024;
export const AGENT_TOOL_MAX_CITED_ATTEMPTS = 8;
export const AGENT_TOOL_MAX_CITATIONS = 200;
const NAMESPACE_PATTERN = /^[a-z][a-zA-Z0-9_]*\.[a-z][a-zA-Z0-9_]*$/;
const SCRATCH_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

export type AgentDiscoverArgs = Record<string, never>;
export type AgentDescribeArgs = { readonly namespace: string };
export type AgentExecuteProgramArgs = { readonly source: string };
export type AgentScratchArgs = { readonly key: string; readonly content: JsonValue };
export type AgentCompleteRunArgs = {
  readonly outcome: AgentAnswerOutcome;
  readonly narrative: string;
  readonly title?: string;
  readonly citedAttemptRefs: readonly string[];
  readonly citations: readonly { readonly ref: string; readonly claim?: string; readonly claimShape?: string }[];
  readonly confidence?: number;
  readonly limitedEvidence?: boolean;
};

type Issue = { readonly path: string; readonly message: string };
type Validation<Args> = { readonly ok: true; readonly args: Args } | { readonly ok: false; readonly issues: readonly Issue[] };

function objectOf(raw: unknown): Record<string, unknown> | null {
  if (raw === undefined || raw === null) return {};
  return isPlainObject(raw) ? raw : null;
}

function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > 32) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((entry) => isJsonValue(entry, depth + 1));
  if (isPlainObject(value)) return Object.values(value).every((entry) => entry === undefined || isJsonValue(entry, depth + 1));
  return false;
}

// ---------------------------------------------------------------------------
// Definitions (validators canonicalize: what they return is what gets hashed)
// ---------------------------------------------------------------------------

export const discoverTool: AgentToolDefinition<AgentDiscoverArgs, unknown> = {
  toolId: "athena.discover",
  description: "List the capabilities this run may read (namespace, purpose, verbs). Call it before describe or executeProgram. Takes no arguments.",
  validateInput: (raw): Validation<AgentDiscoverArgs> => {
    const object = objectOf(raw);
    if (!object) return { ok: false, issues: [{ path: "$", message: "discover takes no arguments" }] };
    const extra = Object.keys(object).filter((key) => object[key] !== undefined);
    if (extra.length > 0) return { ok: false, issues: [{ path: extra[0], message: "discover takes no arguments" }] };
    return { ok: true, args: {} as AgentDiscoverArgs };
  },
};

export const describeTool: AgentToolDefinition<AgentDescribeArgs, unknown> = {
  toolId: "athena.describe",
  description: "Describe one discovered capability: arguments, result fields, freshness, completeness, and citation rules. Arguments: { namespace: \"package.resource\" } from a prior discover.",
  validateInput: (raw): Validation<AgentDescribeArgs> => {
    const object = objectOf(raw);
    const namespace = object?.namespace;
    if (!object || typeof namespace !== "string") return { ok: false, issues: [{ path: "namespace", message: "namespace must be a string" }] };
    const trimmed = namespace.trim();
    if (!NAMESPACE_PATTERN.test(trimmed)) return { ok: false, issues: [{ path: "namespace", message: "namespace must look like package.resource" }] };
    return { ok: true, args: { namespace: trimmed } };
  },
};

export const executeProgramTool: AgentToolDefinition<AgentExecuteProgramArgs, unknown> = {
  toolId: "athena.executeProgram",
  description:
    "Run one bounded, read-only TypeScript program and return its single structured result with citation refs. Arguments: { source: string }.\n" +
    "The source is a program BODY, not a module: top-level `await` is allowed, and it must end with exactly one top-level `return` of one JSON value.\n" +
    "Read only through the full path `athena.<package>.<resource>.get({...})` or `.list({...})` — never destructure or alias `athena`, and never reference a package name on its own.\n" +
    "Every read returns `{ kind, envelope }`; check `kind === \"result\"` before reading `envelope.data`, and report the other kinds honestly instead of guessing.\n" +
    "Arguments are ONLY the filters `athena.describe` lists for that capability: the store is fixed by the run, so a store name or id is never an argument.\n" +
    "No imports, no `require`, no timers, no randomness, no clock.\n" +
    "Example:\n" +
    "const day = await athena.operations.storeDay.get({ operatingDate: \"2026-08-22\" });\n" +
    "const registers = await athena.cash.registerSessions.list({ operatingDate: \"2026-08-22\" });\n" +
    "return {\n" +
    "  stage: day.kind === \"result\" ? day.envelope.data.lifecycleStage : null,\n" +
    "  openDrawers: registers.kind === \"result\" ? registers.envelope.data.filter((s) => s.status === \"open\").length : null,\n" +
    "};",
  validateInput: (raw): Validation<AgentExecuteProgramArgs> => {
    const object = objectOf(raw);
    const source = object?.source;
    if (!object || typeof source !== "string" || source.trim().length === 0) return { ok: false, issues: [{ path: "source", message: "source must be a non-empty string" }] };
    if (measureJsonByteLength(source) - 2 > AGENT_TOOL_SOURCE_MAX_BYTES) return { ok: false, issues: [{ path: "source", message: `source exceeds ${AGENT_TOOL_SOURCE_MAX_BYTES} bytes` }] };
    return { ok: true, args: { source } };
  },
};

export const scratchTool: AgentToolDefinition<AgentScratchArgs, unknown> = {
  toolId: "athena.scratch",
  description: "Keep a small bounded note for this run (overwrites the same key). Arguments: { key: string, content: JSON }. Notes are short-lived and never shown to the operator.",
  validateInput: (raw): Validation<AgentScratchArgs> => {
    const object = objectOf(raw);
    if (!object) return { ok: false, issues: [{ path: "$", message: "scratch takes an object" }] };
    const key = object.key;
    if (typeof key !== "string" || !SCRATCH_KEY_PATTERN.test(key)) return { ok: false, issues: [{ path: "key", message: "key must be a short identifier" }] };
    if (!("content" in object) || !isJsonValue(object.content)) return { ok: false, issues: [{ path: "content", message: "content must be JSON" }] };
    if (measureJsonByteLength(object.content) > AGENT_TOOL_SCRATCH_MAX_BYTES) return { ok: false, issues: [{ path: "content", message: `content exceeds ${AGENT_TOOL_SCRATCH_MAX_BYTES} bytes` }] };
    return { ok: true, args: { key, content: canonicalize(object.content) as JsonValue } };
  },
};

export const completeRunTool: AgentToolDefinition<AgentCompleteRunArgs, unknown> = {
  toolId: "athena.completeRun",
  description:
    "Finish the run exactly once with the final answer. Arguments: { outcome?: \"answer\" | \"no_usable_sources\", narrative: string, title?: string, citedAttemptRefs: string[] (attemptRef values from executeProgram results the answer relies on), citations: [{ ref: string (citation refs from those results), claim?: string }], confidence?: 0..1, limitedEvidence?: boolean }. An answer needs at least one cited attempt and citation; use no_usable_sources when nothing usable was read.",
  validateInput: (raw): Validation<AgentCompleteRunArgs> => {
    const object = objectOf(raw);
    if (!object) return { ok: false, issues: [{ path: "$", message: "completeRun takes an object" }] };
    const issues: Issue[] = [];
    const outcome = object.outcome === undefined ? "answer" : object.outcome;
    if (outcome !== "answer" && outcome !== "no_usable_sources") issues.push({ path: "outcome", message: "outcome must be answer or no_usable_sources" });
    const narrative = object.narrative;
    if (typeof narrative !== "string" || narrative.trim().length === 0) issues.push({ path: "narrative", message: "narrative must be a non-empty string" });
    else if (measureJsonByteLength(narrative) - 2 > AGENT_TOOL_NARRATIVE_MAX_BYTES) issues.push({ path: "narrative", message: `narrative exceeds ${AGENT_TOOL_NARRATIVE_MAX_BYTES} bytes` });
    if (object.title !== undefined && (typeof object.title !== "string" || object.title.length > 200)) issues.push({ path: "title", message: "title must be a string of at most 200 characters" });
    const citedAttemptRefs = object.citedAttemptRefs === undefined ? [] : object.citedAttemptRefs;
    if (!Array.isArray(citedAttemptRefs) || citedAttemptRefs.some((ref) => typeof ref !== "string") || citedAttemptRefs.length > AGENT_TOOL_MAX_CITED_ATTEMPTS) {
      issues.push({ path: "citedAttemptRefs", message: `citedAttemptRefs must be up to ${AGENT_TOOL_MAX_CITED_ATTEMPTS} strings` });
    }
    const citations = object.citations === undefined ? [] : object.citations;
    if (!Array.isArray(citations) || citations.length > AGENT_TOOL_MAX_CITATIONS) issues.push({ path: "citations", message: `citations must be up to ${AGENT_TOOL_MAX_CITATIONS} entries` });
    else {
      citations.forEach((citation, index) => {
        if (!isPlainObject(citation) || typeof citation.ref !== "string") issues.push({ path: `citations[${index}].ref`, message: "citation ref must be a string" });
        else if (citation.claim !== undefined && typeof citation.claim !== "string") issues.push({ path: `citations[${index}].claim`, message: "claim must be a string" });
        else if (citation.claimShape !== undefined && typeof citation.claimShape !== "string") issues.push({ path: `citations[${index}].claimShape`, message: "claimShape must be a string" });
      });
    }
    if (object.confidence !== undefined && (typeof object.confidence !== "number" || !(object.confidence >= 0 && object.confidence <= 1))) issues.push({ path: "confidence", message: "confidence must be between 0 and 1" });
    if (object.limitedEvidence !== undefined && typeof object.limitedEvidence !== "boolean") issues.push({ path: "limitedEvidence", message: "limitedEvidence must be a boolean" });
    if (issues.length > 0) return { ok: false, issues };
    return {
      ok: true,
      args: {
        outcome: outcome as AgentAnswerOutcome,
        narrative: (narrative as string).trim(),
        ...(typeof object.title === "string" ? { title: object.title.trim() } : {}),
        citedAttemptRefs: [...new Set(citedAttemptRefs as string[])],
        citations: (citations as Record<string, unknown>[]).map((citation) => ({
          ref: citation.ref as string,
          ...(typeof citation.claim === "string" ? { claim: citation.claim } : {}),
          ...(typeof citation.claimShape === "string" ? { claimShape: citation.claimShape } : {}),
        })),
        ...(typeof object.confidence === "number" ? { confidence: object.confidence } : {}),
        ...(typeof object.limitedEvidence === "boolean" ? { limitedEvidence: object.limitedEvidence } : {}),
      },
    };
  },
};

/** The whole model-visible catalog, in the order the model sees it. */
export const ATHENA_TOOL_DEFINITIONS: readonly AgentToolDefinition[] = [discoverTool, describeTool, executeProgramTool, scratchTool, completeRunTool];

/** The catalog IS the fixed list from the bridge contract — no more, no less. */
export function assertFixedToolCatalog(definitions: readonly AgentToolDefinition[] = ATHENA_TOOL_DEFINITIONS): void {
  const ids = definitions.map((definition) => definition.toolId);
  if (ids.length !== AGENT_FIXED_TOOL_IDS.length || AGENT_FIXED_TOOL_IDS.some((id, index) => ids[index] !== id)) {
    throw new Error(`The Athena tool catalog must be exactly ${AGENT_FIXED_TOOL_IDS.join(", ")}.`);
  }
}
assertFixedToolCatalog();

/** Digest of a completion request: the private `completion_prepared` reference. */
export function completionRequestRef(args: AgentCompleteRunArgs): string {
  return `completion:${computeSha256Digest(canonicalize(args)).slice(7, 39)}`;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export type AgentDescribeGrantOutcome =
  | { readonly kind: "authorized"; readonly grant: AgentRuntimeGrant }
  | { readonly kind: "refused"; readonly stage: string; readonly reason: string };

/** Internal function references the handlers call (production or test-bound). */
export type AgentToolSeamRefs = {
  readonly describeGrant: FunctionReference<"query", "internal", { runId: Id<"intelligenceRun">; now?: number }, AgentDescribeGrantOutcome>;
  readonly recordScratch: FunctionReference<"mutation", "internal", { runId: Id<"intelligenceRun">; scratchKey: string; content: unknown; now?: number }, unknown>;
  readonly prepareCompletion: FunctionReference<
    "mutation",
    "internal",
    { bindingId: Id<"agentTurnBinding">; runId: Id<"intelligenceRun">; preparedCompletionRef: string; now?: number },
    AgentPrepareCompletionOutcome
  >;
  readonly completeRun: FunctionReference<
    "mutation",
    "internal",
    {
      runId: Id<"intelligenceRun">;
      idempotencyKey: string;
      citedAttemptRefs: string[];
      citations: { ref: string; claim?: string; claimShape?: string }[];
      artifact: { title?: string; summary?: string; payload: Record<string, unknown>; confidence?: number; limitedEvidence?: boolean };
      now?: number;
    },
    AgentCompleteRunOutcome
  >;
};

export type AgentToolHostContext = {
  readonly runId: Id<"intelligenceRun">;
  readonly bindingId: Id<"agentTurnBinding">;
  readonly ctx: { readonly runQuery: (reference: unknown, args: unknown) => Promise<unknown>; readonly runMutation: (reference: unknown, args: unknown) => Promise<unknown> };
  readonly refs: AgentToolSeamRefs;
  readonly executeProgram: (input: { runId: Id<"intelligenceRun">; attemptIdempotencyKey: string; source: string; signal: AbortSignal }) => Promise<AgentExecuteProgramResult>;
  readonly reportProgress?: (milestone: AgentProgressMilestone) => Promise<void>;
  readonly now: () => number;
  /** Discovery schemas (tests bind the test package; production defaults to the generated index). */
  readonly schemas?: AgentCapabilitySchemaIndex;
};

/** What the turn host learns from the handlers as the turn progresses. */
export type AgentToolTurnState = {
  readonly attempts: () => readonly { attemptRef: string; egressClass: AgentEgressClass; completeness: "complete" | "partial"; providerExposed: boolean; citations: readonly { citation: string; namespace: string }[] }[];
  readonly completion: () => { committed: boolean; artifactId?: Id<"intelligenceArtifact"> };
  readonly authorityRevocations: () => readonly string[];
};

/** Refusal reasons that mean the operator's authority changed under the run (not a budget or argument problem). */
export const AGENT_AUTHORITY_REVOCATION_REASONS = new Set([
  "membership_revoked",
  "operator_unknown",
  "store_missing",
  "store_out_of_scope",
  "principal_missing",
  "session_expired",
  "demo_disabled",
  "profile_disabled",
  "profile_unpublished",
  "profile_unknown",
  "capability_disabled",
  "compatibility_epoch_fenced",
  "registry_digest_mismatch",
  "authority_shrunk",
  "grant_deleted",
]);

function denied(code: string, message: string): AgentToolHandlerOutcome<never> {
  return { kind: "denied", denial: { code, message } };
}

function failure(code: string, message: string, retryable = false): AgentToolHandlerOutcome<never> {
  return { kind: "failure", error: { code, message, retryable } };
}

/**
 * Bind the catalog to one run. Handlers keep per-turn state (disclosure,
 * attempts seen, completion) in memory; every durable effect goes through the
 * seams. A replayed tool call never reaches a handler: the ledger answers it.
 */
export function createAthenaToolRegistrations(host: AgentToolHostContext): { registrations: AgentAnyToolRegistration[]; state: AgentToolTurnState } {
  const attempts: { attemptRef: string; egressClass: AgentEgressClass; completeness: "complete" | "partial"; providerExposed: boolean; citations: { citation: string; namespace: string }[] }[] = [];
  const revocations: string[] = [];
  let completion: { committed: boolean; artifactId?: Id<"intelligenceArtifact"> } = { committed: false };
  let surface: ReturnType<typeof createRunDiscoverySurface> | undefined;

  const grantSurface = async (): Promise<{ kind: "surface"; surface: ReturnType<typeof createRunDiscoverySurface> } | { kind: "refused"; stage: string; reason: string }> => {
    const verdict = (await host.ctx.runQuery(host.refs.describeGrant, { runId: host.runId, now: host.now() })) as AgentDescribeGrantOutcome;
    if (verdict.kind === "refused") {
      if (AGENT_AUTHORITY_REVOCATION_REASONS.has(verdict.reason)) revocations.push(verdict.reason);
      return verdict;
    }
    // Re-create on every call so a shrunk grant shrinks the surface; disclosure state carries over.
    const disclosed = surface?.disclosedNamespaces() ?? [];
    const next = createRunDiscoverySurface(verdict.grant, { schemas: host.schemas });
    if (disclosed.length > 0) await next.discover();
    surface = next;
    return { kind: "surface", surface: next };
  };

  const discover: AgentToolRegistration<AgentDiscoverArgs, unknown> = {
    definition: discoverTool,
    handler: async () => {
      await host.reportProgress?.("checking_sources");
      const resolved = await grantSurface();
      if (resolved.kind === "refused") return denied(resolved.reason, "This run may not discover capabilities any more.");
      const capabilities = await resolved.surface.discover();
      return { kind: "success", result: { capabilities } };
    },
  };

  const describe: AgentToolRegistration<AgentDescribeArgs, unknown> = {
    definition: describeTool,
    handler: async (args) => {
      const resolved = await grantSurface();
      if (resolved.kind === "refused") return denied(resolved.reason, "This run may not describe capabilities any more.");
      const outcome = await resolved.surface.describe(args.namespace);
      switch (outcome.kind) {
        case "declaration":
          return { kind: "success", result: { declaration: outcome.declaration } };
        case "discovery_required":
          return denied("discovery_required", "Call athena.discover before describing a capability.");
        case "unknown_namespace":
        case "unauthorized":
          return denied("unknown_namespace", `No capability named ${args.namespace} is available to this run.`);
      }
    },
  };

  const executeProgram: AgentToolRegistration<AgentExecuteProgramArgs, unknown> = {
    definition: executeProgramTool,
    handler: async (args, context) => {
      await host.reportProgress?.("reading_sources");
      const result = await host.executeProgram({ runId: host.runId, attemptIdempotencyKey: context.idempotencyKey, source: args.source, signal: context.signal });
      switch (result.outcome) {
        case "result": {
          attempts.push({
            attemptRef: result.attemptRef,
            egressClass: result.result.egressClass,
            completeness: result.result.completeness.status,
            providerExposed: true,
            citations: result.citations.map((candidate) => ({ citation: candidate.citation, namespace: candidate.namespace })),
          });
          return {
            kind: "success",
            result: {
              attemptRef: result.attemptRef,
              output: result.result.output,
              completeness: result.result.completeness,
              freshness: result.result.freshness,
              citations: result.citations.map((candidate) => ({
                ref: candidate.citation,
                namespace: candidate.namespace,
                verb: candidate.verb,
                ...(candidate.freshness ? { freshness: candidate.freshness } : {}),
                ...(candidate.completeness ? { completeness: candidate.completeness } : {}),
              })),
              calls: result.calls.map((call) => ({
                namespace: call.namespace,
                verb: call.verb,
                outcome: call.outcome,
                ...(call.reason ? { reason: call.reason } : {}),
                ...(call.detail ? { detail: call.detail } : {}),
              })),
            },
          };
        }
        case "withheld":
          if (AGENT_AUTHORITY_REVOCATION_REASONS.has(result.reason)) revocations.push(result.reason);
          return denied(result.reason, "The result was withheld.");
        case "rejected":
          return { kind: "success", result: { outcome: "rejected", issues: result.issues.map((issue) => ({ code: issue.code, message: issue.message, ...(issue.line !== undefined ? { line: issue.line } : {}) })) } };
        case "refused":
          if (AGENT_AUTHORITY_REVOCATION_REASONS.has(result.reason)) revocations.push(result.reason);
          return denied(result.reason, "This run may not execute programs any more.");
        case "denied":
          return denied(result.code, result.message);
        case "failed":
        case "canceled":
          return failure(result.error.code, result.error.message, result.error.retryable === true);
        case "resumed":
        case "already_terminal":
          return failure(result.outcome, "This program attempt was already recorded; submit a new attempt.");
      }
    },
  };

  const scratch: AgentToolRegistration<AgentScratchArgs, unknown> = {
    definition: scratchTool,
    handler: async (args) => {
      const recorded = (await host.ctx.runMutation(host.refs.recordScratch, { runId: host.runId, scratchKey: args.key, content: args.content, now: host.now() })) as
        | { outcome: "recorded"; contentHash: string }
        | { outcome: "rejected"; denial: { code: string; message: string } };
      if (recorded.outcome === "rejected") return denied(recorded.denial.code, recorded.denial.message);
      return { kind: "success", result: { key: args.key, contentHash: recorded.contentHash } };
    },
  };

  const completeRun: AgentToolRegistration<AgentCompleteRunArgs, unknown> = {
    definition: completeRunTool,
    handler: async (args) => {
      if (completion.committed) return denied("already_completed", "The run already has its answer.");
      if (attempts.length === 0) return denied("no_attempts", "Read at least one source with athena.executeProgram before completing.");
      if (args.outcome === "answer" && (args.citedAttemptRefs.length === 0 || args.citations.length === 0)) {
        return denied("citations_required", "An answer must cite at least one attempt and one citation; use outcome no_usable_sources when nothing usable was read.");
      }
      await host.reportProgress?.("finalizing");
      const preparedRef = completionRequestRef(args);
      const prepared = (await host.ctx.runMutation(host.refs.prepareCompletion, { bindingId: host.bindingId, runId: host.runId, preparedCompletionRef: preparedRef, now: host.now() })) as AgentPrepareCompletionOutcome;
      if (prepared.outcome === "rejected") return denied(prepared.code, prepared.message);
      const cited = new Set(args.citedAttemptRefs);
      // The narrative may quote anything the provider was shown, so the answer's
      // class is the maximum over EVERY attempt whose result was released to the
      // provider — never the model-chosen cited subset, which would let a
      // narrative carrying sensitive figures ship labelled `operational`.
      const egressClass = attempts.reduce<AgentEgressClass>((max, attempt) => maxEgressClass(max, attempt.egressClass), "operational");
      const namespaceOf = new Map<string, string>();
      for (const attempt of attempts) for (const citation of attempt.citations) namespaceOf.set(citation.citation, citation.namespace);
      const limitedEvidence = args.limitedEvidence === true || args.outcome === "no_usable_sources" || attempts.some((attempt) => cited.has(attempt.attemptRef) && attempt.completeness === "partial");
      const committed = (await host.ctx.runMutation(host.refs.completeRun, {
        runId: host.runId,
        idempotencyKey: prepared.preparedCompletionRef,
        citedAttemptRefs: [...args.citedAttemptRefs],
        citations: args.citations.map((citation) => ({ ...citation })),
        artifact: {
          ...(args.title ? { title: args.title } : {}),
          summary: args.narrative.slice(0, 280),
          payload: buildAnswerArtifactPayload({
            outcome: args.outcome,
            narrative: args.narrative,
            egressClass,
            citations: args.citations.map((citation) => ({ ref: citation.ref, ...(namespaceOf.has(citation.ref) ? { namespace: namespaceOf.get(citation.ref) } : {}) })),
            ...(args.outcome === "no_usable_sources" ? { sourcesTried: [...new Set(attempts.flatMap((attempt) => attempt.citations.map((citation) => citation.namespace)))] } : {}),
          }),
          ...(args.confidence !== undefined ? { confidence: args.confidence } : {}),
          limitedEvidence,
        },
        now: host.now(),
      })) as AgentCompleteRunOutcome;
      switch (committed.outcome) {
        case "completed":
          completion = { committed: true, artifactId: committed.artifactId };
          return { kind: "success", result: { outcome: "committed", citations: committed.citations.map((citation) => ({ ref: citation.ref, support: citation.support })) } };
        case "already_terminal":
          if (committed.status === "completed") {
            completion = { committed: true, artifactId: committed.artifactId };
            return { kind: "success", result: { outcome: "committed", citations: [] } };
          }
          return denied("run_not_running", "The run has already ended.");
        case "refused":
          if (AGENT_AUTHORITY_REVOCATION_REASONS.has(committed.reason)) revocations.push(committed.reason);
          return denied(committed.reason, "The answer could not be released.");
        case "rejected":
          return failure(committed.reason, committed.message, true);
      }
    },
  };

  const registrations: AgentAnyToolRegistration[] = [discover, describe, executeProgram, scratch, completeRun] as unknown as AgentAnyToolRegistration[];
  return {
    registrations,
    state: {
      attempts: () => attempts.map((attempt) => ({ ...attempt, citations: [...attempt.citations] })),
      completion: () => ({ ...completion }),
      authorityRevocations: () => [...revocations],
    },
  };
}
