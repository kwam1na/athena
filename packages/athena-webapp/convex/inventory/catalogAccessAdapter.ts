import type { Id } from "../_generated/dataModel";
import { resolveOperationScope } from "../operationAdmission/scopes";
import {
  OPERATION_INGRESS_CLAIM_ARG,
  type OperationAdapterDeniedReason,
  type OperationAdapterOutcome,
  type OperationAdmissionCtx,
  type OperationIngressClaim,
  type OperationReadAdapter,
  type OperationReadDefinition,
} from "../operationAdmission/types";

/**
 * Catalogue reader admission.
 *
 * The caller is a program holding a per-store token this server minted. That
 * is ingress IDENTITY, in the same sense as the storefront cookie claim — not
 * delegated authority: the token acts for itself, under the store it was
 * minted for, and carries no operator's grant.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT IMPORT. It reads the token table
 * through `_generated` alone. The mint module (`inventory/catalogAccess.ts`)
 * imports the admission composition root, so importing it here would make
 * every admission depend on the module admission exists to guard, and the
 * token's shape would be enforced in two places that could drift apart. For
 * the same reason the minted token's shape is re-stated at ingress
 * (`http/utils.ts`) rather than imported: nothing on the request path pulls
 * in the module that mints.
 *
 * A PRESENTED CREDENTIAL IS RECOGNISED IDENTITY. On a definition that denies
 * this actor the outcome is a terminal `denied`, before any lookup — the
 * `normal_user` precedent (`operationAdmission/readAdapters.ts`), not the
 * storefront adapter's `not_applicable`. A stale cookie belongs to a shopper
 * who never asked to be identified; a token in a header was chosen and sent,
 * so falling through to the anonymous adapter would let a rejected credential
 * quietly read whatever anonymous callers may read.
 */
const CATALOG_READER_DENIAL_MESSAGE = "Catalogue access unavailable.";

function catalogReaderDenied(reason: OperationAdapterDeniedReason) {
  return {
    error: new Error(CATALOG_READER_DENIAL_MESSAGE),
    kind: "denied" as const,
    reason,
    recognized: true,
  };
}

async function resolveCatalogReader(
  ctx: OperationAdmissionCtx,
  args: Record<string, unknown>,
  definition: OperationReadDefinition,
): Promise<OperationAdapterOutcome> {
  const claim = args[OPERATION_INGRESS_CLAIM_ARG] as
    | OperationIngressClaim
    | undefined;
  const tokenHash =
    claim && typeof claim === "object" ? claim.catalogAccessTokenHash : undefined;

  // No credential of this kind present: the caller is somebody else's.
  if (!tokenHash) return { kind: "not_applicable" };

  if (definition.actors.catalogReader !== "admit") {
    return catalogReaderDenied("actor_denied");
  }

  const token = await ctx.db
    .query("catalogAccessToken")
    .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
    .unique();
  // Unknown and revoked are the same answer on purpose: a reader learns that
  // its credential is not accepted, never which of the two it is.
  if (!token || token.status !== "active") {
    return catalogReaderDenied("unknown_claim");
  }

  const storeId: Id<"store"> = token.storeId;
  const constraints = await resolveOperationScope(ctx, args, definition);
  // The store comes from the token ROW. A `storeId` argument is only ever
  // cross-checked against it, exactly as the `store_id` cookie is.
  if (constraints.storeId && constraints.storeId !== storeId) {
    return catalogReaderDenied("scope_denied");
  }

  return {
    actor: {
      kind: "catalog_reader",
      assurance: "bearer_token",
      storeId,
      tokenId: token._id,
    },
    constraints: { storeId },
    decision: { adapter: "catalog_reader", outcome: "admitted" },
    provenance: {
      kind: "catalog_reader",
      assurance: "bearer_token",
      operationId: definition.operationId,
      // Freshness the handler needs to decide whether a stamp is due. It
      // travels here rather than being re-read, so the read path costs one
      // token lookup in total.
      lastUsedAt: token.lastUsedAt,
    },
  };
}

export function createCatalogReaderReadOperationAdapter(): OperationReadAdapter {
  return {
    kind: "catalog_reader",
    resolve: (ctx, args, definition) =>
      resolveCatalogReader(ctx, args, definition),
  };
}
