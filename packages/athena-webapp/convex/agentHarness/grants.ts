/**
 * Run grants (kernel; product-neutral).
 *
 * Authority boundary: an agent run never holds an identity of its own. It
 * holds a DERIVED grant — the intersection of what the initiating operator
 * held when the run started (pinned immutably here, with provenance) and what
 * that operator still holds on every later check. `materializeRunGrantWithCtx`
 * pins the grant; `reauthorizeGrantWithCtx` re-reads current authority through
 * the registered authority port for the pinned operator kind, applies the live
 * shrink-only enablement overlay, the run state, the compatibility-epoch fence,
 * the registry pin, and the grant's own integrity, and returns a typed verdict.
 * Every step fails closed. A grant can shrink during a run; it never widens.
 *
 * This module never reaches a product domain, `api.*`, or the raw registry
 * artifact: the registry and the authority ports are injected by the
 * composition root (`convex/platform/operationAdmission.ts`).
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { hashCanonical } from "../../shared/agentHarness/agentRuntime";
import type { AgentCapabilityResult } from "../../shared/agentHarness/bridge";
import { isTerminalRunStatus } from "../../shared/agentHarness/execution";
import { manifestEgressClass } from "../../shared/agentHarness/manifest";
import type { AgentReadEnvelope } from "../../shared/agentHarness/results";
import { maxEgressClass, type AgentAuthorityTier, type AgentEgressClass, type AgentScopeKind } from "../../shared/agentHarness/values";
import type {
  DelegatedAuthorityPort,
  DelegatedAuthoritySnapshot,
  DelegatedOperator,
  DelegatedOperatorKind,
} from "../operationAdmission/types";
import type { AgentRuntimeGrant } from "./discovery";
import {
  checkRunEpochFenceWithCtx,
  createAgentRunWithCtx,
  getCurrentCompatibilityEpochWithCtx,
  type CreateAgentRunInput,
} from "./lifecycle";
import {
  computeGrantDigest,
  evaluateEnablement,
  projectGrant,
  type AgentCapabilityRegistry,
  type AgentEnablementOverlay,
  type AgentGrantProjection,
} from "./registry";

export type ReadCtx = QueryCtx | MutationCtx;

export type DelegatedGrantConfig = {
  /** The privileged registry the composition root binds (generated in production, built in tests). */
  readonly registry: AgentCapabilityRegistry;
  /** One authority port per operator kind; selected by the pinned kind, never chained. */
  readonly authorityPorts: { readonly [K in DelegatedOperatorKind]: DelegatedAuthorityPort };
  /** The live shrink-only overlay (kill switch); defaults to the published baseline. */
  readonly resolveEnablement: (ctx: ReadCtx) => Promise<AgentEnablementOverlay>;
  /**
   * Curated starter-intent program lookup, injected by the composition root
   * (the kernel never imports profile modules). Absent lookups downgrade the
   * turn to free-form; nothing here refuses.
   */
  readonly starterIntentProgramFor?: (profileId: string, starterIntentId: string) => string | undefined;
  readonly now?: () => number;
};

export type AgentRunGrantDelegation = NonNullable<Doc<"agentRunGrant">["delegation"]>;

/** The non-result variants of the bridge outcome: what a refused call reports to the program. */
export type AgentCapabilityRefusal = Exclude<AgentCapabilityResult<AgentReadEnvelope<unknown>>, { kind: "result" }>;

export type DelegatedAuthorityStage =
  | "run"
  | "fence"
  | "registry"
  | "integrity"
  | "enablement"
  | "operator"
  | "capability"
  | "projection";

export type DelegatedAuthorityPurpose = "dispatch" | "release" | "citation" | "completion";

export type DelegatedScope = {
  readonly kind: AgentScopeKind;
  readonly organizationId: Id<"organization">;
  readonly storeId?: Id<"store">;
};

export type DelegatedEffectiveGrant = {
  readonly capabilityIds: readonly string[];
  readonly grantedProjectionsByCapability: { readonly [capabilityId: string]: readonly string[] };
};

export type DelegatedAuthorityAuthorized = {
  readonly kind: "authorized";
  readonly run: Doc<"intelligenceRun">;
  readonly grant: Doc<"agentRunGrant">;
  readonly delegation: AgentRunGrantDelegation;
  readonly authority: DelegatedAuthoritySnapshot;
  readonly tier: AgentAuthorityTier;
  readonly scope: DelegatedScope;
  /** Pinned grant ∩ current authority ∩ live enablement. */
  readonly effective: DelegatedEffectiveGrant;
  /** Projections granted for the capability under check (empty when none was named). */
  readonly grantedProjections: readonly string[];
  readonly authorizationEpoch: number;
  readonly authorityDigest: string;
  /** True when the effective grant is narrower than the pinned one. */
  readonly authorityShrunk: boolean;
  /** The effective grant in the model-visible shape (no registry material). */
  readonly runtimeGrant: AgentRuntimeGrant;
};

export type DelegatedAuthorityRefusal = {
  readonly kind: "refused";
  readonly stage: DelegatedAuthorityStage;
  readonly reason: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly result: AgentCapabilityRefusal;
  /** Present once the grant was located, so evidence can still be recorded. */
  readonly context?: {
    readonly run: Doc<"intelligenceRun">;
    readonly grant: Doc<"agentRunGrant">;
    readonly delegation?: AgentRunGrantDelegation;
    readonly authorizationEpoch: number;
  };
};

export type DelegatedAuthorityVerdict = DelegatedAuthorityAuthorized | DelegatedAuthorityRefusal;

// ---------------------------------------------------------------------------
// Operator identity and authority tier
// ---------------------------------------------------------------------------

const ACTOR_REF_PREFIX: { readonly [K in DelegatedOperatorKind]: string } = {
  normal_user: "athenaUser",
  shared_demo: "sharedDemo",
};

/** `athenaUser:<id>` / `sharedDemo:<id>` — the existing intelligence actor-ref convention. */
export function encodeDelegatedActorRef(operator: Pick<DelegatedOperator, "kind" | "athenaUserId">): string {
  return `${ACTOR_REF_PREFIX[operator.kind]}:${operator.athenaUserId}`;
}

export function parseDelegatedActorRef(actorRef: string): Pick<DelegatedOperator, "kind" | "athenaUserId"> | null {
  const separator = actorRef.indexOf(":");
  if (separator <= 0) return null;
  const prefix = actorRef.slice(0, separator);
  const id = actorRef.slice(separator + 1);
  if (id.length === 0) return null;
  for (const kind of Object.keys(ACTOR_REF_PREFIX) as DelegatedOperatorKind[]) {
    if (ACTOR_REF_PREFIX[kind] === prefix) return { kind, athenaUserId: id as Id<"athenaUser"> };
  }
  return null;
}

/**
 * Athena membership → SDK authority tier. `full_admin` is the admin tier; a
 * POS-only member with the `manager` operational role is a manager; every
 * other POS-only member is a member. No new roles are invented here.
 */
export function deriveAuthorityTier(membership: {
  readonly membershipRole: string;
  readonly operationalRoles: readonly string[];
}): AgentAuthorityTier {
  if (membership.membershipRole === "full_admin") return "full_admin";
  if (membership.operationalRoles.includes("manager")) return "manager";
  return "member";
}

function authorityDigestOf(authority: DelegatedAuthoritySnapshot, tier: AgentAuthorityTier): string {
  return hashCanonical({
    operatorKind: authority.operator.kind,
    athenaUserId: authority.operator.athenaUserId,
    organizationId: authority.organizationId,
    storeId: authority.storeId,
    membershipRole: authority.membershipRole,
    operationalRoles: [...authority.operationalRoles].sort(),
    tier,
    heldReadIntents: [...authority.heldReadIntents].sort(),
  });
}

// ---------------------------------------------------------------------------
// Refusal constructors (typed, closed vocabulary from the bridge contract)
// ---------------------------------------------------------------------------

function refused(
  stage: DelegatedAuthorityStage,
  reason: string,
  message: string,
  result: AgentCapabilityRefusal,
  options: { retryable?: boolean; context?: DelegatedAuthorityRefusal["context"] } = {},
): DelegatedAuthorityRefusal {
  return { kind: "refused", stage, reason, message, retryable: options.retryable ?? false, result, context: options.context };
}

const unauthorized = (code: Extract<AgentCapabilityRefusal, { kind: "unauthorized" }>["code"], message: string): AgentCapabilityRefusal => ({
  kind: "unauthorized",
  code,
  message,
});

const denied = (
  code: Extract<AgentCapabilityRefusal, { kind: "denied" }>["code"],
  message: string,
  detail?: Extract<AgentCapabilityRefusal, { kind: "denied" }>["detail"],
): AgentCapabilityRefusal => ({ kind: "denied", code, message, retryable: false, detail });

const failed = (code: string, message: string): AgentCapabilityRefusal => ({ kind: "failed", error: { code, message } });

function enablementRefusal(
  code: Exclude<ReturnType<typeof evaluateEnablement>, { ok: true }>["code"],
  context?: DelegatedAuthorityRefusal["context"],
): DelegatedAuthorityRefusal {
  const message =
    code === "profile_unknown" || code === "capability_unknown"
      ? "This capability is not available."
      : "This capability is currently switched off.";
  const result =
    code === "profile_unknown" || code === "capability_unknown"
      ? unauthorized("unauthorized_capability", message)
      : unauthorized("capability_disabled", message);
  return refused("enablement", code, message, result, { context });
}

// ---------------------------------------------------------------------------
// Current authority (through the registered port for the pinned operator kind)
// ---------------------------------------------------------------------------

async function resolveCurrentAuthority(
  ctx: ReadCtx,
  config: DelegatedGrantConfig,
  request: { operator: DelegatedOperator; organizationId: Id<"organization">; storeId: Id<"store">; now: number },
  context?: DelegatedAuthorityRefusal["context"],
): Promise<{ kind: "authorized"; authority: DelegatedAuthoritySnapshot; tier: AgentAuthorityTier } | DelegatedAuthorityRefusal> {
  // Exactly one port, chosen by the pinned kind. There is no chain to fall
  // through to: a denial here is terminal and a throw propagates untouched.
  const port = config.authorityPorts[request.operator.kind];
  if (!port || port.kind !== request.operator.kind) {
    return refused("operator", "authority_port_missing", "No authority port is registered for this operator kind.", failed("authority_port_missing", "No authority port is registered for this operator kind."), { context });
  }
  const outcome = await port.resolve(ctx, request);
  if (outcome.kind === "denied") {
    return refused("operator", outcome.reason, outcome.message, unauthorized("unauthorized_scope", "The operator no longer holds authority in this scope."), { context });
  }
  return { kind: "authorized", authority: outcome.authority, tier: deriveAuthorityTier(outcome.authority) };
}

// ---------------------------------------------------------------------------
// Materialization
// ---------------------------------------------------------------------------

export type DelegatedRunGrantRequest = {
  readonly operator: DelegatedOperator;
  readonly profileId: string;
  readonly organizationId: Id<"organization">;
  readonly storeId: Id<"store">;
  readonly now: number;
};

export type PreparedRunGrant = {
  readonly kind: "prepared";
  readonly authority: DelegatedAuthoritySnapshot;
  readonly tier: AgentAuthorityTier;
  readonly projection: AgentGrantProjection;
  readonly delegation: AgentRunGrantDelegation;
  readonly authorizationEpoch: number;
  /** Everything `createAgentRunWithCtx` needs except the prompt hash and the turn key. */
  readonly runInput: Omit<CreateAgentRunInput, "promptPayloadHash" | "runIdempotencyKey" | "now">;
};

/**
 * Resolve the operator's current authority, project the grant through the
 * registry under the live overlay, and pin the result. Pure with respect to
 * harness state: nothing is written. Every refusal is typed and names its
 * stage; no run, grant, or ledger exists after a refusal.
 */
export async function prepareDelegatedRunGrantWithCtx(
  ctx: ReadCtx,
  config: DelegatedGrantConfig,
  request: DelegatedRunGrantRequest,
): Promise<PreparedRunGrant | DelegatedAuthorityRefusal> {
  const registry = config.registry;
  const enablement = await config.resolveEnablement(ctx);
  const profileGate = evaluateEnablement(enablement, { profileId: request.profileId });
  if (!profileGate.ok) return enablementRefusal(profileGate.code);
  const profile = registry.profiles[request.profileId];
  if (!profile) return enablementRefusal("profile_unknown");

  const current = await resolveCurrentAuthority(ctx, config, request);
  if (current.kind === "refused") return current;

  const projection = projectGrant(
    registry,
    {
      profileId: profile.profileId,
      grantedPackages: profile.packages.map((selection) => selection.packageKey),
      grantedReadIntents: current.authority.heldReadIntents,
      authorityTier: current.tier,
    },
    { enablement },
  );
  if (projection.kind !== "projected") {
    return enablementRefusal(projection.kind === "profile_disabled" ? "profile_disabled" : "profile_unknown");
  }

  const epoch = await getCurrentCompatibilityEpochWithCtx(ctx);
  const delegation: AgentRunGrantDelegation = {
    operatorKind: request.operator.kind,
    athenaUserId: request.operator.athenaUserId,
    authUserId: request.operator.authUserId,
    membershipRole: current.authority.membershipRole,
    operationalRoles: [...current.authority.operationalRoles],
    authorityTier: current.tier,
    heldReadIntents: [...current.authority.heldReadIntents].sort(),
    capabilityIds: projection.capabilities.map((capability) => capability.capabilityId),
    grantedProjectionsByCapability: Object.fromEntries(
      Object.entries(projection.grantedProjectionsByCapability).map(([capabilityId, projections]) => [capabilityId, [...projections]]),
    ),
    authorityDigest: authorityDigestOf(current.authority, current.tier),
    authorizationEpoch: epoch.epoch,
    authorizedAt: request.now,
    admissionPolicyVersion: registry.protocolVersions.admissionPolicy,
  };

  const runInput: PreparedRunGrant["runInput"] = {
    storeId: request.storeId,
    organizationId: request.organizationId,
    principalKind: "athenaUser",
    actorRef: encodeDelegatedActorRef(request.operator),
    visibilityMode: current.tier === "full_admin" ? "store_admin" : "store_staff",
    profileKey: profile.profileId,
    profileVersion: profile.profileVersion,
    packageKeys: [...projection.packages],
    grantDigest: projection.grantDigest,
    registryDigest: projection.registryDigest,
    compatibilityDigest: projection.compatibilityDigest,
    adapterKind: registry.protocolVersions.runtimeAdapter.adapterKind,
    adapterVersion: registry.protocolVersions.runtimeAdapter.adapterVersion,
    budgetPolicy: {
      runLimits: profile.budgetPolicy.runLimits,
      attemptLimits: profile.budgetPolicy.attemptLimits,
      maxAttempts: profile.budgetPolicy.maxAttempts,
    },
    egressClass: projection.egressClass,
    delegation,
  };

  return { kind: "prepared", authority: current.authority, tier: current.tier, projection, delegation, authorizationEpoch: epoch.epoch, runInput };
}

export type MaterializeRunGrantInput = DelegatedRunGrantRequest & {
  readonly promptPayloadHash: string;
  readonly runIdempotencyKey: string;
};

export type MaterializedRunGrant = {
  readonly kind: "materialized";
  readonly runId: Id<"intelligenceRun">;
  readonly grantId: Id<"agentRunGrant">;
  readonly ledgerId: Id<"agentBudgetLedger">;
  readonly compatibilityEpoch: number;
  readonly projection: AgentGrantProjection;
  readonly delegation: AgentRunGrantDelegation;
  readonly runtimeGrant: AgentRuntimeGrant;
};

/**
 * Materialize the immutable run grant: one transaction creates the business
 * run, the grant (with delegated provenance), and the budget ledger. Callers
 * that create the run through the turn binding (`turns.ts`) use
 * `prepareDelegatedRunGrantWithCtx` and pass `runInput` on instead.
 */
export async function materializeRunGrantWithCtx(
  ctx: MutationCtx,
  config: DelegatedGrantConfig,
  input: MaterializeRunGrantInput,
): Promise<MaterializedRunGrant | DelegatedAuthorityRefusal> {
  const prepared = await prepareDelegatedRunGrantWithCtx(ctx, config, input);
  if (prepared.kind === "refused") return prepared;
  const created = await createAgentRunWithCtx(ctx, {
    ...prepared.runInput,
    promptPayloadHash: input.promptPayloadHash,
    runIdempotencyKey: input.runIdempotencyKey,
    now: input.now,
  });
  return {
    kind: "materialized",
    runId: created.runId,
    grantId: created.grantId,
    ledgerId: created.ledgerId,
    compatibilityEpoch: created.compatibilityEpoch,
    projection: prepared.projection,
    delegation: prepared.delegation,
    runtimeGrant: runtimeGrantOf(config.registry, prepared.runInput, {
      capabilityIds: prepared.delegation.capabilityIds,
      grantedProjectionsByCapability: prepared.delegation.grantedProjectionsByCapability,
    }),
  };
}

// ---------------------------------------------------------------------------
// Reauthorization
// ---------------------------------------------------------------------------

export type ReauthorizeGrantInput = {
  readonly runId: Id<"intelligenceRun">;
  readonly purpose: DelegatedAuthorityPurpose;
  readonly capabilityId?: string;
  /** Projections the caller wants; any outside the effective grant refuses the whole call. */
  readonly requestedProjections?: readonly string[];
  readonly now: number;
};

export async function loadRunGrantWithCtx(
  ctx: ReadCtx,
  runId: Id<"intelligenceRun">,
): Promise<{ run: Doc<"intelligenceRun">; grant: Doc<"agentRunGrant"> } | null> {
  const run = await ctx.db.get("intelligenceRun", runId);
  if (!run || !run.runGrantId) return null;
  const grant = await ctx.db.get("agentRunGrant", run.runGrantId);
  if (!grant || grant.runId !== run._id) return null;
  return { run, grant };
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

/**
 * Re-derive authority for a live run and return the effective grant.
 *
 * Order (each step fails closed):
 *   run exists, is an agent run, is `running`, and carries a retained grant with delegation →
 *   compatibility-epoch fence → registry digest pin → grant integrity (pinned
 *   projection reproduces the pinned digest) → live enablement (profile, then
 *   capability) → current operator authority through the pinned kind's port →
 *   intersection with the pinned projection → capability membership →
 *   requested projections.
 */
export async function reauthorizeGrantWithCtx(
  ctx: ReadCtx,
  config: DelegatedGrantConfig,
  input: ReauthorizeGrantInput,
): Promise<DelegatedAuthorityVerdict> {
  const registry = config.registry;
  const located = await loadRunGrantWithCtx(ctx, input.runId);
  if (!located) {
    return refused("run", "run_not_found", "The run does not exist.", denied("run_not_running", "The run does not exist."));
  }
  const { run, grant } = located;
  const epoch = await getCurrentCompatibilityEpochWithCtx(ctx);
  const baseContext = { run, grant, delegation: grant.delegation, authorizationEpoch: epoch.epoch };

  if (run.harnessKind !== "agent") {
    return refused("run", "run_not_agent", "This run is not an agent run.", denied("run_not_running", "This run is not an agent run."), { context: baseContext });
  }
  if (isTerminalRunStatus(run.status) || run.status !== "running") {
    const message = isTerminalRunStatus(run.status) ? "The run has already ended." : "The run is not running.";
    return refused("run", `run_${run.status}`, message, denied("run_not_running", message, { status: run.status }), { context: baseContext });
  }
  if (grant.lifecycle !== "retained") {
    return refused("run", "grant_deleted", "The run's grant is no longer retained.", denied("run_not_running", "The run's grant is no longer retained."), { context: baseContext });
  }
  const delegation = grant.delegation;
  if (!delegation) {
    return refused("run", "delegation_missing", "The run carries no delegated grant.", failed("delegation_missing", "The run carries no delegated grant."), { context: baseContext });
  }

  const fence = await checkRunEpochFenceWithCtx(ctx, run);
  if (fence.fenced) {
    return refused(
      "fence",
      "compatibility_epoch_fenced",
      "This run belongs to an older release and can no longer proceed.",
      denied("compatibility_epoch_fenced", "This run belongs to an older release and can no longer proceed.", {
        runEpoch: fence.runEpoch,
        currentEpoch: fence.currentEpoch,
      }),
      { context: baseContext },
    );
  }
  if (grant.registryDigest !== registry.registryDigest || grant.compatibilityDigest !== registry.compatibilityDigest) {
    return refused(
      "registry",
      "registry_digest_mismatch",
      "The capability registry changed under this run.",
      denied("compatibility_epoch_fenced", "The capability registry changed under this run."),
      { context: baseContext },
    );
  }

  const profile = registry.profiles[grant.profileKey];
  if (!profile || profile.profileVersion !== grant.profileVersion) {
    return enablementRefusal("profile_unknown", baseContext);
  }
  const expectedDigest = computeGrantDigest({
    profileId: profile.profileId,
    profileVersion: profile.profileVersion,
    packages: grant.packageKeys,
    capabilityIds: delegation.capabilityIds,
    grantedProjectionsByCapability: delegation.grantedProjectionsByCapability,
    authorityTier: delegation.authorityTier as AgentAuthorityTier,
    registryDigest: grant.registryDigest,
  });
  if (expectedDigest !== grant.grantDigest) {
    return refused("integrity", "grant_digest_mismatch", "The run's grant record does not match its digest.", failed("grant_integrity", "The run's grant record does not match its digest."), { context: baseContext });
  }

  const enablement = await config.resolveEnablement(ctx);
  const profileGate = evaluateEnablement(enablement, { profileId: grant.profileKey });
  if (!profileGate.ok) return enablementRefusal(profileGate.code, baseContext);
  if (input.capabilityId !== undefined) {
    const capabilityGate = evaluateEnablement(enablement, { profileId: grant.profileKey, capabilityId: input.capabilityId });
    if (!capabilityGate.ok) return enablementRefusal(capabilityGate.code, baseContext);
  }

  const current = await resolveCurrentAuthority(
    ctx,
    config,
    {
      operator: { kind: delegation.operatorKind, athenaUserId: delegation.athenaUserId, authUserId: delegation.authUserId },
      organizationId: grant.organizationId,
      storeId: grant.storeId,
      now: input.now,
    },
    baseContext,
  );
  if (current.kind === "refused") return current;

  const live = projectGrant(
    registry,
    {
      profileId: grant.profileKey,
      grantedPackages: grant.packageKeys,
      grantedReadIntents: current.authority.heldReadIntents,
      authorityTier: current.tier,
    },
    { enablement },
  );
  if (live.kind !== "projected") {
    return enablementRefusal(live.kind === "profile_disabled" ? "profile_disabled" : "profile_unknown", baseContext);
  }

  // Intersection: the pinned projection bounds everything; the live projection may only remove.
  const liveProjections = live.grantedProjectionsByCapability;
  const capabilityIds = delegation.capabilityIds.filter((capabilityId) => liveProjections[capabilityId] !== undefined);
  const grantedProjectionsByCapability: Record<string, readonly string[]> = {};
  for (const capabilityId of capabilityIds) {
    const pinned = delegation.grantedProjectionsByCapability[capabilityId] ?? [];
    const now = new Set(liveProjections[capabilityId] ?? []);
    grantedProjectionsByCapability[capabilityId] = pinned.filter((projection) => now.has(projection));
  }
  const authorityShrunk =
    capabilityIds.length !== delegation.capabilityIds.length ||
    capabilityIds.some(
      (capabilityId) =>
        !sameStringSet(grantedProjectionsByCapability[capabilityId], delegation.grantedProjectionsByCapability[capabilityId] ?? []),
    );
  const effective: DelegatedEffectiveGrant = { capabilityIds, grantedProjectionsByCapability };

  let grantedProjections: readonly string[] = [];
  let scopeKind: AgentScopeKind = profile.scope.kind;
  if (input.capabilityId !== undefined) {
    const manifest = registry.capabilities[input.capabilityId];
    if (!manifest || !capabilityIds.includes(input.capabilityId)) {
      const reason = manifest && delegation.capabilityIds.includes(input.capabilityId) ? "authority_shrunk" : "capability_not_granted";
      return refused("capability", reason, "This capability is not available to this run.", unauthorized("unauthorized_capability", "This capability is not available to this run."), { context: baseContext });
    }
    scopeKind = manifest.scope.kind;
    grantedProjections = grantedProjectionsByCapability[input.capabilityId] ?? [];
    const requested = input.requestedProjections ?? [];
    const grantedSet = new Set(grantedProjections);
    const outside = requested.filter((projection) => !grantedSet.has(projection));
    if (outside.length > 0) {
      return refused("projection", "projection_not_granted", "A requested projection is not available to this run.", unauthorized("unauthorized_projection", "A requested projection is not available to this run."), { context: baseContext });
    }
  }

  return {
    kind: "authorized",
    run,
    grant,
    delegation,
    authority: current.authority,
    tier: current.tier,
    scope: {
      kind: scopeKind,
      organizationId: grant.organizationId,
      storeId: scopeKind === "store" ? grant.storeId : undefined,
    },
    effective,
    grantedProjections,
    authorizationEpoch: epoch.epoch,
    authorityDigest: authorityDigestOf(current.authority, current.tier),
    authorityShrunk,
    runtimeGrant: runtimeGrantOf(registry, grant, effective),
  };
}

// ---------------------------------------------------------------------------
// Model-visible description
// ---------------------------------------------------------------------------

function runtimeGrantOf(
  registry: AgentCapabilityRegistry,
  pinned: Pick<Doc<"agentRunGrant">, "profileKey" | "profileVersion" | "packageKeys" | "grantDigest" | "registryDigest" | "compatibilityDigest">,
  effective: DelegatedEffectiveGrant,
): AgentRuntimeGrant {
  let egressClass: AgentEgressClass = "operational";
  const capabilityIds = [...effective.capabilityIds].sort();
  for (const capabilityId of capabilityIds) {
    const manifest = registry.capabilities[capabilityId];
    if (!manifest) continue;
    egressClass = maxEgressClass(egressClass, manifestEgressClass(manifest, effective.grantedProjectionsByCapability[capabilityId] ?? []));
  }
  return {
    profileId: pinned.profileKey,
    profileVersion: pinned.profileVersion,
    packages: [...pinned.packageKeys],
    capabilityIds,
    grantedProjectionsByCapability: Object.fromEntries(
      capabilityIds.map((capabilityId) => [capabilityId, [...(effective.grantedProjectionsByCapability[capabilityId] ?? [])]]),
    ),
    egressClass,
    registryDigest: pinned.registryDigest,
    compatibilityDigest: pinned.compatibilityDigest,
    grantDigest: pinned.grantDigest,
  };
}

/**
 * The grant-filtered discovery input (`discovery.ts` consumes this):
 * only the EFFECTIVE capability and projection set, never the registry.
 */
export function describeGrantForModel(verdict: DelegatedAuthorityAuthorized): AgentRuntimeGrant {
  return verdict.runtimeGrant;
}
