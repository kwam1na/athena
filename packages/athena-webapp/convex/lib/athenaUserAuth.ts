import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type AthenaAuthCtx = Pick<QueryCtx, "auth" | "db"> | Pick<MutationCtx, "auth" | "db">;
type OrganizationMemberRole = "full_admin" | "pos_only";

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

async function findAthenaUserByEmailWithCtx(
  ctx: AthenaAuthCtx,
  email: string
) {
  const normalizedEmail = normalizeEmail(email);
  // Case-insensitive duplicate detection requires scanning until the schema gains
  // a normalized-email index for athenaUser records.
  // eslint-disable-next-line @convex-dev/no-collect-in-query
  const athenaUsers = await ctx.db.query("athenaUser").collect();
  const matchingUsers = athenaUsers.filter(
    (athenaUser) => normalizeEmail(athenaUser.email) === normalizedEmail
  );

  if (matchingUsers.length > 1) {
    throw new Error(
      "Multiple Athena users match this email. Resolve duplicate accounts before continuing."
    );
  }

  return matchingUsers[0] ?? null;
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
    normalizedEmail: normalizeEmail(authUser.email),
  };
}

export async function getAuthenticatedAthenaUserWithCtx(ctx: AthenaAuthCtx) {
  const authUserRecord = await getAuthenticatedUserRecord(ctx);

  if (!authUserRecord) {
    return null;
  }

  return findAthenaUserByEmailWithCtx(ctx, authUserRecord.normalizedEmail);
}

export async function requireAuthenticatedAthenaUserWithCtx(ctx: AthenaAuthCtx) {
  const athenaUser = await getAuthenticatedAthenaUserWithCtx(ctx);

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
  }
) {
  const membership = await ctx.db
    .query("organizationMember")
    .filter((q) =>
      q.and(
        q.eq(q.field("organizationId"), args.organizationId),
        q.eq(q.field("userId"), args.userId)
      )
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
    authUserRecord.normalizedEmail
  );

  if (existingUser) {
    return existingUser;
  }

  const athenaUserId = await ctx.db.insert("athenaUser", {
    email: authUserRecord.normalizedEmail,
  });

  return ctx.db.get("athenaUser", athenaUserId);
}
