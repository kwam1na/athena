import { v } from "convex/values";

import { mutation, query } from "../_generated/server";
import { postStaffMessageOperationDefinition } from "../operationAdmission/definitions";
import { admitSharedDemoPublicMutation } from "../operationAdmission/publicMutation";
import {
  requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx,
} from "../lib/athenaUserAuth";
import { requireSharedDemoStoreCapabilityIfApplicable } from "../sharedDemo/actor";
import { requireReadySharedDemoWriteWithCtx } from "../sharedDemo/restore";

export const STAFF_MESSAGE_MAX_LENGTH = 500;
export const STAFF_MESSAGE_RATE_WINDOW_MS = 60_000;
export const STAFF_MESSAGE_RATE_LIMIT = 5;

async function requireStoreMember(ctx: any, storeId: any) {
  const demoActor = await requireSharedDemoStoreCapabilityIfApplicable(
    ctx,
    "staff.communication.write",
    storeId,
  );
  const [store, user] = await Promise.all([
    ctx.db.get("store", storeId),
    requireAuthenticatedAthenaUserWithCtx(ctx, {
      sharedDemoCapability: "staff.communication.write",
    }),
  ]);
  if (!store) throw new Error("Store not found.");
  await requireOrganizationMemberRoleWithCtx(ctx, {
    allowedRoles: ["full_admin", "pos_only"],
    failureMessage: "You do not have access to staff messages.",
    organizationId: store.organizationId,
    userId: user._id,
  });
  return { demoActor, store, user };
}

export const listStaffMessages = query({
  args: { storeId: v.id("store") },
  handler: async (ctx, args) => {
    await requireStoreMember(ctx, args.storeId);
    return ctx.db
      .query("staffMessage")
      .withIndex("by_storeId_createdAt", (q) => q.eq("storeId", args.storeId))
      .order("desc")
      .take(50);
  },
});

export const postStaffMessage = mutation({
  args: {
    body: v.string(),
    expectedDemoRestoreEpoch: v.optional(v.number()),
    storeId: v.id("store"),
  },
  handler: admitSharedDemoPublicMutation(
    postStaffMessageOperationDefinition,
    async (ctx, args) => {
    const body = args.body.trim();
    if (!body || body.length > STAFF_MESSAGE_MAX_LENGTH) {
      throw new Error(`Staff messages must be between 1 and ${STAFF_MESSAGE_MAX_LENGTH} characters.`);
    }
    const { demoActor, store, user } = await requireStoreMember(ctx, args.storeId);
    if (demoActor) {
      if (args.expectedDemoRestoreEpoch === undefined) {
        throw new Error("Refresh the demo before posting a staff message.");
      }
      await requireReadySharedDemoWriteWithCtx(ctx, {
        expectedEpoch: args.expectedDemoRestoreEpoch,
        storeId: args.storeId,
      });
    }

    const now = Date.now();
    const recent = await ctx.db
      .query("staffMessage")
      .withIndex("by_storeId_authorUserId_createdAt", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("authorUserId", user._id)
          .gte("createdAt", now - STAFF_MESSAGE_RATE_WINDOW_MS),
      )
      .take(STAFF_MESSAGE_RATE_LIMIT);
    if (recent.length >= STAFF_MESSAGE_RATE_LIMIT) {
      throw new Error("Wait a moment before posting another staff message.");
    }

    const id = await ctx.db.insert("staffMessage", {
      organizationId: store.organizationId,
      storeId: args.storeId,
      authorUserId: user._id,
      body,
      createdAt: now,
      updatedAt: now,
    });
    return ctx.db.get("staffMessage", id);
    },
  ),
});
