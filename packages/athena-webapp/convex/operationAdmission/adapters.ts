import {
  requireAuthenticatedAthenaUserWithCtx,
} from "../lib/athenaUserAuth";
import type { MutationCtx } from "../_generated/server";
import type {
  OperationAdapter,
  OperationAdapterAdmitted,
  OperationAdapterOutcome,
  OperationDefinition,
} from "./types";
import { resolveOperationScope } from "./scopes";

export function createNormalUserOperationAdapter(): OperationAdapter {
  return {
    kind: "normal_user",
    resolve: async (ctx, args, definition) => {
      if (definition.actors.normalUser === "deny") {
        return {
          kind: "denied",
          recognized: true,
          reason: "actor_denied",
        };
      }
      const [athenaUser, constraints] = await Promise.all([
        requireAuthenticatedAthenaUserWithCtx(ctx),
        resolveOperationScope(ctx, args, definition),
      ]);
      return {
        actor: {
          kind: "normal_user",
          athenaUserId: athenaUser._id,
        },
        constraints,
        decision: { adapter: "normal_user", outcome: "admitted" },
        provenance: { kind: "normal_user" },
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
        provenance: { kind: "public" },
      };
    },
  };
}

export async function resolveOperationAdmission(
  ctx: MutationCtx,
  args: Record<string, unknown>,
  definition: OperationDefinition,
  adapters: {
    normalAdapter?: OperationAdapter;
    sharedDemoAdapter?: OperationAdapter;
    publicAdapter?: OperationAdapter;
  } = {},
) {
  const sharedDemoAdapter = adapters.sharedDemoAdapter;
  if (sharedDemoAdapter) {
    const demoOutcome = await sharedDemoAdapter.resolve(ctx, args, definition);
    if (isAdmitted(demoOutcome)) {
      return { ...demoOutcome, operation: definition };
    }
    if (demoOutcome.kind === "denied" && demoOutcome.recognized) {
      throw demoOutcome.error ??
        new Error("This operation is not available for the shared demo.");
    }
  }

  const normalAdapter = adapters.normalAdapter ?? createNormalUserOperationAdapter();
  const publicAdapter =
    adapters.publicAdapter ?? createPublicOperationAdapter();

  // The normal adapter throws "Sign in again" for anonymous callers. Rather
  // than have it swallow that, we let it throw and fall through to the public
  // adapter, which admits an anonymous actor only for operations that opt in
  // (actors.public === "admit"). If public does not admit, the original
  // authentication error is preserved.
  let normalOutcome: Awaited<ReturnType<OperationAdapter["resolve"]>>;
  try {
    normalOutcome = await normalAdapter.resolve(ctx, args, definition);
  } catch (error) {
    const publicOutcome = await publicAdapter.resolve(ctx, args, definition);
    if (isAdmitted(publicOutcome)) {
      return { ...publicOutcome, operation: definition };
    }
    throw error;
  }
  if (isAdmitted(normalOutcome)) {
    return { ...normalOutcome, operation: definition };
  }
  if (normalOutcome.kind === "denied") {
    throw new Error("This operation is not available for the current actor.");
  }

  const publicOutcome = await publicAdapter.resolve(ctx, args, definition);
  if (isAdmitted(publicOutcome)) {
    return { ...publicOutcome, operation: definition };
  }

  throw new Error("Sign in again to continue.");
}

function isAdmitted(
  outcome: OperationAdapterOutcome,
): outcome is OperationAdapterAdmitted {
  return "actor" in outcome;
}
