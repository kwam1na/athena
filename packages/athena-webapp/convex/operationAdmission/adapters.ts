import { ConvexError } from "convex/values";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type {
  AnyOperationDefinition,
  OperationAdapter,
  OperationAdapterAdmitted,
  OperationAdapterDenied,
  OperationAdapterDeniedReason,
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
 * The identity port is a required construction argument: every adapter is
 * built at the composition root, which is the only module that knows how to
 * resolve an Athena identity. There is no registered default to fall back on,
 * so a chain assembled without a port fails at construction rather than at the
 * first request.
 */
export function createNormalUserOperationAdapter(options: {
  resolveAthenaUser: AthenaIdentityPort;
}): OperationAdapter {
  return {
    kind: "normal_user",
    resolve: async (ctx, args, definition) => {
      // Identity before scope: a scope resolver that throws must never be able
      // to turn an authenticated caller into an anonymous one.
      const athenaUser = await options.resolveAthenaUser(ctx);
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

/**
 * Marker carried on every admission failure the rail itself raises.
 *
 * HTTP ingress needs to answer "was this refused, or did it break?" on the far
 * side of a `ctx.runMutation` boundary, where the original Error class is
 * gone. Classifying by message text there would reintroduce exactly the
 * string-matching this rail removed from the adapters, so the outcome travels
 * as DATA on a `ConvexError` instead.
 *
 * `outcome` distinguishes "no identity at all" (401) from "identified and
 * refused" (403). Anything without this marker is a real fault and must keep
 * surfacing as a 500.
 */
export const OPERATION_ADMISSION_DENIED = "operation_admission_denied" as const;

export type OperationAdmissionDenialData = {
  kind: typeof OPERATION_ADMISSION_DENIED;
  message: string;
  outcome: "denied" | "unauthenticated";
  reason?: OperationAdapterDeniedReason;
};

export function operationAdmissionDenial(
  data: OperationAdmissionDenialData,
): ConvexError<OperationAdmissionDenialData> {
  return new ConvexError(data);
}

/**
 * Read the denial marker off an error that may have crossed a Convex
 * boundary. Convex preserves `ConvexError.data` across `runMutation`, so this
 * works on both sides.
 */
export function operationAdmissionDenialData(
  error: unknown,
): OperationAdmissionDenialData | undefined {
  const data = (error as { data?: unknown } | undefined)?.data;
  if (
    data &&
    typeof data === "object" &&
    (data as { kind?: unknown }).kind === OPERATION_ADMISSION_DENIED
  ) {
    return data as OperationAdmissionDenialData;
  }
  return undefined;
}

/**
 * The chain ran out of adapters without any of them claiming the caller.
 *
 * A distinct class, not a distinct message: HTTP ingress must map this to 401
 * and a genuine refusal to 403, and deciding that by comparing message text is
 * the failure mode this rail exists to remove. The message is unchanged from
 * the plain `Error` it replaces, so existing call sites and assertions that
 * match on it are unaffected.
 */
export class OperationUnauthenticatedError extends Error {
  readonly operationAdmissionOutcome = "unauthenticated" as const;

  constructor(message = "Sign in again to continue.") {
    super(message);
    this.name = "OperationUnauthenticatedError";
  }
}

export function operationDenialError(outcome: OperationAdapterDenied): Error {
  return (
    outcome.error ??
    new Error("This operation is not available for the current actor.")
  );
}

/**
 * Re-throw an admission failure as a typed denial that survives a Convex
 * `runMutation` / `runQuery` boundary.
 *
 * Applied only at the registered entry points, which exist solely for actions
 * and HTTP routes. Direct mutation and query call sites never pass through
 * here, so their error contracts are untouched.
 */
export function asOperationAdmissionDenial(error: unknown) {
  const existing = operationAdmissionDenialData(error);
  if (existing) return operationAdmissionDenial(existing);

  return operationAdmissionDenial({
    kind: OPERATION_ADMISSION_DENIED,
    message:
      error instanceof Error
        ? error.message
        : "This operation is not available for the current actor.",
    outcome:
      error instanceof OperationUnauthenticatedError
        ? "unauthenticated"
        : "denied",
  });
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

  throw new OperationUnauthenticatedError();
}
