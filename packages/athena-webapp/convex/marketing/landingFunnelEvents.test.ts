/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./marketing/"),
    loader,
  ]),
);

describe("landing funnel persistence", () => {
it("stores only bounded anonymous funnel context and aggregates by day", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.marketing.landingFunnelEvents.appendPublic, { event: "page_view", occurredAt: Date.UTC(2026, 6, 11), device: "mobile", source: "direct" });
  const raw = await t.run((ctx) => ctx.db.query("landingFunnelEvent").take(10));
  const buckets = await t.run((ctx) => ctx.db.query("landingFunnelDailyBucket").take(10));
  expect(raw).toMatchObject([{ event: "page_view", device: "mobile", source: "direct" }]);
  expect(buckets).toMatchObject([{ event: "page_view", count: 1 }]);
  expect(JSON.stringify(raw)).not.toMatch(/email|organization|storeId|session/i);
});

it("drops public events generically after the bounded hourly budget", async () => {
  process.env.LANDING_FUNNEL_HOURLY_LIMIT = "1";
  const t = convexTest(schema, modules);
  const args = { event: "page_view" as const, occurredAt: Date.UTC(2026, 6, 11) };
  expect(await t.mutation(internal.marketing.landingFunnelEvents.appendPublic, args)).toMatchObject({ accepted: true, recorded: true });
  expect(await t.mutation(internal.marketing.landingFunnelEvents.appendPublic, args)).toMatchObject({ accepted: true, recorded: false });
  expect(await t.run((ctx) => ctx.db.query("landingFunnelEvent").take(10))).toHaveLength(1);
  delete process.env.LANDING_FUNNEL_HOURLY_LIMIT;
});
});
