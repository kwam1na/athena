import { describe, expect, it } from "vitest";

import {
  assertApprovedRequestConsumable,
  assertApprovalRequestUsable,
  canonicalWaiverCandidate,
  enrollmentTokenDigest,
  assertWaiverCandidateMatches,
  requireEnrollmentBootstrap,
  requireConfiguredReviewer,
} from "./passkeyPolicy";

const candidate = {
  repository: "kwam1na/athena",
  prNumber: 123,
  headSha: "head-1",
  baseRef: "origin/main",
  baseSha: "base-1",
  diffBaseSha: "merge-base-1",
  deliverableTreeSha: "tree-1",
  identityVersion: "deliverable-tree/v1",
  waivedFindingCodes: ["landed-change-report", "compound-solution"],
  reason: "Documentation intentionally follows in the next candidate.",
};

describe("canonicalWaiverCandidate", () => {
  it("sorts finding codes and binds every candidate field", () => {
    expect(canonicalWaiverCandidate(candidate)).toBe(
      '{"repository":"kwam1na/athena","prNumber":123,"headSha":"head-1","baseRef":"origin/main","baseSha":"base-1","diffBaseSha":"merge-base-1","deliverableTreeSha":"tree-1","identityVersion":"deliverable-tree/v1","waivedFindingCodes":["compound-solution","landed-change-report"],"reason":"Documentation intentionally follows in the next candidate."}',
    );
  });

  it("rejects a different candidate before consuming approval", () => {
    expect(() => assertWaiverCandidateMatches(candidate, { ...candidate, headSha: "head-2" }))
      .toThrow("does not match");
    expect(() => assertWaiverCandidateMatches(candidate, { ...candidate }))
      .not.toThrow();
  });
});

describe("assertApprovalRequestUsable", () => {
  it("accepts only a live pending request", () => {
    expect(
      assertApprovalRequestUsable(
        { status: "pending", expiresAt: 2_000, consumedAt: undefined },
        1_000,
      ),
    ).toBeUndefined();
  });

  it.each([
    [{ status: "approved", expiresAt: 2_000 }, "not pending"],
    [{ status: "pending", expiresAt: 999 }, "expired"],
    [{ status: "pending", expiresAt: 2_000, consumedAt: 900 }, "consumed"],
  ])("rejects unusable approval state", (request, message) => {
    expect(() => assertApprovalRequestUsable(request, 1_000)).toThrow(message);
  });
});

describe("assertApprovedRequestConsumable", () => {
  it("accepts only a live approved request", () => {
    expect(assertApprovedRequestConsumable({
      status: "approved",
      expiresAt: 900,
      consumeExpiresAt: 2_000,
    }, 1_000))
      .toBeUndefined();
  });

  it.each([
    [{ status: "pending", expiresAt: 2_000 }, "not approved"],
    [{ status: "approved", expiresAt: 500, consumeExpiresAt: 1_000 }, "expired"],
    [{ status: "consumed", expiresAt: 2_000, consumedAt: 900 }, "consumed"],
  ])("rejects an unusable approved receipt", (request, message) => {
    expect(() => assertApprovedRequestConsumable(request, 1_000)).toThrow(message);
  });
});

describe("requireEnrollmentBootstrap", () => {
  it("accepts only the separately configured enrollment secret", async () => {
    const digest = await enrollmentTokenDigest("human-chosen-bootstrap");
    await expect(requireEnrollmentBootstrap("human-chosen-bootstrap", digest))
      .resolves.toBeUndefined();
    await expect(requireEnrollmentBootstrap("agent-guess", digest)).rejects.toThrow(
      "bootstrap secret",
    );
  });

  it("fails closed when the bootstrap digest is not configured", async () => {
    await expect(requireEnrollmentBootstrap("anything", "")).rejects.toThrow(
      "bootstrap secret",
    );
  });
});

describe("requireConfiguredReviewer", () => {
  it("normalizes and matches the configured reviewer", () => {
    expect(requireConfiguredReviewer(" Kwamina@example.com ", "kwamina@EXAMPLE.com"))
      .toBe("kwamina@example.com");
  });

  it("fails closed for another authenticated identity", () => {
    expect(() => requireConfiguredReviewer("other@example.com", "kwamina@example.com"))
      .toThrow("not authorized");
  });
});
