import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireAuthenticatedAthenaUserWithCtx } from "../lib/athenaUserAuth";

/**
 * Domain authorization gate for the rebuilt reports layer (`convex/reports/`).
 *
 * Ported from legacy `convex/reporting/access.ts` (`requireReportingStoreAccess`)
 * with identical semantics: an authenticated Athena user must hold a SINGLE
 * `full_admin` `organizationMember` row for the store's owning organization.
 * The error message is deliberately opaque and identical across every failure
 * mode (missing auth, missing store, wrong org, insufficient role, duplicate
 * memberships) so a caller cannot distinguish "doesn't exist" from
 * "exists but you can't see it" — this is the reports security boundary.
 *
 * ## What moved to the admission rail (U8)
 *
 * The shared-demo half of this gate is gone. It used to run
 * `requireSharedDemoStoreCapabilityIfApplicable(ctx, "reports.read", storeId)`
 * — a closed capability check plus the server-owned store clamp — and then ask
 * the generic auth helper to map the demo principal onto its Athena user via
 * an explicit `sharedDemoCapability` option. Both are now declared on the
 * `reports.view` read definitions: the shared-demo read adapter checks the
 * grant set, clamps the store (a foreign `storeId` is a recognized
 * `scope_denied`), and publishes the admitted actor as
 * `ctx.operationAdmission.actor`.
 *
 * So this function no longer knows what a demo principal is. It asks for "the
 * authenticated Athena user", which `requireAuthenticatedAthenaUserWithCtx`
 * resolves from the admitted actor for EVERY actor kind, and then applies the
 * membership rule to that user unchanged — which is why a demo visitor still
 * has to be a full admin of the demo organization, exactly as before.
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
    athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
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
