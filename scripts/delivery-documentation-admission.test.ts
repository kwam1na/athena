import { describe, expect, it, vi } from "vitest";

import { evaluateDeliveryDocumentationAdmission } from "./delivery-documentation-admission";
import { HARNESS_REVIEW_IDENTITY_VERSION } from "./harness-review-identity";

const candidate = {
  schemaVersion: 1 as const,
  headSha: "head-1",
  treeSha: "tree-1",
  deliverableTreeSha: "deliverable-1",
  identityVersion: HARNESS_REVIEW_IDENTITY_VERSION,
  mode: "clean" as const,
  baseRef: "origin/main" as const,
  baseTipSha: "base-1",
  diffBaseSha: "merge-base-1",
  status: "",
  untrackedFiles: [],
};

const pullRequest = {
  number: 123,
  pull_request: {
    head: { sha: "head-1" },
    base: { ref: "main", sha: "base-1" },
  },
};

const documentationFailure = {
  status: "fail" as const,
  findings: [
    {
      policy: "compound-solution" as const,
      label: "Solution notes" as const,
      message: "missing",
    },
  ],
};

describe("evaluateDeliveryDocumentationAdmission", () => {
  it("passes immediately when live documentation is current", async () => {
    const discoverWaiver = vi.fn();
    const result = await evaluateDeliveryDocumentationAdmission("/repo", {
      evaluateDocumentation: () => ({ status: "pass", findings: [] }),
      discoverWaiver,
    });

    expect(result).toEqual({ status: "pass", resolution: "live" });
    expect(discoverWaiver).not.toHaveBeenCalled();
  });

  it("admits a verified waiver for the exact pull-request candidate", async () => {
    const result = await evaluateDeliveryDocumentationAdmission("/repo", {
      evaluateDocumentation: () => documentationFailure,
      captureCandidate: async () => ({ ok: true as const, candidate }),
      repository: "v26-labs/athena",
      pullRequest,
      computeHeadDeliverableIdentity: async () => ({
        deliverableTreeSha: "deliverable-1",
        identityVersion: HARNESS_REVIEW_IDENTITY_VERSION,
      }),
      computeHeadDiffBaseSha: async () => "merge-base-1",
      discoverWaiver: async () => ({
        recordId: "github-check:789",
        approvedBy: "human-reviewer",
        attestationUrl: "https://github.com/v26-labs/athena/actions/runs/456",
        attestation: {} as never,
      }),
    });

    expect(result).toMatchObject({
      status: "pass",
      resolution: "waived",
      waiver: { recordId: "github-check:789" },
    });
  });

  it("derives waiver identity from the pull-request head while CI validates a synthetic merge", async () => {
    const discoverWaiver = vi.fn(async () => ({
      recordId: "github-check:789",
      approvedBy: "human-reviewer",
      attestationUrl: "https://github.com/v26-labs/athena/actions/runs/456",
      attestation: {} as never,
    }));
    const result = await evaluateDeliveryDocumentationAdmission("/repo", {
      evaluateDocumentation: () => documentationFailure,
      captureCandidate: async () => ({
        ok: true as const,
        candidate: { ...candidate, headSha: "synthetic-merge-commit" },
      }),
      repository: "v26-labs/athena",
      pullRequest,
      computeHeadDeliverableIdentity: async (_rootDir, treeSha) => {
        expect(treeSha).toBe("head-1");
        return {
          deliverableTreeSha: "head-deliverable",
          identityVersion: HARNESS_REVIEW_IDENTITY_VERSION,
        };
      },
      computeHeadDiffBaseSha: async (_rootDir, headSha) => {
        expect(headSha).toBe("head-1");
        return "head-merge-base";
      },
      discoverWaiver,
    });

    expect(result).toMatchObject({ status: "pass", resolution: "waived" });
    expect(discoverWaiver).toHaveBeenCalledWith(
      expect.objectContaining({
        expected: expect.objectContaining({
          headSha: "head-1",
          deliverableTreeSha: "head-deliverable",
          diffBaseSha: "head-merge-base",
        }),
      }),
    );
  });
});
