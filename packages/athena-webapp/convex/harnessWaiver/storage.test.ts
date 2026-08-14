/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { internal } from "../_generated/api";
import schema from "../schema";
import type { WaiverCandidate } from "./passkeyPolicy";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./harnessWaiver/"),
    loader,
  ]),
);

const candidate: WaiverCandidate = {
  repository: "kwam1na/athena",
  prNumber: 123,
  headSha: "head-1",
  baseRef: "origin/main",
  baseSha: "base-1",
  diffBaseSha: "merge-base-1",
  deliverableTreeSha: "tree-1",
  identityVersion: "deliverable-tree/v1",
  waivedFindingCodes: ["compound-solution"],
  reason: "Accepted for this exact candidate.",
};

describe("harness waiver storage transitions", () => {
  it("consumes a live registration authorization exactly once", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("harnessWaiverRegistrationAuthorization", {
      tokenHash: "a".repeat(64),
      reviewerEmail: "reviewer@example.com",
      expiresAt: 2_000,
    }));

    await expect(t.mutation(
      internal.harnessWaiver.storage.consumeRegistrationAuthorization,
      { tokenHash: "a".repeat(64), now: 1_000 },
    )).resolves.toEqual({ reviewerEmail: "reviewer@example.com" });
    await expect(t.mutation(
      internal.harnessWaiver.storage.consumeRegistrationAuthorization,
      { tokenHash: "a".repeat(64), now: 1_001 },
    )).rejects.toThrow("unavailable");
  });

  it("rejects an expired registration authorization without consuming it", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("harnessWaiverRegistrationAuthorization", {
      tokenHash: "b".repeat(64),
      reviewerEmail: "reviewer@example.com",
      expiresAt: 2_000,
    }));

    await expect(t.mutation(
      internal.harnessWaiver.storage.consumeRegistrationAuthorization,
      { tokenHash: "b".repeat(64), now: 2_000 },
    )).rejects.toThrow("unavailable");
    const [authorization] = await t.run((ctx) =>
      ctx.db.query("harnessWaiverRegistrationAuthorization").take(1),
    );
    expect(authorization.consumedAt).toBeUndefined();
  });

  it("allows exactly one credential to complete one live registration challenge", async () => {
    const t = convexTest(schema, modules);
    const challenge = "registration-challenge";
    await t.mutation(internal.harnessWaiver.storage.saveRegistrationChallenge, {
      challenge,
      reviewerEmail: "reviewer@example.com",
      expiresAt: 2_000,
    });

    const complete = () => t.mutation(internal.harnessWaiver.storage.completeRegistration, {
      challenge,
      reviewerEmail: "reviewer@example.com",
      credentialId: "credential-1",
      publicKey: new ArrayBuffer(4),
      counter: 0,
      transports: ["internal"],
      deviceType: "multiDevice",
      backedUp: true,
      now: 1_000,
    });
    await expect(complete()).resolves.toBeNull();
    await expect(complete()).rejects.toThrow("unavailable");
    const credentials = await t.run((ctx) => ctx.db.query("harnessWaiverPasskey").take(10));
    expect(credentials).toHaveLength(1);
  });

  it("approves and consumes an exact live candidate only once", async () => {
    const t = convexTest(schema, modules);
    const { approvalId } = await seedApproval(t, 5_000);
    await t.mutation(internal.harnessWaiver.storage.approve, {
      approvalId,
      credentialId: "credential-1",
      newCounter: 1,
      approvedAt: 2_000,
      consumeExpiresAt: 5_000,
    });

    const receipt = await t.mutation(internal.harnessWaiver.storage.consume, {
      approvalId,
      expectedCandidate: candidate,
      consumedAt: 3_000,
    });
    expect(receipt).toMatchObject({ candidate, credentialId: "credential-1" });
    await expect(t.mutation(internal.harnessWaiver.storage.consume, {
      approvalId,
      expectedCandidate: candidate,
      consumedAt: 3_001,
    })).resolves.toEqual(receipt);
  });

  it("leaves approved state untouched when expiry or candidate equality fails", async () => {
    const t = convexTest(schema, modules);
    const expired = await seedApproval(t, 2_500);
    await t.mutation(internal.harnessWaiver.storage.approve, {
      approvalId: expired.approvalId,
      credentialId: "credential-1",
      newCounter: 1,
      approvedAt: 2_000,
      consumeExpiresAt: 2_500,
    });
    await expect(t.mutation(internal.harnessWaiver.storage.consume, {
      approvalId: expired.approvalId,
      expectedCandidate: candidate,
      consumedAt: 2_500,
    })).rejects.toThrow("expired");

    const live = await seedApproval(t, 8_000, false);
    await t.mutation(internal.harnessWaiver.storage.approve, {
      approvalId: live.approvalId,
      credentialId: "credential-1",
      newCounter: 2,
      approvedAt: 3_000,
      consumeExpiresAt: 8_000,
    });
    await expect(t.mutation(internal.harnessWaiver.storage.consume, {
      approvalId: live.approvalId,
      expectedCandidate: { ...candidate, headSha: "different" },
      consumedAt: 4_000,
    })).rejects.toThrow("does not match");
    const approvals = await t.run((ctx) => ctx.db.query("harnessWaiverApproval").take(10));
    expect(approvals).toHaveLength(2);
    expect(approvals.every((approval) => approval.status === "approved")).toBe(true);
  });

  it("rejects unknown credentials and counter rollback without approving", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedApproval(t, 8_000, true, 5);
    await expect(t.mutation(internal.harnessWaiver.storage.approve, {
      approvalId: seeded.approvalId,
      credentialId: "unknown",
      newCounter: 6,
      approvedAt: 2_000,
      consumeExpiresAt: 8_000,
    })).rejects.toThrow("counter");
    await expect(t.mutation(internal.harnessWaiver.storage.approve, {
      approvalId: seeded.approvalId,
      credentialId: "credential-1",
      newCounter: 4,
      approvedAt: 2_000,
      consumeExpiresAt: 8_000,
    })).rejects.toThrow("counter");
    const [approval, credential] = await Promise.all([
      t.run((ctx) => ctx.db.get("harnessWaiverApproval", seeded.approvalId)),
      t.run((ctx) => ctx.db.query("harnessWaiverPasskey").first()),
    ]);
    expect(approval?.status).toBe("pending");
    expect(credential?.counter).toBe(5);
  });
});

async function seedApproval(
  t: ReturnType<typeof convexTest>,
  expiresAt: number,
  seedCredential = true,
  credentialCounter = 0,
) {
  if (seedCredential) {
    await t.run((ctx) => ctx.db.insert("harnessWaiverPasskey", {
      credentialId: "credential-1",
      publicKey: new ArrayBuffer(4),
      counter: credentialCounter,
      transports: ["internal"],
      deviceType: "multiDevice",
      backedUp: true,
      reviewerEmail: "reviewer@example.com",
      createdAt: 1_000,
      updatedAt: 1_000,
    }));
  }
  const approvalId = await t.mutation(internal.harnessWaiver.storage.createApproval, {
    publicTokenHash: `token-${expiresAt}`,
    challenge: `challenge-${expiresAt}`,
    candidate,
    expiresAt,
    createdAt: 1_000,
  });
  return { approvalId };
}
