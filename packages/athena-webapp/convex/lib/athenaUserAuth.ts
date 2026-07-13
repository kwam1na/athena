import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

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

export async function getAuthenticatedAthenaUserWithCtx(ctx: AthenaAuthCtx) {
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
    throw new Error("Sign in again to continue.");
  }

  return athenaUser;
}

export async function requireAuthenticatedAthenaUserIndexedWithCtx(
  ctx: AthenaAuthCtx,
) {
  const authUserRecord = await getAuthenticatedUserRecord(ctx);

  if (!authUserRecord) {
    throw new Error("Sign in again to continue.");
  }

  const athenaUser = await findAthenaUserByEmailIndexedWithCtx(
    ctx,
    authUserRecord.normalizedEmail,
  );
  if (!athenaUser) {
    throw new Error("Sign in again to continue.");
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
