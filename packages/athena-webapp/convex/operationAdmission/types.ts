import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { AthenaCapability } from "../platform/capabilityCatalog";
import type { AthenaReadIntent } from "../platform/readIntentCatalog";

export type OperationAdmissionCtx =
  Pick<QueryCtx, "auth" | "db"> | Pick<MutationCtx, "auth" | "db">;

export type OperationActorKind =
  | "normal_user"
  | "shared_demo"
  | "storefront_customer"
  | "public";

export type OperationActor =
  | {
      kind: "normal_user";
      athenaUserId: Id<"athenaUser">;
    }
  | {
      kind: "shared_demo";
      authUserId: Id<"users">;
      athenaUserId: Id<"athenaUser">;
      organizationId: Id<"organization">;
      storeId: Id<"store">;
    }
  | {
      // A storefront shopper identified only by the bearer id in their claim
      // cookie. This is proof of possession, not authentication: it confers no
      // trust beyond "holds this id", and every downstream callee still
      // asserts ownership of caller-supplied resource ids against it.
      kind: "storefront_customer";
      assurance: "bearer_id";
      storeId: Id<"store">;
      storeFrontUserId?: Id<"storeFrontUser">;
      guestId?: Id<"guest">;
    }
  | {
      // Anonymous caller — no identity at all. Only admitted for operations
      // that explicitly opt in via actors.public === "admit".
      kind: "public";
    };

/** Ingress kinds that may perform writes. */
export type OperationWriteKind = "mutation" | "action" | "http";
/** Ingress kinds that may only read. */
export type OperationReadKind = "query" | "http_read";
export type OperationKind = OperationWriteKind | OperationReadKind;

export type OperationScope =
  | { kind: "none" }
  | { kind: "store"; storeIdArg?: string; resolve?: OperationScopeResolver }
  | {
      kind: "organization";
      organizationIdArg?: string;
      resolve?: OperationScopeResolver;
    };

export type OperationReadiness =
  | { kind: "none" }
  // Mutation kinds only: the demo restore fence plus optional epoch assertion.
  | { kind: "store_write"; expectedEpochArg?: string }
  // Action/HTTP kinds: the same admission-time restore fence with no write
  // semantics. The internal mutation that performs the body-derived write
  // re-applies the fence with the admitted store id.
  | { kind: "store_ready" };

export type OperationEffects =
  { mode: "none" } | { mode: "protected"; gateways: readonly string[] };

/**
 * Set-valued dynamic capability with all-of semantics: every capability the
 * resolver returns must be granted, and any resolved capability outside
 * `candidates` is a denial.
 */
export type OperationDynamicCapability = {
  kind: "dynamic";
  candidates: readonly AthenaCapability[];
  resolve: (args: Record<string, unknown>) => readonly AthenaCapability[];
};

export type OperationCapabilitySpec =
  | AthenaCapability
  | OperationDynamicCapability;

export type OperationTargetIdBindings = {
  athenaUserIdArg?: string;
  organizationIdArg?: string;
  storeIdArg?: string;
};

export type OperationTargetIds = {
  athenaUserId?: Id<"athenaUser">;
  organizationId?: Id<"organization">;
  storeId?: Id<"store">;
};

export type OperationTargetResolver = (
  ctx: OperationAdmissionCtx,
  args: Record<string, unknown>,
  constraints: OperationScopeConstraints,
) => Promise<OperationTargetIds> | OperationTargetIds;

export type OperationExternalRefsResolver = (
  ctx: OperationAdmissionCtx,
  args: Record<string, unknown>,
  constraints: OperationScopeConstraints,
) => Promise<readonly string[]> | readonly string[];

/**
 * `true` means "guard the resolved scope constraints"; an id-binding object
 * names the argument each protected id comes from; `{ resolve }` looks the ids
 * up. Evaluated for EVERY actor kind — these guards protect demo fixture rows
 * from normal full admins too, so they are not actor policy.
 */
export type OperationFoundationTarget =
  | true
  | OperationTargetIdBindings
  | { resolve: OperationTargetResolver };

export type OperationExternalRefsTarget =
  | { arg: string }
  | { resolve: OperationExternalRefsResolver };

export type OperationTarget = {
  protectDemoFoundation?: OperationFoundationTarget;
  protectDemoFoundationExternalRefs?: OperationExternalRefsTarget;
};

export type OperationIngressVerification =
  | { kind: "origin_allowlist" }
  | { kind: "signature"; verifier: string };

export type OperationRoute = {
  method: string;
  path: string;
};

export type OperationActorCoverage = {
  normalUser: "admit" | "deny";
  sharedDemo: "admit" | "deny";
  // Storefront bearer-claim shoppers. Valid only on http/http_read kinds.
  storefrontCustomer?: "admit" | "deny";
  // Anonymous callers. Required on every definition; deny by default nowhere —
  // it must be stated.
  public: "admit" | "deny";
};

export type OperationDefinition = {
  kind: OperationWriteKind;
  functionName?: string;
  route?: OperationRoute;
  operationId: string;
  capability: OperationCapabilitySpec;
  scope: OperationScope;
  readiness: OperationReadiness;
  effects: OperationEffects;
  target?: OperationTarget;
  ingressVerification?: OperationIngressVerification;
  actors: OperationActorCoverage;
};

export type OperationReadDefinition = {
  kind: OperationReadKind;
  functionName?: string;
  route?: OperationRoute;
  operationId: string;
  access: {
    intent: AthenaReadIntent;
    kind: "read";
  };
  scope: OperationScope;
  ingressVerification?: OperationIngressVerification;
  actors: OperationActorCoverage;
};

export type AnyOperationDefinition =
  | OperationDefinition
  | OperationReadDefinition;

export type OperationScopeConstraints = {
  organizationId?: Id<"organization">;
  storeId?: Id<"store">;
};

export type OperationScopeResolver = (
  ctx: OperationAdmissionCtx,
  args: Record<string, unknown>,
) => Promise<OperationScopeConstraints> | OperationScopeConstraints;

export type OperationAdmissionDecision = {
  adapter: OperationActorKind;
  outcome: "admitted";
};

export type OperationAdmissionContext = {
  actor: OperationActor;
  constraints: OperationScopeConstraints;
  decision: OperationAdmissionDecision;
  operation: AnyOperationDefinition;
  provenance: Record<string, unknown>;
};

/**
 * The serializable shape an action/HTTP body receives back from the registered
 * admission entry point. It carries no definition object (functions do not
 * cross the boundary) — only the operation id and the admitted facts.
 */
export type OperationAdmissionProjection = {
  actor: OperationActor;
  constraints: OperationScopeConstraints;
  decision: OperationAdmissionDecision;
  operationId: string;
  provenance: Record<string, unknown>;
};

export type OperationMutationCtx = MutationCtx & {
  operationAdmission: OperationAdmissionContext;
};

export type OperationQueryCtx = QueryCtx & {
  operationAdmission: OperationAdmissionContext;
};

export type OperationAdapterAdmitted = Omit<
  OperationAdmissionContext,
  "operation"
>;

export type OperationAdapterDeniedReason =
  | "actor_denied"
  | "capability_denied"
  | "effect_denied"
  | "scope_denied"
  | "readiness_denied"
  | "target_denied"
  | "session_expired"
  | "demo_disabled"
  | "claim_missing"
  | "unknown_claim";

export type OperationAdapterDenied = {
  error?: Error;
  kind: "denied";
  recognized: boolean;
  reason: OperationAdapterDeniedReason;
};

export type OperationAdapterNotApplicable = {
  kind: "not_applicable";
};

/**
 * The adapter recognized the caller as "no identity of my kind present". The
 * chain falls through only on this outcome and `not_applicable`.
 */
export type OperationAdapterUnauthenticated = {
  kind: "unauthenticated";
};

export type OperationAdapterOutcome =
  | OperationAdapterAdmitted
  | OperationAdapterDenied
  | OperationAdapterNotApplicable
  | OperationAdapterUnauthenticated;

export type OperationAdapter = {
  kind: OperationActorKind;
  resolve: (
    ctx: MutationCtx,
    args: Record<string, unknown>,
    definition: OperationDefinition,
  ) => Promise<OperationAdapterOutcome>;
};

export type OperationReadAdapter = {
  kind: OperationActorKind;
  resolve: (
    ctx: QueryCtx,
    args: Record<string, unknown>,
    definition: OperationReadDefinition,
  ) => Promise<OperationAdapterOutcome>;
};

/**
 * Resource guards registered at the composition root. They protect target rows
 * from every actor and are therefore not adapters.
 */
export type OperationResourceGuards = {
  protectDemoFoundation: (target: OperationTargetIds) => void | Promise<void>;
  protectDemoFoundationExternalRefs: (
    refs: readonly string[],
  ) => void | Promise<void>;
};

/** Injected observability port — the rail core never imports the recorder. */
export type OperationCapturePort = (
  ctx: Pick<MutationCtx, "db">,
  admission: OperationAdmissionContext,
) => Promise<void> | void;

/**
 * Reserved admission argument carrying the ingress claim the HTTP wrappers
 * extracted from the request. Adapters read it; domain handlers never see it.
 */
export const OPERATION_INGRESS_CLAIM_ARG = "__operationIngressClaim";

export type OperationIngressClaim = {
  storeFrontUserId?: Id<"storeFrontUser">;
  guestId?: Id<"guest">;
  storeId?: Id<"store">;
};

export type OperationIngress = {
  rawBody: string;
  request: Request;
};

// ---------------------------------------------------------------------------
// Agent delegation (V26-1262)
//
// An agent run acts under a DERIVED grant, never under a substitute identity.
// The types below are deliberately NOT members of `OperationActor`: the public
// ingress rail, its adapter chain, and every actor-coverage assertion are
// untouched. A delegated run records the initiating operator and re-reads that
// operator's CURRENT authority through a registered authority port on every
// capability call; the effective grant is the intersection of what was pinned
// at run start and what the operator still holds.
// ---------------------------------------------------------------------------

/** The operator kinds that may initiate an agent run. Public and storefront actors never can. */
export type DelegatedOperatorKind = "normal_user" | "shared_demo";

export type DelegatedOperator = {
  kind: DelegatedOperatorKind;
  athenaUserId: Id<"athenaUser">;
  /** Shared-demo principals are keyed by their auth user; required for that kind. */
  authUserId?: Id<"users">;
};

export type DelegatedAuthorityRequest = {
  operator: DelegatedOperator;
  organizationId: Id<"organization">;
  storeId: Id<"store">;
  now: number;
};

export type DelegatedMembershipRole = "full_admin" | "pos_only";

/**
 * What the operator holds RIGHT NOW, as the authority port observed it. The
 * kernel derives the SDK authority tier and the grant intersection from this;
 * the port itself knows nothing about manifests or projections.
 */
export type DelegatedAuthoritySnapshot = {
  operator: DelegatedOperator;
  organizationId: Id<"organization">;
  storeId: Id<"store">;
  membershipRole: DelegatedMembershipRole;
  operationalRoles: readonly string[];
  heldReadIntents: readonly AthenaReadIntent[];
};

export type DelegatedAuthorityDenialReason =
  | "operator_unknown"
  | "membership_revoked"
  | "store_missing"
  | "store_out_of_scope"
  | "principal_missing"
  | "session_expired"
  | "demo_disabled";

export type DelegatedAuthorityOutcome =
  | { kind: "authorized"; authority: DelegatedAuthoritySnapshot }
  | { kind: "denied"; reason: DelegatedAuthorityDenialReason; message: string };

/**
 * Authority port for one operator kind. Registered at the composition root,
 * selected by the operator kind pinned on the grant — there is no chain and no
 * fall-through: a denial from the selected port is terminal, and a throw
 * propagates.
 */
export type DelegatedAuthorityPort = {
  kind: DelegatedOperatorKind;
  resolve: (
    ctx: OperationAdmissionCtx,
    request: DelegatedAuthorityRequest,
  ) => Promise<DelegatedAuthorityOutcome>;
};

/** Provenance recorded on harness evidence rows: the grant, never an actor substitution. */
export type AgentDelegationProvenance = {
  kind: "agent_delegation";
  operatorKind: DelegatedOperatorKind;
  actorRef: string;
  grantDigest: string;
  authorizationEpoch: number;
};
