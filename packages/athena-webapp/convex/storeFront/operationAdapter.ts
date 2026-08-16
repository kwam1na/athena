import type { Id } from "../_generated/dataModel";
import { resolveOperationScope } from "../operationAdmission/scopes";
import {
  OPERATION_INGRESS_CLAIM_ARG,
  type OperationAdapter,
  type OperationAdapterDeniedReason,
  type OperationAdapterOutcome,
  type OperationAdmissionCtx,
  type OperationIngressClaim,
  type OperationReadAdapter,
  type AnyOperationDefinition,
} from "../operationAdmission/types";

/**
 * Storefront customer admission.
 *
 * The claim is a bearer id from a cookie: proof of possession, nothing more.
 * It confers no trust beyond `public`, and every internal callee reachable
 * from a customer route still asserts ownership of caller-supplied ids
 * against the admitted actor. The store is derived from the claim ROW; the
 * `store_id` cookie is only cross-checked, never trusted as the source.
 */
const CUSTOMER_DENIAL_MESSAGE = "This request could not be verified.";

export function readOperationIngressClaim(
  args: Record<string, unknown>,
): OperationIngressClaim | undefined {
  const claim = args[OPERATION_INGRESS_CLAIM_ARG];
  if (!claim || typeof claim !== "object") return undefined;
  return claim as OperationIngressClaim;
}

async function resolveStorefrontCustomer(
  ctx: OperationAdmissionCtx,
  args: Record<string, unknown>,
  definition: AnyOperationDefinition,
): Promise<OperationAdapterOutcome> {
  if (definition.actors.storefrontCustomer !== "admit") {
    return { kind: "not_applicable" };
  }

  const claim = readOperationIngressClaim(args);
  const storeFrontUserId = claim?.storeFrontUserId;
  const guestId = claim?.guestId;

  if (!storeFrontUserId && !guestId) {
    // A write route that admits customers never admits anonymous callers
    // (validation makes them mutually exclusive), so a missing claim there is
    // terminal. A browse read may still fall through to the public adapter.
    return definition.kind === "http"
      ? customerDenied("claim_missing")
      : { kind: "unauthenticated" };
  }

  // A claim cookie is caller-supplied text: a corrupted or hand-edited value
  // is not a parseable Convex id, and `ctx.db.get` THROWS on it rather than
  // returning null. That throw is not a fault — the caller simply presented an
  // unusable claim — so it is caught here and answered as `unknown_claim`. The
  // rail no longer converts arbitrary admission-path throws into denials, so
  // without this guard a garbage cookie would surface as a 500.
  let storeId: Id<"store"> | undefined;
  try {
    if (storeFrontUserId) {
      const user = await ctx.db.get("storeFrontUser", storeFrontUserId);
      if (!user) return customerDenied("unknown_claim");
      storeId = user.storeId;
    } else if (guestId) {
      const guest = await ctx.db.get("guest", guestId);
      if (!guest) return customerDenied("unknown_claim");
      // A guest row with no store cannot be clamped, so it cannot be admitted.
      if (!guest.storeId) return customerDenied("unknown_claim");
      storeId = guest.storeId;
    }
  } catch {
    return customerDenied("unknown_claim");
  }
  if (!storeId) return customerDenied("unknown_claim");

  if (claim?.storeId && claim.storeId !== storeId) {
    return customerDenied("scope_denied");
  }

  const constraints = await resolveOperationScope(ctx, args, definition);
  if (constraints.storeId && constraints.storeId !== storeId) {
    return customerDenied("scope_denied");
  }

  return {
    actor: {
      kind: "storefront_customer",
      assurance: "bearer_id",
      storeId,
      ...(storeFrontUserId ? { storeFrontUserId } : {}),
      // Identity precedence: the account wins whenever both cookies are
      // present, so `guestId` names the actor ONLY for a pure guest. A
      // signed-in shopper's guest cookie is possession evidence, not identity,
      // and travels to the merge callees separately (see
      // `admittedClaimGuestId` in the customer-channel routes).
      ...(guestId && !storeFrontUserId ? { guestId } : {}),
    },
    constraints: { storeId },
    decision: { adapter: "storefront_customer", outcome: "admitted" },
    provenance: {
      kind: "storefront_customer",
      assurance: "bearer_id",
      operationId: definition.operationId,
    },
  };
}

export function createStorefrontCustomerOperationAdapter(): OperationAdapter {
  return {
    kind: "storefront_customer",
    resolve: (ctx, args, definition) =>
      resolveStorefrontCustomer(ctx, args, definition),
  };
}

export function createStorefrontCustomerReadOperationAdapter(): OperationReadAdapter {
  return {
    kind: "storefront_customer",
    resolve: (ctx, args, definition) =>
      resolveStorefrontCustomer(ctx, args, definition),
  };
}

function customerDenied(reason: OperationAdapterDeniedReason) {
  return {
    error: new Error(CUSTOMER_DENIAL_MESSAGE),
    kind: "denied" as const,
    reason,
    recognized: true,
  };
}
