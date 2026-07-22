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

export async function resolveOperationAdmission(
  ctx: MutationCtx,
  args: Record<string, unknown>,
  definition: OperationDefinition,
  adapters: {
    normalAdapter?: OperationAdapter;
    sharedDemoAdapter?: OperationAdapter;
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
  const normalOutcome = await normalAdapter.resolve(ctx, args, definition);
  if (isAdmitted(normalOutcome)) {
    return { ...normalOutcome, operation: definition };
  }
  if (normalOutcome.kind === "denied") {
    throw new Error("This operation is not available for the current actor.");
  }
  throw new Error("Sign in again to continue.");
}

function isAdmitted(
  outcome: OperationAdapterOutcome,
): outcome is OperationAdapterAdmitted {
  return "actor" in outcome;
}
