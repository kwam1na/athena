import { readFileSync } from "node:fs";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import schema from "../schema";
import { SHARED_DEMO_REGISTER_NUMBER } from "./config";
import { SHARED_DEMO_REGISTER_UNAVAILABLE_CODE } from "../../shared/sharedDemoRegisterError";
import {
  bindSharedDemoRegisterBaselineWithCtx,
  buildSharedDemoRegisterCashBaseline,
  buildSharedDemoRegisterNarrative,
  buildSharedDemoStoreSchedule,
  planSharedDemoRegisterAllocation,
  rollSharedDemoSeededRegisterWithCtx,
  sharedDemoSeededRegisterOpenedAt,
} from "./registerBaseline";

const modules = import.meta.glob("../**/*.ts");

describe("planSharedDemoRegisterAllocation", () => {
  it("reuses the seeded session already owned by this browser terminal", () => {
    expect(
      planSharedDemoRegisterAllocation({
        hasExistingTerminalSession: true,
      }),
    ).toBe("reuse");
  });

  it("clones the narrative for the first browser", () => {
    expect(
      planSharedDemoRegisterAllocation({
        hasExistingTerminalSession: false,
      }),
    ).toBe("clone");
  });

  it("never assigns template ownership to a browser terminal", () => {
    expect(
      planSharedDemoRegisterAllocation({
        hasExistingTerminalSession: false,
      }),
    ).toBe("clone");
  });
});

describe("buildSharedDemoRegisterCashBaseline", () => {
  it("starts seeded browser registers with a $50 opening float", () => {
    expect(buildSharedDemoRegisterCashBaseline()).toEqual({
      expectedCash: 5000,
      openingFloat: 5000,
    });
  });
});

describe("buildSharedDemoRegisterNarrative", () => {
  it("opens the browser register on the current demo day", () => {
    const now = Date.parse("2026-07-14T12:00:00.000Z");

    expect(
      buildSharedDemoRegisterNarrative({
        now,
        registerNumber: "213305",
        terminalId: "terminal-browser" as never,
      }),
    ).toEqual({
      openedAt: Date.parse("2026-07-14T08:00:00.000Z"),
      openedOperatingDate: "2026-07-14",
      openedOperatingDateEndAt: Date.parse("2026-07-15T04:00:00.000Z"),
      openedOperatingDateStartAt: Date.parse("2026-07-14T04:00:00.000Z"),
      registerNumber: "213305",
      terminalId: "terminal-browser",
    });
  });

  it("does not place opening activity before the current operating day", () => {
    const now = Date.parse("2026-07-14T00:30:00.000Z");
    const narrative = buildSharedDemoRegisterNarrative({
      now,
      registerNumber: "213305",
      terminalId: "terminal-browser" as never,
    });

    expect(narrative.openedAt).toBe(Date.parse("2026-07-13T20:30:00.000Z"));
  });

  it("does not collapse an overnight browser session to midnight", () => {
    const now = Date.parse("2026-07-24T05:30:00.000Z"); // 01:30 ET
    const narrative = buildSharedDemoRegisterNarrative({
      now,
      registerNumber: "213305",
      terminalId: "terminal-browser" as never,
    });

    expect(narrative.openedAt).toBe(Date.parse("2026-07-24T04:45:00.000Z"));
    expect(narrative.openedAt).not.toBe(
      Date.parse("2026-07-24T04:00:00.000Z"),
    );
  });

  it("creates all-day demo store hours in the canonical timezone", () => {
    expect(
      buildSharedDemoStoreSchedule({
        actorUserId: "user" as never,
        now: 100,
        organizationId: "organization" as never,
        storeId: "store" as never,
      }),
    ).toMatchObject({
      dateExceptions: [],
      effectiveFrom: 0,
      source: "seed",
      status: "active",
      timezone: "America/New_York",
      weeklyClosedDays: [],
      weeklyWindows: Array.from({ length: 7 }, (_, dayOfWeek) => ({
        dayOfWeek,
        endMinute: 24 * 60,
        label: "Demo hours",
        startMinute: 0,
      })),
    });
  });
});

describe("sharedDemoSeededRegisterOpenedAt", () => {
  const dayStart = Date.parse("2026-07-24T04:00:00.000Z"); // midnight ET

  it("anchors to a believable morning time, not the day start", () => {
    const openedAt = sharedDemoSeededRegisterOpenedAt({
      now: Date.parse("2026-07-24T18:00:00.000Z"),
      operatingDayStartAt: dayStart,
    });
    // 08:47 ET → offset 8h47m from the operating-day start.
    expect(openedAt).toBe(Date.parse("2026-07-24T12:47:00.000Z"));
    expect(openedAt).not.toBe(dayStart);
  });

  it("clamps to now when the morning open time has not arrived yet", () => {
    const now = Date.parse("2026-07-24T05:30:00.000Z"); // 01:30 ET
    expect(
      sharedDemoSeededRegisterOpenedAt({ now, operatingDayStartAt: dayStart }),
    ).toBe(now);
  });
});

describe("rollSharedDemoSeededRegisterWithCtx", () => {
  async function seedStoreWithRegister(
    ctx: any,
    session: Record<string, unknown>,
  ) {
    const ownerUserId = await ctx.db.insert("athenaUser", {
      email: "demo@example.test",
    });
    const organizationId = await ctx.db.insert("organization", {
      createdByUserId: ownerUserId,
      name: "Demo Org",
      slug: "demo-org",
    });
    const storeId = await ctx.db.insert("store", {
      createdByUserId: ownerUserId,
      currency: "GHS",
      name: "Demo Store",
      organizationId,
      slug: "demo-store",
    });
    const sessionId = await ctx.db.insert("registerSession", {
      expectedCash: 5_000,
      openedAt: Date.parse("2026-07-18T08:00:00.000Z"),
      openedByUserId: ownerUserId,
      openedOperatingDate: "2026-07-18",
      openedOperatingDateEndAt: Date.parse("2026-07-19T04:00:00.000Z"),
      openedOperatingDateStartAt: Date.parse("2026-07-18T04:00:00.000Z"),
      openingFloat: 5_000,
      organizationId,
      registerNumber: SHARED_DEMO_REGISTER_NUMBER,
      status: "active",
      storeId,
      ...session,
    });
    return { organizationId, sessionId, storeId };
  }

  it("rebases the frozen seeded register onto the current demo day at a believable morning time", async () => {
    const t = convexTest(schema, modules);
    // 16:00 UTC = 12:00 ET, safely past the seeded 08:47 ET open time.
    const now = Date.parse("2026-07-24T16:00:00.000Z");

    const { sessionId } = await t.run(async (ctx) => {
      const seeded = await seedStoreWithRegister(ctx, {});
      await rollSharedDemoSeededRegisterWithCtx(ctx, {
        now,
        storeId: seeded.storeId,
      });
      return seeded;
    });

    const rolled = await t.run((ctx) => ctx.db.get("registerSession", sessionId));
    expect(rolled).toMatchObject({
      // 08:47 ET on the operating day, not the 12:00 AM day-start.
      openedAt: Date.parse("2026-07-24T12:47:00.000Z"),
      openedOperatingDate: "2026-07-24",
      openedOperatingDateEndAt: Date.parse("2026-07-25T04:00:00.000Z"),
      openedOperatingDateStartAt: Date.parse("2026-07-24T04:00:00.000Z"),
    });
  });

  it("leaves non-seeded and closed registers untouched", async () => {
    const t = convexTest(schema, modules);
    const now = Date.parse("2026-07-24T12:00:00.000Z");

    const { browserSessionId, closedSessionId } = await t.run(async (ctx) => {
      const { storeId } = await seedStoreWithRegister(ctx, {});
      const browserSessionId = await ctx.db.insert("registerSession", {
        expectedCash: 240_500,
        openedAt: Date.parse("2026-07-18T08:00:00.000Z"),
        openedOperatingDate: "2026-07-18",
        openingFloat: 5_000,
        registerNumber: "57",
        status: "active",
        storeId,
      });
      const closedSessionId = await ctx.db.insert("registerSession", {
        expectedCash: 5_000,
        openedAt: Date.parse("2026-07-18T08:00:00.000Z"),
        openedOperatingDate: "2026-07-18",
        openingFloat: 5_000,
        registerNumber: SHARED_DEMO_REGISTER_NUMBER,
        status: "closed",
        storeId,
      });
      await rollSharedDemoSeededRegisterWithCtx(ctx, { now, storeId });
      return { browserSessionId, closedSessionId };
    });

    const [browser, closed] = await t.run(async (ctx) => [
      await ctx.db.get("registerSession", browserSessionId),
      await ctx.db.get("registerSession", closedSessionId),
    ]);
    expect(browser?.openedOperatingDate).toBe("2026-07-18");
    expect(closed?.openedOperatingDate).toBe("2026-07-18");
  });
});

describe("bindSharedDemoRegisterBaselineWithCtx", () => {
  it("throws the typed register-unavailable error for an unusable terminal", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await expect(
        bindSharedDemoRegisterBaselineWithCtx(ctx as any, {
          actorUserId: "user" as any,
          now: 1_000,
          storeId: "store-a" as any,
          terminal: {
            registerNumber: "05",
            status: "active",
            storeId: "store-b",
          } as any,
        }),
      ).rejects.toMatchObject({
        data: { code: SHARED_DEMO_REGISTER_UNAVAILABLE_CODE },
      });
    });
  });
});

describe("shared demo register baseline", () => {
  it("does not manufacture a completed sale for the template or browser register", () => {
    const baselineSource = readFileSync(
      "convex/sharedDemo/registerBaseline.ts",
      "utf8",
    );
    const provisionSource = readFileSync(
      "convex/sharedDemo/provision.ts",
      "utf8",
    );

    expect(baselineSource).not.toContain('ctx.db.insert("posTransaction"');
    expect(provisionSource).not.toContain('ctx.db.insert("posTransaction"');
    expect(provisionSource).not.toContain('movementType: "sale"');
  });
});
