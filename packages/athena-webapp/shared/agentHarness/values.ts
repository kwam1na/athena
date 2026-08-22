/**
 * Canonical values of the Athena capability SDK (browser-safe, no Convex).
 *
 * This module fixes the closed v1 vocabulary every other contract refers to:
 * opaque reference kinds, canonical domain value kinds, scope kinds, the two
 * read verbs, lifecycle states, freshness/completeness/egress/authority
 * classes, agent-callable filter kinds, and host mount modes. Anything outside
 * these lists is not a profile exception: it is a `versioned_extension_required`
 * issue that demands a contract version bump and a migration plan.
 *
 * The command namespace is reserved here as a type-level marker only. There is
 * deliberately no executable surface, verb, or handler for it in v1.
 */

export const AGENT_HARNESS_CONTRACT_VERSION = 1 as const;
export type AgentHarnessContractVersion = typeof AGENT_HARNESS_CONTRACT_VERSION;

/** Version token mixed into compatibility digests and tool fingerprints. */
export const AGENT_HARNESS_PROTOCOL_VERSION = "athena.agent-harness.v1" as const;

// ---------------------------------------------------------------------------
// Opaque references
// ---------------------------------------------------------------------------

export const AGENT_OPAQUE_REF_KINDS = [
  "source",
  "resource",
  "cursor",
  "citation",
  "context_binding",
  "runtime_thread",
  "runtime_input",
  "runtime_turn",
  "runtime_schedule",
  "runtime_projection",
] as const;
export type AgentOpaqueRefKind = (typeof AGENT_OPAQUE_REF_KINDS)[number];

declare const opaqueRefBrand: unique symbol;
/**
 * Branded string carrying only an opaque token. The brand is phantom: at
 * runtime an opaque ref is the string `<kind>:<token>`, which keeps it
 * serializable through JSON, Convex validators, and the sandbox bridge.
 *
 * The brand is required, so a bare `string` never satisfies `OpaqueRef<Kind>`:
 * every ref must come from `opaqueRef()` or from a narrowing through
 * `isOpaqueRef()`.
 */
export type OpaqueRef<Kind extends AgentOpaqueRefKind = AgentOpaqueRefKind> = string & {
  readonly [opaqueRefBrand]: Kind;
};

/**
 * Convex document ids are 32 lowercase base-32-ish characters. The harness
 * never lets one cross into agent-visible data, filters, or examples.
 */
const RAW_DOCUMENT_ID_PATTERN = /^[a-z0-9]{32}$/;
export const AGENT_RAW_IDENTIFIER_FIELD_PATTERN = /^(_id|_creationTime|id|[a-zA-Z0-9]*Id|[a-zA-Z0-9]*Ids)$/;

export function looksLikeRawDocumentId(value: unknown): boolean {
  return typeof value === "string" && RAW_DOCUMENT_ID_PATTERN.test(value);
}

export function isRawIdentifierFieldName(name: string): boolean {
  return AGENT_RAW_IDENTIFIER_FIELD_PATTERN.test(name);
}

export function opaqueRef<Kind extends AgentOpaqueRefKind>(kind: Kind, token: string): OpaqueRef<Kind> {
  if (!isOneOf(AGENT_OPAQUE_REF_KINDS, kind)) {
    throw new AgentVersionedExtensionError(versionedExtensionRequired("opaqueRef.kind", String(kind)));
  }
  if (token.length === 0) throw new Error("Opaque ref token must not be empty.");
  if (looksLikeRawDocumentId(token)) {
    throw new Error("Opaque ref token looks like a raw document id; mint a derived token instead.");
  }
  return `${kind}:${token}` as OpaqueRef<Kind>;
}

export function parseOpaqueRef(value: string): { kind: AgentOpaqueRefKind; token: string } | null {
  const separator = value.indexOf(":");
  if (separator <= 0) return null;
  const kind = value.slice(0, separator);
  const token = value.slice(separator + 1);
  if (!isOneOf(AGENT_OPAQUE_REF_KINDS, kind) || token.length === 0) return null;
  return { kind, token };
}

export function isOpaqueRef<Kind extends AgentOpaqueRefKind>(
  value: unknown,
  kind?: Kind,
): value is OpaqueRef<Kind> {
  if (typeof value !== "string") return false;
  const parsed = parseOpaqueRef(value);
  if (!parsed) return false;
  return kind === undefined || parsed.kind === kind;
}

// ---------------------------------------------------------------------------
// Canonical domain values
// ---------------------------------------------------------------------------

/** Epoch milliseconds. */
export type Timestamp = number;

/** `YYYY-MM-DD` in the store's operating calendar; never a raw instant. */
export type OperatingDate = string;
const OPERATING_DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export function isOperatingDate(value: unknown): value is OperatingDate {
  return typeof value === "string" && OPERATING_DATE_PATTERN.test(value);
}

/** Minor units plus ISO currency; never a float of major units. */
export type MoneyValue = { readonly amount: number; readonly currency: string };
export type QuantityValue = { readonly value: number; readonly unit: string };
export type DurationValue = { readonly ms: number };

export const AGENT_VALUE_KINDS = [
  "string",
  "text",
  "integer",
  "decimal",
  "boolean",
  "timestamp",
  "operatingDate",
  "money",
  "quantity",
  "percentage",
  "duration",
  "enum",
  "opaqueRef",
  "object",
  "array",
] as const;
export type AgentValueKind = (typeof AGENT_VALUE_KINDS)[number];

// ---------------------------------------------------------------------------
// Closed vocabularies
// ---------------------------------------------------------------------------

export const AGENT_SCOPE_KINDS = ["store", "organization"] as const;
export type AgentScopeKind = (typeof AGENT_SCOPE_KINDS)[number];

/** `get` is one semantic snapshot; `list` is cursor-bounded collection access. */
export const AGENT_READ_VERBS = ["get", "list"] as const;
export type AgentReadVerb = (typeof AGENT_READ_VERBS)[number];

export const AGENT_LIFECYCLE_STATES = ["unpublished", "enabled", "disabled"] as const;
export type AgentLifecycleState = (typeof AGENT_LIFECYCLE_STATES)[number];

export const AGENT_FRESHNESS_CLASSES = ["live", "accepted", "derived", "stale"] as const;
export type AgentFreshnessClass = (typeof AGENT_FRESHNESS_CLASSES)[number];

export const AGENT_FRESHNESS_AUTHORITIES = [
  "authoritative_record",
  "live_read",
  "derived",
] as const;
export type AgentFreshnessAuthority = (typeof AGENT_FRESHNESS_AUTHORITIES)[number];

export const AGENT_COMPLETENESS_STATUSES = [
  "complete",
  "partial",
  "truncated",
  "unavailable",
] as const;
export type AgentCompletenessStatus = (typeof AGENT_COMPLETENESS_STATUSES)[number];

/** Ordered from least to most sensitive; transforms inherit the maximum. */
export const AGENT_EGRESS_CLASSES = ["operational", "sensitive", "restricted"] as const;
export type AgentEgressClass = (typeof AGENT_EGRESS_CLASSES)[number];

export function egressClassRank(egressClass: AgentEgressClass): number {
  return AGENT_EGRESS_CLASSES.indexOf(egressClass);
}

export function maxEgressClass(...classes: readonly AgentEgressClass[]): AgentEgressClass {
  let max: AgentEgressClass = AGENT_EGRESS_CLASSES[0];
  for (const egressClass of classes) {
    if (egressClassRank(egressClass) > egressClassRank(max)) max = egressClass;
  }
  return max;
}

export function isEgressClassAtMost(egressClass: AgentEgressClass, ceiling: AgentEgressClass): boolean {
  return egressClassRank(egressClass) <= egressClassRank(ceiling);
}

/** Ordered authority tiers a sensitive projection may require. */
export const AGENT_AUTHORITY_TIERS = ["member", "manager", "full_admin"] as const;
export type AgentAuthorityTier = (typeof AGENT_AUTHORITY_TIERS)[number];

export function authorityTierRank(tier: AgentAuthorityTier): number {
  return AGENT_AUTHORITY_TIERS.indexOf(tier);
}

/**
 * Filter kinds an agent may supply. Raw instants, timezones, offsets, and time
 * windows are deliberately absent: the server derives operating boundaries
 * through `storeTime`, so a program can only name an operating date.
 */
export const AGENT_FILTER_KINDS = [
  "operatingDate",
  "enum",
  "opaqueRef",
  "string",
  "integer",
  "boolean",
] as const;
export type AgentFilterKind = (typeof AGENT_FILTER_KINDS)[number];

export const AGENT_NON_CALLABLE_FILTER_KINDS = [
  "timestamp",
  "timezone",
  "utcOffset",
  "timeWindow",
] as const;

export const AGENT_MOUNT_MODES = ["docked_panel", "full_screen_sheet", "inline_section"] as const;
export type AgentMountMode = (typeof AGENT_MOUNT_MODES)[number];

// ---------------------------------------------------------------------------
// Reserved command namespace (type-level marker only)
// ---------------------------------------------------------------------------

export const AGENT_RESERVED_COMMAND_NAMESPACE = "command" as const;
export const AGENT_RESERVED_COMMAND_VERBS = [
  "propose",
  "apply",
  "execute",
  "command",
  "mutate",
  "create",
  "update",
  "delete",
] as const;
export type AgentReservedCommandVerb = (typeof AGENT_RESERVED_COMMAND_VERBS)[number];

/**
 * The future command rail (R20) gets its own namespace, proposal lifecycle, and
 * admission path. In v1 this marker exists so manifests, facades, and tool
 * catalogs can state that the namespace is taken while guaranteeing that no
 * executable member exists on the read contract.
 */
export type AgentReservedCommandNamespace = {
  readonly namespace: typeof AGENT_RESERVED_COMMAND_NAMESPACE;
  readonly executable: false;
  readonly reservedVerbs: readonly AgentReservedCommandVerb[];
  readonly availableFromContractVersion: "future";
};

export const AGENT_COMMAND_NAMESPACE_RESERVATION: AgentReservedCommandNamespace = Object.freeze({
  namespace: AGENT_RESERVED_COMMAND_NAMESPACE,
  executable: false,
  reservedVerbs: Object.freeze([...AGENT_RESERVED_COMMAND_VERBS]),
  availableFromContractVersion: "future",
});

// ---------------------------------------------------------------------------
// Contract issues and versioned extension errors
// ---------------------------------------------------------------------------

export type AgentContractIssue = {
  readonly code: string;
  readonly path: string;
  readonly message: string;
  /** Present only for `versioned_extension_required`. */
  readonly primitive?: string;
  readonly value?: string;
  readonly contractVersion?: AgentHarnessContractVersion;
};

export type AgentContractValidation<T, Key extends string = "value"> =
  | ({ readonly ok: true } & { readonly [K in Key]: T })
  | { readonly ok: false; readonly issues: readonly AgentContractIssue[] };

export type AgentVersionedExtensionIssue = AgentContractIssue & {
  readonly code: "versioned_extension_required";
  readonly primitive: string;
  readonly value: string;
  readonly contractVersion: AgentHarnessContractVersion;
};

export function versionedExtensionRequired(
  primitive: string,
  value: string,
  path: string = primitive,
): AgentVersionedExtensionIssue {
  return {
    code: "versioned_extension_required",
    path,
    primitive,
    value,
    contractVersion: AGENT_HARNESS_CONTRACT_VERSION,
    message:
      `"${value}" is not a v${AGENT_HARNESS_CONTRACT_VERSION} ${primitive}. ` +
      "Genuinely new primitives require a versioned contract evolution and migration plan, " +
      "not a profile-specific kernel exception.",
  };
}

export function isVersionedExtensionIssue(
  issue: AgentContractIssue,
): issue is AgentVersionedExtensionIssue {
  return issue.code === "versioned_extension_required";
}

export class AgentVersionedExtensionError extends Error {
  readonly issue: AgentVersionedExtensionIssue;

  constructor(issue: AgentVersionedExtensionIssue) {
    super(issue.message);
    this.name = "AgentVersionedExtensionError";
    this.issue = issue;
  }
}

export class AgentContractViolationError extends Error {
  readonly issues: readonly AgentContractIssue[];

  constructor(subject: string, issues: readonly AgentContractIssue[]) {
    super(
      `${subject} violates the agent harness contract: ` +
        issues.map((issue) => `${issue.code} at ${issue.path}`).join("; "),
    );
    this.name = "AgentContractViolationError";
    this.issues = issues;
  }
}

/** Throw the most specific error for a failed validation. */
export function throwContractIssues(subject: string, issues: readonly AgentContractIssue[]): never {
  const extension = issues.find(isVersionedExtensionIssue);
  if (extension) throw new AgentVersionedExtensionError(extension);
  throw new AgentContractViolationError(subject, issues);
}

// ---------------------------------------------------------------------------
// Small helpers shared by the contract validators
// ---------------------------------------------------------------------------

export function isOneOf<const T extends readonly string[]>(list: T, value: unknown): value is T[number] {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Deep-freeze plain data reachable from a contract definition. Functions are
 * left alone (resolvers, label formatters); only plain objects and arrays are
 * frozen so a later-loaded module cannot mutate registered policy.
 */
export function deepFreezeContract<T>(value: T): T {
  const seen = new Set<unknown>();
  const freeze = (input: unknown) => {
    if (input === null || typeof input !== "object" || seen.has(input)) return;
    seen.add(input);
    if (!isPlainObject(input) && !Array.isArray(input)) return;
    Object.freeze(input);
    for (const key of Object.keys(input as Record<string, unknown>)) {
      freeze((input as Record<string, unknown>)[key]);
    }
  };
  freeze(value);
  return value;
}
