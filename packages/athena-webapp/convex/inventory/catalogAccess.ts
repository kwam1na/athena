import { v } from "convex/values";
import { internalMutation, mutation, query } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { requireOrganizationMemberRoleWithCtx } from "../lib/athenaUserAuth";
import { commandResultValidator } from "../lib/commandResultValidators";
import {
  OPERATION_ADMISSION_DENIED,
  operationAdmissionDenial,
} from "../operationAdmission/adapters";
import {
  mintCatalogAccessTokenOperationDefinition,
  revokeCatalogAccessTokenOperationDefinition,
} from "../operationAdmission/domains/catalogAccess_definitions";
import { listCatalogAccessTokensReadDefinition } from "../operationAdmission/domains/catalogAccess_readDefinitions";
import type {
  OperationMutationCtx,
  OperationQueryCtx,
} from "../operationAdmission/types";
import {
  admitPublicMutation,
  admitPublicQuery,
} from "../platform/operationAdmission";
import { sha256Hex } from "../platform/storefrontCookieSignature";
import { ok, userError, type CommandResult } from "../../shared/commandResult";

/**
 * Per-store catalogue access tokens.
 *
 * The raw value is returned exactly once, by `mint`. Only its SHA-256 is
 * stored, so a leaked database row cannot be presented as a credential and a
 * lost token can only be replaced, never recovered. Every response on this
 * module omits `tokenHash` for the same reason: the stored hash is the
 * verifier's secret, not an operator-facing field.
 *
 * Authorization is deliberately two-layered. The admission rail clamps the
 * store the caller CLAIMS, and each handler then resolves that store's own
 * organization and requires a `full_admin` membership there — so another
 * organization's full admin is refused even though they are a full admin
 * somewhere. Revoke goes one step further and compares the target row's own
 * `storeId` against the admitted constraint, because the store scope only
 * echoes `args.storeId` and never binds a row.
 */

/** Prefix plus 43 base64url characters (32 bytes, unpadded). */
export const CATALOG_ACCESS_TOKEN_PREFIX = "athcat_";
export const CATALOG_ACCESS_TOKEN_PATTERN = /^athcat_[A-Za-z0-9_-]{43}$/;
const CATALOG_ACCESS_TOKEN_BYTES = 32;

/** A store keeps a handful of integrations, not a key ring. */
export const MAX_ACTIVE_CATALOG_ACCESS_TOKENS = 5;
export const CATALOG_ACCESS_TOKEN_LABEL_MAX_LENGTH = 80;

/**
 * `lastUsedAt` is operator-facing freshness, not an audit log, so a busy
 * reader writes at most once per quarter hour.
 */
export const CATALOG_ACCESS_TOKEN_TOUCH_INTERVAL_MS = 15 * 60 * 1000;

/** One store's whole key ring, active and revoked, in a single bounded read. */
const CATALOG_ACCESS_TOKEN_LIST_CAP = 50;
const CATALOG_ACCESS_TOKEN_DELETE_BATCH_SIZE = 100;

/**
 * One opaque message for every refusal (no auth, no store, wrong
 * organization, insufficient role) so a caller cannot probe which stores
 * exist.
 */
const CATALOG_ACCESS_DENIED = "Catalogue access unavailable.";

/** Stripping control characters is the point of this pattern. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

export function normalizeCatalogAccessTokenLabel(label: string): string {
  return label.replace(CONTROL_CHARACTERS, "").trim();
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 32 CSPRNG bytes, base64url, prefixed. Never persisted. */
export function generateCatalogAccessTokenValue(): string {
  const bytes = new Uint8Array(CATALOG_ACCESS_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return `${CATALOG_ACCESS_TOKEN_PREFIX}${base64UrlEncode(bytes)}`;
}

/** Hash of the EXACT header value a reader presents, lowercase hex. */
export function hashCatalogAccessTokenValue(token: string): string {
  return sha256Hex(new TextEncoder().encode(token));
}

type CatalogAccessCtx = OperationMutationCtx | OperationQueryCtx;

async function requireStoreFullAdminWithCtx(
  ctx: CatalogAccessCtx,
  storeId: Id<"store">,
) {
  const actor = ctx.operationAdmission.actor;
  if (actor.kind !== "normal_user") {
    throw new Error(CATALOG_ACCESS_DENIED);
  }
  const store = await ctx.db.get("store", storeId);
  if (!store) {
    throw new Error(CATALOG_ACCESS_DENIED);
  }
  await requireOrganizationMemberRoleWithCtx(ctx, {
    allowedRoles: ["full_admin"],
    failureMessage: CATALOG_ACCESS_DENIED,
    organizationId: store.organizationId,
    userId: actor.athenaUserId,
  });
  return { store, athenaUserId: actor.athenaUserId };
}

const catalogAccessTokenProjectionValidator = v.object({
  tokenId: v.id("catalogAccessToken"),
  label: v.string(),
  status: v.union(v.literal("active"), v.literal("revoked")),
  createdAt: v.number(),
  lastUsedAt: v.optional(v.number()),
  revokedAt: v.optional(v.number()),
});

async function mintWithCtx(
  ctx: OperationMutationCtx,
  args: { storeId: Id<"store">; label: string },
): Promise<CommandResult<{ tokenId: Id<"catalogAccessToken">; token: string }>> {
  const { athenaUserId } = await requireStoreFullAdminWithCtx(
    ctx,
    args.storeId,
  );

  const label = normalizeCatalogAccessTokenLabel(args.label);
  if (label.length === 0) {
    return userError({
      code: "validation_failed",
      message: "Give the token a name so you can tell it apart later.",
    });
  }
  if (label.length > CATALOG_ACCESS_TOKEN_LABEL_MAX_LENGTH) {
    return userError({
      code: "validation_failed",
      message: `Token names are at most ${CATALOG_ACCESS_TOKEN_LABEL_MAX_LENGTH} characters.`,
    });
  }

  const active = await ctx.db
    .query("catalogAccessToken")
    .withIndex("by_storeId_status", (q) =>
      q.eq("storeId", args.storeId).eq("status", "active"),
    )
    .take(MAX_ACTIVE_CATALOG_ACCESS_TOKENS);
  if (active.length >= MAX_ACTIVE_CATALOG_ACCESS_TOKENS) {
    return userError({
      code: "precondition_failed",
      message: `This store already has ${MAX_ACTIVE_CATALOG_ACCESS_TOKENS} active tokens. Revoke one before creating another.`,
    });
  }

  const token = generateCatalogAccessTokenValue();
  const tokenId = await ctx.db.insert("catalogAccessToken", {
    storeId: args.storeId,
    tokenHash: hashCatalogAccessTokenValue(token),
    label,
    status: "active" as const,
    createdAt: Date.now(),
    createdByUserId: athenaUserId,
  });

  return ok({ tokenId, token });
}

export const mint = mutation({
  args: { storeId: v.id("store"), label: v.string() },
  returns: commandResultValidator(
    v.object({
      tokenId: v.id("catalogAccessToken"),
      token: v.string(),
    }),
  ),
  handler: admitPublicMutation(
    mintCatalogAccessTokenOperationDefinition,
    mintWithCtx,
  ),
});

async function revokeWithCtx(
  ctx: OperationMutationCtx,
  args: { storeId: Id<"store">; tokenId: Id<"catalogAccessToken"> },
): Promise<CommandResult<null>> {
  await requireStoreFullAdminWithCtx(ctx, args.storeId);

  const token = await ctx.db.get("catalogAccessToken", args.tokenId);
  if (!token) {
    return userError({
      code: "not_found",
      message: "That token no longer exists.",
    });
  }
  // The admitted store constraint only echoes `args.storeId`; the row itself
  // is what has to belong to it.
  if (token.storeId !== ctx.operationAdmission.constraints.storeId) {
    throw operationAdmissionDenial({
      kind: OPERATION_ADMISSION_DENIED,
      message: CATALOG_ACCESS_DENIED,
      outcome: "denied",
      reason: "scope_denied",
    });
  }
  if (token.status === "revoked") {
    return ok(null);
  }

  await ctx.db.patch("catalogAccessToken", token._id, {
    status: "revoked" as const,
    revokedAt: Date.now(),
  });
  return ok(null);
}

export const revoke = mutation({
  args: {
    storeId: v.id("store"),
    tokenId: v.id("catalogAccessToken"),
  },
  returns: commandResultValidator(v.null()),
  handler: admitPublicMutation(
    revokeCatalogAccessTokenOperationDefinition,
    revokeWithCtx,
  ),
});

export const list = query({
  args: { storeId: v.id("store") },
  returns: v.array(catalogAccessTokenProjectionValidator),
  handler: admitPublicQuery(
    listCatalogAccessTokensReadDefinition,
    async (ctx: OperationQueryCtx, args: { storeId: Id<"store"> }) => {
      await requireStoreFullAdminWithCtx(ctx, args.storeId);

      const rows = await ctx.db
        .query("catalogAccessToken")
        .withIndex("by_storeId_status", (q) => q.eq("storeId", args.storeId))
        .take(CATALOG_ACCESS_TOKEN_LIST_CAP);

      return rows.map((row) => ({
        tokenId: row._id,
        label: row.label,
        status: row.status,
        createdAt: row.createdAt,
        lastUsedAt: row.lastUsedAt,
        revokedAt: row.revokedAt,
      }));
    },
  ),
});

/**
 * Freshness stamp for a token that was just presented.
 *
 * Takes only the token id — the query a reader ran never reaches this write —
 * and re-checks both the interval and the status here, because the caller's
 * view of the row is from before its own read finished.
 */
export const touch = internalMutation({
  args: { tokenId: v.id("catalogAccessToken") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const token = await ctx.db.get("catalogAccessToken", args.tokenId);
    if (!token || token.status !== "active") return null;

    const now = Date.now();
    if (
      token.lastUsedAt !== undefined &&
      now - token.lastUsedAt < CATALOG_ACCESS_TOKEN_TOUCH_INTERVAL_MS
    ) {
      return null;
    }

    await ctx.db.patch("catalogAccessToken", token._id, { lastUsedAt: now });
    return null;
  },
});

/**
 * Cascade for store removal, in the same bounded-batch shape as the other
 * per-store cleanups: a full batch reports `hasMore` and the caller
 * reschedules.
 */
export async function deleteCatalogAccessTokensForStoreWithCtx(
  ctx: MutationCtx,
  storeId: Id<"store">,
): Promise<{ hasMore: boolean }> {
  const rows = await ctx.db
    .query("catalogAccessToken")
    .withIndex("by_storeId_status", (q) => q.eq("storeId", storeId))
    .take(CATALOG_ACCESS_TOKEN_DELETE_BATCH_SIZE);
  await Promise.all(
    rows.map((row) => ctx.db.delete("catalogAccessToken", row._id)),
  );
  return { hasMore: rows.length === CATALOG_ACCESS_TOKEN_DELETE_BATCH_SIZE };
}
