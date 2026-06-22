import { v } from "convex/values";

import { internalQuery, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import {
  buildSnapshotHash,
  buildSourceRefs,
  buildStoreInsightsPrompt,
  buildUserInsightsPrompt,
} from "../intelligence/capabilities/insights";
import { SYNTHETIC_MONITOR_ORIGIN } from "../storeFront/syntheticMonitor";
import type { CompiledContextBundle } from "./types";

const MAX_CONTEXT_ANALYTICS = 250;

export const compileStoreInsightsContextBundle = internalQuery({
  args: {
    storeId: v.id("store"),
  },
  handler: async (ctx, args): Promise<CompiledContextBundle> => {
    const analytics = await ctx.db
      .query("analytics")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .filter((q) => q.neq(q.field("origin"), SYNTHETIC_MONITOR_ORIGIN))
      .order("desc")
      .take(MAX_CONTEXT_ANALYTICS);

    const built = buildStoreInsightsPrompt(analytics);
    const sourceRefs = buildSourceRefs(analytics);

    return {
      bundleKind: "store_insights_context",
      bundleVersion: 1,
      freshness: analytics.length === 0 ? "partial" : "current",
      snapshotHash: buildSnapshotHash(built.snapshot),
      payloadSummary: built.snapshot,
      payloadRedaction: "analytics rows compacted; user contact fields omitted",
      sourceRefs,
      ...getDataWindow(analytics),
      hiddenSourceCount: Math.max(0, analytics.length - sourceRefs.length),
      omittedEvidenceCount: 0,
      redactionMode: "compact_no_contact_fields",
      qualityFlags: analytics.length === 0 ? ["no_context_events"] : [],
      limitedEvidence: analytics.length === 0,
    };
  },
});

export const compileUserInsightsContextBundle = internalQuery({
  args: {
    storeId: v.id("store"),
    storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
  },
  handler: async (ctx, args): Promise<CompiledContextBundle> => {
    await assertActorMatchesStore(ctx, args.storeFrontUserId, args.storeId);

    const analytics = await ctx.db
      .query("analytics")
      .withIndex("by_storeFrontUserId_storeId", (q) =>
        q
          .eq("storeFrontUserId", args.storeFrontUserId)
          .eq("storeId", args.storeId),
      )
      .filter((q) => q.neq(q.field("origin"), SYNTHETIC_MONITOR_ORIGIN))
      .take(MAX_CONTEXT_ANALYTICS);

    const built = buildUserInsightsPrompt(analytics);
    const analyticsRefs = buildSourceRefs(analytics);

    return {
      bundleKind: "user_insights_context",
      bundleVersion: 1,
      freshness: analytics.length === 0 ? "partial" : "current",
      snapshotHash: buildSnapshotHash(built.snapshot),
      payloadSummary: built.snapshot,
      payloadRedaction: "analytics rows compacted; contact fields omitted",
      sourceRefs: [
        {
          table: getStorefrontActorTable(ctx, args.storeFrontUserId),
          id: String(args.storeFrontUserId),
        },
        ...analyticsRefs,
      ],
      ...getDataWindow(analytics),
      hiddenSourceCount: Math.max(0, analytics.length - analyticsRefs.length),
      omittedEvidenceCount: 0,
      redactionMode: "compact_no_contact_fields",
      qualityFlags: analytics.length === 0 ? ["no_context_events"] : [],
      limitedEvidence: analytics.length === 0,
    };
  },
});

async function assertActorMatchesStore(
  ctx: QueryCtx,
  actorId: Id<"storeFrontUser"> | Id<"guest">,
  storeId: Id<"store">,
) {
  const actor = await getStoreFrontActorById(ctx, actorId);
  if (!actor || String(actor.storeId) !== String(storeId)) {
    throw new Error("Customer activity is not available for this store.");
  }
}

function getStorefrontActorTable(
  ctx: QueryCtx,
  actorId: Id<"storeFrontUser"> | Id<"guest">,
) {
  return ctx.db.normalizeId("guest", actorId) ? "guest" : "storeFrontUser";
}

async function getStoreFrontActorById(
  ctx: QueryCtx,
  actorId: Id<"storeFrontUser"> | Id<"guest">,
) {
  const storeFrontUserId = ctx.db.normalizeId("storeFrontUser", actorId);
  if (storeFrontUserId) {
    const user = await ctx.db.get("storeFrontUser", storeFrontUserId);
    if (user) return user;
  }

  const guestId = ctx.db.normalizeId("guest", actorId);
  if (guestId) {
    return await ctx.db.get("guest", guestId);
  }

  return null;
}

function getDataWindow(analytics: Array<Pick<Doc<"analytics">, "_creationTime">>) {
  if (analytics.length === 0) return {};

  const times = analytics.map((item) => item._creationTime);

  return {
    dataWindowStartAt: Math.min(...times),
    dataWindowEndAt: Math.max(...times),
  };
}
