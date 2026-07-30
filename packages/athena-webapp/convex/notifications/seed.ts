import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { ADMIN_EMAILS } from "../constants/email";
import { normalizeRecipientEmail } from "./deliveryPolicy";
import type { NotificationCategory } from "./registry";

const SEED_CATEGORIES: NotificationCategory[] = [
  "cash_controls",
  "eod",
  "system_health",
];

const ORGANIZATION_SCAN_CAP = 100;
const SUBSCRIPTION_SCAN_CAP = 200;
const MEMBER_SCAN_CAP = 200;

// One-time backfill: every ADMIN_EMAILS recipient gets an org-wide email
// subscription for each category, matching the legacy hardcoded audience.
// Idempotent — safe to re-run. Until this runs, audience resolution falls
// back to ADMIN_EMAILS directly, so seeding is not deploy-order-sensitive.
export const seedAdminSubscriptions = internalMutation({
  args: {},
  returns: v.object({ inserted: v.number() }),
  handler: async (ctx) => {
    const organizations = await ctx.db
      .query("organization")
      .take(ORGANIZATION_SCAN_CAP);
    const now = Date.now();
    let inserted = 0;

    for (const organization of organizations) {
      for (const category of SEED_CATEGORIES) {
        const existing = await ctx.db
          .query("notificationSubscription")
          .withIndex("by_organizationId_and_category", (q) =>
            q.eq("organizationId", organization._id).eq("category", category),
          )
          .take(SUBSCRIPTION_SCAN_CAP);
        const existingEmails = new Set(
          existing
            .filter((subscription) => subscription.channel === "email")
            .map((subscription) =>
              normalizeRecipientEmail(subscription.recipientEmail),
            ),
        );
        for (const recipient of ADMIN_EMAILS) {
          const email = normalizeRecipientEmail(recipient.email);
          if (existingEmails.has(email)) continue;
          await ctx.db.insert("notificationSubscription", {
            organizationId: organization._id,
            category,
            channel: "email",
            recipientEmail: email,
            recipientName: recipient.name,
            enabled: true,
            createdAt: now,
            updatedAt: now,
          });
          inserted += 1;
        }
      }
    }

    return { inserted };
  },
});

// One-time backfill for the `approvals` category: every organization member
// whose operationalRoles include "manager" gets an org-wide, enabled email
// subscription. Orgs that already have ANY approvals subscription rows are
// skipped entirely — an admin who has curated that audience must not have it
// silently widened by a re-run. Idempotent; safe to re-run.
export const seedApprovalsManagerSubscriptions = internalMutation({
  args: {},
  returns: v.object({ inserted: v.number() }),
  handler: async (ctx) => {
    const organizations = await ctx.db
      .query("organization")
      .take(ORGANIZATION_SCAN_CAP);
    const now = Date.now();
    let inserted = 0;

    for (const organization of organizations) {
      const existingApprovals = await ctx.db
        .query("notificationSubscription")
        .withIndex("by_organizationId_and_category", (q) =>
          q.eq("organizationId", organization._id).eq("category", "approvals"),
        )
        .take(1);
      if (existingApprovals.length > 0) continue;

      const members = await ctx.db
        .query("organizationMember")
        .withIndex("by_organizationId_userId", (q) =>
          q.eq("organizationId", organization._id),
        )
        .take(MEMBER_SCAN_CAP);

      const seededEmails = new Set<string>();
      for (const member of members) {
        if (!member.operationalRoles?.includes("manager")) continue;
        const athenaUser = await ctx.db.get("athenaUser", member.userId);
        if (!athenaUser) continue;
        const email = normalizeRecipientEmail(athenaUser.email);
        if (!email || seededEmails.has(email)) continue;
        seededEmails.add(email);
        const recipientName =
          [athenaUser.firstName, athenaUser.lastName]
            .filter(Boolean)
            .join(" ") || undefined;
        await ctx.db.insert("notificationSubscription", {
          organizationId: organization._id,
          category: "approvals",
          channel: "email",
          recipientEmail: email,
          recipientName,
          recipientUserId: member.userId,
          enabled: true,
          createdAt: now,
          updatedAt: now,
        });
        inserted += 1;
      }
    }

    return { inserted };
  },
});
