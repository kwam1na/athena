/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";

import { internal } from "../_generated/api";
import schema from "../schema";
import { shouldExpireFunnelRecord } from "./landingFunnelRetention";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./marketing/"),
    loader,
  ]),
);

it("expires raw events after 30 days and aggregates after 395 days", () => {
  expect(shouldExpireFunnelRecord("raw", 0, 31 * 86_400_000)).toBe(true);
  expect(shouldExpireFunnelRecord("aggregate", 0, 394 * 86_400_000)).toBe(false);
  expect(shouldExpireFunnelRecord("aggregate", 0, 396 * 86_400_000)).toBe(true);
});

it("self-continues bounded funnel cleanup batches", async () => {
  const t = convexTest(schema, modules);
  const now = 396 * 86_400_000;
  await t.run(async (ctx) => {
    for (const day of ["2025-01-01", "2025-01-02"]) {
      await ctx.db.insert("landingFunnelEvent", {
        event: "page_view",
        occurredAt: 0,
        day,
      });
      await ctx.db.insert("landingFunnelDailyBucket", {
        day,
        event: "page_view",
        device: "unknown",
        source: "unknown",
        count: 1,
        updatedAt: 0,
      });
    }
  });

  vi.useFakeTimers();
  try {
    expect(
      await t.mutation(internal.marketing.landingFunnelRetention.cleanupBatch, {
        now,
        limit: 1,
      }),
    ).toMatchObject({ deletedRaw: 1, deletedAggregates: 1, hasMore: true });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  } finally {
    vi.useRealTimers();
  }

  expect(
    await t.run((ctx) => ctx.db.query("landingFunnelEvent").take(10)),
  ).toHaveLength(0);
  expect(
    await t.run((ctx) => ctx.db.query("landingFunnelDailyBucket").take(10)),
  ).toHaveLength(0);
});

it("expires identity-free qualification aggregates on the aggregate schedule", async () => {
  const t = convexTest(schema, modules);
  const now = 396 * 86_400_000;
  await t.run((ctx) =>
    ctx.db.insert("landingFunnelDailyBucket", {
      day: "2025-01-01",
      event: "not_qualified",
      device: "unknown",
      source: "unknown",
      count: 2,
      updatedAt: 0,
    }),
  );

  await t.mutation(internal.marketing.landingFunnelRetention.cleanupBatch, {
    now,
  });
  expect(
    await t.run((ctx) => ctx.db.query("landingFunnelDailyBucket").take(10)),
  ).toHaveLength(0);
});
