import type {
  OperationAdapterDeniedReason,
  OperationReadAdapter,
} from "../operationAdmission/types";
import { resolveOperationScope } from "../operationAdmission/scopes";
import {
  getSharedDemoActorWithCtx,
  isSharedDemoActorError,
  sharedDemoActorDenialError,
} from "./actor";
import { denySharedDemoAction, isSharedDemoReadIntentAllowed } from "./policy";

/**
 * Shared-demo read admission.
 *
 * Moved out of the rail core in U1a so `convex/operationAdmission/**` imports
 * no policy. Reads are governed by their own closed grant set
 * (`SHARED_DEMO_ALLOWED_READ_INTENTS`) rather than by write capabilities: a
 * demo visitor who may complete a sale is not thereby entitled to every view.
 */
export function createSharedDemoReadOperationAdapter(): OperationReadAdapter {
  return {
    kind: "shared_demo",
    resolve: async (ctx, args, definition) => {
      let actor;
      try {
        actor = await getSharedDemoActorWithCtx(ctx);
      } catch (error) {
        if (isSharedDemoActorError(error)) {
          // Reads keep denying an expired session, including the ones a
          // public caller could make. The denial IS the signal: it is how the
          // client learns the session ended and renews itself. Letting a read
          // like `app:getCurrentUser` fall through to `public` instead answers
          // it successfully, the app sees a half-identified visitor rather
          // than an expired demo, and the visitor is quietly redirected to a
          // sign-in form they have no credentials for.
          //
          // Recovery is a WRITE — minting a fresh ticket — and that is where
          // the reachability exception lives (`operationAdapter.ts`).
          return {
            error: sharedDemoActorDenialError(error),
            kind: "denied",
            reason: error.reason,
            recognized: true,
          };
        }
        throw error;
      }
      if (!actor) return { kind: "not_applicable" };
      if (definition.actors.sharedDemo !== "admit") {
        return sharedDemoReadDenied("actor_denied");
      }
      if (!isSharedDemoReadIntentAllowed(definition.access.intent)) {
        return sharedDemoReadDenied("capability_denied");
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

function sharedDemoReadDenied(reason: OperationAdapterDeniedReason) {
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
