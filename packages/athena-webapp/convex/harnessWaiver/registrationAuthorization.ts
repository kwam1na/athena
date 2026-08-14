import { v } from "convex/values";

import { env, mutation } from "../_generated/server";
import {
  requireConfiguredReviewer,
  requireEnrollmentBootstrap,
} from "./passkeyPolicy";

const AUTHORIZATION_TTL_MS = 60_000;

function required(name: string, value: string | undefined) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is not configured.`);
  return normalized;
}

export const authorizeRegistration = mutation({
  args: {
    bootstrapSecret: v.string(),
    tokenHash: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("Sign in before enrolling the waiver passkey.");
    const reviewerEmail = requireConfiguredReviewer(
      identity.email,
      required("ATHENA_WAIVER_REVIEWER_EMAIL", env.ATHENA_WAIVER_REVIEWER_EMAIL),
    );
    await requireEnrollmentBootstrap(
      args.bootstrapSecret,
      env.ATHENA_WAIVER_ENROLLMENT_TOKEN_HASH?.trim() ?? "",
    );
    if (!/^[a-f0-9]{64}$/.test(args.tokenHash)) {
      throw new Error("Registration authorization token is invalid.");
    }
    const existing = await ctx.db.query("harnessWaiverPasskey").first();
    if (existing) throw new Error("A waiver passkey is already enrolled.");
    const now = Date.now();
    const existingAuthorization = await ctx.db
      .query("harnessWaiverRegistrationAuthorization")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();
    if (existingAuthorization) throw new Error("Registration authorization already exists.");
    await ctx.db.insert("harnessWaiverRegistrationAuthorization", {
      tokenHash: args.tokenHash,
      reviewerEmail,
      expiresAt: now + AUTHORIZATION_TTL_MS,
    });
    return null;
  },
});
