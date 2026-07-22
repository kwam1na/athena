import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { OperationAdapter } from "../operationAdmission/types";
import { resolveOperationScope } from "../operationAdmission/scopes";
import { getSharedDemoActorWithCtx } from "./actor";
import { denySharedDemoAction, requireSharedDemoCapability } from "./policy";
import { requireReadySharedDemoWriteWithCtx } from "./restore";

type ReadyWrite = (
  ctx: Pick<MutationCtx, "auth" | "db">,
  args: { expectedEpoch?: number; storeId: Id<"store"> },
) => Promise<unknown>;

export function createSharedDemoOperationAdapter(
  options: { requireReadyWrite?: ReadyWrite } = {},
): OperationAdapter {
  return {
    kind: "shared_demo",
    resolve: async (ctx, args, definition) => {
      let actor;
      try {
        actor = await getSharedDemoActorWithCtx(ctx);
      } catch {
        return { kind: "not_applicable" };
      }
      if (!actor) return { kind: "not_applicable" };
      if (definition.actors.sharedDemo !== "admit") {
        return sharedDemoDenied("capability_denied");
      }
      try {
        requireSharedDemoCapability(definition.capability);
      } catch {
        return sharedDemoDenied("capability_denied");
      }

      const constraints = await resolveOperationScope(ctx, args, definition);
      if (constraints.storeId && constraints.storeId !== actor.storeId) {
        return sharedDemoDenied("scope_denied");
      }
      if (
        constraints.organizationId &&
        constraints.organizationId !== actor.organizationId
      ) {
        return sharedDemoDenied("scope_denied");
      }

      if (definition.readiness.kind === "store_write") {
        const expectedEpoch =
          definition.readiness.expectedEpochArg &&
          typeof args[definition.readiness.expectedEpochArg] === "number"
            ? (args[definition.readiness.expectedEpochArg] as number)
            : undefined;
        try {
          await (options.requireReadyWrite ?? requireReadySharedDemoWriteWithCtx)(
            ctx,
            { expectedEpoch, storeId: actor.storeId },
          );
        } catch {
          return sharedDemoDenied("readiness_denied");
        }
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
        },
      };
    },
  };
}

function sharedDemoDenied(
  reason: "actor_denied" | "capability_denied" | "scope_denied" | "readiness_denied",
) {
  return {
    error: sharedDemoDenialError(),
    kind: "denied" as const,
    reason,
    recognized: true,
  };
}

function sharedDemoDenialError() {
  try {
    denySharedDemoAction();
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  return new Error("This action isn't allowed in the demo.");
}
