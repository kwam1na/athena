/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  DEFAULT_STORE_TIMEZONE,
  localDateLabel,
  resolveOperatingDate,
  resolveStoreTimezone,
} from "./operatingDay";

const modules = import.meta.glob("../**/*.ts");

async function seedStore(
  ctx: MutationCtx,
  config?: Record<string, unknown>,
): Promise<{
  organizationId: Id<"organization">;
  storeId: Id<"store">;
  userId: Id<"athenaUser">;
}> {
  const userId = await ctx.db.insert("athenaUser", {
    email: "admin@example.test",
  });
  const organizationId = await ctx.db.insert("organization", {
    createdByUserId: userId,
    name: "Org",
    slug: "org",
  });
  const storeId = await ctx.db.insert("store", {
    ...(config ? { config } : {}),
    createdByUserId: userId,
    currency: "GHS",
    name: "Store",
    organizationId,
    slug: "store",
  });
  return { organizationId, storeId, userId };
}

async function seedTimezoneVersion(
  ctx: MutationCtx,
  args: {
    organizationId: Id<"organization">;
    storeId: Id<"store">;
    userId: Id<"athenaUser">;
    timezone: string;
    effectiveFrom: number;
    effectiveTo?: number;
    contentHash: string;
  },
) {
  return await ctx.db.insert("storeTimezoneVersion", {
    authorizedAt: 1,
    authorizedByUserId: args.userId,
    contentHash: args.contentHash,
    createdAt: 1,
    effectiveFrom: args.effectiveFrom,
    ...(args.effectiveTo === undefined ? {} : { effectiveTo: args.effectiveTo }),
    organizationId: args.organizationId,
    source: "admin_authorized",
    storeId: args.storeId,
    timezone: args.timezone,
  });
}

describe("localDateLabel", () => {
  it("labels the store-local calendar date across a UTC+9 midnight", () => {
    // 2026-03-01T14:59:59Z is still 2026-03-01 23:59 in Tokyo…
    expect(localDateLabel(Date.parse("2026-03-01T14:59:59Z"), "Asia/Tokyo")).toBe(
      "2026-03-01",
    );
    // …and one second later it is already the next local day.
    expect(localDateLabel(Date.parse("2026-03-01T15:00:00Z"), "Asia/Tokyo")).toBe(
      "2026-03-02",
    );
  });

  it("labels the store-local calendar date across a UTC-8 midnight", () => {
    expect(
      localDateLabel(Date.parse("2026-03-01T07:59:59Z"), "America/Los_Angeles"),
    ).toBe("2026-02-28");
    expect(
      localDateLabel(Date.parse("2026-03-01T08:00:00Z"), "America/Los_Angeles"),
    ).toBe("2026-03-01");
  });

  it("matches UTC for the platform default zone", () => {
    expect(
      localDateLabel(Date.parse("2026-03-01T23:59:59Z"), DEFAULT_STORE_TIMEZONE),
    ).toBe("2026-03-01");
  });
});

describe("resolveOperatingDate", () => {
  it("uses the timezone version effective at occurredAt", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const { organizationId, storeId, userId } = await seedStore(ctx);
      const cutover = Date.parse("2026-02-01T00:00:00Z");
      await seedTimezoneVersion(ctx, {
        contentHash: "hash-old",
        effectiveFrom: 0,
        effectiveTo: cutover,
        organizationId,
        storeId,
        timezone: "America/Los_Angeles",
        userId,
      });
      await seedTimezoneVersion(ctx, {
        contentHash: "hash-new",
        effectiveFrom: cutover,
        organizationId,
        storeId,
        timezone: "Asia/Tokyo",
        userId,
      });

      // Before the cutover the old (UTC-8) authority still dates the fact.
      await expect(
        resolveOperatingDate(ctx, storeId, Date.parse("2026-01-15T05:00:00Z")),
      ).resolves.toBe("2026-01-14");
      // After it, the new (UTC+9) authority applies.
      await expect(
        resolveOperatingDate(ctx, storeId, Date.parse("2026-03-01T16:00:00Z")),
      ).resolves.toBe("2026-03-02");
    });
  });

  it("falls back to the store's configured timezone when no version covers the instant", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const { organizationId, storeId, userId } = await seedStore(ctx, {
        timezone: "Asia/Tokyo",
      });
      // A version exists but its interval closed before the instant.
      await seedTimezoneVersion(ctx, {
        contentHash: "hash-closed",
        effectiveFrom: 0,
        effectiveTo: Date.parse("2026-01-01T00:00:00Z"),
        organizationId,
        storeId,
        timezone: "America/Los_Angeles",
        userId,
      });
      await expect(
        resolveStoreTimezone(ctx, storeId, Date.parse("2026-03-01T16:00:00Z")),
      ).resolves.toBe("Asia/Tokyo");
      await expect(
        resolveOperatingDate(ctx, storeId, Date.parse("2026-03-01T16:00:00Z")),
      ).resolves.toBe("2026-03-02");
    });
  });

  it("falls back to the platform default when the store has no timezone at all", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const { storeId } = await seedStore(ctx);
      await expect(resolveStoreTimezone(ctx, storeId, 0)).resolves.toBe(
        DEFAULT_STORE_TIMEZONE,
      );
      await expect(
        resolveOperatingDate(ctx, storeId, Date.parse("2026-03-01T23:30:00Z")),
      ).resolves.toBe("2026-03-01");
    });
  });

  it("ignores an invalid configured timezone rather than throwing", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const { storeId } = await seedStore(ctx, { timezone: "Not/AZone" });
      await expect(resolveStoreTimezone(ctx, storeId, 0)).resolves.toBe(
        DEFAULT_STORE_TIMEZONE,
      );
    });
  });
});
