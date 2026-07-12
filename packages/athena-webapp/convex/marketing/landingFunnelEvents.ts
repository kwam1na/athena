import { v } from "convex/values";
import { env, internalMutation, type MutationCtx } from "../_generated/server";
import { landingFunnelEventName } from "../schemas/marketing/landingFunnelEvent";
import { consumeWalkthroughBudget } from "./walkthroughBudgets";
import { landingFunnelHourlyLimit } from "./walkthroughConfig";

const deviceValidator = v.optional(v.union(v.literal("mobile"), v.literal("desktop"), v.literal("tablet"), v.literal("unknown")));
const sourceValidator = v.optional(v.union(v.literal("direct"), v.literal("search"), v.literal("social"), v.literal("referral"), v.literal("unknown")));

export async function appendFunnelEventWithCtx(ctx: MutationCtx, args: {
  event: "page_view" | "walkthrough_cta" | "form_start" | "durable_acceptance";
  occurredAt: number;
  device?: "mobile" | "desktop" | "tablet" | "unknown";
  source?: "direct" | "search" | "social" | "referral" | "unknown";
}) {
  await ctx.db.insert("landingFunnelEvent", { ...args, day: new Date(args.occurredAt).toISOString().slice(0, 10) });
  await appendFunnelAggregateWithCtx(ctx, args);
}

export async function appendFunnelAggregateWithCtx(ctx: MutationCtx, args: {
  event: "page_view" | "walkthrough_cta" | "form_start" | "durable_acceptance" | "qualified" | "not_qualified" | "unknown";
  occurredAt: number;
  device?: "mobile" | "desktop" | "tablet" | "unknown";
  source?: "direct" | "search" | "social" | "referral" | "unknown";
}) {
  const day = new Date(args.occurredAt).toISOString().slice(0, 10);
  const device = args.device ?? "unknown";
  const source = args.source ?? "unknown";
  const bucket = await ctx.db.query("landingFunnelDailyBucket")
    .withIndex("by_day_and_event_and_device_and_source", (q) => q.eq("day", day).eq("event", args.event).eq("device", device).eq("source", source))
    .unique();
  if (bucket) await ctx.db.patch("landingFunnelDailyBucket", bucket._id, { count: bucket.count + 1, updatedAt: args.occurredAt });
  else await ctx.db.insert("landingFunnelDailyBucket", { day, event: args.event, device, source, count: 1, updatedAt: args.occurredAt });
}

export const appendPublic = internalMutation({
  args: { event: v.union(v.literal("page_view"), v.literal("walkthrough_cta"), v.literal("form_start")), occurredAt: v.number(), device: deviceValidator, source: sourceValidator },
  handler: async (ctx, args) => {
    if (env.LANDING_FUNNEL_INGRESS_DISABLED === "true") {
      return { accepted: true as const, recorded: false as const };
    }
    const hour = 3_600_000;
    const windowStart = Math.floor(args.occurredAt / hour) * hour;
    const withinBudget = await consumeWalkthroughBudget(
      ctx,
      "landing-funnel-global",
      windowStart,
      landingFunnelHourlyLimit(),
    );
    if (!withinBudget) {
      return { accepted: true as const, recorded: false as const };
    }
    await appendFunnelEventWithCtx(ctx, args);
    return { accepted: true as const, recorded: true as const };
  },
});

export const appendDurableAcceptance = internalMutation({
  args: { event: landingFunnelEventName, occurredAt: v.number() },
  handler: async (ctx, args) => {
    if (args.event !== "durable_acceptance") throw new Error("Internal event is not durable acceptance");
    await appendFunnelEventWithCtx(ctx, args);
    return null;
  },
});
