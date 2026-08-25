/**
 * Agent read ports (kernel; product-neutral).
 *
 * Authority boundary: the ONLY way data reaches a program is through a port
 * that (a) the generated registry names, (b) the composition root explicitly
 * bound to an `internal.*` query reference whose function name is exactly the
 * registered path, and (c) was defined through `defineAgentReadPortQuery`, so
 * it reauthorizes the run inside its own transaction, derives scope from the
 * verified grant (never from arguments), strips every ungranted field, refuses
 * undeclared fields and raw identifiers, enforces the manifest's bounds, and
 * hashes the sanitized envelope. The registry is a closed map keyed by port
 * key; dispatch looks up by key only. No `api.*`, no `ctx.db` for the bridge,
 * no ad hoc function references.
 */
import { getFunctionName, type FunctionReference } from "convex/server";
import { v, type Infer } from "convex/values";

import type { Id } from "../_generated/dataModel";
import { internalQuery, type QueryCtx } from "../_generated/server";
import { hashCanonical } from "../../shared/agentHarness/agentRuntime";
import { measureJsonByteLength } from "../../shared/agentHarness/execution";
import {
  namespacePath,
  omitUngrantedFields,
  type AgentCapabilityManifest,
  type AgentFilterSchema,
  type JsonValue,
} from "../../shared/agentHarness/manifest";
import type { AgentReadPortDefinition } from "../../shared/agentHarness/readPort";
import {
  deriveCompleteness,
  scanForRawIdentifiers,
  validateReadEnvelope,
  type AgentReadEnvelope,
  type AgentSourceCompleteness,
  type AgentSourceRef,
  type AgentWarning,
} from "../../shared/agentHarness/results";
import {
  isOpaqueRef,
  isOperatingDate,
  isPlainObject,
  looksLikeRawDocumentId,
  opaqueRef,
  parseOpaqueRef,
  type AgentContractIssue,
  type AgentFreshnessAuthority,
  type AgentFreshnessClass,
  type AgentReadVerb,
  type AgentScopeKind,
  type OpaqueRef,
} from "../../shared/agentHarness/values";
import { findDisallowedFields } from "./conformance";
import {
  reauthorizeGrantWithCtx,
  type AgentCapabilityRefusal,
  type DelegatedGrantConfig,
} from "./grants";
import type { AgentCapabilityRegistry } from "./registry";

/** Arguments a program may hand a port: bounded, JSON-only, no raw identifiers. */
export const AGENT_READ_ARGS_BYTE_CEILING = 64 * 1024;

// ---------------------------------------------------------------------------
// Invocation (what the kernel hands a port query): ids and arguments only
// ---------------------------------------------------------------------------

export const agentReadPortInvocationValidator = v.object({
  contractVersion: v.literal(1),
  runId: v.id("intelligenceRun"),
  grantId: v.id("agentRunGrant"),
  attemptId: v.id("agentProgramAttempt"),
  callId: v.id("agentCapabilityCall"),
  portKey: v.string(),
  capabilityId: v.string(),
  verb: v.union(v.literal("get"), v.literal("list")),
  args: v.record(v.string(), v.any()),
  cursor: v.optional(v.string()),
  grantedProjections: v.array(v.string()),
  authorizationEpoch: v.number(),
  admittedAt: v.number(),
});

export type AgentReadPortInvocation = Infer<typeof agentReadPortInvocationValidator>;

/** Field names of the invocation — there is no ctx, db, or scope in it. */
export const AGENT_READ_PORT_INVOCATION_FIELDS = Object.freeze(
  Object.fromEntries(Object.keys(agentReadPortInvocationValidator.fields).map((key) => [key, true])),
) as { readonly [K in keyof AgentReadPortInvocation]: true };

// ---------------------------------------------------------------------------
// Handler contract (what a domain-owned port implements)
// ---------------------------------------------------------------------------

export type AgentReadPortScope = {
  readonly kind: AgentScopeKind;
  readonly organizationId: Id<"organization">;
  readonly storeId?: Id<"store">;
};

export type AgentReadPortHandlerInput = {
  readonly portKey: string;
  readonly capabilityId: string;
  readonly verb: AgentReadVerb;
  /** Derived from the verified grant inside this transaction — never from arguments. */
  readonly scope: AgentReadPortScope;
  readonly args: { readonly [name: string]: JsonValue };
  /** Raw continuation cursor the port minted on the previous page, if any. */
  readonly cursor?: string;
  readonly pageIndex: number;
  /** The manifest's page bound; returning more is a contract violation. */
  readonly pageSize: number;
  readonly grantedProjections: readonly string[];
  readonly now: number;
};

export type AgentReadPortHandlerOutput =
  | {
      readonly kind: "data";
      readonly data: unknown;
      readonly observedAt: number;
      readonly freshness: {
        readonly class: AgentFreshnessClass;
        readonly authority: AgentFreshnessAuthority;
        readonly sourceVersion?: string;
        readonly staleAfter?: number;
      };
      readonly sources: readonly AgentSourceCompleteness[];
      readonly warnings?: readonly AgentWarning[];
      readonly sourceRefs: readonly AgentSourceRef[];
      /** `list` only: whether a further page exists and the raw cursor reaching it. */
      readonly page?: { readonly hasMore: boolean; readonly rawCursor: string | null };
    }
  | { readonly kind: "unavailable"; readonly reason: string; readonly retryable: boolean; readonly sourceKey?: string };

export type AgentReadPortHandler = (ctx: QueryCtx, input: AgentReadPortHandlerInput) => Promise<AgentReadPortHandlerOutput>;

export type AgentReadPortUsage = { readonly rows: number; readonly bytes: number };

/** What the port query returns to the kernel. Data travels only inside `envelope`. */
export type AgentReadPortResponse =
  | {
      readonly kind: "envelope";
      readonly envelope: AgentReadEnvelope<unknown>;
      readonly usage: AgentReadPortUsage;
      readonly grantedProjections: readonly string[];
      readonly authorizationEpoch: number;
    }
  | { readonly kind: "unavailable"; readonly reason: string; readonly retryable: boolean; readonly sourceKey?: string }
  | { readonly kind: "refused"; readonly stage: string; readonly reason: string; readonly result: AgentCapabilityRefusal }
  | { readonly kind: "failed"; readonly error: { readonly code: string; readonly message: string } };

// ---------------------------------------------------------------------------
// Registry: closed map portKey → { port, manifest, handler }
// ---------------------------------------------------------------------------

export type AgentReadPortHandlerReference = FunctionReference<"query", "internal">;

export type AgentReadPortInvocationBinding = {
  readonly portKey: string;
  readonly handler: AgentReadPortHandlerReference;
};

export type AgentReadPortBindingErrorCode =
  | "port_unregistered"
  | "handler_path_mismatch"
  | "binding_duplicate"
  | "handler_not_function_reference";

export class AgentReadPortBindingError extends Error {
  readonly code: AgentReadPortBindingErrorCode;
  readonly portKey: string;

  constructor(code: AgentReadPortBindingErrorCode, portKey: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "AgentReadPortBindingError";
    this.code = code;
    this.portKey = portKey;
  }
}

export type AgentBoundReadPort = {
  readonly port: AgentReadPortDefinition;
  readonly manifest: AgentCapabilityManifest;
  readonly handler: AgentReadPortHandlerReference;
  readonly handlerPath: string;
};

export type AgentReadPortRegistry = {
  readonly registry: AgentCapabilityRegistry;
  readonly bound: ReadonlyMap<string, AgentBoundReadPort>;
  /** Generated ports with no binding — unreachable until the composition root binds them. */
  listUnboundPorts(): string[];
};

function functionNameOf(handler: unknown): string | null {
  if (!handler || typeof handler !== "object") return null;
  try {
    const name = getFunctionName(handler as AgentReadPortHandlerReference);
    return typeof name === "string" && name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

/**
 * Build the closed dispatch map. Every binding must name a generated port and
 * carry a function reference whose name is EXACTLY the registered internal
 * path; anything else throws at composition time, before any request.
 */
export function createAgentReadPortRegistry(input: {
  readonly registry: AgentCapabilityRegistry;
  readonly bindings: readonly AgentReadPortInvocationBinding[];
}): AgentReadPortRegistry {
  const bound = new Map<string, AgentBoundReadPort>();
  for (const binding of input.bindings) {
    const port = input.registry.readPorts[binding.portKey];
    if (!port) {
      throw new AgentReadPortBindingError("port_unregistered", binding.portKey, `"${binding.portKey}" is not a generated read port.`);
    }
    if (bound.has(binding.portKey)) {
      throw new AgentReadPortBindingError("binding_duplicate", binding.portKey, `"${binding.portKey}" is bound twice.`);
    }
    const name = functionNameOf(binding.handler);
    if (name === null) {
      throw new AgentReadPortBindingError(
        "handler_not_function_reference",
        binding.portKey,
        `"${binding.portKey}" must be bound to an internal function reference.`,
      );
    }
    if (name !== port.handler.functionPath) {
      throw new AgentReadPortBindingError(
        "handler_path_mismatch",
        binding.portKey,
        `"${binding.portKey}" is registered as ${port.handler.functionPath} but was bound to ${name}.`,
      );
    }
    const manifest = input.registry.capabilities[port.capabilityId];
    if (!manifest) {
      throw new AgentReadPortBindingError("port_unregistered", binding.portKey, `"${binding.portKey}" serves no registered capability.`);
    }
    bound.set(binding.portKey, { port, manifest, handler: binding.handler, handlerPath: name });
  }
  return {
    registry: input.registry,
    bound,
    listUnboundPorts: () => Object.keys(input.registry.readPorts).filter((portKey) => !bound.has(portKey)).sort(),
  };
}

export type AgentReadPortResolution =
  | ({ readonly kind: "bound" } & AgentBoundReadPort)
  | { readonly kind: "unbound"; readonly portKey: string }
  | { readonly kind: "unregistered"; readonly portKey: string };

/** Lookup by key only. There is no other way to obtain a handler reference. */
export function resolveAgentReadPortHandler(ports: AgentReadPortRegistry, portKey: string): AgentReadPortResolution {
  const bound = ports.bound.get(portKey);
  if (bound) return { kind: "bound", ...bound };
  if (ports.registry.readPorts[portKey]) return { kind: "unbound", portKey };
  return { kind: "unregistered", portKey };
}

/** The one Convex capability the executor needs to reach a port: `runQuery`. */
export type AgentReadPortDispatchCtx = {
  runQuery: <Response>(reference: AgentReadPortHandlerReference, args: { invocation: AgentReadPortInvocation }) => Promise<Response>;
};

/**
 * Run an admitted invocation against the closed map. The executor's action
 * holds no handler reference and no `db`; it hands over the invocation the
 * admission mutation returned and gets the port's response back. An unbound
 * or unregistered port answers `unavailable`, never a throw.
 */
export async function dispatchAgentReadPort(
  ctx: AgentReadPortDispatchCtx,
  ports: AgentReadPortRegistry,
  invocation: AgentReadPortInvocation,
): Promise<AgentReadPortResponse> {
  const resolution = resolveAgentReadPortHandler(ports, invocation.portKey);
  if (resolution.kind !== "bound") {
    return { kind: "unavailable", reason: resolution.kind === "unbound" ? "port_unbound" : "port_unregistered", retryable: false };
  }
  return ctx.runQuery<AgentReadPortResponse>(resolution.handler, { invocation });
}

// ---------------------------------------------------------------------------
// Opaque cursors: bound to run and port, never carrying an identifier
// ---------------------------------------------------------------------------

const CURSOR_TOKEN_VERSION = "v1";

function toHex(value: string): string {
  return Array.from(new TextEncoder().encode(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): string | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function cursorBindingDigest(binding: { runId: string; portKey: string; rawCursor: string; pageIndex: number }): string {
  return hashCanonical({ cursor: CURSOR_TOKEN_VERSION, ...binding });
}

export function mintAgentCursor(input: { runId: string; portKey: string; rawCursor: string; pageIndex: number }): OpaqueRef<"cursor"> {
  const digest = cursorBindingDigest(input);
  return opaqueRef("cursor", `${CURSOR_TOKEN_VERSION}.${input.pageIndex}.${toHex(input.rawCursor)}.${digest}`);
}

export function resolveAgentCursor(
  ref: string,
  binding: { runId: string; portKey: string },
): { rawCursor: string; pageIndex: number } | null {
  const parsed = parseOpaqueRef(ref);
  if (!parsed || parsed.kind !== "cursor") return null;
  const parts = parsed.token.split(".");
  if (parts.length !== 4 || parts[0] !== CURSOR_TOKEN_VERSION) return null;
  const pageIndex = Number(parts[1]);
  if (!Number.isInteger(pageIndex) || pageIndex < 0) return null;
  const rawCursor = fromHex(parts[2]);
  if (rawCursor === null) return null;
  if (cursorBindingDigest({ runId: binding.runId, portKey: binding.portKey, rawCursor, pageIndex }) !== parts[3]) return null;
  return { rawCursor, pageIndex };
}

// ---------------------------------------------------------------------------
// Request argument validation (manifest filters only)
// ---------------------------------------------------------------------------

export type AgentReadArgsValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly issues: readonly AgentContractIssue[] };

function filterValueValid(schema: AgentFilterSchema, value: unknown): boolean {
  switch (schema.kind) {
    case "enum":
      return typeof value === "string" && schema.values.includes(value);
    case "opaqueRef":
      return isOpaqueRef(value, schema.refKind);
    case "operatingDate":
      return typeof value === "string" && isOperatingDate(value);
    case "string":
      return typeof value === "string" && !looksLikeRawDocumentId(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    default:
      return false;
  }
}

export function validateAgentReadRequestArgs(
  manifest: AgentCapabilityManifest,
  verb: AgentReadVerb,
  args: unknown,
): AgentReadArgsValidation {
  const issues: AgentContractIssue[] = [];
  const add = (code: string, path: string, message: string) => issues.push({ code, path, message });
  const operation = manifest.operations[verb];
  if (!operation) {
    add("verb_unsupported", "verb", `This capability does not support ${verb}.`);
    return { ok: false, issues };
  }
  if (!isPlainObject(args)) {
    add("args_invalid", "args", "Arguments must be a plain object.");
    return { ok: false, issues };
  }
  if (measureJsonByteLength(args) > AGENT_READ_ARGS_BYTE_CEILING) {
    add("args_too_large", "args", "Arguments exceed the size ceiling.");
    return { ok: false, issues };
  }
  const filters = operation.filters;
  for (const [name, value] of Object.entries(args)) {
    const schema = filters[name];
    if (!schema) {
      add("filter_unknown", name, `"${name}" is not a filter of this operation.`);
      continue;
    }
    if (value === undefined) continue;
    if (!filterValueValid(schema, value)) {
      const expectation = schema.kind === "enum" ? `must be one of: ${schema.values.join(", ")}` : `must be a ${schema.kind} value`;
      add("filter_value_invalid", name, `"${name}" ${expectation}.`);
    }
  }
  for (const [name, schema] of Object.entries(filters)) {
    if (schema.required && args[name] === undefined) {
      add("filter_required", name, `"${name}" is required.`);
    }
  }
  for (const finding of scanForRawIdentifiers(args)) {
    add("raw_identifier_in_args", finding, "Arguments may not carry raw identifiers.");
  }
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

// ---------------------------------------------------------------------------
// Envelope finishing: the last defense before data becomes program-visible
// ---------------------------------------------------------------------------

export type AgentReadEnvelopeContext = {
  readonly runId: string;
  readonly portKey: string;
  readonly pageIndex: number;
  readonly now: number;
};

export type AgentReadEnvelopeFinish =
  | { readonly kind: "envelope"; readonly envelope: AgentReadEnvelope<unknown>; readonly usage: AgentReadPortUsage }
  | Extract<AgentReadPortResponse, { kind: "unavailable" | "failed" }>;

function contractViolation(message: string, issues?: readonly AgentContractIssue[]): AgentReadEnvelopeFinish {
  const detail = issues && issues.length > 0 ? ` (${issues.map((issue) => `${issue.code}@${issue.path}`).join(", ")})` : "";
  return { kind: "failed", error: { code: "port_contract_violation", message: `${message}${detail}` } };
}

/** Hash of the sanitized result: content, completeness, refs, and page shape; never the wall clock or the cursor. */
export function computeReadResultHash(envelope: AgentReadEnvelope<unknown>): string {
  return hashCanonical({
    capabilityId: envelope.capabilityId,
    namespace: envelope.namespace,
    verb: envelope.verb,
    data: envelope.data,
    completeness: envelope.completeness,
    sourceRefs: envelope.sourceRefs.map((ref) => ({ ref: ref.ref, kind: ref.kind, version: ref.version, label: ref.label })),
    pagination: envelope.pagination
      ? { hasMore: envelope.pagination.hasMore, pageIndex: envelope.pagination.pageIndex, pageSize: envelope.pagination.pageSize }
      : undefined,
  });
}

/**
 * Turn a port's output into the uniform envelope under ONE grant: strip
 * ungranted fields, refuse undeclared fields and raw identifiers, enforce
 * page bounds and declared freshness/completeness vocabularies, mint the
 * next opaque cursor, and hash the sanitized result.
 */
export function finishAgentReadEnvelope(input: {
  readonly manifest: AgentCapabilityManifest;
  readonly port: AgentReadPortDefinition;
  readonly verb: AgentReadVerb;
  readonly grantedProjections: readonly string[];
  readonly output: AgentReadPortHandlerOutput;
  readonly context: AgentReadEnvelopeContext;
}): AgentReadEnvelopeFinish {
  const { manifest, port, verb, output, context } = input;
  if (output.kind === "unavailable") {
    return { kind: "unavailable", reason: output.reason, retryable: output.retryable, sourceKey: output.sourceKey };
  }
  const operation = manifest.operations[verb];
  if (!operation || !port.verbs.includes(verb)) return contractViolation(`The port does not serve ${verb}.`);

  if (verb === "list" && !Array.isArray(output.data)) return contractViolation("A list port must return an array.");
  if (verb === "get" && (!isPlainObject(output.data) || Array.isArray(output.data))) {
    return contractViolation("A get port must return one object.");
  }
  if (verb === "list" && operation.bounds.kind === "collection" && (output.data as unknown[]).length > operation.bounds.maxItemsPerPage) {
    return contractViolation(`The port returned more than ${operation.bounds.maxItemsPerPage} items on one page.`);
  }
  if (!manifest.freshness.classes.includes(output.freshness.class)) {
    return contractViolation(`Freshness class "${output.freshness.class}" is not declared by the manifest.`);
  }
  if (output.freshness.authority !== manifest.freshness.authority) {
    return contractViolation(`Freshness authority "${output.freshness.authority}" differs from the manifest.`);
  }
  const declaredSources = new Set(manifest.completeness.sourceKeys);
  for (const source of output.sources) {
    if (!declaredSources.has(source.sourceKey)) return contractViolation(`Completeness source "${source.sourceKey}" is not declared.`);
  }

  // Undeclared fields are a port bug, not something to silently drop.
  const declaredCheck = findDisallowedFields(manifest.result.fields, Object.keys(manifest.projections), output.data);
  if (declaredCheck.unknown.length > 0) {
    return contractViolation("The port returned fields the manifest does not declare.", declaredCheck.unknown.map((path) => ({ code: "unknown_field_present", path, message: path })));
  }
  const data = omitUngrantedFields(manifest.result.fields, input.grantedProjections, output.data);
  const grantedCheck = findDisallowedFields(manifest.result.fields, input.grantedProjections, data);
  if (grantedCheck.ungranted.length > 0 || grantedCheck.unknown.length > 0) {
    return contractViolation("Field omission left an ungranted field in place.");
  }
  const rawIdentifiers = scanForRawIdentifiers(data);
  if (rawIdentifiers.length > 0) {
    return contractViolation("The port leaked a raw identifier.", rawIdentifiers.map((path) => ({ code: "raw_identifier_in_result", path, message: path })));
  }

  const warnings: AgentWarning[] = [...(output.warnings ?? [])];
  const base = {
    contractVersion: 1 as const,
    capabilityId: manifest.capabilityId,
    namespace: namespacePath(manifest.namespace),
    data,
    observedAt: output.observedAt,
    capturedAt: context.now,
    freshness: {
      class: output.freshness.class,
      authority: output.freshness.authority,
      observedAt: output.observedAt,
      capturedAt: context.now,
      sourceVersion: output.freshness.sourceVersion,
      staleAfter: output.freshness.staleAfter,
    },
    completeness: deriveCompleteness(output.sources),
    sourceRefs: output.sourceRefs,
  };

  let envelope: AgentReadEnvelope<unknown>;
  if (verb === "list") {
    const maxPages = operation.bounds.kind === "collection" ? operation.bounds.maxPagesPerRun : 1;
    const nextIndex = context.pageIndex + 1;
    const pagesRemainingInRun = Math.max(0, maxPages - nextIndex);
    const wantsMore = output.page?.hasMore === true && typeof output.page.rawCursor === "string";
    const hasMore = wantsMore && pagesRemainingInRun > 0;
    if (wantsMore && !hasMore) {
      warnings.push({ code: "page_budget_exhausted", message: "More results exist, but this run's page budget for the capability is spent." });
    }
    envelope = {
      ...base,
      data: data as readonly unknown[],
      verb: "list",
      warnings,
      pagination: {
        cursor: hasMore
          ? mintAgentCursor({ runId: context.runId, portKey: context.portKey, rawCursor: output.page!.rawCursor as string, pageIndex: nextIndex })
          : undefined,
        hasMore,
        pageIndex: context.pageIndex,
        pageSize: (data as unknown[]).length,
        pagesRemainingInRun,
      },
    };
  } else {
    envelope = { ...base, verb: "get", warnings, pagination: undefined };
  }

  const validation = validateReadEnvelope(envelope);
  if (!validation.ok) return contractViolation("The finished envelope is invalid.", validation.issues);
  const resultHash = computeReadResultHash(envelope);
  const finished = { ...envelope, resultHash };
  return {
    kind: "envelope",
    envelope: finished,
    usage: { rows: verb === "list" ? (data as unknown[]).length : 1, bytes: measureJsonByteLength(finished) },
  };
}

// ---------------------------------------------------------------------------
// Port query definer: the only way to produce a dispatchable port
// ---------------------------------------------------------------------------

export type AgentReadPortQueryConfig = DelegatedGrantConfig & {
  readonly readPorts: AgentReadPortRegistry;
};

export type AgentReadPortQuerySpec = {
  readonly portKey: string;
  readonly handler: AgentReadPortHandler;
};

function refusedResponse(stage: string, reason: string, result: AgentCapabilityRefusal): AgentReadPortResponse {
  return { kind: "refused", stage, reason, result };
}

const invalidInvocation = (reason: string, message: string): AgentReadPortResponse =>
  refusedResponse("invocation", reason, { kind: "denied", code: "invalid_arguments", message, retryable: false });

/**
 * Wrap a domain-owned handler as the registered internal query for one port.
 * Inside the query's own transaction it reauthorizes the run, verifies the
 * invocation names a call this run admitted for this port, derives the scope
 * and projections from the verified grant (ignoring whatever the invocation
 * claims), validates the arguments again, and finishes the envelope.
 *
 * Throws at definition time for a port the generated registry does not name,
 * so a mis-keyed port module fails the push instead of serving nothing.
 */
export function createAgentReadPortQueryDefiner(config: AgentReadPortQueryConfig) {
  return function defineAgentReadPortQuery(spec: AgentReadPortQuerySpec) {
    const port = config.registry.readPorts[spec.portKey];
    const manifest = port ? config.registry.capabilities[port.capabilityId] : undefined;
    if (!port || !manifest) {
      throw new AgentReadPortBindingError("port_unregistered", spec.portKey, `"${spec.portKey}" is not a generated read port.`);
    }
    return internalQuery({
      args: { invocation: agentReadPortInvocationValidator },
      handler: async (ctx, { invocation }): Promise<AgentReadPortResponse> => {
        const now = config.now?.() ?? Date.now();
        if (invocation.portKey !== port.portKey || invocation.capabilityId !== port.capabilityId) {
          return invalidInvocation("port_mismatch", "The invocation names a different port.");
        }
        if (!port.verbs.includes(invocation.verb)) {
          return refusedResponse("invocation", "verb_unsupported", { kind: "denied", code: "unsupported_verb", message: "This port does not serve that verb.", retryable: false });
        }
        const call = await ctx.db.get("agentCapabilityCall", invocation.callId);
        if (
          !call ||
          call.runId !== invocation.runId ||
          call.attemptId !== invocation.attemptId ||
          call.capabilityId !== port.capabilityId ||
          (call.status !== "admitted" && call.status !== "executing")
        ) {
          return invalidInvocation("call_not_admitted", "The invocation does not name an admitted call of this run.");
        }
        const verdict = await reauthorizeGrantWithCtx(ctx, config, {
          runId: invocation.runId,
          purpose: "dispatch",
          capabilityId: port.capabilityId,
          now,
        });
        if (verdict.kind === "refused") return refusedResponse(verdict.stage, verdict.reason, verdict.result);
        if (verdict.grant._id !== invocation.grantId) {
          return invalidInvocation("grant_mismatch", "The invocation names a different grant.");
        }
        const argsValidation = validateAgentReadRequestArgs(manifest, invocation.verb, invocation.args);
        if (!argsValidation.ok) {
          // Same wording contract as delegated admission: the message is what
          // a model reads, and a denial that hides the offending argument is
          // what makes it guess again.
          const detail = argsValidation.issues.map((issue) => `${issue.code} at ${issue.path}`).join("; ");
          return invalidInvocation("args_invalid", `The arguments do not match the capability's filters (${detail}).`);
        }
        let rawCursor: string | undefined;
        let pageIndex = 0;
        if (invocation.cursor !== undefined) {
          const resolved = resolveAgentCursor(invocation.cursor, { runId: invocation.runId, portKey: port.portKey });
          if (!resolved) return invalidInvocation("cursor_invalid", "The cursor does not belong to this run and port.");
          rawCursor = resolved.rawCursor;
          pageIndex = resolved.pageIndex;
        }
        const operation = manifest.operations[invocation.verb];
        const pageSize = operation && operation.bounds.kind === "collection" ? operation.bounds.maxItemsPerPage : 1;
        const output = await spec.handler(ctx, {
          portKey: port.portKey,
          capabilityId: port.capabilityId,
          verb: invocation.verb,
          scope: verdict.scope,
          args: invocation.args as { readonly [name: string]: JsonValue },
          cursor: rawCursor,
          pageIndex,
          pageSize,
          grantedProjections: verdict.grantedProjections,
          now,
        });
        const finished = finishAgentReadEnvelope({
          manifest,
          port,
          verb: invocation.verb,
          grantedProjections: verdict.grantedProjections,
          output,
          context: { runId: invocation.runId, portKey: port.portKey, pageIndex, now },
        });
        if (finished.kind !== "envelope") return finished;
        return { ...finished, grantedProjections: [...verdict.grantedProjections], authorizationEpoch: verdict.authorizationEpoch };
      },
    });
  };
}

export type AgentReadPortQueryDefiner = ReturnType<typeof createAgentReadPortQueryDefiner>;
