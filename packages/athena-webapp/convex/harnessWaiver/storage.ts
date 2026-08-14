import { v } from "convex/values";

import { internalMutation, internalQuery } from "../_generated/server";
import { waiverCandidateSchema } from "../schemas/harnessWaiver";
import {
  assertApprovedRequestConsumable,
  assertApprovalRequestUsable,
  assertWaiverCandidateMatches,
} from "./passkeyPolicy";

export const getPasskey = internalQuery({
  args: {},
  handler: async (ctx) => await ctx.db.query("harnessWaiverPasskey").first(),
});

export const saveRegistrationChallenge = internalMutation({
  args: {
    challenge: v.string(),
    reviewerEmail: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => await ctx.db.insert("harnessWaiverRegistration", args),
});

export const getRegistrationChallenge = internalQuery({
  args: { challenge: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("harnessWaiverRegistration")
      .withIndex("by_challenge", (q) => q.eq("challenge", args.challenge))
      .unique(),
});

export const completeRegistration = internalMutation({
  args: {
    challenge: v.string(),
    reviewerEmail: v.string(),
    credentialId: v.string(),
    publicKey: v.bytes(),
    counter: v.number(),
    transports: v.array(v.string()),
    deviceType: v.string(),
    backedUp: v.boolean(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const registration = await ctx.db
      .query("harnessWaiverRegistration")
      .withIndex("by_challenge", (q) => q.eq("challenge", args.challenge))
      .unique();
    if (
      !registration ||
      registration.consumedAt !== undefined ||
      registration.expiresAt <= args.now ||
      registration.reviewerEmail !== args.reviewerEmail
    ) {
      throw new Error("Registration challenge is unavailable.");
    }
    const existing = await ctx.db.query("harnessWaiverPasskey").first();
    if (existing) throw new Error("A waiver passkey is already enrolled.");
    const credential = {
      credentialId: args.credentialId,
      publicKey: args.publicKey,
      counter: args.counter,
      transports: args.transports,
      deviceType: args.deviceType,
      backedUp: args.backedUp,
      reviewerEmail: args.reviewerEmail,
      createdAt: args.now,
      updatedAt: args.now,
    };
    await ctx.db.insert("harnessWaiverPasskey", credential);
    await ctx.db.patch("harnessWaiverRegistration", registration._id, { consumedAt: args.now });
    return null;
  },
});

export const createApproval = internalMutation({
  args: {
    publicTokenHash: v.string(),
    challenge: v.string(),
    candidate: waiverCandidateSchema,
    expiresAt: v.number(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => await ctx.db.insert("harnessWaiverApproval", {
    ...args,
    status: "pending",
  }),
});

export const getApprovalByTokenHash = internalQuery({
  args: { publicTokenHash: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("harnessWaiverApproval")
      .withIndex("by_publicTokenHash", (q) => q.eq("publicTokenHash", args.publicTokenHash))
      .unique(),
});

export const getApprovalById = internalQuery({
  args: { approvalId: v.id("harnessWaiverApproval") },
  handler: async (ctx, args) => await ctx.db.get("harnessWaiverApproval", args.approvalId),
});

export const approve = internalMutation({
  args: {
    approvalId: v.id("harnessWaiverApproval"),
    credentialId: v.string(),
    newCounter: v.number(),
    approvedAt: v.number(),
    consumeExpiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const approval = await ctx.db.get("harnessWaiverApproval", args.approvalId);
    if (!approval) throw new Error("Approval request is unavailable.");
    assertApprovalRequestUsable(approval, args.approvedAt);
    const credential = await ctx.db
      .query("harnessWaiverPasskey")
      .withIndex("by_credentialId", (q) => q.eq("credentialId", args.credentialId))
      .unique();
    if (!credential || args.newCounter < credential.counter) {
      throw new Error("Passkey counter is invalid.");
    }
    await ctx.db.patch("harnessWaiverPasskey", credential._id, {
      counter: args.newCounter,
      updatedAt: args.approvedAt,
    });
    await ctx.db.patch("harnessWaiverApproval", approval._id, {
      status: "approved",
      credentialId: args.credentialId,
      approvedAt: args.approvedAt,
      consumeExpiresAt: args.consumeExpiresAt,
    });
    return null;
  },
});

export const consume = internalMutation({
  args: {
    approvalId: v.id("harnessWaiverApproval"),
    expectedCandidate: waiverCandidateSchema,
    consumedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const approval = await ctx.db.get("harnessWaiverApproval", args.approvalId);
    if (!approval || !approval.approvedAt || !approval.credentialId) {
      throw new Error("Passkey approval is unavailable.");
    }
    assertWaiverCandidateMatches(approval.candidate, args.expectedCandidate);
    const receipt = {
      approvalId: approval._id,
      candidate: approval.candidate,
      credentialId: approval.credentialId,
      approvedAt: approval.approvedAt,
    };
    if (approval.status === "consumed" && approval.consumedAt !== undefined) {
      return receipt;
    }
    assertApprovedRequestConsumable(approval, args.consumedAt);
    await ctx.db.patch("harnessWaiverApproval", approval._id, {
      status: "consumed",
      consumedAt: args.consumedAt,
    });
    return receipt;
  },
});
