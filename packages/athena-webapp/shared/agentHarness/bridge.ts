/**
 * Capability bridge and generated-facade typing contract (browser-safe).
 *
 * The sandbox sees `athena.<package>.<resource>.get|list(...)` and nothing
 * else: no command surface, no raw identifiers, no host or Convex context.
 * `AgentFacade<Manifests, Granted>` is the type the generated facade must
 * satisfy for one grant; resources, verbs, projections, and fields outside
 * the grant do not exist on it. Every call resolves to a typed outcome in
 * which unauthorized is distinct from denied, unavailable, failed, and
 * canceled, and a result carries the uniform envelope.
 *
 * The fixed Athena tool catalog is named here so the runtime contract, the
 * executor, and the host agree on the only five model-visible tools.
 */
import type { BudgetVector } from "./execution";
import type {
  AgentCapabilityDeclaration,
  AgentCapabilityManifest,
  AgentCapabilitySummary,
  JsonValue,
  OperationArgs,
  ProjectedShape,
  Simplify,
} from "./manifest";
import type { AgentCompleteness, AgentGetEnvelope, AgentListEnvelope, AgentReadEnvelope } from "./results";
import type { AgentEgressClass, AgentReadVerb, OpaqueRef } from "./values";

// ---------------------------------------------------------------------------
// Fixed model-visible tool catalog (plan decision 8)
// ---------------------------------------------------------------------------

export const AGENT_FIXED_TOOL_IDS = [
  "athena.discover",
  "athena.describe",
  "athena.executeProgram",
  "athena.scratch",
  "athena.completeRun",
] as const;
export type AgentFixedToolId = (typeof AGENT_FIXED_TOOL_IDS)[number];

// ---------------------------------------------------------------------------
// Requests and outcomes
// ---------------------------------------------------------------------------

export type AgentCapabilityRequest = {
  readonly capabilityId: string;
  readonly namespace: string;
  readonly verb: AgentReadVerb;
  readonly args: { readonly [name: string]: JsonValue };
  /** Optional authorized projections; requesting an ungranted one is `unauthorized`. */
  readonly projections?: readonly string[];
  readonly cursor?: OpaqueRef<"cursor">;
};

export const AGENT_UNAUTHORIZED_CODES = [
  "unauthorized_capability",
  "unauthorized_projection",
  "unauthorized_scope",
  "capability_disabled",
] as const;
export type AgentUnauthorizedCode = (typeof AGENT_UNAUTHORIZED_CODES)[number];

export const AGENT_CAPABILITY_DENIAL_CODES = [
  "budget_exceeded",
  "run_not_running",
  "attempt_not_executing",
  "compatibility_epoch_fenced",
  "invalid_arguments",
  "unsupported_verb",
  "in_flight_limit",
] as const;
export type AgentCapabilityDenialCode = (typeof AGENT_CAPABILITY_DENIAL_CODES)[number];

export type AgentCapabilityResult<Envelope extends AgentReadEnvelope<unknown>> =
  | { readonly kind: "result"; readonly envelope: Envelope }
  | {
      readonly kind: "unauthorized";
      readonly code: AgentUnauthorizedCode;
      readonly message: string;
    }
  | {
      readonly kind: "denied";
      readonly code: AgentCapabilityDenialCode;
      readonly message: string;
      readonly retryable: boolean;
      readonly detail?: { readonly [key: string]: string | number | boolean | readonly string[] };
    }
  | {
      readonly kind: "unavailable";
      readonly reason: string;
      readonly retryable: boolean;
      readonly sourceKey?: string;
    }
  | {
      readonly kind: "failed";
      readonly error: { readonly code: string; readonly message: string };
    }
  | { readonly kind: "canceled"; readonly reason: string };

export type AgentCapabilityOutcome<Data> = AgentCapabilityResult<AgentReadEnvelope<Data>>;

/** The async bridge a program sees: mediated reads plus read-only budget inspection (R14). */
export type AgentCapabilityBridge = {
  readonly invoke: <Data = unknown>(
    request: AgentCapabilityRequest,
  ) => Promise<AgentCapabilityOutcome<Data>>;
  readonly remainingBudget: () => Readonly<BudgetVector>;
};

// ---------------------------------------------------------------------------
// Generated facade typing
// ---------------------------------------------------------------------------

type ResultFields<M extends AgentCapabilityManifest> = M["result"]["fields"];

export type AgentGetOutcome<M extends AgentCapabilityManifest, Granted extends string> = AgentCapabilityResult<
  AgentGetEnvelope<ProjectedShape<ResultFields<M>, Granted>>
>;

export type AgentListOutcome<M extends AgentCapabilityManifest, Granted extends string> = AgentCapabilityResult<
  AgentListEnvelope<ProjectedShape<ResultFields<M>, Granted>>
>;

/**
 * One resource of the facade. Only the verbs the manifest declares exist, and
 * their signatures come straight from the manifest's filters and result
 * fields projected for the grant.
 */
export type AgentResourceFacade<M extends AgentCapabilityManifest, Granted extends string> = Simplify<
  (M["operations"] extends { readonly get: infer Get }
    ? { readonly get: (args: OperationArgs<Get, "get">) => Promise<AgentGetOutcome<M, Granted>> }
    : unknown) &
    (M["operations"] extends { readonly list: infer List }
      ? { readonly list: (args: OperationArgs<List, "list">) => Promise<AgentListOutcome<M, Granted>> }
      : unknown)
>;

type PackageOf<Manifests extends readonly AgentCapabilityManifest[]> = Manifests[number]["namespace"]["package"];

type ManifestsIn<
  Manifests extends readonly AgentCapabilityManifest[],
  P extends string,
> = Extract<Manifests[number], { readonly namespace: { readonly package: P } }>;

/** The `athena.*` facade for a set of granted manifests and projections. */
export type AgentFacade<Manifests extends readonly AgentCapabilityManifest[], Granted extends string> = Simplify<{
  readonly [P in PackageOf<Manifests>]: Simplify<{
    readonly [R in ManifestsIn<Manifests, P>["namespace"]["resource"]]: AgentResourceFacade<
      Extract<ManifestsIn<Manifests, P>, { readonly namespace: { readonly resource: R } }>,
      Granted
    >;
  }>;
}>;

// ---------------------------------------------------------------------------
// Discovery surface and program output (consumed by discovery and the executor)
// ---------------------------------------------------------------------------

export type AgentDescribeOutcome =
  | { readonly kind: "declaration"; readonly declaration: AgentCapabilityDeclaration }
  | { readonly kind: "unauthorized"; readonly namespace: string }
  | { readonly kind: "unknown_namespace"; readonly namespace: string };

export type AgentDiscoverySurface = {
  readonly discover: () => Promise<readonly AgentCapabilitySummary[]>;
  readonly describe: (namespace: string) => Promise<AgentDescribeOutcome>;
};

/** Exactly one explicit structured output per program (R15). */
export type AgentProgramResultEnvelope = {
  readonly output: JsonValue;
  readonly completeness: AgentCompleteness;
  readonly egressClass: AgentEgressClass;
  /** Capability call refs whose results the output is derived from. */
  readonly derivedFromCallRefs: readonly string[];
};
