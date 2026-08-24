import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type {
  OperationAdapter,
  OperationAdapterDeniedReason,
} from "../operationAdmission/types";
import { resolveOperationCapabilities } from "../operationAdmission/capabilities";
import { resolveOperationScope } from "../operationAdmission/scopes";
import {
  getSharedDemoActorWithCtx,
  isSharedDemoActorError,
  sharedDemoActorDenialError,
} from "./actor";
import {
  classifySharedDemoExternalGateway,
  denySharedDemoAction,
  requireSharedDemoCapability,
  SHARED_DEMO_LIFECYCLE_CAPABILITY,
} from "./policy";
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
      } catch (error) {
        // Recognized principal failures are typed denials: a disabled or
        // expired demo session must never fall through and be re-admitted as
        // a NORMAL USER. The one narrow exception below is a fall-through to
        // `public`, which grants strictly less than the demo already did.
        if (isSharedDemoActorError(error)) {
          // An expired session is not a demo actor. For an operation the demo
          // was ALREADY allowed to perform and the public may perform anyway —
          // minting the ticket that STARTS a session — the caller is therefore
          // just anonymous, and denying makes recovery unreachable: taking a
          // fresh admission would require already holding a live one. That
          // deadlock is what strands a visitor whose demo expired.
          //
          // Scoped to the demo's OWN lifecycle capability, not to every
          // public-admitted write. Keying only on `public: "admit"` would also
          // open invite redemption, auth-code verification, passkey
          // registration and remote-assist credentials — writes carrying a
          // deliberate `sharedDemo: "deny"` — and would let POS sync writes
          // through as anonymous, skipping the restore fence and the demo
          // capture port below. `demo.lifecycle` is exactly the set that
          // manages a demo session, which is the only thing an expired
          // session needs to reach.
          //
          // Nor can this re-admit the caller as a normal user, which is the
          // fall-through this adapter exists to prevent: a demo auth identity
          // is created with a name and no email, and the normal-user adapter
          // resolves its Athena user BY email, so it finds nothing and falls
          // through too.
          if (
            error.reason === "session_expired" &&
            definition.capability === SHARED_DEMO_LIFECYCLE_CAPABILITY &&
            definition.actors.public === "admit"
          ) {
            return { kind: "not_applicable" };
          }
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
        return sharedDemoDenied("actor_denied");
      }

      // All-of semantics: a batch that mixes granted and ungranted
      // capabilities is denied as a whole, before the handler runs.
      const capabilities = resolveOperationCapabilities(
        definition.capability,
        args,
      );
      if (capabilities.kind === "out_of_candidates") {
        return sharedDemoDenied("capability_denied");
      }
      try {
        for (const capability of capabilities.capabilities) {
          requireSharedDemoCapability(capability);
        }
      } catch {
        return sharedDemoDenied("capability_denied");
      }

      if (definition.effects.mode === "protected") {
        const deniedGateway = definition.effects.gateways.some(
          (gateway) =>
            classifySharedDemoExternalGateway(gateway).decision !== "simulated",
        );
        if (deniedGateway) {
          return sharedDemoDenied("effect_denied");
        }
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

      if (
        definition.readiness.kind === "store_write" ||
        definition.readiness.kind === "store_ready"
      ) {
        // `store_ready` is the same fence without write semantics: an action
        // or route admitted while the store is restoring is denied here, and
        // the internal mutation that performs the write re-applies the epoch
        // assertion with the admitted store id.
        const expectedEpoch =
          definition.readiness.kind === "store_write" &&
          definition.readiness.expectedEpochArg &&
          typeof args[definition.readiness.expectedEpochArg] === "number"
            ? (args[definition.readiness.expectedEpochArg] as number)
            : undefined;
        try {
          await (
            options.requireReadyWrite ?? requireReadySharedDemoWriteWithCtx
          )(ctx, { expectedEpoch, storeId: actor.storeId });
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

function sharedDemoDenied(reason: OperationAdapterDeniedReason) {
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
