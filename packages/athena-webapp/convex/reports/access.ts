import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireAuthenticatedAthenaUserWithCtx } from "../lib/athenaUserAuth";
import { requireSharedDemoStoreCapabilityIfApplicable } from "../sharedDemo/actor";

/**
 * Access gate for the rebuilt reports layer (`convex/reports/`).
 *
 * Ported from legacy `convex/reporting/access.ts` (`requireReportingStoreAccess`)
 * with identical semantics: an authenticated Athena user must hold a SINGLE
 * `full_admin` `organizationMember` row for the store's owning organization
 * (shared-demo callers go through the demo capability check first). The
 * error message is deliberately opaque and identical across every failure
 * mode (missing auth, missing store, wrong org, insufficient role, duplicate
 * memberships) so a caller cannot distinguish "doesn't exist" from
 * "exists but you can't see it" — this is the reports security boundary.
 */

type ReportsAccessCtx =
  Pick<QueryCtx, "auth" | "db"> | Pick<MutationCtx, "auth" | "db">;

const REPORTS_ACCESS_DENIED = "Reports access unavailable.";

export async function requireReportsStoreAccess(
  ctx: ReportsAccessCtx,
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
    throw new Error(REPORTS_ACCESS_DENIED);
  }

  const store = await ctx.db.get("store", storeId);
  if (!store) {
    throw new Error(REPORTS_ACCESS_DENIED);
  }

  const memberships = await ctx.db
    .query("organizationMember")
    .withIndex("by_organizationId_userId", (q) =>
      q.eq("organizationId", store.organizationId).eq("userId", athenaUser._id),
    )
    .take(2);
  const membership = memberships.length === 1 ? memberships[0] : null;

  if (!membership || membership.role !== "full_admin") {
    throw new Error(REPORTS_ACCESS_DENIED);
  }

  return { athenaUser, membership, store };
}
