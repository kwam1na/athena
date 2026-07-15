import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireAuthenticatedAthenaUserWithCtx } from "../lib/athenaUserAuth";
import { requireSharedDemoStoreCapabilityIfApplicable } from "../sharedDemo/actor";

type ReportingAccessCtx =
  Pick<QueryCtx, "auth" | "db"> | Pick<MutationCtx, "auth" | "db">;

const REPORTING_ACCESS_DENIED = "Reports access unavailable.";

export async function requireReportingStoreAccess(
  ctx: ReportingAccessCtx,
  storeId: Id<"store">,
) {
  let athenaUser;
  try {
    await requireSharedDemoStoreCapabilityIfApplicable(
      ctx,
      "reports.read",
      storeId,
    );
    athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx, {
      sharedDemoCapability: "reports.read",
    });
  } catch {
    throw new Error(REPORTING_ACCESS_DENIED);
  }

  const store = await ctx.db.get("store", storeId);
  if (!store) {
    throw new Error(REPORTING_ACCESS_DENIED);
  }

  const memberships = await ctx.db
    .query("organizationMember")
    .withIndex("by_organizationId_userId", (q) =>
      q.eq("organizationId", store.organizationId).eq("userId", athenaUser._id),
    )
    .take(2);
  const membership = memberships.length === 1 ? memberships[0] : null;

  if (!membership || membership.role !== "full_admin") {
    throw new Error(REPORTING_ACCESS_DENIED);
  }

  return { athenaUser, membership, store };
}

export function requireReportingSourceStore(args: {
  requestedStoreId: Id<"store">;
  sourceStoreId: Id<"store">;
}) {
  if (args.requestedStoreId !== args.sourceStoreId) {
    throw new Error(REPORTING_ACCESS_DENIED);
  }
}
