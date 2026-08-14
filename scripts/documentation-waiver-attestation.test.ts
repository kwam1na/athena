import { describe, expect, it } from "vitest";

import {
  discoverDocumentationWaiverAttestation,
  verifyDocumentationWaiverAttestation,
  type DocumentationWaiverAttestation,
} from "./documentation-waiver-attestation";
import { HARNESS_REVIEW_IDENTITY_VERSION } from "./harness-review-identity";

const expected = {
  repository: "v26-labs/athena",
  prNumber: 123,
  headSha: "head-1",
  deliverableTreeSha: "deliverable-1",
  identityVersion: HARNESS_REVIEW_IDENTITY_VERSION,
  baseRef: "origin/main",
  baseTipSha: "base-1",
  diffBaseSha: "merge-base-1",
};

const attestation: DocumentationWaiverAttestation = {
  schemaVersion: 4,
  kind: "documentation_waiver",
  ...expected,
  obligationId: "documentation.current",
  waivedFindingCodes: ["compound-solution", "landed-change-report"],
  requestedBy: "waiver-requester",
  requestedByType: "User",
  relayedBy: "github-actions[bot]",
  relayWorkflowRunId: 455,
  passkeyApprovalId: "approval-1",
  passkeyCredentialId: "credential-1",
  passkeyApprovedAt: 1_723_659_000_000,
  approvedBy: "human-reviewer",
  approvalEnvironment: "athena-documentation-waiver",
  reason: "Documentation is intentionally deferred for this candidate.",
  workflowRunId: 456,
  createdAt: "2026-08-14T18:00:00.000Z",
};

const workflowRun = {
  id: 456,
  event: "workflow_dispatch",
  path: ".github/workflows/athena-documentation-waiver.yml",
  headBranch: "main",
  conclusion: "success",
  actor: "github-actions[bot]",
  actorType: "Bot",
  relay: {
    id: 455,
    event: "workflow_dispatch",
    path: ".github/workflows/athena-documentation-waiver-request.yml",
    headBranch: "main",
    conclusion: "success",
    actor: "waiver-requester",
    actorType: "User",
  },
  approvals: [
    {
      state: "approved",
      user: "human-reviewer",
      userType: "User",
      environments: ["athena-documentation-waiver"],
    },
  ],
};

describe("verifyDocumentationWaiverAttestation", () => {
  it("accepts a trusted human attestation for the exact candidate and findings", () => {
    expect(
      verifyDocumentationWaiverAttestation({
        attestation,
        expected,
        findingCodes: ["compound-solution", "landed-change-report"],
        workflowRun,
      }),
    ).toEqual({ ok: true, attestation });
  });

  it.each([
    ["head SHA", { headSha: "head-2" }],
    ["base tip", { baseTipSha: "base-2" }],
    ["deliverable identity", { deliverableTreeSha: "deliverable-2" }],
  ])("rejects candidate drift in the %s", (_label, changed) => {
    const result = verifyDocumentationWaiverAttestation({
      attestation,
      expected: { ...expected, ...changed },
      findingCodes: ["compound-solution"],
      workflowRun,
    });

    expect(result).toMatchObject({ ok: false, code: "candidate_mismatch" });
  });

  it("rejects an attestation that does not cover every live finding", () => {
    const result = verifyDocumentationWaiverAttestation({
      attestation: {
        ...attestation,
        waivedFindingCodes: ["compound-solution"],
      },
      expected,
      findingCodes: ["compound-solution", "landed-change-report"],
      workflowRun,
    });

    expect(result).toMatchObject({ ok: false, code: "finding_not_waived" });
  });

  it.each([
    ["wrong workflow", { path: ".github/workflows/other.yml" }],
    ["wrong event", { event: "pull_request" }],
    ["wrong actor", { actor: "automation" }],
    ["human requester", { actorType: "User" }],
    ["unapproved bot requester", { actor: "other-app[bot]" }],
    [
      "wrong relay workflow",
      { relay: { ...workflowRun.relay, path: ".github/workflows/other.yml" } },
    ],
    ["no environment approval", { approvals: [] }],
    [
      "self approval",
      { actor: "human-reviewer", approvals: workflowRun.approvals },
    ],
    ["non-green run", { conclusion: "failure" }],
  ])("rejects untrusted workflow provenance: %s", (_label, changed) => {
    const result = verifyDocumentationWaiverAttestation({
      attestation,
      expected,
      findingCodes: ["compound-solution"],
      workflowRun: { ...workflowRun, ...changed },
    });

    expect(result).toMatchObject({ ok: false, code: "untrusted_workflow" });
  });
});

describe("discoverDocumentationWaiverAttestation", () => {
  it("returns a verified waiver from the trusted GitHub check and workflow run", async () => {
    const requestJson = async (path: string) => {
      if (path.includes("check-runs")) {
        return {
          check_runs: [
            {
              id: 789,
              name: "athena/documentation-waiver",
              conclusion: "success",
              app: { slug: "github-actions" },
              external_id: "athena-documentation-waiver/v1/456",
              details_url: "https://github.com/v26-labs/athena/actions/runs/456",
            },
          ],
        };
      }
      if (path.endsWith("/actions/runs/456")) {
        return {
          id: 456,
          event: "workflow_dispatch",
          path: ".github/workflows/athena-documentation-waiver.yml",
          head_branch: "main",
          conclusion: "success",
          actor: { login: "github-actions[bot]", type: "Bot" },
        };
      }
      if (path.endsWith("/actions/runs/455")) {
        return {
          id: 455,
          event: "workflow_dispatch",
          path: ".github/workflows/athena-documentation-waiver-request.yml",
          head_branch: "main",
          conclusion: "success",
          actor: { login: "waiver-requester", type: "User" },
        };
      }
      if (path.endsWith("/actions/runs/456/approvals")) {
        return [
          {
            state: "approved",
            user: { login: "human-reviewer", type: "User" },
            environments: [{ name: "athena-documentation-waiver" }],
          },
        ];
      }
      throw new Error(`Unexpected GitHub path: ${path}`);
    };

    await expect(
      discoverDocumentationWaiverAttestation({
        expected,
        findingCodes: ["compound-solution"],
        requestJson,
        loadWorkflowAttestation: async () => attestation,
      }),
    ).resolves.toMatchObject({
      recordId: "github-check:789",
      approvedBy: "human-reviewer",
      attestationUrl: "https://github.com/v26-labs/athena/actions/runs/456",
    });
  });

  it("fails closed when a matching-name check comes from another GitHub app", async () => {
    const requestJson = async () => ({
      check_runs: [
        {
          id: 789,
          name: "athena/documentation-waiver",
          conclusion: "success",
          app: { slug: "untrusted-app" },
          external_id: "athena-documentation-waiver/v1/456",
          details_url: "https://example.com/forged",
          output: { summary: JSON.stringify(attestation) },
        },
      ],
    });

    await expect(
      discoverDocumentationWaiverAttestation({
        expected,
        findingCodes: ["compound-solution"],
        requestJson,
        loadWorkflowAttestation: async () => attestation,
      }),
    ).resolves.toBeUndefined();
  });

  it("ignores a forged check payload and trusts only the workflow artifact", async () => {
    const requestJson = async (path: string) => {
      if (path.includes("check-runs")) {
        return {
          check_runs: [
            {
              id: 789,
              name: "athena/documentation-waiver",
              conclusion: "success",
              app: { slug: "github-actions" },
              external_id: "athena-documentation-waiver/v1/456",
              details_url: "https://github.com/v26-labs/athena/actions/runs/456",
              output: { summary: JSON.stringify(attestation) },
            },
          ],
        };
      }
      if (path.endsWith("/approvals")) {
        return [
          {
            state: "approved",
            user: { login: "human-reviewer", type: "User" },
            environments: [{ name: "athena-documentation-waiver" }],
          },
        ];
      }
      if (path.endsWith("/actions/runs/455")) {
        return {
          id: 455,
          event: "workflow_dispatch",
          path: ".github/workflows/athena-documentation-waiver-request.yml",
          head_branch: "main",
          conclusion: "success",
          actor: { login: "waiver-requester", type: "User" },
        };
      }
      return {
        id: 456,
        event: "workflow_dispatch",
        path: ".github/workflows/athena-documentation-waiver.yml",
        head_branch: "main",
        conclusion: "success",
        actor: { login: "github-actions[bot]", type: "Bot" },
      };
    };

    await expect(
      discoverDocumentationWaiverAttestation({
        expected,
        findingCodes: ["compound-solution"],
        requestJson,
        loadWorkflowAttestation: async () => ({
          ...attestation,
          headSha: "different-head",
        }),
      }),
    ).resolves.toBeUndefined();
  });
});
