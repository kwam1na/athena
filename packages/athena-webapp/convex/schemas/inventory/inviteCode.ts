import { v } from "convex/values";
import { redeem } from "../../inventory/inviteCode";

export const inviteCodeSchema = v.object({
  code: v.string(),
  organizationId: v.id("organization"),
  recipientEmail: v.string(),
  recipientUserId: v.id("athenaUser"),
  createdByUserId: v.id("athenaUser"),
  redeemedAt: v.optional(v.number()),
});
