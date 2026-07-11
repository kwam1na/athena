/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import {
  classifyDeliveryResult,
  isDeliberateRetryEligible,
  nextBackoffMs,
} from "./walkthroughRequestNotifications";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./marketing/"),
    loader,
  ]),
);

async function insertAttempt(
  t: TestConvex<typeof schema>,
  state: "pending" | "in_flight" = "pending",
  now = 1_000,
) {
  return await t.run(async (ctx) => {
    const requestId = await ctx.db.insert("walkthroughRequest", {
      submissionKey: `01J${String(now).padStart(23, "A")}`,
      payloadDigest: `sha256:${"a".repeat(64)}`,
      name: "Ada Owner",
      normalizedEmail: `ada-${now}@example.com`,
      businessName: "Ada Goods",
      businessNeed: "Understand sales and inventory pressure.",
      status: "open",
      submittedAt: now,
      lastActivityAt: now,
    });
    return await ctx.db.insert("walkthroughNotificationAttempt", {
      requestId,
      state,
      attemptCount: state === "in_flight" ? 1 : 0,
      createdAt: now,
      nextAttemptAt: state === "pending" ? now : undefined,
      leaseExpiresAt: state === "in_flight" ? now : undefined,
    });
  });
}

describe("walkthrough notification state machine", () => {
  it("bounds retry backoff", () => expect(nextBackoffMs(99)).toBeLessThanOrEqual(86_400_000));
  it("does not blindly retry ambiguous timeouts", () => expect(classifyDeliveryResult({ kind: "timeout" })).toEqual({ state: "outcome_unknown", retry: false, code: "provider_timeout" }));
  it("retries provider unavailability but terminates client rejection", () => {
    expect(classifyDeliveryResult({ kind: "http", status: 503 }).retry).toBe(true);
    expect(classifyDeliveryResult({ kind: "http", status: 400 }).retry).toBe(false);
  });
  it("does not authorize a deliberate retry after the automatic attempt cap", () => {
    expect(isDeliberateRetryEligible("terminal_failure", 3)).toBe(true);
    expect(isDeliberateRetryEligible("terminal_failure", 4)).toBe(false);
  });

  it("checks emergency disable before leasing or consuming notification budget", async () => {
    const t = convexTest(schema, modules);
    const attemptId = await insertAttempt(t);
    process.env.WALKTHROUGH_NOTIFICATIONS_DISABLED = "true";
    expect(await t.mutation(internal.marketing.walkthroughRequestNotifications.lease, { attemptId, now: 1_000 })).toBeNull();
    expect(await t.run((ctx) => ctx.db.query("walkthroughBudgetCounter").take(10))).toHaveLength(0);
    delete process.env.WALKTHROUGH_NOTIFICATIONS_DISABLED;
  });

  it("marks a stale lease outcome unknown instead of resending it", async () => {
    const t = convexTest(schema, modules);
    const attemptId = await insertAttempt(t, "in_flight", 1_000);
    expect(await t.mutation(internal.marketing.walkthroughRequestNotifications.scheduleEligibleBatch, { now: 2_000 })).toMatchObject({ markedOutcomeUnknown: 1, scheduled: 0 });
    expect(await t.run((ctx) => ctx.db.get("walkthroughNotificationAttempt", attemptId))).toMatchObject({ state: "outcome_unknown", errorCode: "stale_delivery_lease" });
  });

  it("rejects completion from a worker holding an expired lease token", async () => {
    const t = convexTest(schema, modules);
    const attemptId = await insertAttempt(t);
    const firstLease = await t.mutation(
      internal.marketing.walkthroughRequestNotifications.lease,
      { attemptId, now: 1_000 },
    );
    await t.mutation(
      internal.marketing.walkthroughRequestNotifications.scheduleEligibleBatch,
      { now: 302_000 },
    );
    await t.mutation(
      internal.marketing.walkthroughRequestNotifications.resolveUnknown,
      {
        attemptId,
        outcome: "retryable_failure",
        operatorReference: "restricted-operator",
        reasonCode: "provider_reviewed",
        now: 303_000,
      },
    );
    const secondLease = await t.mutation(
      internal.marketing.walkthroughRequestNotifications.lease,
      { attemptId, now: 303_000 },
    );

    await t.mutation(
      internal.marketing.walkthroughRequestNotifications.complete,
      {
        attemptId,
        leaseToken: firstLease!.leaseToken,
        now: 304_000,
        state: "sent",
        errorCode: "sent",
      },
    );
    expect(
      await t.run((ctx) =>
        ctx.db.get("walkthroughNotificationAttempt", attemptId),
      ),
    ).toMatchObject({
      state: "in_flight",
      leaseToken: secondLease!.leaseToken,
    });
  });

  it("leaves over-budget notification work pending", async () => {
    const t = convexTest(schema, modules);
    const firstAttemptId = await insertAttempt(t, "pending", 4_000);
    const secondAttemptId = await insertAttempt(t, "pending", 5_000);
    process.env.WALKTHROUGH_HOURLY_NOTIFICATION_LIMIT = "1";
    try {
      expect(
        await t.mutation(
          internal.marketing.walkthroughRequestNotifications.lease,
          { attemptId: firstAttemptId, now: 5_000 },
        ),
      ).not.toBeNull();
      expect(
        await t.mutation(
          internal.marketing.walkthroughRequestNotifications.lease,
          { attemptId: secondAttemptId, now: 5_000 },
        ),
      ).toBeNull();
      expect(
        await t.run((ctx) =>
          ctx.db.get("walkthroughNotificationAttempt", secondAttemptId),
        ),
      ).toMatchObject({ state: "pending" });
    } finally {
      delete process.env.WALKTHROUGH_HOURLY_NOTIFICATION_LIMIT;
    }
  });
});
