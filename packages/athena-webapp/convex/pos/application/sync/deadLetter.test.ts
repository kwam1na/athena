/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import schema from "../../../schema";
import type { Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import { recordLocalSyncDeadLetter } from "./deadLetter";
import { PERSISTENT_SYNC_FAILURE_SUMMARY } from "./registerSessionSyncReview";

const modules = import.meta.glob("../../../**/*.ts");

async function seed(ctx: MutationCtx) {
  const userId = await ctx.db.insert("athenaUser", {
    email: "admin@example.test",
  });
  const organizationId = await ctx.db.insert("organization", {
    createdByUserId: userId,
    name: "Org",
    slug: "org",
  });
  const storeId = await ctx.db.insert("store", {
    createdByUserId: userId,
    currency: "GHS",
    name: "Store",
    organizationId,
    slug: "store",
  });
  const terminalId = await ctx.db.insert("posTerminal", {
    browserInfo: { platform: "MacIntel", userAgent: "Chrome" },
    displayName: "Front Counter",
    fingerprintHash: "fingerprint-1",
    heartbeatEnabled: false,
    registerNumber: "1",
    registeredAt: 1,
    registeredByUserId: userId,
    status: "active",
    storeId,
  });
  return { storeId, terminalId };
}

const baseArgs = (ids: {
  storeId: Id<"store">;
  terminalId: Id<"posTerminal">;
}) => ({
  ...ids,
  localRegisterSessionId: "local-register-1",
  localEventId: "event-1",
  sequence: 4,
  eventCount: 3,
  consecutiveFailureCount: 5,
  failureMessage: "Server Error: Uncaught Error at recordFacts",
  reportedAt: 1_000,
});

describe("recordLocalSyncDeadLetter", () => {
  it("creates a needs_review conflict for the failing batch head", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const ids = await seed(ctx);
      const { conflict, created } = await recordLocalSyncDeadLetter(ctx, baseArgs(ids));

      expect(created).toBe(true);
      expect(conflict).toMatchObject({
        conflictType: "server_rejected",
        localEventId: "event-1",
        localRegisterSessionId: "local-register-1",
        sequence: 4,
        status: "needs_review",
        summary: PERSISTENT_SYNC_FAILURE_SUMMARY,
        details: {
          code: "persistent_sync_failure",
          consecutiveFailureCount: 5,
          eventCount: 3,
          failureMessage: "Server Error: Uncaught Error at recordFacts",
        },
      });

      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      const rows = await ctx.db.query("posLocalSyncConflict").collect();
      expect(rows).toHaveLength(1);
    });
  });

  it("is idempotent for the same wedged batch head", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const ids = await seed(ctx);
      const first = await recordLocalSyncDeadLetter(ctx, baseArgs(ids));
      const second = await recordLocalSyncDeadLetter(ctx, {
        ...baseArgs(ids),
        // A later report of the SAME wedge (higher streak) must not fan out
        // into a second review item.
        consecutiveFailureCount: 9,
        reportedAt: 2_000,
      });

      expect(second.created).toBe(false);
      expect(String(second.conflict._id)).toBe(String(first.conflict._id));
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      const rows = await ctx.db.query("posLocalSyncConflict").collect();
      expect(rows).toHaveLength(1);
    });
  });

  it("creates a fresh conflict once the earlier one is resolved", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const ids = await seed(ctx);
      const first = await recordLocalSyncDeadLetter(ctx, baseArgs(ids));
      await ctx.db.patch("posLocalSyncConflict", first.conflict._id, {
        status: "resolved",
        resolvedAt: 1_500,
      });

      const second = await recordLocalSyncDeadLetter(ctx, {
        ...baseArgs(ids),
        reportedAt: 2_000,
      });
      expect(second.created).toBe(true);
      expect(String(second.conflict._id)).not.toBe(String(first.conflict._id));
    });
  });
});
