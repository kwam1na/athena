/**
 * Uniform result semantics of the Athena capability SDK (browser-safe).
 *
 * Every capability read returns the same envelope: sanitized data, observed
 * and captured time, a freshness classification, per-source completeness,
 * pagination for `list`, warnings, and opaque source references (plan decision
 * 7, R16). Inside the data, a field may carry an explicit value state so that
 * unknown, unavailable, stale, and partial stay distinct typed outcomes.
 * Unauthorized is deliberately NOT a value state: an unauthorized field is
 * structurally absent from the projected type and from the payload, never a
 * sentinel, a zero, or `null`.
 */
import {
  AGENT_HARNESS_CONTRACT_VERSION,
  isNonNegativeInteger,
  isOneOf,
  isOpaqueRef,
  isPlainObject,
  isRawIdentifierFieldName,
  looksLikeRawDocumentId,
  AGENT_COMPLETENESS_STATUSES,
  AGENT_FRESHNESS_AUTHORITIES,
  AGENT_FRESHNESS_CLASSES,
  AGENT_READ_VERBS,
  type AgentCompletenessStatus,
  type AgentContractIssue,
  type AgentFreshnessAuthority,
  type AgentFreshnessClass,
  type AgentHarnessContractVersion,
  type AgentReadVerb,
  type OpaqueRef,
  type Timestamp,
} from "./values";

// ---------------------------------------------------------------------------
// Value states (scenario 3)
// ---------------------------------------------------------------------------

export const AGENT_UNKNOWN_REASONS = [
  "not_recorded",
  "not_applicable",
  "not_yet_available",
] as const;
export type AgentUnknownReason = (typeof AGENT_UNKNOWN_REASONS)[number];

export type AgentValueState<T> =
  | { readonly state: "known"; readonly value: T }
  | { readonly state: "unknown"; readonly reason: AgentUnknownReason }
  | {
      readonly state: "unavailable";
      readonly reason: string;
      readonly retryable: boolean;
    }
  | {
      readonly state: "stale";
      readonly value: T;
      readonly asOf: Timestamp;
      readonly staleAfter: Timestamp;
    }
  | { readonly state: "partial"; readonly value: T; readonly missing: readonly string[] };

export function known<T>(value: T): AgentValueState<T> {
  return { state: "known", value };
}

export function unknown<T = never>(reason: AgentUnknownReason): AgentValueState<T> {
  return { state: "unknown", reason };
}

export function unavailable<T = never>(
  reason: string,
  options: { retryable?: boolean } = {},
): AgentValueState<T> {
  return { state: "unavailable", reason, retryable: options.retryable ?? false };
}

export function stale<T>(
  value: T,
  window: { asOf: Timestamp; staleAfter: Timestamp },
): AgentValueState<T> {
  return { state: "stale", value, asOf: window.asOf, staleAfter: window.staleAfter };
}

export function partial<T>(value: T, options: { missing: readonly string[] }): AgentValueState<T> {
  return { state: "partial", value, missing: options.missing };
}

/** Known, stale, and partial values are usable (with their caveats). */
export function isUsableValue<T>(
  state: AgentValueState<T>,
): state is Extract<AgentValueState<T>, { value: T }> {
  return state.state === "known" || state.state === "stale" || state.state === "partial";
}

// ---------------------------------------------------------------------------
// Freshness, completeness, pagination, warnings, source refs
// ---------------------------------------------------------------------------

export type AgentFreshness = {
  readonly class: AgentFreshnessClass;
  readonly authority: AgentFreshnessAuthority;
  readonly observedAt: Timestamp;
  readonly capturedAt: Timestamp;
  readonly sourceVersion?: string;
  readonly staleAfter?: Timestamp;
};

export type AgentSourceCompleteness = {
  readonly sourceKey: string;
  readonly status: AgentCompletenessStatus;
  readonly reason?: string;
  readonly missing?: readonly string[];
  readonly capturedAt?: Timestamp;
};

export type AgentCompleteness = {
  readonly status: "complete" | "partial";
  readonly sources: readonly AgentSourceCompleteness[];
};

/**
 * Aggregate completeness is the minimum across contributing sources. With no
 * sources nothing was covered, so the aggregate is partial: completeness may
 * be downgraded but never overstated (R16).
 */
export function deriveCompleteness(sources: readonly AgentSourceCompleteness[]): AgentCompleteness {
  const complete = sources.length > 0 && sources.every((source) => source.status === "complete");
  return { status: complete ? "complete" : "partial", sources };
}

export function mergeCompleteness(
  ...parts: readonly AgentCompleteness[]
): AgentCompleteness {
  return deriveCompleteness(parts.flatMap((part) => part.sources));
}

export type AgentPagination = {
  readonly cursor?: OpaqueRef<"cursor">;
  readonly hasMore: boolean;
  readonly pageIndex: number;
  readonly pageSize: number;
  readonly pagesRemainingInRun: number;
};

export type AgentWarning = {
  readonly code: string;
  readonly message: string;
  readonly sourceKey?: string;
};

export type AgentSourceRef = {
  readonly ref: OpaqueRef<"source">;
  readonly kind: string;
  readonly label?: string;
  readonly version?: string;
  readonly capturedAt: Timestamp;
};

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export type AgentReadEnvelopeBase<Data> = {
  readonly contractVersion: AgentHarnessContractVersion;
  readonly capabilityId: string;
  readonly namespace: string;
  readonly verb: AgentReadVerb;
  readonly data: Data;
  readonly observedAt: Timestamp;
  readonly capturedAt: Timestamp;
  readonly freshness: AgentFreshness;
  readonly completeness: AgentCompleteness;
  readonly warnings: readonly AgentWarning[];
  readonly sourceRefs: readonly AgentSourceRef[];
  readonly resultHash?: string;
};

export type AgentGetEnvelope<Data> = AgentReadEnvelopeBase<Data> & {
  readonly verb: "get";
  readonly pagination?: undefined;
};

export type AgentListEnvelope<Item> = AgentReadEnvelopeBase<readonly Item[]> & {
  readonly verb: "list";
  readonly pagination: AgentPagination;
};

export type AgentReadEnvelope<Data> = AgentGetEnvelope<Data> | AgentListEnvelope<Data>;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Walk a sanitized payload and report every raw identifier: id-shaped field
 * names and values that look like Convex document ids. Opaque refs are
 * exempt by construction (their tokens are validated when minted).
 */
export function scanForRawIdentifiers(value: unknown, basePath = ""): string[] {
  const findings: string[] = [];
  const visit = (node: unknown, path: string) => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (isPlainObject(node)) {
      for (const [key, child] of Object.entries(node)) {
        const childPath = path ? `${path}.${key}` : key;
        if (isRawIdentifierFieldName(key)) findings.push(`${childPath} (field name)`);
        visit(child, childPath);
      }
      return;
    }
    if (looksLikeRawDocumentId(node)) findings.push(`${path || "$"} (value)`);
  };
  visit(value, basePath);
  return findings;
}

export type AgentEnvelopeValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly issues: readonly AgentContractIssue[] };

export function validateReadEnvelope(envelope: unknown): AgentEnvelopeValidation {
  const issues: AgentContractIssue[] = [];
  const issue = (code: string, path: string, message: string) => issues.push({ code, path, message });
  if (!isPlainObject(envelope)) {
    issue("envelope_invalid", "$", "Envelope must be a plain object.");
    return { ok: false, issues };
  }
  if (envelope.contractVersion !== AGENT_HARNESS_CONTRACT_VERSION) {
    issue("contract_version_unsupported", "contractVersion", "Unsupported envelope contract version.");
  }
  if (!isOneOf(AGENT_READ_VERBS, envelope.verb)) {
    issue("unsupported_verb", "verb", "Envelope verb must be get or list.");
  }
  if (typeof envelope.capabilityId !== "string" || typeof envelope.namespace !== "string") {
    issue("metadata_incomplete", "capabilityId", "Envelope must name its capability and namespace.");
  }
  if (!isNonNegativeInteger(envelope.observedAt) || !isNonNegativeInteger(envelope.capturedAt)) {
    issue("time_missing", "observedAt", "Envelope must carry observed and captured time.");
  }
  const freshness = envelope.freshness;
  if (
    !isPlainObject(freshness) ||
    !isOneOf(AGENT_FRESHNESS_CLASSES, freshness.class) ||
    !isOneOf(AGENT_FRESHNESS_AUTHORITIES, freshness.authority)
  ) {
    issue("freshness_invalid", "freshness", "Envelope freshness must use the v1 classes and authorities.");
  }
  const completeness = envelope.completeness;
  if (
    !isPlainObject(completeness) ||
    !Array.isArray(completeness.sources) ||
    (completeness.status !== "complete" && completeness.status !== "partial")
  ) {
    issue("completeness_invalid", "completeness", "Envelope completeness must list per-source coverage.");
  } else {
    const sources = completeness.sources as unknown[];
    const allComplete =
      sources.length > 0 &&
      sources.every((source) => isPlainObject(source) && source.status === "complete");
    if (completeness.status === "complete" && !allComplete) {
      issue("completeness_overstated", "completeness.status", "Aggregate completeness exceeds its sources.");
    }
    sources.forEach((source, index) => {
      if (!isPlainObject(source) || !isOneOf(AGENT_COMPLETENESS_STATUSES, source.status)) {
        issue("completeness_invalid", `completeness.sources[${index}]`, "Unknown source completeness status.");
      }
    });
  }
  if (!Array.isArray(envelope.warnings)) {
    issue("warnings_invalid", "warnings", "Envelope warnings must be an array.");
  }
  if (!Array.isArray(envelope.sourceRefs)) {
    issue("source_refs_invalid", "sourceRefs", "Envelope source refs must be an array.");
  } else {
    (envelope.sourceRefs as unknown[]).forEach((sourceRef, index) => {
      if (!isPlainObject(sourceRef) || !isOpaqueRef(sourceRef.ref, "source")) {
        issue("source_ref_not_opaque", `sourceRefs[${index}].ref`, "Source refs must be opaque source refs.");
      }
    });
  }
  if (envelope.verb === "list") {
    if (!Array.isArray(envelope.data)) {
      issue("list_data_invalid", "data", "List envelopes carry an array of items.");
    }
    const pagination = envelope.pagination;
    if (!isPlainObject(pagination)) {
      issue("pagination_missing", "pagination", "List envelopes must carry pagination.");
    } else {
      if (typeof pagination.hasMore !== "boolean") {
        issue("pagination_invalid", "pagination.hasMore", "hasMore must be boolean.");
      }
      if (pagination.hasMore && !isOpaqueRef(pagination.cursor, "cursor")) {
        issue("pagination_invalid", "pagination.cursor", "A page with more results must carry an opaque cursor.");
      }
      if (
        !isNonNegativeInteger(pagination.pageIndex) ||
        !isNonNegativeInteger(pagination.pageSize) ||
        !isNonNegativeInteger(pagination.pagesRemainingInRun)
      ) {
        issue("pagination_invalid", "pagination", "Pagination counters must be non-negative integers.");
      }
    }
  } else if (envelope.pagination !== undefined) {
    issue("pagination_unexpected", "pagination", "Get envelopes carry no pagination.");
  }
  for (const finding of scanForRawIdentifiers(envelope.data)) {
    issue("raw_identifier_in_result", `data.${finding}`, `Raw identifier leaked into result data: ${finding}`);
  }
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}
