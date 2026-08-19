import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { OperationMutationCtx } from "../operationAdmission/types";
import { AthenaUnauthenticatedError } from "./athenaUnauthenticated";

export { AthenaUnauthenticatedError };

/**
 * Generic Athena-user authentication.
 *
 * This module is deliberately shared-demo-UNAWARE. A demo principal reaches an
 * Athena identity through the operation admission rail — the shared-demo
 * adapter admits it and publishes `ctx.operationAdmission.actor` — never
 * through a capability option threaded down from a handler. The old
 * `{ sharedDemoCapability: "reports.read" }` bridge (and the allowlist that
 * decided which capabilities it honoured) is gone with U8: reads that a demo
 * visitor may perform are declared on read definitions and enforced by the
 * rail, so no caller can re-open a demo identity path by passing an argument.
 */

type AthenaAuthCtx =
  | Pick<QueryCtx, "auth" | "db">
  | Pick<MutationCtx, "auth" | "db">;
type OrganizationMemberRole = "full_admin" | "pos_only";

export function normalizeAthenaUserEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function findAthenaUserByEmailWithCtx(
  ctx: AthenaAuthCtx,
  email: string,
) {
  const normalizedEmail = normalizeAthenaUserEmail(email);
  const indexedMatches = await ctx.db
    .query("athenaUser")
    .withIndex("by_normalizedEmail", (q) =>
      q.eq("normalizedEmail", normalizedEmail),
    )
    .take(3);
  const missingNormalizedIdentity = await ctx.db
    .query("athenaUser")
    .withIndex("by_normalizedEmail", (q) => q.eq("normalizedEmail", undefined))
    .first();

  if (!missingNormalizedIdentity) {
    if (indexedMatches.length > 1) {
      throw new Error(
        "Multiple Athena users match this email. Resolve duplicate accounts before continuing.",
      );
    }
    return indexedMatches[0] ?? null;
  }

  // Compatibility scan remains required until every row has an indexed value.
  // eslint-disable-next-line @convex-dev/no-collect-in-query
  const athenaUsers = await ctx.db.query("athenaUser").collect();
  const matchingUsers = athenaUsers.filter(
    (athenaUser) =>
      normalizeAthenaUserEmail(athenaUser.email) === normalizedEmail,
  );

  if (matchingUsers.length > 1) {
    throw new Error(
      "Multiple Athena users match this email. Resolve duplicate accounts before continuing.",
    );
  }

  return matchingUsers[0] ?? null;
}

export async function findAthenaUserByEmailIndexedWithCtx(
  ctx: AthenaAuthCtx,
  email: string,
) {
  const normalizedEmail = normalizeAthenaUserEmail(email);
  const matches = await ctx.db
    .query("athenaUser")
    .withIndex("by_normalizedEmail", (q) =>
      q.eq("normalizedEmail", normalizedEmail),
    )
    .take(2);

  if (matches.length > 1) {
    throw new Error(
      "Multiple Athena users match this email. Resolve duplicate accounts before continuing.",
    );
  }

  return matches[0] ?? null;
}

async function getAuthenticatedUserRecord(ctx: AthenaAuthCtx) {
  const authUserId = await getAuthUserId(ctx);

  if (!authUserId) {
    return null;
  }

  const authUser = await ctx.db.get("users", authUserId);

  if (!authUser || typeof authUser.email !== "string") {
    return null;
  }

  return {
    authUser,
    authUserId,
    normalizedEmail: normalizeAthenaUserEmail(authUser.email),
  };
}

function getOperationAdmissionActorUserId(ctx: AthenaAuthCtx) {
  const actor = (ctx as Partial<OperationMutationCtx>).operationAdmission?.actor;
  if (!actor) return undefined;
  // Exhaustive by actor kind: an actor kind that carries no Athena identity
  // (anonymous, or a storefront shopper holding only a bearer claim) must
  // never be mapped onto one, and a new kind must fail to compile here rather
  // than silently fall into the identified branch.
  switch (actor.kind) {
    case "normal_user":
    case "shared_demo":
      return actor.athenaUserId;
    case "storefront_customer":
    case "public":
      return undefined;
    default: {
      const exhaustive: never = actor;
      void exhaustive;
      return undefined;
    }
  }
}

export async function getAuthenticatedAthenaUserWithCtx(ctx: AthenaAuthCtx) {
  const admittedUserId = getOperationAdmissionActorUserId(ctx);
  if (admittedUserId) {
    return ctx.db.get("athenaUser", admittedUserId);
  }

  const authUserRecord = await getAuthenticatedUserRecord(ctx);

  if (!authUserRecord) {
    return null;
  }

  return findAthenaUserByEmailWithCtx(ctx, authUserRecord.normalizedEmail);
}

export async function requireAuthenticatedAthenaUserWithCtx(
  ctx: AthenaAuthCtx,
) {
  const athenaUser = await getAuthenticatedAthenaUserWithCtx(ctx);

  if (!athenaUser) {
    throw new AthenaUnauthenticatedError();
  }

  return athenaUser;
}

export async function requireAuthenticatedAthenaUserIndexedWithCtx(
  ctx: AthenaAuthCtx,
) {
  const admittedUserId = getOperationAdmissionActorUserId(ctx);
  if (admittedUserId) {
    const athenaUser = await ctx.db.get("athenaUser", admittedUserId);
    if (!athenaUser) throw new AthenaUnauthenticatedError();
    return athenaUser;
  }

  const authUserRecord = await getAuthenticatedUserRecord(ctx);

  if (!authUserRecord) {
    throw new AthenaUnauthenticatedError();
  }

  const athenaUser = await findAthenaUserByEmailIndexedWithCtx(
    ctx,
    authUserRecord.normalizedEmail,
  );
  if (!athenaUser) {
    throw new AthenaUnauthenticatedError();
  }

  return athenaUser;
}

export async function requireOrganizationMemberRoleWithCtx(
  ctx: AthenaAuthCtx,
  args: {
    allowedRoles: OrganizationMemberRole[];
    failureMessage: string;
    organizationId: Id<"organization">;
    userId: Id<"athenaUser">;
  },
) {
  const membership = await ctx.db
    .query("organizationMember")
    .withIndex("by_organizationId_userId", (q) =>
      q.eq("organizationId", args.organizationId).eq("userId", args.userId),
    )
    .first();

  if (!membership || !args.allowedRoles.includes(membership.role)) {
    throw new Error(args.failureMessage);
  }

  return membership;
}

export async function syncAuthenticatedAthenaUserWithCtx(ctx: MutationCtx) {
  const authUserRecord = await getAuthenticatedUserRecord(ctx);

  if (!authUserRecord) {
    throw new Error("Sign in again to continue.");
  }

  const existingUser = await findAthenaUserByEmailWithCtx(
    ctx,
    authUserRecord.normalizedEmail,
  );

  if (existingUser) {
    return existingUser;
  }

  const athenaUserId = await ctx.db.insert("athenaUser", {
    email: authUserRecord.normalizedEmail,
    normalizedEmail: authUserRecord.normalizedEmail,
  });

  return ctx.db.get("athenaUser", athenaUserId);
}
