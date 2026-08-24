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
 * recorded outcome; any mismatch fails without a handler. Athena buffers no
 * model narrative: the running text is emitted in process as ordered
 * `narrative_delta` events and held only in a short-lived provisional row that
 * every terminal cause deletes, so a host can surface it as explicitly
 * provisional text. It never enters the durable record, projected history, a
 * citation, or a prompt, and the committed artifact remains the only released
 * answer; the only other progress the browser sees are the server-authored
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
import {
  annotateMoneyDisplays,
  APP_PRODUCT_LEXICON,
  collectNarrativeEvidence,
  normalizeNarrative,
  senseTone,
  stripSourcesFooter,
  type AgentMoneyAmount,
  type AgentProductLexicon,
  type AgentToneFinding,
} from "../../shared/agentHarness/productLexicon";
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
  description: "Describe one discovered capability: arguments, result fields, freshness, completeness, and citation rules. Arguments: { namespace: \"package.resource\" } from the capability catalog.",
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
    "Guarded fields (money and similar) arrive as `{ state, value }`: read `value` only when `state === \"known\"`, and report any other state as unavailable rather than missing.\n" +
    "If the result carries `fieldDiagnostics`, the program read a field the capability does not declare — rewrite using the named fields instead of concluding the data is unreadable.\n" +
    "Arguments are ONLY the filters `athena.describe` lists for that capability: the store is fixed by the run, so a store name or id is never an argument.\n" +
    "BUDGET: one run serves a fixed number of capability calls across all of its programs; `athena.budget.remaining().callsRemaining` tells you how many are left, so plan a wide question into the budget before looping. A read past the budget returns `{ kind: \"denied\", code: \"budget_exhausted\" }` as a value — keep what you already read and return it.\n" +
    "PAGES: a `list` result's `envelope.pagination` carries `hasMore` and an opaque `cursor`; pass it back (`.list({ ...sameFilters, cursor })`) to read the next page, within the capability's small per-run page budget. A truncated or paged read is `completeness: \"partial\"` — page onward when the question needs the rest.\n" +
    "SPEED: calls run up to 4 at a time — `Promise.all` over a batch is much faster than awaiting one by one, and excess calls queue rather than fail. Repeating an identical read inside one program costs nothing extra.\n" +
    "DATES: there is no clock. `athena.dates.shift(\"2026-08-22\", -7)` and `athena.dates.range(startIso, endIso)` do date arithmetic; take today's operating date from the turn context.\n" +
    "You may run several programs in one turn: read first, look at the result, then write the next program to drill into what it revealed — a follow-up program is a normal step, not a failure.\n" +
    "No imports, no `require`, no timers, no randomness.\n" +
    "Example:\n" +
    "const day = await athena.operations.storeDay.get({ operatingDate: \"2026-08-22\" });\n" +
    "const week = athena.dates.range(athena.dates.shift(\"2026-08-22\", -6), \"2026-08-22\");\n" +
    "const registers = await Promise.all(week.map((operatingDate) => athena.cash.registerSessions.list({ operatingDate })));\n" +
    "return {\n" +
    "  stage: day.kind === \"result\" ? day.envelope.data.lifecycleStage : null,\n" +
    "  openDrawers: registers.filter((r) => r.kind === \"result\").flatMap((r) => r.envelope.data).filter((s) => s.status === \"open\").length,\n" +
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
    "Finish the run exactly once with the final answer. Arguments: { outcome?: \"answer\" | \"no_usable_sources\" | \"needs_clarification\", narrative: string, title?: string, citedAttemptRefs: string[] (attemptRef values from executeProgram results the answer relies on), citations: [{ ref: string (citation refs from those results), claim?: string }], confidence?: 0..1, limitedEvidence?: boolean }. The narrative is the complete answer a store operator reads — plain operator language, never field names, namespaces, enum spellings, or refs; title is only a short label and never the answer. The answer surface already lists your citations under \"Sources\", so never write a sources or refs section into the narrative. Money values in results carry a display string — quote display, never amount. An answer needs at least one cited attempt and citation; use no_usable_sources when nothing usable was read, and needs_clarification — with the narrative asking the operator one specific question — when the question is too ambiguous to answer without guessing (neither requires citations). Submit by CALLING this tool — arguments written out as prose are not a submission. Say a value was unavailable only when its read returned kind !== \"result\" or its state was not \"known\".",
  validateInput: (raw): Validation<AgentCompleteRunArgs> => {
    const object = objectOf(raw);
    if (!object) return { ok: false, issues: [{ path: "$", message: "completeRun takes an object" }] };
    const issues: Issue[] = [];
    const outcome = object.outcome === undefined ? "answer" : object.outcome;
    if (outcome !== "answer" && outcome !== "no_usable_sources" && outcome !== "needs_clarification") issues.push({ path: "outcome", message: "outcome must be answer, no_usable_sources, or needs_clarification" });
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
    // Canonicalize the two ref buckets by prefix: models file attempt refs
    // under `citations` and citation refs under `citedAttemptRefs`, and the
    // kernel rightly rejects the whole submission for one misfiled ref.
    // Re-bucketing reconstructs the unambiguous intent; a forged ref still
    // dies in the kernel's resolvers.
    const attemptRefs: string[] = [];
    const citationEntries: { ref: string; claim?: string; claimShape?: string }[] = [];
    for (const ref of citedAttemptRefs as string[]) {
      if (ref.startsWith("citation:")) citationEntries.push({ ref });
      else attemptRefs.push(ref);
    }
    for (const citation of citations as Record<string, unknown>[]) {
      const ref = citation.ref as string;
      // A claim-less attempt-prefixed ref is an unambiguous misfile; one that
      // carries a claim stays in citations so tail resolution can route it.
      // The claim survives only when the ref lands in the citation bucket —
      // a ref resolving to an attempt sheds it by design (attempts have no
      // claim slot).
      if (ref.startsWith("attempt_") && typeof citation.claim !== "string" && typeof citation.claimShape !== "string") {
        attemptRefs.push(ref);
        continue;
      }
      citationEntries.push({
        ref,
        ...(typeof citation.claim === "string" ? { claim: citation.claim } : {}),
        ...(typeof citation.claimShape === "string" ? { claimShape: citation.claimShape } : {}),
      });
    }
    return {
      ok: true,
      args: {
        outcome: outcome as AgentAnswerOutcome,
        narrative: (narrative as string).trim(),
        ...(typeof object.title === "string" ? { title: object.title.trim() } : {}),
        citedAttemptRefs: [...new Set(attemptRefs)],
        citations: citationEntries.reduce<{ ref: string; claim?: string; claimShape?: string }[]>((deduped, entry) => {
          const existing = deduped.find((other) => other.ref === entry.ref);
          if (!existing) deduped.push({ ...entry });
          else {
            // Merge, never drop: a later duplicate may carry the claim the
            // first (claimless, cross-listed) occurrence lacked.
            if (existing.claim === undefined && entry.claim !== undefined) existing.claim = entry.claim;
            if (existing.claimShape === undefined && entry.claimShape !== undefined) existing.claimShape = entry.claimShape;
          }
          return deduped;
        }, []),
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

/**
 * The definitions the PROVIDER is offered for one turn. The kernel catalog
 * stays fixed — the dispatch ledger, replay, and fake-adapter flows keep all
 * five tools — but the model-visible list drops athena.discover when the turn
 * prompt already embeds the grant catalog: measured on the deployment, the
 * model calls discover first on every turn it is offered, whatever the
 * prompt says, and the answer is deterministic per grant.
 */
export function modelVisibleToolDefinitions(
  registrations: readonly AgentAnyToolRegistration[],
  catalogEmbedded: boolean,
): readonly AgentToolDefinition[] {
  const definitions = registrations.map((registration) => registration.definition);
  return catalogEmbedded ? definitions.filter((definition) => definition.toolId !== discoverTool.toolId) : definitions;
}

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
  /**
   * Class of the projected history this turn replayed into the provider. The
   * answer can never be classed below it, so the host must state it: a host
   * that forgot would silently label an answer written from sensitive history
   * as operational.
   */
  readonly egressFloor: AgentEgressClass;
  /** Discovery schemas (tests bind the test package; production defaults to the generated index). */
  readonly schemas?: AgentCapabilitySchemaIndex;
  /** The operator's question, verbatim: tokens it contains are never tone findings. */
  readonly question?: string;
  /** Merged product lexicon (app-wide + the profile's surface overlay). */
  readonly lexicon?: AgentProductLexicon;
  /**
   * Tone sensor policy. "warn" (default) records findings on the turn state
   * for telemetry; "enforce" denies the first completeRun whose narrative
   * carries findings — one corrective denial, never a loop.
   */
  readonly tonePolicy?: "warn" | "enforce";
};

/** What the turn host learns from the handlers as the turn progresses. */
export type AgentToolTurnState = {
  readonly attempts: () => readonly { attemptRef: string; egressClass: AgentEgressClass; completeness: "complete" | "partial"; providerExposed: boolean; citations: readonly { citation: string; namespace: string }[] }[];
  readonly completion: () => { committed: boolean; artifactId?: Id<"intelligenceArtifact"> };
  readonly authorityRevocations: () => readonly string[];
  /** Product-tone findings from the last sensed completeRun narrative. */
  readonly toneFindings: () => readonly AgentToneFinding[];
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
  const toneEvidence = { fieldNames: new Set<string>(), enumLiterals: new Set<string>(), moneyKeys: new Set<string>(), moneyAmounts: [] as AgentMoneyAmount[], truncated: false };
  let toneFindings: readonly AgentToneFinding[] = [];
  let toneDeniedOnce = false;
  let sourcesDeniedOnce = false;
  let completion: { committed: boolean; artifactId?: Id<"intelligenceArtifact"> } = { committed: false };
  let surface: ReturnType<typeof createRunDiscoverySurface> | undefined;

  const grantSurface = async (): Promise<{ kind: "surface"; surface: ReturnType<typeof createRunDiscoverySurface> } | { kind: "refused"; stage: string; reason: string }> => {
    const verdict = (await host.ctx.runQuery(host.refs.describeGrant, { runId: host.runId, now: host.now() })) as AgentDescribeGrantOutcome;
    if (verdict.kind === "refused") {
      if (AGENT_AUTHORITY_REVOCATION_REASONS.has(verdict.reason)) revocations.push(verdict.reason);
      return verdict;
    }
    // Re-create on every call so a shrunk grant shrinks the surface. The turn
    // prompt already carries the grant's catalog, so the granted namespaces
    // are pre-disclosed: describe never demands a redundant discover round
    // trip, and athena.discover remains a re-list.
    const next = createRunDiscoverySurface(verdict.grant, { schemas: host.schemas });
    await next.discover();
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
          // Money values gain product display strings before the model sees
          // them, and the raw internal tokens the model was shown are
          // harvested so the tone sensor can hold the narrative to them.
          const harvested = collectNarrativeEvidence(result.result.output);
          if (harvested.truncated) toneEvidence.truncated = true;
          for (const name of harvested.fieldNames) toneEvidence.fieldNames.add(name);
          for (const literal of harvested.enumLiterals) toneEvidence.enumLiterals.add(literal);
          for (const money of harvested.moneyAmounts) {
            const moneyKey = `${money.amount}:${money.currency}`;
            if (!toneEvidence.moneyKeys.has(moneyKey)) {
              toneEvidence.moneyKeys.add(moneyKey);
              toneEvidence.moneyAmounts.push(money);
            }
          }
          return {
            kind: "success",
            result: {
              attemptRef: result.attemptRef,
              output: annotateMoneyDisplays(result.result.output),
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
              ...(result.fieldAdvisories && result.fieldAdvisories.length > 0
                ? { fieldDiagnostics: result.fieldAdvisories.map((advisory) => advisory.message) }
                : {}),
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
      // `no_usable_sources` is precisely for the run whose every read failed,
      // and `needs_clarification` for the question too ambiguous to read for
      // at all: both must stay reachable with zero successful attempts, or a
      // turn that cannot honestly read anything can never end honestly.
      if (attempts.length === 0 && args.outcome !== "no_usable_sources" && args.outcome !== "needs_clarification") {
        return denied("no_attempts", "Read at least one source with athena.executeProgram before completing, or complete with outcome no_usable_sources (nothing usable was readable) or needs_clarification (the question needs the operator's answer first).");
      }
      // Refs are opaque handles this turn itself handed out, and models
      // transcribe them imperfectly (dropped prefixes, dropped version
      // segments, attempt/citation hybrids). The content-hash tail identifies
      // the intended handle exactly, so resolve each passed ref to the unique
      // known ref sharing its tail — including across buckets — and leave
      // anything unresolvable for the kernel to reject. Nothing is granted
      // that this run's reads did not already return.
      const knownAttemptRefs = attempts.map((attempt) => attempt.attemptRef);
      const knownCitationRefs = attempts.flatMap((attempt) => attempt.citations.map((citation) => citation.citation));
      const hashTail = (ref: string) => /([0-9a-f]{24,})$/.exec(ref)?.[1];
      const tailsOf = (refs: readonly string[]) => refs.map((ref) => ({ ref, tail: hashTail(ref) })).filter((entry): entry is { ref: string; tail: string } => entry.tail !== undefined);
      // Exact tail first; then unique containment either way, because models
      // also add or drop a character while transcribing (a 33-hex tail whose
      // first 32 characters are the minted hash names exactly one handle).
      const resolveByTail = (tail: string, entries: readonly { ref: string; tail: string }[]) => {
        const exact = entries.filter((entry) => entry.tail === tail);
        if (exact.length === 1) return exact[0].ref;
        if (exact.length > 1) return undefined;
        // One transcribed character, as documented — not arbitrary containment.
        const near = entries.filter((entry) => (entry.tail.includes(tail) || tail.includes(entry.tail)) && Math.abs(entry.tail.length - tail.length) === 1);
        return near.length === 1 ? near[0].ref : undefined;
      };
      const attemptTails = tailsOf(knownAttemptRefs);
      const citationTails = tailsOf(knownCitationRefs);
      const knownAttempts = new Set(knownAttemptRefs);
      const knownCitations = new Set(knownCitationRefs);
      const resolvedAttemptRefs: string[] = [];
      const resolvedCitations: { ref: string; claim?: string; claimShape?: string }[] = [];
      const resolveRef = (ref: string, claim?: { claim?: string; claimShape?: string }) => {
        // An exact membership hit in either bucket beats any tail resolution
        // in the other: a verbatim ref is never re-routed by a coincidence.
        if (knownCitations.has(ref)) {
          resolvedCitations.push({ ref, ...(claim ?? {}) });
          return;
        }
        if (knownAttempts.has(ref)) {
          resolvedAttemptRefs.push(ref);
          return;
        }
        const tail = hashTail(ref);
        const asAttempt = tail ? resolveByTail(tail, attemptTails) : undefined;
        const asCitation = tail ? resolveByTail(tail, citationTails) : undefined;
        if (asCitation) resolvedCitations.push({ ref: asCitation, ...(claim ?? {}) });
        else if (asAttempt) resolvedAttemptRefs.push(asAttempt);
        else if (ref.startsWith("citation:")) resolvedCitations.push({ ref, ...(claim ?? {}) });
        else resolvedAttemptRefs.push(ref);
      };
      for (const ref of args.citedAttemptRefs) resolveRef(ref);
      for (const citation of args.citations) resolveRef(citation.ref, { ...(citation.claim !== undefined ? { claim: citation.claim } : {}), ...(citation.claimShape !== undefined ? { claimShape: citation.claimShape } : {}) });
      const citedAttemptRefs = [...new Set(resolvedAttemptRefs)];
      const citations = resolvedCitations.reduce<{ ref: string; claim?: string; claimShape?: string }[]>((deduped, entry) => {
        const existing = deduped.find((other) => other.ref === entry.ref);
        if (!existing) deduped.push({ ...entry });
        else {
          if (existing.claim === undefined && entry.claim !== undefined) existing.claim = entry.claim;
          if (existing.claimShape === undefined && entry.claimShape !== undefined) existing.claimShape = entry.claimShape;
        }
        return deduped;
      }, []);
      const validRefsHint = () =>
        ` Valid citedAttemptRefs: ${knownAttemptRefs.join(", ") || "(none)"}. Valid citation refs: ${knownCitationRefs.join(", ") || "(none)"}. Copy them verbatim.`;
      if (args.outcome === "answer" && (citedAttemptRefs.length === 0 || citations.length === 0)) {
        return denied("citations_required", `An answer must cite at least one attempt and one citation; use outcome no_usable_sources when nothing usable was read.${validRefsHint()}`);
      }
      // The mirror gate, denied once like tone: observed after a tone denial,
      // the model abandoned a good cited answer and resubmitted
      // no_usable_sources with a "could not read" narrative — while this very
      // turn held successful reads and minted citations. Push back once; a
      // repeated submission is accepted as the model's honest judgment (a
      // turn CAN read successfully yet find nothing usable in the data).
      if (args.outcome === "no_usable_sources" && knownCitationRefs.length > 0 && !sourcesDeniedOnce) {
        sourcesDeniedOnce = true;
        return denied(
          "sources_were_read",
          `This turn read sources successfully and minted citations. If they answer the question, complete with outcome answer and cite them; if the question is too ambiguous to answer, complete with needs_clarification asking the operator one specific question. Use no_usable_sources only if nothing read was actually usable.${validRefsHint()}`,
        );
      }
      // Normalization before sensing or commit: strip the trailing refs-only
      // "Sources:" footer (the surface renders citations itself), then rewrite
      // the internal tokens this run served the model into their operator
      // wording — deterministic and evidence-bound, the operatorMessages.ts
      // mechanism applied to the answer.
      const namespacesRead = [...new Set(attempts.flatMap((attempt) => attempt.citations.map((citation) => citation.namespace)))];
      const lexicon = host.lexicon ?? APP_PRODUCT_LEXICON;
      const normalizeOptions = {
        evidence: { fieldNames: [...toneEvidence.fieldNames], enumLiterals: [...toneEvidence.enumLiterals], moneyAmounts: toneEvidence.moneyAmounts },
        namespaces: namespacesRead,
        lexicon,
        question: host.question ?? "",
      };
      const narrative = normalizeNarrative(stripSourcesFooter(args.narrative), normalizeOptions);
      // The title reaches the operator too: same rewrite, same evidence.
      const title = args.title === undefined ? undefined : normalizeNarrative(args.title, normalizeOptions);
      // Product-tone sensor: the narrative is held to the run's own evidence
      // (fields, enum spellings, minor-unit amounts it was shown, plus the
      // grant's namespaces and this turn's refs). Warn mode records findings
      // for telemetry; enforce mode spends at most ONE corrective denial —
      // the fix is named, and the retry commits regardless.
      const sensed = senseTone({
        narrative,
        question: host.question ?? "",
        fieldNames: [...toneEvidence.fieldNames],
        enumLiterals: [...toneEvidence.enumLiterals],
        moneyAmounts: toneEvidence.moneyAmounts,
        namespaces: namespacesRead,
        refs: [...knownAttemptRefs, ...knownCitationRefs],
        lexicon,
      });
      // Accumulate across invocations so a denial's findings survive the clean
      // retry into turn_report telemetry.
      for (const finding of sensed) {
        if (!toneFindings.some((existing) => existing.code === finding.code && existing.token === finding.token)) toneFindings = [...toneFindings, finding];
      }
      if (toneEvidence.truncated && !toneFindings.some((existing) => existing.code === "evidence_truncated")) {
        // Telemetry only, never a denial: a capped harvest means tone
        // policing was degraded for this turn, and silence would read clean.
        toneFindings = [...toneFindings, { code: "evidence_truncated", token: "harvest_caps", fix: "Evidence harvest hit its cap; tone policing may be incomplete for this turn." }];
      }
      if (host.tonePolicy === "enforce" && sensed.length > 0 && !toneDeniedOnce) {
        toneDeniedOnce = true;
        // Distinct fixes only: several findings can carry the same sentence
        // (every ref in prose does), and a message that repeats itself reads
        // as a glitch rather than an instruction.
        const fixes = [...new Set(sensed.map((finding) => finding.fix))].join(" ");
        return denied("tone", `Rewrite the narrative for the operator, then call completeRun again. ${fixes}`);
      }
      await host.reportProgress?.("finalizing");
      const preparedRef = completionRequestRef(args);
      const prepared = (await host.ctx.runMutation(host.refs.prepareCompletion, { bindingId: host.bindingId, runId: host.runId, preparedCompletionRef: preparedRef, now: host.now() })) as AgentPrepareCompletionOutcome;
      if (prepared.outcome === "rejected") return denied(prepared.code, prepared.message);
      const cited = new Set(citedAttemptRefs);
      // The narrative may quote anything the provider was shown, so the answer's
      // class is the maximum over EVERY attempt whose result was released to the
      // provider — never the model-chosen cited subset, which would let a
      // narrative carrying sensitive figures ship labelled `operational`. The
      // projected history was shown to the provider too, so it is the floor.
      const egressClass = attempts.reduce<AgentEgressClass>((max, attempt) => maxEgressClass(max, attempt.egressClass), host.egressFloor);
      const namespaceOf = new Map<string, string>();
      for (const attempt of attempts) for (const citation of attempt.citations) namespaceOf.set(citation.citation, citation.namespace);
      const limitedEvidence = args.limitedEvidence === true || args.outcome === "no_usable_sources" || attempts.some((attempt) => cited.has(attempt.attemptRef) && attempt.completeness === "partial");
      const committed = (await host.ctx.runMutation(host.refs.completeRun, {
        runId: host.runId,
        idempotencyKey: prepared.preparedCompletionRef,
        citedAttemptRefs: [...citedAttemptRefs],
        citations: citations.map((citation) => ({ ...citation })),
        artifact: {
          ...(title ? { title } : {}),
          summary: narrative.slice(0, 280),
          payload: buildAnswerArtifactPayload({
            outcome: args.outcome,
            narrative,
            egressClass,
            citations: citations.map((citation) => ({ ref: citation.ref, ...(namespaceOf.has(citation.ref) ? { namespace: namespaceOf.get(citation.ref) } : {}) })),
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
          return failure(committed.reason, `${committed.message}${validRefsHint()}`, true);
      }
    },
  };

  const registrations: AgentAnyToolRegistration[] = [discover, describe, executeProgram, scratch, completeRun];
  return {
    registrations,
    state: {
      attempts: () => attempts.map((attempt) => ({ ...attempt, citations: [...attempt.citations] })),
      completion: () => ({ ...completion }),
      authorityRevocations: () => [...revocations],
      toneFindings: () => [...toneFindings],
    },
  };
}
