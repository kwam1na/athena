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
import { compileLegacyStorefrontAnalyticsRowsWithReport } from "./legacyStorefrontAnalytics";
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

    return buildStoreInsightsContextBundleFromAnalytics(analytics);
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

    return buildUserInsightsContextBundleFromAnalytics(analytics, {
      table: getStorefrontActorTable(ctx, args.storeFrontUserId),
      id: String(args.storeFrontUserId),
    });
  },
});

export function buildStoreInsightsContextBundleFromAnalytics(
  analytics: Doc<"analytics">[],
): CompiledContextBundle {
  const compiled = compileLegacyStorefrontAnalyticsRowsWithReport(analytics);
  const built = buildStoreInsightsPrompt(compiled.contextRows);
  const sourceRefs = buildSourceRefs(compiled.contextRows);

  return buildCompiledContextBundle({
    bundleKind: "store_insights_context",
    promptSnapshot: built.snapshot,
    sourceRefs,
    sourceRowCount: compiled.sourceRowCount,
    compiledRowCount: compiled.contextRows.length,
    omittedEvidenceCount: compiled.omittedEvidenceCount,
    qualityFlags: compiled.qualityFlags,
    dataWindow: getDataWindow(compiled.contextRows),
  });
}

export function buildUserInsightsContextBundleFromAnalytics(
  analytics: Doc<"analytics">[],
  actorSourceRef: { table: string; id: string },
): CompiledContextBundle {
  const compiled = compileLegacyStorefrontAnalyticsRowsWithReport(analytics);
  const built = buildUserInsightsPrompt(compiled.contextRows);
  const analyticsRefs = buildSourceRefs(compiled.contextRows);

  return buildCompiledContextBundle({
    bundleKind: "user_insights_context",
    promptSnapshot: built.snapshot,
    sourceRefs: [actorSourceRef, ...analyticsRefs],
    sourceRowCount: compiled.sourceRowCount,
    compiledRowCount: compiled.contextRows.length,
    omittedEvidenceCount: compiled.omittedEvidenceCount,
    qualityFlags: compiled.qualityFlags,
    dataWindow: getDataWindow(compiled.contextRows),
    sourceRefOffset: 1,
  });
}

function buildCompiledContextBundle(input: {
  bundleKind: "store_insights_context" | "user_insights_context";
  promptSnapshot: Record<string, unknown>;
  sourceRefs: Array<{ table: string; id: string; label?: string }>;
  sourceRowCount: number;
  compiledRowCount: number;
  omittedEvidenceCount: number;
  qualityFlags: string[];
  dataWindow: ReturnType<typeof getDataWindow>;
  sourceRefOffset?: number;
}): CompiledContextBundle {
  const evidenceRefCount = Math.max(0, input.sourceRefs.length - (input.sourceRefOffset ?? 0));
  const qualityFlags =
    input.compiledRowCount === 0
      ? ["no_storefront_context", ...input.qualityFlags]
      : ["legacy_analytics_compiled", ...input.qualityFlags];

  return {
    bundleKind: input.bundleKind,
    bundleVersion: 1,
    freshness: input.compiledRowCount === 0 ? "partial" : "current",
    snapshotHash: buildSnapshotHash(input.promptSnapshot),
    payloadSummary: input.promptSnapshot,
    payloadRedaction:
      "legacy storefront analytics compiled into context primitives; contact fields omitted",
    sourceRefs: input.sourceRefs,
    ...input.dataWindow,
    hiddenSourceCount: Math.max(0, input.sourceRowCount - evidenceRefCount),
    omittedEvidenceCount: input.omittedEvidenceCount,
    redactionMode: "compact_no_contact_fields",
    qualityFlags: [...new Set(qualityFlags)],
    limitedEvidence: input.compiledRowCount === 0,
  };
}

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
