/**
 * Reusable capability conformance harness (kernel; product-neutral).
 *
 * A capability may not be enabled until it demonstrably behaves the way its
 * manifest claims. `runCapabilityConformance` is the single gate the generator
 * and every domain package run: it checks the static manifest/port binding plus
 * the behavioral dimensions the plan names — scope isolation, field omission,
 * pagination and snapshot bounds, freshness, completeness sources, evidence
 * extraction, determinism, and budget accounting — against probe observations
 * supplied by the domain.
 *
 * Evidence extraction is deliberately fail-closed: an extractor must be
 * deterministic, must not read ambient state, and may only emit fields the
 * caller was already authorized to see. When no extractor is registered, the
 * transform is unsupported, or the slice would exceed authorization, the
 * citation becomes `provenance_only` — the state U1's evidence lifecycle
 * records once the short-lived replay payload expires.
 */
import { AGENT_BUDGET_DIMENSIONS, type BudgetVector } from "../../shared/agentHarness/execution";
import {
  namespacePath,
  supportedVerbs,
  type AgentCapabilityManifest,
  type AgentFieldRecord,
  type JsonValue,
} from "../../shared/agentHarness/manifest";
import {
  validateReadEnvelope,
  scanForRawIdentifiers,
  type AgentReadEnvelope,
} from "../../shared/agentHarness/results";
import {
  validateReadPortIndex,
  type AgentReadPortDefinition,
} from "../../shared/agentHarness/readPort";
import { hashCanonical } from "../../shared/agentHarness/agentRuntime";
import { isPlainObject, type AgentContractIssue, type AgentReadVerb } from "../../shared/agentHarness/values";
import { isAthenaReadIntent } from "../platform/readIntentCatalog";
import { assertManifestConformance, type AgentRegistryValidation } from "./registry";

// ---------------------------------------------------------------------------
// Field authorization walk (shared by the omission and extractor checks)
// ---------------------------------------------------------------------------

export type AgentFieldFindings = {
  /** Paths bound to a projection the grant does not hold. */
  readonly ungranted: readonly string[];
  /** Paths the manifest never declared. */
  readonly unknown: readonly string[];
};

/**
 * Walk sanitized data against the manifest field record and report every path
 * that is not authorized under the granted projections. This is the runtime
 * mirror of `ProjectedShape`: an unauthorized field must be absent, never
 * zeroed or nulled.
 */
export function findDisallowedFields(
  fields: AgentFieldRecord,
  grantedProjections: readonly string[],
  data: unknown,
): AgentFieldFindings {
  const granted = new Set(grantedProjections);
  const ungranted: string[] = [];
  const unknown: string[] = [];

  const walk = (schema: AgentFieldRecord, value: unknown, path: string) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(schema, item, `${path}[${index}]`));
      return;
    }
    if (!isPlainObject(value)) return;
    for (const [name, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${name}` : name;
      const fieldSchema = schema[name];
      if (!fieldSchema) {
        unknown.push(childPath);
        continue;
      }
      if (fieldSchema.projection !== undefined && !granted.has(fieldSchema.projection)) {
        ungranted.push(childPath);
        continue;
      }
      if (fieldSchema.kind === "object") {
        walk(fieldSchema.fields, unwrapValueState(child), childPath);
      } else if (fieldSchema.kind === "array" && fieldSchema.items.kind === "object") {
        walk(fieldSchema.items.fields, unwrapValueState(child), childPath);
      }
    }
  };

  walk(fields, data, "");
  return { ungranted, unknown };
}

/** A field may be wrapped in an explicit value state; authorization looks through it. */
function unwrapValueState(value: unknown): unknown {
  if (isPlainObject(value) && typeof value.state === "string" && "value" in value) return value.value;
  return value;
}

// ---------------------------------------------------------------------------
// Evidence extraction
// ---------------------------------------------------------------------------

export type AgentEvidenceExtractorInput = {
  readonly capabilityId: string;
  readonly verb: AgentReadVerb;
  /** Hash of the capability call result the slice is bound to. */
  readonly resultHash: string;
  /** Already-projected, already-omitted result data. */
  readonly data: unknown;
  readonly grantedProjections: readonly string[];
  readonly claimShape: string;
};

/**
 * Explicitly tagged so a result payload that happens to carry a field named
 * `unsupported` can never be mistaken for a refusal.
 */
export type AgentEvidenceExtractorOutput =
  | { readonly claim: JsonValue }
  | { readonly unsupported: string };

/**
 * A deterministic, pure function registered alongside a manifest. It receives
 * only authorized data and returns the minimal slice that substantiates one
 * declared claim shape, or an explicit `unsupported` reason.
 */
export type AgentEvidenceExtractor = {
  readonly extractorKey: string;
  readonly extractorVersion: string;
  readonly claimShapes: readonly string[];
  readonly extract: (input: AgentEvidenceExtractorInput) => AgentEvidenceExtractorOutput;
};

export type AgentEvidenceExtraction =
  | {
      readonly kind: "claim_support";
      readonly extractorKey: string;
      readonly extractorVersion: string;
      readonly claimShape: string;
      readonly slice: JsonValue;
      /** Binds the slice to the exact call result it was taken from. */
      readonly sliceDigest: string;
      readonly resultHash: string;
    }
  | { readonly kind: "provenance_only"; readonly reason: string };

const AMBIENT_STATE_MARKERS = [
  "Date.now",
  "new Date",
  "Math.random",
  "performance.now",
  "crypto.",
  "globalThis",
  "process.",
] as const;

function provenanceOnly(reason: string): AgentEvidenceExtraction {
  return { kind: "provenance_only", reason };
}

/**
 * Run the registered extractor for one claim shape, fail-closed. Any missing,
 * mismatched, unsupported, or over-reaching extraction downgrades the citation
 * to provenance-only rather than emitting an unverifiable or over-authorized
 * slice.
 */
export function extractClaimSupport(
  manifest: AgentCapabilityManifest,
  extractor: AgentEvidenceExtractor | undefined,
  input: AgentEvidenceExtractorInput,
): AgentEvidenceExtraction {
  const policy = manifest.evidence;
  if (policy.mode !== "extractor") return provenanceOnly(policy.reason);
  if (!extractor) return provenanceOnly("extractor_not_registered");
  if (extractor.extractorKey !== policy.extractorKey) return provenanceOnly("extractor_key_mismatch");
  if (extractor.extractorVersion !== policy.extractorVersion) {
    return provenanceOnly("extractor_version_mismatch");
  }
  if (!policy.claimShapes.includes(input.claimShape) || !extractor.claimShapes.includes(input.claimShape)) {
    return provenanceOnly("claim_shape_not_declared");
  }

  let output: AgentEvidenceExtractorOutput;
  try {
    output = extractor.extract(input);
  } catch {
    return provenanceOnly("extractor_failed");
  }
  if ("unsupported" in output) return provenanceOnly(output.unsupported);
  const slice = output.claim;
  if (scanForRawIdentifiers(slice).length > 0) return provenanceOnly("extractor_leaked_raw_identifier");
  const findings = findDisallowedFields(manifest.result.fields, input.grantedProjections, slice);
  if (findings.ungranted.length > 0 || findings.unknown.length > 0) {
    return provenanceOnly("extractor_field_not_authorized");
  }
  return {
    kind: "claim_support",
    extractorKey: extractor.extractorKey,
    extractorVersion: extractor.extractorVersion,
    claimShape: input.claimShape,
    slice,
    sliceDigest: hashCanonical({
      capabilityId: input.capabilityId,
      claimShape: input.claimShape,
      extractorKey: extractor.extractorKey,
      extractorVersion: extractor.extractorVersion,
      resultHash: input.resultHash,
      slice,
    }),
    resultHash: input.resultHash,
  };
}

// ---------------------------------------------------------------------------
// Conformance probes
// ---------------------------------------------------------------------------

export type AgentConformanceProbe = {
  readonly label: string;
  readonly verb: AgentReadVerb;
  readonly args: { readonly [name: string]: JsonValue };
  /** Opaque scope the probe was executed under (`store:…`, `organization:…`). */
  readonly scopeRef: string;
  readonly grantedProjections: readonly string[];
  readonly envelope: AgentReadEnvelope<unknown>;
  /** True when the probe reads a scope the caller must not see: it must return nothing. */
  readonly foreignScope?: boolean;
  /** A second observation of the same call; must be identical apart from observed time. */
  readonly repeat?: AgentReadEnvelope<unknown>;
  readonly budget: { readonly requested: BudgetVector; readonly settled: BudgetVector };
};

export type AgentConformanceInput = {
  readonly manifest: AgentCapabilityManifest;
  readonly port: AgentReadPortDefinition;
  readonly probes: readonly AgentConformanceProbe[];
  readonly extractor?: AgentEvidenceExtractor;
};

/**
 * What a probe actually observed. A snapshot with no fields observed nothing:
 * unauthorized and out-of-scope data is structurally ABSENT, so the honest
 * answer to "one store this organization does not own" is an empty snapshot
 * whose sources report `unavailable` — not a null body (a `get` port must
 * return an object) and not a zeroed one.
 */
function envelopeItems(envelope: AgentReadEnvelope<unknown>): readonly unknown[] {
  const data = envelope.data;
  if (Array.isArray(data)) return data;
  if (data === undefined || data === null) return [];
  if (typeof data === "object" && Object.keys(data as Record<string, unknown>).length === 0) return [];
  return [data];
}

/** Canonical form of an observation, ignoring the wall clock. */
function observationDigest(envelope: AgentReadEnvelope<unknown>): string {
  const { observedAt: _observedAt, freshness, ...rest } = envelope as Record<string, unknown> & {
    freshness: { observedAt?: number };
  };
  const { observedAt: _freshObservedAt, ...freshnessRest } = freshness ?? {};
  return hashCanonical({ ...rest, freshness: freshnessRest });
}

/**
 * The conformance gate. Every issue it reports blocks enabling the capability.
 */
export function runCapabilityConformance(input: AgentConformanceInput): AgentRegistryValidation {
  const issues: AgentContractIssue[] = [];
  const { manifest, port, probes, extractor } = input;
  const base = namespacePath(manifest.namespace);
  const add = (code: string, path: string, message: string) => issues.push({ code, path, message });

  // Static binding: the port must serve exactly this manifest.
  const binding = validateReadPortIndex({ contractVersion: 1, ports: [port] }, [manifest], {
    isKnownReadIntent: isAthenaReadIntent,
  });
  if (!binding.ok) issues.push(...binding.issues);

  // Every declared verb needs at least one probe.
  const verbs = supportedVerbs(manifest);
  for (const verb of verbs) {
    if (!probes.some((probe) => probe.verb === verb && probe.foreignScope !== true)) {
      add(
        "conformance_probe_missing",
        `${base}.operations.${verb}`,
        `No in-scope conformance probe exercises \`${verb}\`; a capability cannot be enabled unproven.`,
      );
    }
  }

  probes.forEach((probe, index) => {
    const path = `${base}.probes[${index}] (${probe.label})`;
    const envelope = probe.envelope;

    const envelopeValidation = validateReadEnvelope(envelope);
    if (!envelopeValidation.ok) {
      issues.push(...envelopeValidation.issues.map((issue) => ({ ...issue, path: `${path}.${issue.path}` })));
    }
    if (envelope.capabilityId !== manifest.capabilityId || envelope.namespace !== base) {
      add("envelope_identity_mismatch", path, "The envelope must name the capability it came from.");
    }
    if (envelope.verb !== probe.verb) {
      add("envelope_identity_mismatch", path, "The envelope verb must match the probe verb.");
    }
    if (manifest.operations[probe.verb] === undefined) {
      add("unsupported_verb", path, `The manifest declares no \`${probe.verb}\` operation.`);
      return;
    }

    // Scope isolation: a probe outside the caller's scope must return nothing.
    if (probe.foreignScope === true) {
      if (envelopeItems(envelope).length > 0) {
        add(
          "scope_isolation_violated",
          path,
          `Reading ${probe.scopeRef} returned rows the caller is not scoped to.`,
        );
      }
    }

    // Field omission: nothing outside the granted projections may be present.
    const findings = findDisallowedFields(manifest.result.fields, probe.grantedProjections, envelope.data);
    for (const field of findings.ungranted) {
      add("ungranted_field_present", `${path}.data.${field}`, "A field bound to an ungranted projection is present.");
    }
    for (const field of findings.unknown) {
      add("unknown_field_present", `${path}.data.${field}`, "The result carries a field the manifest never declared.");
    }

    // Bounds: pagination for collections, embedded caps for snapshots.
    if (probe.verb === "list") {
      const bounds = manifest.operations.list?.bounds;
      const items = envelopeItems(envelope);
      if (bounds) {
        if (items.length > bounds.maxItemsPerPage) {
          add(
            "pagination_bounds_exceeded",
            `${path}.data`,
            `A page returned ${items.length} items; the manifest caps a page at ${bounds.maxItemsPerPage}.`,
          );
        }
        const pagination = envelope.pagination;
        if (pagination && pagination.pagesRemainingInRun > bounds.maxPagesPerRun) {
          add(
            "pagination_bounds_exceeded",
            `${path}.pagination`,
            `Pages remaining exceeds the manifest cap of ${bounds.maxPagesPerRun}.`,
          );
        }
        if (pagination && pagination.pageSize > bounds.maxItemsPerPage) {
          add("pagination_bounds_exceeded", `${path}.pagination.pageSize`, "Page size exceeds the manifest cap.");
        }
      }
    } else {
      const bounds = manifest.operations.get?.bounds;
      const embedded = countEmbeddedItems(envelope.data);
      if (bounds?.maxEmbeddedItems !== undefined && embedded > bounds.maxEmbeddedItems) {
        add(
          "snapshot_bounds_exceeded",
          `${path}.data`,
          `The snapshot embeds ${embedded} items; the manifest caps it at ${bounds.maxEmbeddedItems}.`,
        );
      }
    }

    // Freshness must stay inside the declared vocabulary.
    if (!manifest.freshness.classes.includes(envelope.freshness.class)) {
      add(
        "freshness_undeclared",
        `${path}.freshness.class`,
        `"${envelope.freshness.class}" is not one of the manifest's declared freshness classes.`,
      );
    }
    if (envelope.freshness.authority !== manifest.freshness.authority) {
      add(
        "freshness_authority_mismatch",
        `${path}.freshness.authority`,
        "The envelope authority differs from the manifest authority.",
      );
    }

    // Completeness must be reported per declared source.
    const declaredSources = new Set(manifest.completeness.sourceKeys);
    for (const source of envelope.completeness.sources) {
      if (!declaredSources.has(source.sourceKey)) {
        add(
          "completeness_sources_mismatch",
          `${path}.completeness`,
          `Source "${source.sourceKey}" is not declared by the manifest.`,
        );
      }
    }
    const reported = new Set(envelope.completeness.sources.map((source) => source.sourceKey));
    for (const sourceKey of declaredSources) {
      if (!reported.has(sourceKey)) {
        add(
          "completeness_sources_mismatch",
          `${path}.completeness`,
          `Declared source "${sourceKey}" has no completeness entry.`,
        );
      }
    }

    // Determinism: the same call observed twice must be the same result.
    if (probe.repeat && observationDigest(probe.repeat) !== observationDigest(envelope)) {
      add(
        "result_not_deterministic",
        path,
        "Two observations of the same call differ beyond observed time.",
      );
    }

    // Budget accounting: settled ≤ requested ≤ declared worst case.
    for (const dimension of AGENT_BUDGET_DIMENSIONS) {
      const declared = manifest.cost.worstCasePerCall[dimension];
      const requested = probe.budget.requested[dimension];
      const settled = probe.budget.settled[dimension];
      if (requested > declared) {
        add(
          "budget_over_declared",
          `${path}.budget.requested.${dimension}`,
          `Reserved ${requested} ${dimension} beyond the declared worst case of ${declared}.`,
        );
      }
      if (settled > requested) {
        add(
          "budget_overspent",
          `${path}.budget.settled.${dimension}`,
          `Settled ${settled} ${dimension} against a reservation of ${requested}.`,
        );
      }
    }
  });

  issues.push(...evidenceIssues(manifest, extractor, probes, base));

  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

function countEmbeddedItems(data: unknown): number {
  let count = 0;
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      count += value.length;
      value.forEach(visit);
      return;
    }
    if (isPlainObject(value)) Object.values(value).forEach(visit);
  };
  visit(data);
  return count;
}

function evidenceIssues(
  manifest: AgentCapabilityManifest,
  extractor: AgentEvidenceExtractor | undefined,
  probes: readonly AgentConformanceProbe[],
  base: string,
): AgentContractIssue[] {
  const issues: AgentContractIssue[] = [];
  const add = (code: string, message: string) => issues.push({ code, path: `${base}.evidence`, message });
  const policy = manifest.evidence;

  if (policy.mode !== "extractor") {
    if (extractor) {
      add(
        "evidence_extractor_unexpected",
        "The manifest declares provenance-only evidence but an extractor was registered.",
      );
    }
    return issues;
  }

  if (!extractor) {
    add(
      "evidence_extractor_missing",
      `The manifest declares extractor "${policy.extractorKey}" but none is registered.`,
    );
    return issues;
  }
  if (extractor.extractorKey !== policy.extractorKey || extractor.extractorVersion !== policy.extractorVersion) {
    add("evidence_extractor_mismatch", "The registered extractor key/version differs from the manifest.");
    return issues;
  }
  for (const claimShape of policy.claimShapes) {
    if (!extractor.claimShapes.includes(claimShape)) {
      add("evidence_extractor_mismatch", `The extractor does not declare claim shape "${claimShape}".`);
    }
  }

  const source = String(extractor.extract);
  for (const marker of AMBIENT_STATE_MARKERS) {
    if (source.includes(marker)) {
      add("extractor_reads_ambient_state", `The extractor references ambient state (${marker}).`);
      break;
    }
  }

  const inScope = probes.filter((probe) => probe.foreignScope !== true);
  for (const claimShape of policy.claimShapes) {
    let substantiated = false;
    for (const probe of inScope) {
      const extractorInput: AgentEvidenceExtractorInput = {
        capabilityId: manifest.capabilityId,
        verb: probe.verb,
        resultHash: `conformance:${probe.label}`,
        data: probe.envelope.data,
        grantedProjections: probe.grantedProjections,
        claimShape,
      };
      const first = extractClaimSupport(manifest, extractor, extractorInput);
      const second = extractClaimSupport(manifest, extractor, extractorInput);
      if (hashCanonical(first) !== hashCanonical(second)) {
        add("extractor_not_deterministic", `Two runs over the same input differ for "${claimShape}".`);
        break;
      }
      if (first.kind === "claim_support") {
        substantiated = true;
        continue;
      }
      if (first.reason === "extractor_field_not_authorized" || first.reason === "extractor_leaked_raw_identifier") {
        add(
          "extractor_not_field_minimizing",
          `The extractor emitted an unauthorized field for "${claimShape}" (${first.reason}).`,
        );
      }
    }
    if (!substantiated) {
      add(
        "extractor_insufficient_for_claim_shape",
        `No conformance probe produced claim support for "${claimShape}"; the citation would be provenance-only.`,
      );
    }
  }
  return issues;
}

/**
 * Enable gate: static manifest conformance plus the behavioral harness. The
 * generator refuses to publish a capability as `enabled` unless this passes.
 */
export function assertCapabilityEnableable(input: AgentConformanceInput): AgentRegistryValidation {
  const issues: AgentContractIssue[] = [];
  const staticConformance = assertManifestConformance(input.manifest);
  if (!staticConformance.ok) issues.push(...staticConformance.issues);
  const behavioral = runCapabilityConformance(input);
  if (!behavioral.ok) issues.push(...behavioral.issues);
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}
