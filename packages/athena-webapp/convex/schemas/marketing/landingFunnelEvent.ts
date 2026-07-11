import { v } from "convex/values";

export const landingFunnelEventName = v.union(v.literal("page_view"), v.literal("walkthrough_cta"), v.literal("form_start"), v.literal("durable_acceptance"));
export const landingFunnelEventSchema = v.object({
  event: landingFunnelEventName,
  occurredAt: v.number(),
  day: v.string(),
  device: v.optional(v.union(v.literal("mobile"), v.literal("desktop"), v.literal("tablet"), v.literal("unknown"))),
  source: v.optional(v.union(v.literal("direct"), v.literal("search"), v.literal("social"), v.literal("referral"), v.literal("unknown"))),
});
export const landingFunnelDailyBucketSchema = v.object({
  day: v.string(),
  event: landingFunnelEventName,
  device: v.string(),
  source: v.string(),
  count: v.number(),
  updatedAt: v.number(),
});
