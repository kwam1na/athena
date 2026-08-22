/// <reference types="vite/client" />
/**
 * Characterization of the register-session seams the `cash.registerSessions`
 * agent resource reshapes (V26-1267, posture: characterization-first).
 *
 * `listRegisterSessionsForDashboard` is the store-scoped session read the cash
 * controls surface uses: four "live" status partitions plus a bounded window of
 * recently closed sessions. The agent resource pages the same partitions, so
 * the partition set and the money fields on a session are pinned here.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import schema from "../../schema";
import { listRegisterSessionsForDashboard } from "../deposits";
import { CURRENT_OPERATING_DATE, seedDailyOperationsStore } from "../../agentHarness/evals/dailyOperations.fixture";

const modules = import.meta.glob("../../**/*.ts");

describe("register session seams (characterization)", () => {
  it("reads open and recently closed sessions for the store", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run((ctx) => seedDailyOperationsStore(ctx));
    const sessions = await t.run((ctx) => listRegisterSessionsForDashboard(ctx, fixture.storeId));

    expect(sessions).toHaveLength(2);
    const byNumber = new Map(sessions.map((session) => [session.registerNumber, session]));
    const open = byNumber.get("Register 1")!;
    const closed = byNumber.get("Register 2")!;

    expect(open.status).toBe("open");
    expect(open.openedOperatingDate).toBe(CURRENT_OPERATING_DATE);
    expect(open.expectedCash).toBe(60_000);
    // An open drawer has no counted cash and therefore no variance.
    expect(open.countedCash).toBeUndefined();
    expect(open.variance).toBeUndefined();

    expect(closed.status).toBe("closed");
    expect(closed.closeoutOperatingDate).toBe(CURRENT_OPERATING_DATE);
    expect(closed.countedCash).toBe(44_500);
    expect(closed.variance).toBe(-500);
    expect(closed.closeoutRecords).toHaveLength(1);
    expect(closed.closeoutRecords?.[0].type).toBe("closed");
  });

  it("does not read another store's sessions", async () => {
    const t = convexTest(schema, modules);
    const own = await t.run((ctx) => seedDailyOperationsStore(ctx, { slug: "own" }));
    await t.run((ctx) => seedDailyOperationsStore(ctx, { slug: "other" }));
    const sessions = await t.run((ctx) => listRegisterSessionsForDashboard(ctx, own.storeId));
    expect(sessions.every((session) => session.storeId === own.storeId)).toBe(true);
    expect(sessions).toHaveLength(2);
  });
});
