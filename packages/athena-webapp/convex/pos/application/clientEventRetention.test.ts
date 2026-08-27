/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";

import { internal } from "../../_generated/api";
import schema from "../../schema";
import { POS_CLIENT_EVENT_RETENTION_MS } from "./clientEventRetention";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../../**/*.ts")).map(([path, loader]) => [
    path.replace(/^\.\.\/\.\.\//, "./"),
    loader,
  ]),
);
modules["./pos/application/clientEventRetention.ts"] = () =>
  import("./clientEventRetention");
const cleanupBatch = internal.pos.application.clientEventRetention.cleanupBatch;

async function insertClientEvent(
  t: ReturnType<typeof convexTest>,
  receivedAt: number,
  clientEventId: string,
) {
  return await t.run(async (ctx) => {
    const createdByUserId = await ctx.db.insert("athenaUser", {
      email: `${clientEventId}@test.local`,
    });
    const organizationId = await ctx.db.insert("organization", {
      name: `Organization ${clientEventId}`,
      slug: `organization-${clientEventId}`,
      createdByUserId,
    });
    const storeId = await ctx.db.insert("store", {
      name: `Store ${clientEventId}`,
      currency: "GHS",
      createdByUserId,
      organizationId,
      slug: `store-${clientEventId}`,
    });
    return await ctx.db.insert("posClientEvent", {
      storeId,
      clientEventId,
      level: "error",
      flow: "runtime",
      message: "Legacy client event",
      metadata: {},
      occurredAt: receivedAt,
      receivedAt,
    });
  });
}

describe("POS client-event retention", () => {
  it("keeps the exact 30-day boundary and removes only older diagnostics", async () => {
    const t = convexTest(schema, modules);
    const fixedNow = 40 * 86_400_000;
    const exactBoundaryId = await insertClientEvent(
      t,
      fixedNow - POS_CLIENT_EVENT_RETENTION_MS,
      "exact-boundary",
    );
    const olderId = await insertClientEvent(
      t,
      fixedNow - POS_CLIENT_EVENT_RETENTION_MS - 1,
      "older",
    );

    await expect(t.mutation(cleanupBatch, { fixedNow })).resolves.toMatchObject({
      deleted: 1,
      hasMore: false,
      fixedNow,
    });
    await expect(
      t.run((ctx) => ctx.db.get("posClientEvent", exactBoundaryId)),
    ).resolves.not.toBeNull();
    await expect(
      t.run((ctx) => ctx.db.get("posClientEvent", olderId)),
    ).resolves.toBeNull();
  });

  it("self-continues only after a full bounded batch with the same fixed now", async () => {
    const t = convexTest(schema, modules);
    const fixedNow = 40 * 86_400_000;
    await insertClientEvent(t, 0, "old-1");
    await insertClientEvent(t, 1, "old-2");

    vi.useFakeTimers();
    try {
      await expect(
        t.mutation(cleanupBatch, { fixedNow, limit: 1 }),
      ).resolves.toMatchObject({ deleted: 1, hasMore: true, fixedNow });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    } finally {
      vi.useRealTimers();
    }

    await expect(
      t.run((ctx) => ctx.db.query("posClientEvent").take(10)),
    ).resolves.toHaveLength(0);
  });
});
