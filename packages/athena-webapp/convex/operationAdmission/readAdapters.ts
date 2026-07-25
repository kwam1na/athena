import type { QueryCtx } from "../_generated/server";
import { requireAuthenticatedAthenaUserWithCtx } from "../lib/athenaUserAuth";
import { getSharedDemoActorWithCtx } from "../sharedDemo/actor";
import { denySharedDemoAction } from "../sharedDemo/policy";
import { resolveOperationScope } from "./scopes";
import type {
  OperationAdapterAdmitted,
  OperationAdapterOutcome,
  OperationReadAdapter,
  OperationReadDefinition,
} from "./types";

export function createNormalUserReadOperationAdapter(): OperationReadAdapter {
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
        provenance: {
          kind: "normal_user",
          operationId: definition.operationId,
          readIntent: definition.access.intent,
        },
      };
    },
  };
}

export function createPublicReadOperationAdapter(): OperationReadAdapter {
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
        provenance: {
          kind: "public",
          operationId: definition.operationId,
          readIntent: definition.access.intent,
        },
      };
    },
  };
}

export function createSharedDemoReadOperationAdapter(): OperationReadAdapter {
  return {
    kind: "shared_demo",
    resolve: async (ctx, args, definition) => {
      let actor;
      try {
        actor = await getSharedDemoActorWithCtx(ctx);
      } catch (error) {
        if (isRecognizedSharedDemoActorError(error)) {
          return {
            error: error instanceof Error ? error : new Error(String(error)),
            kind: "denied",
            reason: "actor_denied",
            recognized: true,
          };
        }
        throw error;
      }
      if (!actor) return { kind: "not_applicable" };
      if (definition.actors.sharedDemo !== "admit") {
        return sharedDemoReadDenied("actor_denied");
      }

      const constraints = await resolveOperationScope(ctx, args, definition);
      if (constraints.storeId && constraints.storeId !== actor.storeId) {
        return sharedDemoReadDenied("scope_denied");
      }
      if (
        constraints.organizationId &&
        constraints.organizationId !== actor.organizationId
      ) {
        return sharedDemoReadDenied("scope_denied");
      }

      return {
        actor,
        constraints: {
          organizationId: actor.organizationId,
          storeId: actor.storeId,
        },
        decision: { adapter: "shared_demo", outcome: "admitted" },
        provenance: {
          kind: "shared_demo",
          operationId: definition.operationId,
          readIntent: definition.access.intent,
        },
      };
    },
  };
}

export async function resolveReadOperationAdmission(
  ctx: QueryCtx,
  args: Record<string, unknown>,
  definition: OperationReadDefinition,
  adapters: {
    normalAdapter?: OperationReadAdapter;
    sharedDemoAdapter?: OperationReadAdapter;
    publicAdapter?: OperationReadAdapter;
  } = {},
) {
  const sharedDemoAdapter = adapters.sharedDemoAdapter;
  if (sharedDemoAdapter) {
    const demoOutcome = await sharedDemoAdapter.resolve(ctx, args, definition);
    if (isAdmitted(demoOutcome)) {
      return { ...demoOutcome, operation: definition };
    }
    if (demoOutcome.kind === "denied" && demoOutcome.recognized) {
      throw (
        demoOutcome.error ??
        new Error("This operation is not available for the shared demo.")
      );
    }
  }

  const normalAdapter =
    adapters.normalAdapter ?? createNormalUserReadOperationAdapter();
  const publicAdapter =
    adapters.publicAdapter ?? createPublicReadOperationAdapter();

  // The normal adapter throws "Sign in again" for anonymous callers. Rather
  // than have it swallow that, we let it throw and fall through to the public
  // adapter, which admits an anonymous actor only for operations that opt in
  // (actors.public === "admit"). If public does not admit, the original
  // authentication error is preserved.
  let normalOutcome: Awaited<ReturnType<OperationReadAdapter["resolve"]>>;
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

function isRecognizedSharedDemoActorError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("demo session has expired") ||
    error.message.includes("demo is unavailable in this environment")
  );
}

function sharedDemoReadDenied(
  reason: "actor_denied" | "capability_denied" | "scope_denied",
) {
  return {
    error: sharedDemoReadDenialError(),
    kind: "denied" as const,
    reason,
    recognized: true,
  };
}

function sharedDemoReadDenialError() {
  try {
    denySharedDemoAction();
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  return new Error("This view isn't available in the demo.");
}
