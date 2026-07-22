import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { AthenaCapability } from "../platform/capabilityCatalog";

export type OperationAdmissionCtx =
  Pick<QueryCtx, "auth" | "db"> | Pick<MutationCtx, "auth" | "db">;

export type OperationActorKind = "normal_user" | "shared_demo";

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
    };

export type OperationScope =
  | { kind: "none" }
  | { kind: "store"; storeIdArg?: string; resolve?: OperationScopeResolver }
  | {
      kind: "organization";
      organizationIdArg?: string;
      resolve?: OperationScopeResolver;
    };

export type OperationReadiness =
  { kind: "none" } | { kind: "store_write"; expectedEpochArg?: string };

export type OperationEffects =
  { mode: "none" } | { mode: "protected"; gateways: readonly string[] };

export type OperationActorCoverage = {
  normalUser: "admit" | "deny";
  sharedDemo: "admit" | "deny";
};

export type OperationDefinition = {
  functionName?: string;
  operationId: string;
  capability: AthenaCapability;
  scope: OperationScope;
  readiness: OperationReadiness;
  effects: OperationEffects;
  actors: OperationActorCoverage;
};

export type OperationReadDefinition = {
  functionName?: string;
  operationId: string;
  access: {
    intent: string;
    kind: "read";
  };
  scope: OperationScope;
  actors: OperationActorCoverage;
};

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
  operation: OperationDefinition | OperationReadDefinition;
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

export type OperationAdapterDenied = {
  error?: Error;
  kind: "denied";
  recognized: boolean;
  reason:
    | "actor_denied"
    | "capability_denied"
    | "effect_denied"
    | "scope_denied"
    | "readiness_denied";
};

export type OperationAdapterNotApplicable = {
  kind: "not_applicable";
};

export type OperationAdapterOutcome =
  | OperationAdapterAdmitted
  | OperationAdapterDenied
  | OperationAdapterNotApplicable;

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
