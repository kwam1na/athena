import { v } from "convex/values";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { action, internalMutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import {
  readRuntimeSharedDemoConfig,
  SHARED_DEMO_ADMISSION_RATE_WINDOW_MS,
  SHARED_DEMO_ADMISSION_DURATION_MS,
  SHARED_DEMO_EXCHANGE_RATE_LIMIT,
  SHARED_DEMO_MINT_RATE_LIMIT,
  SHARED_DEMO_TICKET_DURATION_MS,
  SHARED_DEMO_BASELINE_VERSION,
} from "./config";
import { createOpaqueTicket, hashSharedDemoTicket } from "./crypto";

const storeTicketRef = (internal as any).sharedDemo.admission.storeSharedDemoTicket;

export async function requireCurrentSharedDemoAdmissionFoundationWithCtx(
  ctx: Pick<MutationCtx, "db">,
  storeId: Id<"store">,
) {
  const state = await ctx.db
    .query("sharedDemoRestoreState")
    .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
    .unique();
  if (
    !state ||
    state.baselineVersion !== SHARED_DEMO_BASELINE_VERSION ||
    state.completedAt === undefined ||
    state.status !== "ready"
  ) {
    throw new Error("The demo store is not a current provisioned foundation.");
  }
  return state;
}

export async function consumeAdmissionBudgetWithCtx(
  ctx: Pick<MutationCtx, "db">,
  args: { kind: "mint" | "exchange"; limit: number; now: number },
) {
  const bucket = await ctx.db.query("sharedDemoAdmissionRateBucket").withIndex("by_kind", (q) => q.eq("kind", args.kind)).unique();
  if (!bucket || bucket.windowStartedAt <= args.now - SHARED_DEMO_ADMISSION_RATE_WINDOW_MS) {
    if (bucket) await ctx.db.replace("sharedDemoAdmissionRateBucket", bucket._id, { count: 1, kind: args.kind, windowStartedAt: args.now });
    else await ctx.db.insert("sharedDemoAdmissionRateBucket", { count: 1, kind: args.kind, windowStartedAt: args.now });
    return;
  }
  if (bucket.count >= args.limit) throw new Error("The demo is busy. Try again shortly.");
  await ctx.db.patch("sharedDemoAdmissionRateBucket", bucket._id, { count: bucket.count + 1 });
}

export async function consumeSharedDemoTicketWithCtx(
  ctx: Pick<MutationCtx, "db">,
  args: { now: number; ticketHash: string },
) {
  const ticket = await ctx.db
    .query("sharedDemoAdmissionTicket")
    .withIndex("by_ticketHash", (q) => q.eq("ticketHash", args.ticketHash))
    .unique();

  if (!ticket || ticket.consumedAt !== undefined || ticket.expiresAt <= args.now) {
    throw new Error("Demo sign-in link is no longer valid. Open the demo again.");
  }

  await ctx.db.patch("sharedDemoAdmissionTicket", ticket._id, {
    consumedAt: args.now,
  });
  await ctx.db.patch("sharedDemoPrincipal", ticket.principalId, {
    admissionExpiresAt: args.now + SHARED_DEMO_ADMISSION_DURATION_MS,
    updatedAt: args.now,
  });
  return { authUserId: ticket.authUserId };
}

export const issueSharedDemoTicket = action({
  args: {},
  returns: v.object({ ticket: v.string(), expiresAt: v.number() }),
  handler: async (ctx) => {
    const config = readRuntimeSharedDemoConfig();
    const now = Date.now();
    const ticket = createOpaqueTicket();
    const ticketHash = await hashSharedDemoTicket(ticket);
    const expiresAt = now + SHARED_DEMO_TICKET_DURATION_MS;

    await ctx.runMutation(storeTicketRef, { ...config, expiresAt, ticketHash });
    return { ticket, expiresAt };
  },
});

export const consumeSharedDemoExchangeBudget = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    readRuntimeSharedDemoConfig();
    await consumeAdmissionBudgetWithCtx(ctx, {
      kind: "exchange",
      limit: SHARED_DEMO_EXCHANGE_RATE_LIMIT,
      now: Date.now(),
    });
    return null;
  },
});

export const storeSharedDemoTicket = internalMutation({
  args: {
    athenaUserId: v.id("athenaUser"),
    organizationId: v.id("organization"),
    storeId: v.id("store"),
    ticketHash: v.string(),
    expiresAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const config = readRuntimeSharedDemoConfig();
    if (
      args.athenaUserId !== config.athenaUserId ||
      args.organizationId !== config.organizationId ||
      args.storeId !== config.storeId
    ) {
      throw new Error("Demo configuration changed during admission.");
    }
    await requireCurrentSharedDemoAdmissionFoundationWithCtx(
      ctx,
      args.storeId,
    );
    await consumeAdmissionBudgetWithCtx(ctx, { kind: "mint", limit: SHARED_DEMO_MINT_RATE_LIMIT, now: Date.now() });

    const [athenaUser, organization, store] = await Promise.all([
      ctx.db.get("athenaUser", args.athenaUserId),
      ctx.db.get("organization", args.organizationId),
      ctx.db.get("store", args.storeId),
    ]);
    if (!athenaUser || !organization || !store) {
      throw new Error("The demo store is not ready.");
    }
    if (store.organizationId !== args.organizationId) {
      throw new Error("The demo store configuration is invalid.");
    }
    const membership = await ctx.db
      .query("organizationMember")
      .withIndex("by_organizationId_userId", (q) =>
        q.eq("organizationId", args.organizationId).eq("userId", args.athenaUserId),
      )
      .unique();
    if (!membership || membership.role !== "full_admin") {
      throw new Error("The demo owner membership is not ready.");
    }

    // A fresh auth identity per admission prevents a later visitor from extending
    // an earlier browser's server-authorized demo window. All identities still map
    // to the same dedicated Athena owner and shared store.
    const authUserId = await ctx.db.insert("users", {
      name: "Athena demo owner",
    });
    const principalId = await ctx.db.insert("sharedDemoPrincipal", {
      authUserId,
      athenaUserId: args.athenaUserId,
      organizationId: args.organizationId,
      storeId: args.storeId,
      admissionExpiresAt: 0,
      updatedAt: Date.now(),
    });

    await ctx.db.insert("sharedDemoAdmissionTicket", {
      authUserId,
      principalId,
      ticketHash: args.ticketHash,
      expiresAt: args.expiresAt,
    });
    return null;
  },
});

export const consumeSharedDemoTicket = internalMutation({
  args: { ticketHash: v.string() },
  returns: v.object({ authUserId: v.id("users") }),
  handler: async (ctx, args) => {
    readRuntimeSharedDemoConfig();
    return consumeSharedDemoTicketWithCtx(ctx, {
      now: Date.now(),
      ticketHash: args.ticketHash,
    });
  },
});
