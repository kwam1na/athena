import { describe, expect, it } from "vitest";
// CLI boundary coverage is centralized in harness-blocker-inventory.test.ts.

import {
  buildDocumentationWaiverRequest,
  buildDocumentationWaiverDispatchArgs,
  buildDocumentationWaiverRequestReceipt,
  parseDocumentationWaiverArgs,
} from "./documentation-waiver-command";
import { HARNESS_REVIEW_IDENTITY_VERSION } from "./harness-review-identity";

const candidate = {
  headSha: "head-1",
  deliverableTreeSha: "deliverable-1",
  identityVersion: HARNESS_REVIEW_IDENTITY_VERSION,
  baseRef: "origin/main",
  baseTipSha: "base-1",
  diffBaseSha: "merge-base-1",
  mode: "clean" as const,
};

describe("buildDocumentationWaiverRequest", () => {
  it("binds the dispatch to the clean prepared pull-request candidate", () => {
    expect(
      buildDocumentationWaiverRequest({
        candidate,
        repository: "v26-labs/athena",
        pullRequest: {
          number: 123,
          headSha: "head-1",
          baseRef: "main",
          baseSha: "base-1",
        },
        findingCodes: ["compound-solution", "landed-change-report"],
        reason: "Human accepted the documentation exception.",
      }),
    ).toMatchObject({
      pr_number: "123",
      head_sha: "head-1",
      base_sha: "base-1",
      deliverable_tree_sha: "deliverable-1",
      waived_finding_codes:
        '["compound-solution","landed-change-report"]',
    });
  });

  it("rejects a staged candidate because CI cannot identify it by commit", () => {
    expect(() =>
      buildDocumentationWaiverRequest({
        candidate: { ...candidate, mode: "staged-index" },
        repository: "v26-labs/athena",
        pullRequest: {
          number: 123,
          headSha: "head-1",
          baseRef: "main",
          baseSha: "base-1",
        },
        findingCodes: ["compound-solution"],
        reason: "Accepted.",
      }),
    ).toThrow("committed clean candidate");
  });

  it("rejects pull-request head or base drift", () => {
    expect(() =>
      buildDocumentationWaiverRequest({
        candidate,
        repository: "v26-labs/athena",
        pullRequest: {
          number: 123,
          headSha: "different-head",
          baseRef: "main",
          baseSha: "base-1",
        },
        findingCodes: ["compound-solution"],
        reason: "Accepted.",
      }),
    ).toThrow("does not match the pull request");
  });
});

describe("parseDocumentationWaiverArgs", () => {
  it("parses an explicit PR and reason", () => {
    expect(
      parseDocumentationWaiverArgs(["--pr", "123", "--reason", "Accepted"]),
    ).toEqual({ help: false, pr: "123", reason: "Accepted" });
  });

  it.each(["--pr", "--reason"])("rejects a missing value for %s", (flag) => {
    expect(() =>
      parseDocumentationWaiverArgs(
        flag === "--pr" ? ["--reason", "Accepted", flag] : [flag],
      ),
    ).toThrow(`${flag} requires a value`);
  });

  it("does not consume another flag as a value", () => {
    expect(() =>
      parseDocumentationWaiverArgs(["--pr", "--reason", "Accepted"]),
    ).toThrow("--pr requires a value");
  });

  it("supports a discoverable help path", () => {
    expect(parseDocumentationWaiverArgs(["--help"])).toEqual({ help: true });
    expect(parseDocumentationWaiverArgs(["-h"])).toEqual({ help: true });
  });
});

describe("buildDocumentationWaiverDispatchArgs", () => {
  it("dispatches the unprivileged relay instead of the protected issuer", () => {
    const args = buildDocumentationWaiverDispatchArgs({
      repository: "v26-labs/athena",
      pr_number: "123",
      head_sha: "head-1",
      base_ref: "origin/main",
      base_sha: "base-1",
      diff_base_sha: "merge-base-1",
      deliverable_tree_sha: "deliverable-1",
      identity_version: HARNESS_REVIEW_IDENTITY_VERSION,
      waived_finding_codes: '["compound-solution"]',
      reason: "Accepted.",
    });
    expect(args.slice(0, 5)).toEqual([
        "workflow",
        "run",
        "athena-documentation-waiver-request.yml",
        "--ref",
        "main",
      ]);
    expect(args).toContain("repository=v26-labs/athena");
  });
});

describe("buildDocumentationWaiverRequestReceipt", () => {
  it("returns a machine-readable candidate receipt", () => {
    expect(
      buildDocumentationWaiverRequestReceipt({
        repository: "v26-labs/athena",
        pr_number: "123",
        head_sha: "head-1",
      }),
    ).toEqual({
      status: "requested",
      workflow: "athena-documentation-waiver-request.yml",
      repository: "v26-labs/athena",
      prNumber: 123,
      headSha: "head-1",
    });
  });
});
