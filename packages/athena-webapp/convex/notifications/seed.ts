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
