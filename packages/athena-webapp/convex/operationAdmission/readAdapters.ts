import type { QueryCtx } from "../_generated/server";
import {
  requireAthenaIdentityPort,
  resolveAdmissionChain,
  type AthenaIdentityPort,
} from "./adapters";
import { resolveOperationScope } from "./scopes";
import type {
  OperationAdmissionContext,
  OperationReadAdapter,
  OperationReadDefinition,
} from "./types";

export function createNormalUserReadOperationAdapter(options?: {
  resolveAthenaUser?: AthenaIdentityPort;
}): OperationReadAdapter {
  return {
    kind: "normal_user",
    resolve: async (ctx, args, definition) => {
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

/** TRANSITIONAL adapter-set shape; deleted with its call sites in U1c. */
export type LegacyOperationReadAdapterSet = {
  normalAdapter?: OperationReadAdapter;
  sharedDemoAdapter?: OperationReadAdapter;
  publicAdapter?: OperationReadAdapter;
};

export function resolveReadOperationAdmission(
  ctx: QueryCtx,
  args: Record<string, unknown>,
  definition: OperationReadDefinition,
  adapters: readonly OperationReadAdapter[] | LegacyOperationReadAdapterSet,
): Promise<OperationAdmissionContext> {
  const chain = Array.isArray(adapters)
    ? adapters
    : ([
        (adapters as LegacyOperationReadAdapterSet).sharedDemoAdapter,
        (adapters as LegacyOperationReadAdapterSet).normalAdapter ??
          createNormalUserReadOperationAdapter(),
        (adapters as LegacyOperationReadAdapterSet).publicAdapter ??
          createPublicReadOperationAdapter(),
      ].filter(Boolean) as OperationReadAdapter[]);
  return resolveAdmissionChain(ctx, args, definition, chain);
}
