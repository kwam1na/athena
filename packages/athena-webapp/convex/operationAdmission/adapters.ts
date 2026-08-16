import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type {
  AnyOperationDefinition,
  OperationAdapter,
  OperationAdapterAdmitted,
  OperationAdapterDenied,
  OperationAdapterOutcome,
  OperationAdmissionContext,
  OperationAdmissionCtx,
  OperationDefinition,
} from "./types";
import { resolveOperationScope } from "./scopes";

/**
 * The rail core knows how to find "the authenticated Athena user" only through
 * this port. Wiring it lives at the composition root, so no policy or auth
 * module is imported from inside `convex/operationAdmission/**`.
 */
export type AthenaIdentityPort = (
  ctx: OperationAdmissionCtx,
) => Promise<{ _id: Id<"athenaUser"> } | null>;

type GenericAdapter<Definition extends AnyOperationDefinition> = {
  kind: OperationAdapter["kind"];
  resolve: (
    ctx: never,
    args: Record<string, unknown>,
    definition: Definition,
  ) => Promise<OperationAdapterOutcome>;
};

export function isAdmittedOutcome(
  outcome: OperationAdapterOutcome,
): outcome is OperationAdapterAdmitted {
  return "actor" in outcome;
}

/**
 * TRANSITIONAL default identity port.
 *
 * The composition root registers the real resolver at module init. It exists
 * only so the three pre-existing call sites that construct their own adapter
 * chain (`operations/approvalRequests.ts`,
 * `operations/openWorkInventoryReviews.ts`, `sharedDemo/public.ts`) keep
 * working until U1c folds them onto the canonical wrappers; after that every
 * adapter is constructed at the composition root with the port passed in.
 */
let defaultAthenaIdentityPort: AthenaIdentityPort | undefined;

export function registerAthenaIdentityPort(port: AthenaIdentityPort) {
  defaultAthenaIdentityPort = port;
}

export function requireAthenaIdentityPort(
  port: AthenaIdentityPort | undefined,
): AthenaIdentityPort {
  const resolved = port ?? defaultAthenaIdentityPort;
  if (!resolved) {
    throw new Error(
      "No Athena identity port is registered on the admission rail.",
    );
  }
  return resolved;
}

export function createNormalUserOperationAdapter(options?: {
  resolveAthenaUser?: AthenaIdentityPort;
}): OperationAdapter {
  return {
    kind: "normal_user",
    resolve: async (ctx, args, definition) => {
      // Identity before scope: a scope resolver that throws must never be able
      // to turn an authenticated caller into an anonymous one.
      const athenaUser = await requireAthenaIdentityPort(
        options?.resolveAthenaUser,
      )(ctx);
      if (!athenaUser) return { kind: "unauthenticated" };
      if (definition.actors.normalUser === "deny") {
        return {
          kind: "denied",
          recognized: true,
          reason: "actor_denied",
        };
      }
      const constraints = await resolveOperationScope(ctx, args, definition);
      return {
        actor: {
          kind: "normal_user",
          athenaUserId: athenaUser._id,
        },
        constraints,
        decision: { adapter: "normal_user", outcome: "admitted" },
        provenance: { kind: "normal_user", operationId: definition.operationId },
      };
    },
  };
}

export function createPublicOperationAdapter(): OperationAdapter {
  return {
    kind: "public",
    resolve: async (ctx, args, definition) => {
      if (definition.actors.public !== "admit") {
        return { kind: "not_applicable" };
      }
      const constraints = await resolveOperationScope(ctx, args, definition);
      return {
        actor: { kind: "public" },
        constraints,
        decision: { adapter: "public", outcome: "admitted" },
        provenance: { kind: "public", operationId: definition.operationId },
      };
    },
  };
}

export function operationDenialError(outcome: OperationAdapterDenied): Error {
  return (
    outcome.error ??
    new Error("This operation is not available for the current actor.")
  );
}

/**
 * Fail-closed admission chain.
 *
 * Walks the registered adapters in trust order and falls through ONLY on
 * `unauthenticated` / `not_applicable`. A `denied` outcome is terminal — it is
 * never retried against a lower-trust adapter — and an unexpected throw from
 * any adapter propagates untouched. There is no catch-and-fall-through here by
 * design: routing a scope-resolver failure to the public adapter is exactly
 * the fail-open shape this rail exists to remove.
 */
export async function resolveAdmissionChain<
  Definition extends AnyOperationDefinition,
>(
  ctx: unknown,
  args: Record<string, unknown>,
  definition: Definition,
  adapters: readonly GenericAdapter<Definition>[],
): Promise<OperationAdmissionContext> {
  for (const adapter of adapters) {
    const outcome = await adapter.resolve(
      ctx as never,
      args,
      definition,
    );
    if (isAdmittedOutcome(outcome)) {
      return { ...outcome, operation: definition };
    }
    if (outcome.kind === "denied") {
      throw operationDenialError(outcome);
    }
  }

  throw new Error("Sign in again to continue.");
}

/**
 * TRANSITIONAL adapter-set shape. U1c deletes it along with the call sites
 * that hand-assemble a chain.
 */
export type LegacyOperationAdapterSet = {
  normalAdapter?: OperationAdapter;
  sharedDemoAdapter?: OperationAdapter;
  publicAdapter?: OperationAdapter;
};

export function resolveOperationAdmission(
  ctx: MutationCtx,
  args: Record<string, unknown>,
  definition: OperationDefinition,
  adapters: readonly OperationAdapter[] | LegacyOperationAdapterSet,
): Promise<OperationAdmissionContext> {
  const chain = Array.isArray(adapters)
    ? adapters
    : ([
        (adapters as LegacyOperationAdapterSet).sharedDemoAdapter,
        (adapters as LegacyOperationAdapterSet).normalAdapter ??
          createNormalUserOperationAdapter(),
        (adapters as LegacyOperationAdapterSet).publicAdapter ??
          createPublicOperationAdapter(),
      ].filter(Boolean) as OperationAdapter[]);
  return resolveAdmissionChain(ctx, args, definition, chain);
}
