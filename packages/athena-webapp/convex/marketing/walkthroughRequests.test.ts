/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { createWalkthroughDedupeHmac } from "./walkthroughHmac";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./marketing/"),
    loader,
  ]),
);
process.env.WALKTHROUGH_HMAC_ACTIVE_SECRET = "test-only-secret-with-at-least-32-bytes";
process.env.WALKTHROUGH_HMAC_ACTIVE_VERSION = "v2";
process.env.WALKTHROUGH_HMAC_PRIOR_KEYRING = JSON.stringify({
  v1: "prior-test-only-secret-with-at-least-32-bytes",
});
const valid = {
  submissionKey: "01JABCDEFGHIJKLMNOPQRSTUVWX",
  payloadDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  name: "Ada Owner",
  workEmail: "ada@example.com",
  businessName: "Ada Goods",
  businessNeed: "Understand sales and restock with confidence.",
  submittedAt: 1_000,
};

describe("walkthrough persistence contract", () => {
  it("persists one request and one attempt for an identical retry", async () => {
    const t = convexTest(schema, modules);
    expect(await t.mutation(internal.marketing.walkthroughRequests.accept, valid)).toMatchObject({ accepted: true, inserted: true });
    expect(await t.mutation(internal.marketing.walkthroughRequests.accept, valid)).toMatchObject({ accepted: true, inserted: false });
    expect(await t.run((ctx) => ctx.db.query("walkthroughRequest").take(10))).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query("walkthroughNotificationAttempt").take(10))).toHaveLength(1);
  });

  it("serializes concurrent identical submissions", async () => {
    const t = convexTest(schema, modules);
    const results = await Promise.all([
      t.mutation(internal.marketing.walkthroughRequests.accept, valid),
      t.mutation(internal.marketing.walkthroughRequests.accept, valid),
    ]);
    expect(results.filter((result) => result.inserted)).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query("walkthroughRequest").take(10))).toHaveLength(1);
  });

  it("rejects a reused key with changed content without side effects", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.marketing.walkthroughRequests.accept, valid);
    const result = await t.mutation(internal.marketing.walkthroughRequests.accept, {
      ...valid,
      payloadDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      businessNeed: "A changed need",
    });
    expect(result).toMatchObject({ accepted: false, reason: "retry" });
    expect(await t.run((ctx) => ctx.db.query("walkthroughRequest").take(10))).toHaveLength(1);
  });

  it("suppresses equivalent same-email repeats but preserves changed follow-ups", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.marketing.walkthroughRequests.accept, valid);
    expect(await t.mutation(internal.marketing.walkthroughRequests.accept, { ...valid, submissionKey: "01JZZZZZZZZZZZZZZZZZZZZZZZ" })).toMatchObject({ accepted: true, inserted: false });
    expect(await t.mutation(internal.marketing.walkthroughRequests.accept, {
      ...valid,
      submissionKey: "01JYYYYYYYYYYYYYYYYYYYYYYYYY",
      payloadDigest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      businessNeed: "Now we also need inventory visibility",
    })).toMatchObject({ accepted: true, inserted: true, followUp: true });
    expect(await t.run((ctx) => ctx.db.query("walkthroughRequest").take(10))).toHaveLength(2);
  });

  it("bounds replay aliases for equivalent repeats with fresh keys", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.marketing.walkthroughRequests.accept, valid);

    const results = [];
    for (let index = 0; index < 12; index += 1) {
      results.push(
        await t.mutation(internal.marketing.walkthroughRequests.accept, {
          ...valid,
          submissionKey: `01JFRESHRETRY${String(index).padStart(12, "0")}`,
        }),
      );
    }

    expect(results.filter((result) => result.accepted)).toHaveLength(3);
    expect(results.filter((result) => !result.accepted)).toHaveLength(9);
    expect(
      results
        .filter((result) => !result.accepted)
        .every(
          (result) =>
            !result.inserted && result.reason === "unavailable",
        ),
    ).toBe(true);
    expect(
      await t.run((ctx) => ctx.db.query("walkthroughRequestTombstone").take(20)),
    ).toHaveLength(3);
    expect(
      await t.run((ctx) => ctx.db.query("walkthroughRequest").take(20)),
    ).toHaveLength(1);
  });

  it("rejects changed content when an accepted equivalent fresh key is reused", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.marketing.walkthroughRequests.accept, valid);
    const aliasKey = "01JBOUNDALIASBOUNDALIASBOUND";
    await expect(
      t.mutation(internal.marketing.walkthroughRequests.accept, {
        ...valid,
        submissionKey: aliasKey,
      }),
    ).resolves.toMatchObject({ accepted: true, inserted: false });

    await expect(
      t.mutation(internal.marketing.walkthroughRequests.accept, {
        ...valid,
        submissionKey: aliasKey,
        payloadDigest: `sha256:${"e".repeat(64)}`,
        businessNeed: "Changed content cannot reuse an accepted alias key.",
      }),
    ).resolves.toMatchObject({ accepted: false, reason: "retry" });
    expect(
      await t.run((ctx) => ctx.db.query("walkthroughRequest").take(10)),
    ).toHaveLength(1);
  });

  it("links a materially changed follow-up after the rapid-dedupe window", async () => {
    const t = convexTest(schema, modules);
    const first = await t.mutation(
      internal.marketing.walkthroughRequests.accept,
      valid,
    );
    const followUp = await t.mutation(
      internal.marketing.walkthroughRequests.accept,
      {
        ...valid,
        submissionKey: "01JLATEFOLLOWUPLATEFOLLOWUP",
        payloadDigest: `sha256:${"d".repeat(64)}`,
        businessNeed: "A later inventory visibility request.",
        submittedAt: 2 * 86_400_000,
      },
    );

    expect(followUp).toMatchObject({ inserted: true, followUp: true });
    expect(
      await t.run((ctx) =>
        ctx.db.get("walkthroughRequest", followUp.requestId!),
      ),
    ).toMatchObject({ parentRequestId: first.requestId });
  });

  it("uses a prior-version tombstone to suppress equivalent content after redaction", async () => {
    const t = convexTest(schema, modules);
    const dedupeHmac = await createWalkthroughDedupeHmac(
      valid.workEmail,
      valid.payloadDigest,
      "prior-test-only-secret-with-at-least-32-bytes",
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("walkthroughRequestTombstone", {
        submissionKey: "01JPRIORPRIORPRIORPRIORPR",
        dedupeHmac,
        keyVersion: "v1",
        createdAt: 0,
        expiresAt: 365 * 86_400_000,
      });
    });

    await expect(
      t.mutation(internal.marketing.walkthroughRequests.accept, {
        ...valid,
        submissionKey: "01JNEWKEYNEWKEYNEWKEYNEWKEY",
      }),
    ).resolves.toMatchObject({ accepted: true, inserted: false });
    expect(await t.run((ctx) => ctx.db.query("walkthroughRequest").take(10))).toHaveLength(0);
    const tombstones = await t.run((ctx) =>
      ctx.db.query("walkthroughRequestTombstone").take(10),
    );
    expect(tombstones).toHaveLength(2);
    expect(tombstones.find((row) => row.submissionKey === "01JNEWKEYNEWKEYNEWKEYNEWKEY"))
      .toMatchObject({ keyVersion: "v2" });

    await expect(
      t.mutation(internal.marketing.walkthroughRequests.accept, {
        ...valid,
        submissionKey: "01JNEWKEYNEWKEYNEWKEYNEWKEY",
        payloadDigest: `sha256:${"f".repeat(64)}`,
        businessNeed: "Rotated alias keys still reject changed replay content.",
      }),
    ).resolves.toMatchObject({ accepted: false, reason: "retry" });
  });

  it("returns retry guidance when a redacted key is reused for changed content", async () => {
    const t = convexTest(schema, modules);
    const dedupeHmac = await createWalkthroughDedupeHmac(
      valid.workEmail,
      valid.payloadDigest,
      "test-only-secret-with-at-least-32-bytes",
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("walkthroughRequestTombstone", {
        submissionKey: valid.submissionKey,
        dedupeHmac,
        keyVersion: "v2",
        createdAt: 0,
        expiresAt: 365 * 86_400_000,
      });
    });

    await expect(
      t.mutation(internal.marketing.walkthroughRequests.accept, {
        ...valid,
        payloadDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        businessNeed: "Changed content must not masquerade as a retry.",
      }),
    ).resolves.toMatchObject({ accepted: false, reason: "retry" });
  });

  it("allows only one open-to-terminal lifecycle transition", async () => {
    const t = convexTest(schema, modules);
    const requestId = await t.run((ctx) =>
      ctx.db.insert("walkthroughRequest", {
        submissionKey: "01JLIFECYCLELIFECYCLELIFEC",
        payloadDigest: valid.payloadDigest,
        name: valid.name,
        normalizedEmail: valid.workEmail,
        businessName: valid.businessName,
        businessNeed: valid.businessNeed,
        status: "open",
        submittedAt: valid.submittedAt,
        lastActivityAt: valid.submittedAt,
      }),
    );

    await t.mutation(internal.marketing.walkthroughRequests.resolve, {
      requestId,
      qualification: "qualified",
      operatorReference: "restricted-operator",
      reasonCode: "walkthrough_fit",
      occurredAt: 2_000,
    });

    expect(
      await t.run((ctx) =>
        ctx.db
          .query("landingFunnelDailyBucket")
          .withIndex("by_day_and_event_and_device_and_source", (q) =>
            q
              .eq("day", "1970-01-01")
              .eq("event", "qualified")
              .eq("device", "unknown")
              .eq("source", "unknown"),
          )
          .unique(),
      ),
    ).toMatchObject({ count: 1 });
    expect(
      await t.run((ctx) => ctx.db.query("landingFunnelEvent").take(10)),
    ).toHaveLength(0);

    await expect(
      t.mutation(internal.marketing.walkthroughRequests.abandon, {
        requestId,
        operatorReference: "restricted-operator",
        reasonCode: "rewrite_terminal_state",
        occurredAt: 3_000,
      }),
    ).rejects.toThrow("Only an open request can be abandoned");

    await expect(
      t.mutation(internal.marketing.walkthroughRequests.resolve, {
        requestId,
        qualification: "qualified",
        operatorReference: "restricted-operator",
        reasonCode: "duplicate_resolution",
        occurredAt: 4_000,
      }),
    ).rejects.toThrow("Only an open request can be resolved");
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("landingFunnelDailyBucket")
          .withIndex("by_day_and_event_and_device_and_source", (q) =>
            q
              .eq("day", "1970-01-01")
              .eq("event", "qualified")
              .eq("device", "unknown")
              .eq("source", "unknown"),
          )
          .unique(),
      ),
    ).toMatchObject({ count: 1 });
  });
});
