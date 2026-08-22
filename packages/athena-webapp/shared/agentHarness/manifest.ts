/**
 * Domain-owned capability manifest contract (browser-safe).
 *
 * A manifest is the complete, model-independent description of one semantic
 * resource: immutable capability identity, readable `package.resource`
 * namespace, supported read verbs with typed filters and collection bounds,
 * result field meaning, sensitive projections and their authority, freshness,
 * completeness, citation and evidence rules, declared worst-case cost,
 * examples, lifecycle state, and the read-intent/port binding delegated
 * admission resolves.
 *
 * Types derive from the manifest: `ProjectedShape<Fields, Granted>` is the
 * grant-projected result type in which unauthorized fields are structurally
 * absent. `validateCapabilityManifest` is the single runtime gate the registry
 * compiler and every package's conformance run reuse; `composeCapabilityPackages` is the
 * collision-free SDK view a run is granted.
 */
import type { BudgetVector } from "./execution";
import { AGENT_BUDGET_DIMENSIONS } from "./execution";
import type { AgentValueState } from "./results";
import {
  AGENT_AUTHORITY_TIERS,
  AGENT_EGRESS_CLASSES,
  AGENT_FILTER_KINDS,
  AGENT_FRESHNESS_AUTHORITIES,
  AGENT_FRESHNESS_CLASSES,
  AGENT_HARNESS_CONTRACT_VERSION,
  AGENT_LIFECYCLE_STATES,
  AGENT_NON_CALLABLE_FILTER_KINDS,
  AGENT_OPAQUE_REF_KINDS,
  AGENT_READ_VERBS,
  AGENT_RESERVED_COMMAND_NAMESPACE,
  AGENT_RESERVED_COMMAND_VERBS,
  AGENT_SCOPE_KINDS,
  AGENT_VALUE_KINDS,
  deepFreezeContract,
  isNonEmptyString,
  isNonNegativeInteger,
  isOneOf,
  isPlainObject,
  isPositiveInteger,
  isRawIdentifierFieldName,
  looksLikeRawDocumentId,
  versionedExtensionRequired,
  type AgentAuthorityTier,
  type AgentContractIssue,
  type AgentEgressClass,
  type AgentFreshnessAuthority,
  type AgentFreshnessClass,
  type AgentHarnessContractVersion,
  type AgentLifecycleState,
  type AgentOpaqueRefKind,
  type AgentReadVerb,
  type AgentScopeKind,
  type DurationValue,
  type MoneyValue,
  type OpaqueRef,
  type QuantityValue,
} from "./values";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** Flatten an intersection of mapped types into one object type. */
export type Simplify<T> = { [K in keyof T]: T[K] };

// ---------------------------------------------------------------------------
// Capability identity and namespace
// ---------------------------------------------------------------------------

/** Immutable capability identity, separate from the readable namespace. */
export const AGENT_CAPABILITY_ID_PATTERN = /^cap_[a-z0-9]+(?:_[a-z0-9]+)*$/;
const NAMESPACE_SEGMENT_PATTERN = /^[a-z][a-zA-Z0-9]*$/;
const RESERVED_PACKAGE_NAMES = new Set<string>(["athena", AGENT_RESERVED_COMMAND_NAMESPACE]);
const PACKAGE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

export type AgentNamespace = { readonly package: string; readonly resource: string };

export function namespacePath(namespace: AgentNamespace): string {
  return `${namespace.package}.${namespace.resource}`;
}

// ---------------------------------------------------------------------------
// Field schema and derived types
// ---------------------------------------------------------------------------

export type AgentScalarFieldKind =
  | "string"
  | "text"
  | "integer"
  | "decimal"
  | "boolean"
  | "timestamp"
  | "operatingDate"
  | "money"
  | "quantity"
  | "percentage"
  | "duration";

type AgentFieldBase = {
  readonly meaning: string;
  readonly optional?: boolean;
  /** Sensitive projection key; the field is absent unless that projection is granted. */
  readonly projection?: string;
  /** Wrap the value in an explicit `AgentValueState`. */
  readonly valueState?: boolean;
  readonly egressClass?: AgentEgressClass;
};

export type AgentFieldSchema =
  | (AgentFieldBase & { readonly kind: AgentScalarFieldKind })
  | (AgentFieldBase & { readonly kind: "enum"; readonly values: readonly string[] })
  | (AgentFieldBase & { readonly kind: "opaqueRef"; readonly refKind: AgentOpaqueRefKind })
  | (AgentFieldBase & { readonly kind: "object"; readonly fields: AgentFieldRecord })
  | (AgentFieldBase & {
      readonly kind: "array";
      readonly items: AgentFieldSchema;
      readonly maxItems: number;
    });

export type AgentFieldRecord = { readonly [name: string]: AgentFieldSchema };

type ScalarValue<K> = K extends "string" | "text" | "operatingDate"
  ? string
  : K extends "integer" | "decimal" | "percentage" | "timestamp"
    ? number
    : K extends "boolean"
      ? boolean
      : K extends "money"
        ? MoneyValue
        : K extends "quantity"
          ? QuantityValue
          : K extends "duration"
            ? DurationValue
            : never;

type BaseFieldValue<F, Granted extends string> = F extends {
  readonly kind: "enum";
  readonly values: readonly (infer V)[];
}
  ? V
  : F extends { readonly kind: "opaqueRef"; readonly refKind: infer R extends AgentOpaqueRefKind }
    ? OpaqueRef<R>
    : F extends { readonly kind: "object"; readonly fields: infer Fields extends AgentFieldRecord }
      ? ProjectedShape<Fields, Granted>
      : F extends { readonly kind: "array"; readonly items: infer Items }
        ? readonly FieldValue<Items, Granted>[]
        : F extends { readonly kind: infer K }
          ? ScalarValue<K>
          : never;

type WithValueState<F, V> = F extends { readonly valueState: true } ? AgentValueState<V> : V;

export type FieldValue<F, Granted extends string = string> = WithValueState<
  F,
  BaseFieldValue<F, Granted>
>;

type GrantedKeys<Fields extends AgentFieldRecord, Granted extends string> = {
  [K in keyof Fields]: Fields[K] extends { readonly projection: infer P }
    ? P extends Granted
      ? K
      : never
    : K;
}[keyof Fields];

type OptionalKeys<Fields extends AgentFieldRecord> = {
  [K in keyof Fields]: Fields[K] extends { readonly optional: true } ? K : never;
}[keyof Fields];

/**
 * The result shape visible under a grant. Fields bound to a projection that is
 * not in `Granted` do not exist on the type; there is no `undefined`, `null`,
 * or sentinel path for them.
 */
export type ProjectedShape<Fields extends AgentFieldRecord, Granted extends string> = Simplify<
  {
    readonly [K in Exclude<GrantedKeys<Fields, Granted>, OptionalKeys<Fields>>]: FieldValue<
      Fields[K],
      Granted
    >;
  } & {
    readonly [K in Extract<GrantedKeys<Fields, Granted>, OptionalKeys<Fields>>]?: FieldValue<
      Fields[K],
      Granted
    >;
  }
>;

export type FullShape<Fields extends AgentFieldRecord> = ProjectedShape<Fields, string>;

// ---------------------------------------------------------------------------
// Filters, operations, and argument types
// ---------------------------------------------------------------------------

type AgentFilterBase = { readonly required: boolean; readonly meaning: string };

export type AgentFilterSchema =
  | (AgentFilterBase & { readonly kind: "enum"; readonly values: readonly string[] })
  | (AgentFilterBase & { readonly kind: "opaqueRef"; readonly refKind: AgentOpaqueRefKind })
  | (AgentFilterBase & { readonly kind: "operatingDate" | "string" | "integer" | "boolean" });

export type AgentFilterRecord = { readonly [name: string]: AgentFilterSchema };

type FilterValue<F> = F extends { readonly kind: "enum"; readonly values: readonly (infer V)[] }
  ? V
  : F extends { readonly kind: "opaqueRef"; readonly refKind: infer R extends AgentOpaqueRefKind }
    ? OpaqueRef<R>
    : F extends { readonly kind: "integer" }
      ? number
      : F extends { readonly kind: "boolean" }
        ? boolean
        : string;

type RequiredFilterKeys<Filters extends AgentFilterRecord> = {
  [K in keyof Filters]: Filters[K] extends { readonly required: true } ? K : never;
}[keyof Filters];

export type OperationArgs<Op, Verb extends AgentReadVerb> = Op extends {
  readonly filters: infer Filters extends AgentFilterRecord;
}
  ? Simplify<
      { [K in RequiredFilterKeys<Filters>]: FilterValue<Filters[K]> } & {
        [K in Exclude<keyof Filters, RequiredFilterKeys<Filters>>]?: FilterValue<Filters[K]>;
      } & (Verb extends "list" ? { cursor?: OpaqueRef<"cursor"> } : unknown)
    >
  : never;

export type AgentSnapshotBounds = { readonly kind: "snapshot"; readonly maxEmbeddedItems?: number };
export type AgentCollectionBounds = {
  readonly kind: "collection";
  readonly maxItemsPerPage: number;
  readonly maxPagesPerRun: number;
};

export type AgentGetOperationManifest = {
  readonly purpose: string;
  readonly filters: AgentFilterRecord;
  readonly bounds: AgentSnapshotBounds;
};

export type AgentListOperationManifest = {
  readonly purpose: string;
  readonly filters: AgentFilterRecord;
  readonly bounds: AgentCollectionBounds;
};

export type AgentOperationManifests = {
  readonly get?: AgentGetOperationManifest;
  readonly list?: AgentListOperationManifest;
};

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export type AgentProjectionPolicy = {
  readonly requires: { readonly tier: AgentAuthorityTier; readonly readIntents?: readonly string[] };
  readonly egressClass: AgentEgressClass;
  readonly meaning: string;
};

export type AgentEvidencePolicy =
  | {
      readonly mode: "extractor";
      readonly extractorKey: string;
      readonly extractorVersion: string;
      readonly claimShapes: readonly string[];
    }
  | { readonly mode: "provenance_only"; readonly reason: string };

export type AgentCapabilityExample = {
  readonly title: string;
  readonly verb: AgentReadVerb;
  readonly args: { readonly [name: string]: JsonValue };
  readonly description: string;
  readonly usesProjections?: readonly string[];
};

export type AgentCapabilityBinding = {
  /** Read intents from the closed `readIntentCatalog`; validated by the registry. */
  readonly readIntents: readonly string[];
  readonly portKey: string;
  readonly implementationVersion: string;
};

export type AgentCapabilityManifest = {
  readonly contractVersion: AgentHarnessContractVersion;
  readonly capabilityId: string;
  readonly namespace: AgentNamespace;
  readonly packageVersion: string;
  readonly purpose: string;
  readonly scope: { readonly kind: AgentScopeKind };
  readonly lifecycle: AgentLifecycleState;
  readonly operations: AgentOperationManifests;
  readonly result: { readonly fields: AgentFieldRecord; readonly itemLabel?: string };
  readonly projections: { readonly [key: string]: AgentProjectionPolicy };
  readonly freshness: {
    readonly classes: readonly AgentFreshnessClass[];
    readonly authority: AgentFreshnessAuthority;
    readonly rule: string;
  };
  readonly completeness: { readonly rule: string; readonly sourceKeys: readonly string[] };
  readonly citation: { readonly rule: string; readonly sourceRefKinds: readonly string[] };
  readonly evidence: AgentEvidencePolicy;
  readonly cost: { readonly worstCasePerCall: BudgetVector };
  readonly egressClass: AgentEgressClass;
  readonly examples: readonly AgentCapabilityExample[];
  readonly binding: AgentCapabilityBinding;
};

/** Identity helper that keeps literal types and freezes the definition. */
export function defineCapabilityManifest<const M extends AgentCapabilityManifest>(manifest: M): M {
  return deepFreezeContract(manifest);
}

export function supportedVerbs(manifest: Pick<AgentCapabilityManifest, "operations">): AgentReadVerb[] {
  return AGENT_READ_VERBS.filter((verb) => manifest.operations[verb] !== undefined);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type AgentManifestValidation =
  | { readonly ok: true; readonly manifest: AgentCapabilityManifest }
  | { readonly ok: false; readonly issues: readonly AgentContractIssue[] };

class IssueCollector {
  readonly issues: AgentContractIssue[] = [];

  add(code: string, path: string, message: string) {
    this.issues.push({ code, path, message });
  }

  extension(primitive: string, value: unknown, path: string) {
    this.issues.push(versionedExtensionRequired(primitive, String(value), path));
  }

  incomplete(path: string, message: string) {
    this.add("metadata_incomplete", path, message);
  }
}

function validateFieldRecord(
  fields: unknown,
  path: string,
  declaredProjections: ReadonlySet<string>,
  collector: IssueCollector,
) {
  if (!isPlainObject(fields)) {
    collector.add("field_invalid", path, "Fields must be a record of field schemas.");
    return;
  }
  for (const [name, schema] of Object.entries(fields)) {
    const fieldPath = `${path}.${name}`;
    if (isRawIdentifierFieldName(name)) {
      collector.add(
        "raw_identifier_field",
        fieldPath,
        `Field "${name}" is id-shaped; expose an opaque ref instead.`,
      );
    }
    if (!isPlainObject(schema)) {
      collector.add("field_invalid", fieldPath, "Field schema must be an object.");
      continue;
    }
    if (!isOneOf(AGENT_VALUE_KINDS, schema.kind)) {
      collector.extension("field.kind", schema.kind, `${fieldPath}.kind`);
      continue;
    }
    if (!isNonEmptyString(schema.meaning)) {
      collector.add("field_invalid", `${fieldPath}.meaning`, "Every field declares its meaning.");
    }
    if (schema.projection !== undefined && !declaredProjections.has(String(schema.projection))) {
      collector.add(
        "projection_undeclared",
        `${fieldPath}.projection`,
        `Projection "${String(schema.projection)}" is not declared on the manifest.`,
      );
    }
    if (schema.egressClass !== undefined && !isOneOf(AGENT_EGRESS_CLASSES, schema.egressClass)) {
      collector.extension("egressClass", schema.egressClass, `${fieldPath}.egressClass`);
    }
    switch (schema.kind) {
      case "enum":
        if (!Array.isArray(schema.values) || schema.values.length === 0) {
          collector.add("field_invalid", `${fieldPath}.values`, "Enum fields list their values.");
        }
        break;
      case "opaqueRef":
        if (!isOneOf(AGENT_OPAQUE_REF_KINDS, schema.refKind)) {
          collector.extension("opaqueRef.kind", schema.refKind, `${fieldPath}.refKind`);
        }
        break;
      case "object":
        validateFieldRecord(schema.fields, `${fieldPath}.fields`, declaredProjections, collector);
        break;
      case "array":
        if (!isPositiveInteger(schema.maxItems)) {
          collector.add("bounds_missing", `${fieldPath}.maxItems`, "Array fields declare a maximum item count.");
        }
        validateFieldRecord({ items: schema.items }, fieldPath, declaredProjections, collector);
        break;
      default:
        break;
    }
  }
}

function validateFilters(filters: unknown, path: string, collector: IssueCollector) {
  if (!isPlainObject(filters)) {
    collector.add("filter_invalid", path, "Filters must be a record of filter schemas.");
    return;
  }
  for (const [name, schema] of Object.entries(filters)) {
    const filterPath = `${path}.${name}`;
    if (name === "cursor") {
      collector.add("filter_invalid", filterPath, "`cursor` is owned by the list verb, not a filter.");
    }
    if (isRawIdentifierFieldName(name)) {
      collector.add("raw_identifier_field", filterPath, `Filter "${name}" is id-shaped; accept an opaque ref.`);
    }
    if (!isPlainObject(schema)) {
      collector.add("filter_invalid", filterPath, "Filter schema must be an object.");
      continue;
    }
    if (isOneOf(AGENT_NON_CALLABLE_FILTER_KINDS, schema.kind)) {
      collector.add(
        "filter_kind_not_agent_callable",
        `${filterPath}.kind`,
        `Filter kind "${schema.kind}" is not agent-callable; the server derives time boundaries through store time.`,
      );
      continue;
    }
    if (!isOneOf(AGENT_FILTER_KINDS, schema.kind)) {
      collector.extension("filter.kind", schema.kind, `${filterPath}.kind`);
      continue;
    }
    if (typeof schema.required !== "boolean" || !isNonEmptyString(schema.meaning)) {
      collector.add("filter_invalid", filterPath, "Filters declare `required` and their meaning.");
    }
    if (schema.kind === "enum" && (!Array.isArray(schema.values) || schema.values.length === 0)) {
      collector.add("filter_invalid", `${filterPath}.values`, "Enum filters list their values.");
    }
    if (schema.kind === "opaqueRef" && !isOneOf(AGENT_OPAQUE_REF_KINDS, schema.refKind)) {
      collector.extension("opaqueRef.kind", schema.refKind, `${filterPath}.refKind`);
    }
  }
}

function validateOperations(operations: unknown, collector: IssueCollector): number {
  if (!isPlainObject(operations)) {
    collector.add("no_operations", "operations", "A manifest declares at least one read operation.");
    return 0;
  }
  let supported = 0;
  for (const [verb, operation] of Object.entries(operations)) {
    const path = `operations.${verb}`;
    if (isOneOf(AGENT_RESERVED_COMMAND_VERBS, verb)) {
      collector.add(
        "reserved_command_verb",
        path,
        `"${verb}" belongs to the reserved command namespace; v1 reads cannot declare it.`,
      );
      continue;
    }
    if (!isOneOf(AGENT_READ_VERBS, verb)) {
      collector.extension("operation.verb", verb, path);
      continue;
    }
    supported += 1;
    if (!isPlainObject(operation)) {
      collector.add("operation_invalid", path, "Operation manifest must be an object.");
      continue;
    }
    if (!isNonEmptyString(operation.purpose)) {
      collector.incomplete(`${path}.purpose`, "Operations state their purpose.");
    }
    validateFilters(operation.filters, `${path}.filters`, collector);
    const bounds = operation.bounds;
    if (!isPlainObject(bounds)) {
      collector.add("bounds_missing", `${path}.bounds`, "Every operation declares explicit bounds.");
      continue;
    }
    if (verb === "get") {
      if (bounds.kind !== "snapshot") {
        collector.add("bounds_invalid", `${path}.bounds.kind`, "`get` returns one snapshot.");
      } else if (bounds.maxEmbeddedItems !== undefined && !isPositiveInteger(bounds.maxEmbeddedItems)) {
        collector.add("bounds_invalid", `${path}.bounds.maxEmbeddedItems`, "Embedded item cap must be positive.");
      }
    } else if (
      bounds.kind !== "collection" ||
      !isPositiveInteger(bounds.maxItemsPerPage) ||
      !isPositiveInteger(bounds.maxPagesPerRun)
    ) {
      collector.add(
        "bounds_invalid",
        `${path}.bounds`,
        "`list` declares positive items-per-page and pages-per-run limits.",
      );
    }
  }
  if (supported === 0) {
    collector.add("no_operations", "operations", "A manifest declares at least one read operation.");
  }
  return supported;
}

function validateExamples(
  examples: unknown,
  operations: AgentOperationManifests,
  declaredProjections: ReadonlySet<string>,
  collector: IssueCollector,
) {
  if (!Array.isArray(examples) || examples.length === 0) {
    collector.incomplete("examples", "At least one example is required.");
    return;
  }
  examples.forEach((example, index) => {
    const path = `examples[${index}]`;
    if (!isPlainObject(example)) {
      collector.add("example_invalid", path, "Example must be an object.");
      return;
    }
    if (!isNonEmptyString(example.title) || typeof example.description !== "string") {
      collector.add("example_invalid", path, "Examples carry a title and description.");
    }
    const verb = example.verb;
    const operation = isOneOf(AGENT_READ_VERBS, verb) ? operations[verb] : undefined;
    if (!operation) {
      collector.add("example_invalid", `${path}.verb`, `Example verb "${String(verb)}" is not supported.`);
      return;
    }
    const args = isPlainObject(example.args) ? example.args : null;
    if (!args) {
      collector.add("example_invalid", `${path}.args`, "Example args must be an object.");
      return;
    }
    for (const [name, filter] of Object.entries(operation.filters)) {
      if (filter.required && args[name] === undefined) {
        collector.add("example_invalid", `${path}.args.${name}`, `Required filter "${name}" missing.`);
      }
    }
    for (const [name, value] of Object.entries(args)) {
      if (name !== "cursor" && operation.filters[name] === undefined) {
        collector.add("example_invalid", `${path}.args.${name}`, `Unknown filter "${name}".`);
      }
      if (looksLikeRawDocumentId(value)) {
        collector.add("raw_identifier_in_example", `${path}.args.${name}`, "Example uses a raw document id.");
      }
    }
    if (example.usesProjections !== undefined) {
      if (!Array.isArray(example.usesProjections)) {
        collector.add("example_invalid", `${path}.usesProjections`, "usesProjections must be an array.");
      } else {
        for (const projection of example.usesProjections) {
          if (!declaredProjections.has(String(projection))) {
            collector.add(
              "projection_undeclared",
              `${path}.usesProjections`,
              `Projection "${String(projection)}" is not declared.`,
            );
          }
        }
      }
    }
  });
}

export function validateCapabilityManifest(manifest: AgentCapabilityManifest): AgentManifestValidation {
  const collector = new IssueCollector();
  const raw: Record<string, unknown> = isPlainObject(manifest) ? manifest : {};
  if (!isPlainObject(manifest)) {
    collector.add("manifest_invalid", "$", "Manifest must be a plain object.");
    return { ok: false, issues: collector.issues };
  }

  if (raw.contractVersion !== AGENT_HARNESS_CONTRACT_VERSION) {
    collector.extension("contractVersion", raw.contractVersion, "contractVersion");
  }
  if (typeof raw.capabilityId !== "string" || !AGENT_CAPABILITY_ID_PATTERN.test(raw.capabilityId)) {
    collector.add("capability_id_invalid", "capabilityId", "Capability ids match cap_<lowercase-token>.");
  }
  const namespace = raw.namespace;
  if (
    !isPlainObject(namespace) ||
    typeof namespace.package !== "string" ||
    typeof namespace.resource !== "string" ||
    !NAMESPACE_SEGMENT_PATTERN.test(namespace.package) ||
    !NAMESPACE_SEGMENT_PATTERN.test(namespace.resource)
  ) {
    collector.add("namespace_invalid", "namespace", "Namespace is `package.resource` in camelCase.");
  } else if (RESERVED_PACKAGE_NAMES.has(namespace.package)) {
    collector.add("reserved_namespace", "namespace.package", `"${namespace.package}" is reserved.`);
  }
  if (typeof raw.packageVersion !== "string" || !PACKAGE_VERSION_PATTERN.test(raw.packageVersion)) {
    collector.incomplete("packageVersion", "Package version is semantic (`major.minor.patch`).");
  }
  if (!isNonEmptyString(raw.purpose)) collector.incomplete("purpose", "Purpose is required.");

  const scope = raw.scope;
  if (!isPlainObject(scope)) {
    collector.incomplete("scope", "Scope kind is required.");
  } else if (!isOneOf(AGENT_SCOPE_KINDS, scope.kind)) {
    collector.extension("scope.kind", scope.kind, "scope.kind");
  }
  if (!isOneOf(AGENT_LIFECYCLE_STATES, raw.lifecycle)) {
    collector.extension("lifecycle", raw.lifecycle, "lifecycle");
  }

  validateOperations(raw.operations, collector);

  const projections = isPlainObject(raw.projections) ? raw.projections : null;
  const declaredProjections = new Set<string>();
  if (!projections) {
    collector.incomplete("projections", "Declare sensitive projections (an empty record is valid).");
  } else {
    for (const [key, policy] of Object.entries(projections)) {
      declaredProjections.add(key);
      const path = `projections.${key}`;
      if (!isPlainObject(policy) || !isPlainObject(policy.requires)) {
        collector.add("projection_invalid", path, "Projection policies declare their authority.");
        continue;
      }
      if (!isOneOf(AGENT_AUTHORITY_TIERS, policy.requires.tier)) {
        collector.extension("authority.tier", policy.requires.tier, `${path}.requires.tier`);
      }
      if (
        policy.requires.readIntents !== undefined &&
        (!Array.isArray(policy.requires.readIntents) ||
          policy.requires.readIntents.some((intent) => !isNonEmptyString(intent)))
      ) {
        collector.add("projection_invalid", `${path}.requires.readIntents`, "Read intents must be strings.");
      }
      if (!isOneOf(AGENT_EGRESS_CLASSES, policy.egressClass)) {
        collector.extension("egressClass", policy.egressClass, `${path}.egressClass`);
      }
      if (!isNonEmptyString(policy.meaning)) {
        collector.add("projection_invalid", `${path}.meaning`, "Projections explain what they unlock.");
      }
    }
  }

  const result = raw.result;
  if (!isPlainObject(result)) {
    collector.incomplete("result", "Result field schema is required.");
  } else {
    validateFieldRecord(result.fields, "result.fields", declaredProjections, collector);
  }

  const freshness = raw.freshness;
  if (!isPlainObject(freshness)) {
    collector.incomplete("freshness", "Freshness rule is required.");
  } else {
    if (!Array.isArray(freshness.classes) || freshness.classes.length === 0) {
      collector.incomplete("freshness.classes", "Declare the freshness classes a result may carry.");
    } else {
      for (const freshnessClass of freshness.classes) {
        if (!isOneOf(AGENT_FRESHNESS_CLASSES, freshnessClass)) {
          collector.extension("freshness.class", freshnessClass, "freshness.classes");
        }
      }
    }
    if (!isOneOf(AGENT_FRESHNESS_AUTHORITIES, freshness.authority)) {
      collector.extension("freshness.authority", freshness.authority, "freshness.authority");
    }
    if (!isNonEmptyString(freshness.rule)) collector.incomplete("freshness.rule", "Freshness rule is required.");
  }

  const completeness = raw.completeness;
  if (
    !isPlainObject(completeness) ||
    !isNonEmptyString(completeness.rule) ||
    !Array.isArray(completeness.sourceKeys) ||
    completeness.sourceKeys.length === 0
  ) {
    collector.incomplete("completeness", "Completeness rule and at least one source key are required.");
  }

  const citation = raw.citation;
  if (
    !isPlainObject(citation) ||
    !isNonEmptyString(citation.rule) ||
    !Array.isArray(citation.sourceRefKinds) ||
    citation.sourceRefKinds.length === 0
  ) {
    collector.incomplete("citation", "Citation rule and at least one source ref kind are required.");
  }

  const evidence = raw.evidence;
  if (!isPlainObject(evidence)) {
    collector.incomplete("evidence", "Evidence policy is required.");
  } else if (evidence.mode === "extractor") {
    if (
      !isNonEmptyString(evidence.extractorKey) ||
      !isNonEmptyString(evidence.extractorVersion) ||
      !Array.isArray(evidence.claimShapes) ||
      evidence.claimShapes.length === 0
    ) {
      collector.incomplete("evidence", "Extractors declare key, version, and claim shapes.");
    }
  } else if (evidence.mode === "provenance_only") {
    if (!isNonEmptyString(evidence.reason)) {
      collector.incomplete("evidence.reason", "Provenance-only evidence explains why.");
    }
  } else {
    collector.extension("evidence.mode", evidence.mode, "evidence.mode");
  }

  const cost = raw.cost;
  const operations: AgentOperationManifests = isPlainObject(raw.operations)
    ? (raw.operations as AgentOperationManifests)
    : {};
  if (!isPlainObject(cost) || !isPlainObject(cost.worstCasePerCall)) {
    collector.incomplete("cost", "Declared worst-case cost per call is required.");
  } else {
    const worstCase = cost.worstCasePerCall;
    for (const dimension of AGENT_BUDGET_DIMENSIONS) {
      if (!isNonNegativeInteger(worstCase[dimension])) {
        collector.add("cost_invalid", `cost.worstCasePerCall.${dimension}`, "Cost units are non-negative integers.");
      }
    }
    if (worstCase.calls !== 1) {
      collector.add("cost_invalid", "cost.worstCasePerCall.calls", "One capability call costs exactly one call.");
    }
    const rows = typeof worstCase.rows === "number" ? worstCase.rows : 0;
    const listBounds = operations.list?.bounds;
    if (listBounds && isPlainObject(listBounds) && typeof listBounds.maxItemsPerPage === "number" && rows < listBounds.maxItemsPerPage) {
      collector.add("cost_below_bounds", "cost.worstCasePerCall.rows", "Worst-case rows must cover a full page.");
    }
    const getBounds = operations.get?.bounds;
    if (getBounds && isPlainObject(getBounds) && typeof getBounds.maxEmbeddedItems === "number" && rows < getBounds.maxEmbeddedItems) {
      collector.add("cost_below_bounds", "cost.worstCasePerCall.rows", "Worst-case rows must cover embedded items.");
    }
    if (typeof worstCase.bytes === "number" && worstCase.bytes <= 0) {
      collector.add("cost_invalid", "cost.worstCasePerCall.bytes", "Declare a positive byte ceiling.");
    }
  }

  if (!isOneOf(AGENT_EGRESS_CLASSES, raw.egressClass)) {
    collector.extension("egressClass", raw.egressClass, "egressClass");
  }

  validateExamples(raw.examples, operations, declaredProjections, collector);

  const binding = raw.binding;
  if (!isPlainObject(binding)) {
    collector.incomplete("binding", "Read-intent and port binding is required.");
  } else {
    if (
      !Array.isArray(binding.readIntents) ||
      binding.readIntents.length === 0 ||
      binding.readIntents.some((intent) => !isNonEmptyString(intent))
    ) {
      collector.incomplete("binding.readIntents", "Bind at least one read intent.");
    }
    if (!isNonEmptyString(binding.portKey)) collector.incomplete("binding.portKey", "Bind a port key.");
    if (!isNonEmptyString(binding.implementationVersion)) {
      collector.incomplete("binding.implementationVersion", "Bind the port implementation version.");
    }
  }

  return collector.issues.length === 0
    ? { ok: true, manifest }
    : { ok: false, issues: collector.issues };
}

// ---------------------------------------------------------------------------
// Package composition (scenario 1)
// ---------------------------------------------------------------------------

export type AgentSdkResourceView = {
  readonly capabilityId: string;
  readonly verbs: readonly AgentReadVerb[];
  readonly scopeKind: AgentScopeKind;
};

export type AgentSdkPackageView = {
  readonly version: string;
  readonly resources: { readonly [resource: string]: AgentSdkResourceView };
};

export type AgentSdkView = {
  readonly contractVersion: AgentHarnessContractVersion;
  readonly packages: { readonly [packageKey: string]: AgentSdkPackageView };
};

export type AgentSdkComposition =
  | { readonly ok: true; readonly view: AgentSdkView }
  | { readonly ok: false; readonly issues: readonly AgentContractIssue[] };

/**
 * Compose manifests from any number of packages into one SDK view. Namespace
 * paths must be unique, capability ids must be unique, and every manifest of a
 * package must agree on the package version.
 */
export function composeCapabilityPackages(
  manifests: readonly AgentCapabilityManifest[],
): AgentSdkComposition {
  const issues: AgentContractIssue[] = [];
  const byNamespace = new Map<string, AgentCapabilityManifest>();
  const byCapabilityId = new Map<string, AgentCapabilityManifest>();
  const packageVersions = new Map<string, string>();
  const packages: Record<string, { version: string; resources: Record<string, AgentSdkResourceView> }> = {};

  manifests.forEach((manifest, index) => {
    const validation = validateCapabilityManifest(manifest);
    if (!validation.ok) {
      issues.push(
        ...validation.issues.map((issue) => ({ ...issue, path: `manifests[${index}].${issue.path}` })),
      );
      return;
    }
    const path = namespacePath(manifest.namespace);
    const existingNamespace = byNamespace.get(path);
    if (existingNamespace && existingNamespace.capabilityId !== manifest.capabilityId) {
      issues.push({
        code: "namespace_collision",
        path: `manifests[${index}].namespace`,
        message: `Namespace "${path}" is claimed by ${existingNamespace.capabilityId} and ${manifest.capabilityId}.`,
      });
      return;
    }
    if (byCapabilityId.has(manifest.capabilityId)) {
      issues.push({
        code: "capability_id_collision",
        path: `manifests[${index}].capabilityId`,
        message: `Capability id "${manifest.capabilityId}" is declared more than once.`,
      });
      return;
    }
    const knownVersion = packageVersions.get(manifest.namespace.package);
    if (knownVersion !== undefined && knownVersion !== manifest.packageVersion) {
      issues.push({
        code: "package_version_conflict",
        path: `manifests[${index}].packageVersion`,
        message: `Package "${manifest.namespace.package}" is ${knownVersion} elsewhere but ${manifest.packageVersion} here.`,
      });
      return;
    }
    byNamespace.set(path, manifest);
    byCapabilityId.set(manifest.capabilityId, manifest);
    packageVersions.set(manifest.namespace.package, manifest.packageVersion);
    const pkg = (packages[manifest.namespace.package] ??= {
      version: manifest.packageVersion,
      resources: {},
    });
    pkg.resources[manifest.namespace.resource] = {
      capabilityId: manifest.capabilityId,
      verbs: supportedVerbs(manifest),
      scopeKind: manifest.scope.kind,
    };
  });

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, view: deepFreezeContract({ contractVersion: AGENT_HARNESS_CONTRACT_VERSION, packages }) };
}

// ---------------------------------------------------------------------------
// Model-visible projections
// ---------------------------------------------------------------------------

/** Compact discovery summary: what exists, never what fields it carries. */
export type AgentCapabilitySummary = {
  readonly capabilityId: string;
  readonly namespace: string;
  readonly purpose: string;
  readonly verbs: readonly AgentReadVerb[];
  readonly scopeKind: AgentScopeKind;
};

export function summarizeCapability(manifest: AgentCapabilityManifest): AgentCapabilitySummary {
  return {
    capabilityId: manifest.capabilityId,
    namespace: namespacePath(manifest.namespace),
    purpose: manifest.purpose,
    verbs: supportedVerbs(manifest),
    scopeKind: manifest.scope.kind,
  };
}

/** Detailed declaration projected for one grant; binding details never leave the kernel. */
export type AgentCapabilityDeclaration = Omit<AgentCapabilityManifest, "binding">;

export type AgentGrantProjectionInput = {
  readonly grantedProjections: readonly string[];
};

function projectFields(fields: AgentFieldRecord, granted: ReadonlySet<string>): AgentFieldRecord {
  const projected: Record<string, AgentFieldSchema> = {};
  for (const [name, schema] of Object.entries(fields)) {
    if (schema.projection !== undefined && !granted.has(schema.projection)) continue;
    if (schema.kind === "object") {
      projected[name] = { ...schema, fields: projectFields(schema.fields, granted) };
    } else if (schema.kind === "array" && schema.items.kind === "object") {
      projected[name] = {
        ...schema,
        items: { ...schema.items, fields: projectFields(schema.items.fields, granted) },
      };
    } else {
      projected[name] = schema;
    }
  }
  return projected;
}

/**
 * Project a manifest for a grant. Fields bound to ungranted projections,
 * ungranted projection policies, and examples that use them are omitted from
 * the declaration entirely.
 */
export function projectManifestForGrant(
  manifest: AgentCapabilityManifest,
  grant: AgentGrantProjectionInput,
): AgentCapabilityDeclaration {
  const granted = new Set(grant.grantedProjections.filter((key) => manifest.projections[key] !== undefined));
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the binding is kernel-only and must not reach a declaration
  const { binding: _binding, ...declaration } = manifest;
  const projections: Record<string, AgentProjectionPolicy> = {};
  for (const key of granted) projections[key] = manifest.projections[key];
  return deepFreezeContract({
    ...declaration,
    result: { ...manifest.result, fields: projectFields(manifest.result.fields, granted) },
    projections,
    examples: manifest.examples.filter((example) =>
      (example.usesProjections ?? []).every((projection) => granted.has(projection)),
    ),
  });
}

/**
 * Runtime counterpart of `ProjectedShape`: strip every field bound to an
 * ungranted projection from sanitized result data (recursively through
 * objects and arrays). Read ports already omit such fields; the bridge applies
 * this as the last defense before data becomes program- or model-visible, so
 * unauthorized fields are absent rather than zeroed.
 */
export function omitUngrantedFields<T>(
  fields: AgentFieldRecord,
  grantedProjections: readonly string[],
  data: T,
): T {
  const granted = new Set(grantedProjections);
  const strip = (schema: AgentFieldRecord, value: unknown): unknown => {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map((item) => strip(schema, item));
    const out: Record<string, unknown> = {};
    for (const [name, child] of Object.entries(value as Record<string, unknown>)) {
      const fieldSchema = schema[name];
      if (!fieldSchema) continue;
      if (fieldSchema.projection !== undefined && !granted.has(fieldSchema.projection)) continue;
      if (fieldSchema.kind === "object") {
        out[name] = strip(fieldSchema.fields, child);
      } else if (fieldSchema.kind === "array" && fieldSchema.items.kind === "object") {
        const itemFields = fieldSchema.items.fields;
        out[name] = Array.isArray(child) ? child.map((item) => strip(itemFields, item)) : child;
      } else {
        out[name] = child;
      }
    }
    return out;
  };
  return strip(fields, data) as T;
}

/** Maximum egress class reachable through a manifest under a grant. */
export function manifestEgressClass(
  manifest: AgentCapabilityManifest,
  grantedProjections?: readonly string[],
): AgentEgressClass {
  let max = manifest.egressClass;
  const rank = (value: AgentEgressClass) => AGENT_EGRESS_CLASSES.indexOf(value);
  for (const [key, policy] of Object.entries(manifest.projections)) {
    if (grantedProjections !== undefined && !grantedProjections.includes(key)) continue;
    if (rank(policy.egressClass) > rank(max)) max = policy.egressClass;
  }
  return max;
}
