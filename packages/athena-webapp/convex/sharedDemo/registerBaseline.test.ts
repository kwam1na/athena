import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  buildSharedDemoRegisterCashBaseline,
  buildSharedDemoRegisterNarrative,
  buildSharedDemoStoreSchedule,
  planSharedDemoRegisterAllocation,
} from "./registerBaseline";

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
