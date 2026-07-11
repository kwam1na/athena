/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { retentionDecision } from "./walkthroughRequestRetention";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./marketing/"),
    loader,
  ]),
);
process.env.WALKTHROUGH_HMAC_ACTIVE_VERSION = "v1";
process.env.WALKTHROUGH_HMAC_ACTIVE_SECRET = "retention-test-secret-with-at-least-32-bytes";

describe("walkthrough retention", () => {
  it("abandons inactive open work and redacts terminal work at 180 days", () => {
    expect(retentionDecision({ status: "open", lastActivityAt: 0, now: 181 * 86_400_000 })).toBe("abandon_and_redact");
    expect(retentionDecision({ status: "resolved", lastActivityAt: 0, terminalAt: 0, now: 181 * 86_400_000 })).toBe("redact");
  });
  it("retains active and recently terminal records", () => expect(retentionDecision({ status: "open", lastActivityAt: 0, now: 179 * 86_400_000 })).toBe("retain"));

  it("removes replay keys from redacted records when their tombstones expire", async () => {
    const t = convexTest(schema, modules);
    const requestId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("walkthroughRequest", {
        submissionKey: "01JRETENTIONRETENTIONRETENT",
        status: "abandoned",
        submittedAt: 0,
        lastActivityAt: 0,
        terminalAt: 0,
        redactedAt: 500,
      });
      await ctx.db.insert("walkthroughRequestTombstone", {
        submissionKey: "01JRETENTIONRETENTIONRETENT",
        dedupeHmac: "a".repeat(64),
        keyVersion: "v1",
        createdAt: 0,
        expiresAt: 1_000,
      });
      return id;
    });

    await t.mutation(internal.marketing.walkthroughRequestRetention.cleanupBatch, { now: 2_000 });
    const retainedRequest = await t.run((ctx) =>
      ctx.db.get("walkthroughRequest", requestId),
    );
    expect(retainedRequest).toMatchObject({ redactedAt: 500 });
    expect(retainedRequest).not.toHaveProperty("submissionKey");
    expect(await t.run((ctx) => ctx.db.query("walkthroughRequestTombstone").take(10))).toHaveLength(0);
  });

  it("consumes a one-time stored-email challenge and audits verified export", async () => {
    const t = convexTest(schema, modules);
    const requestId = await t.run((ctx) => ctx.db.insert("walkthroughRequest", {
      submissionKey: "01JPRIVACYPRIVACYPRIVACYPRI",
      payloadDigest: `sha256:${"b".repeat(64)}`,
      name: "Ada Owner",
      normalizedEmail: "ada@example.com",
      businessName: "Ada Goods",
      businessNeed: "Export my walkthrough request.",
      status: "open",
      submittedAt: 0,
      lastActivityAt: 0,
    }));
    const replyDigest = `sha256:${"c".repeat(64)}`;
    const challenge = await t.mutation(internal.marketing.walkthroughRequestRetention.beginPrivacyChallenge, {
      requestId,
      challengeDigest: replyDigest,
      requestedAction: "export",
      operatorReference: "operator@example.com",
      now: 1_000,
    });

    expect(await t.mutation(internal.marketing.walkthroughRequestRetention.exportVerifiedSubject, {
      challengeId: challenge.challengeId,
      replyDigest,
      operatorReference: "operator@example.com",
      now: 2_000,
    })).toMatchObject({ workEmail: "ada@example.com", businessName: "Ada Goods" });
    await expect(t.mutation(internal.marketing.walkthroughRequestRetention.exportVerifiedSubject, {
      challengeId: challenge.challengeId,
      replyDigest,
      operatorReference: "operator@example.com",
      now: 3_000,
    })).rejects.toThrow("Privacy challenge is not valid");
    expect(await t.run((ctx) => ctx.db.query("walkthroughOperationsAudit").withIndex("by_requestId_and_occurredAt", (q) => q.eq("requestId", requestId)).take(10))).toEqual(expect.arrayContaining([expect.objectContaining({ action: "verified_export" })]));
  });

  it("continues full cleanup batches without reprocessing redacted rows", async () => {
    const t = convexTest(schema, modules);
    const now = 181 * 86_400_000;
    await t.run(async (ctx) => {
      for (const suffix of ["A", "B"]) {
        await ctx.db.insert("walkthroughRequest", {
          submissionKey: `01JCLEANUPCONTINUATION${suffix}KEY`,
          status: "open",
          submittedAt: 0,
          lastActivityAt: 0,
        });
      }
    });

    vi.useFakeTimers();
    try {
      expect(
        await t.mutation(
          internal.marketing.walkthroughRequestRetention.cleanupBatch,
          { now, limit: 1 },
        ),
      ).toMatchObject({ processedRequests: 1, hasMore: true });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    } finally {
      vi.useRealTimers();
    }

    const requests = await t.run((ctx) =>
      ctx.db.query("walkthroughRequest").take(10),
    );
    expect(requests).toHaveLength(2);
    expect(requests.every((request) => request.redactedAt === now)).toBe(true);
  });
});
