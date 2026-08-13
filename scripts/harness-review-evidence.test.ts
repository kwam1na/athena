import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  collectHarnessReviewContext,
  recordHarnessReviewEvidence,
} from "./harness-review-evidence";
import { HARNESS_REVIEW_IDENTITY_VERSION } from "./harness-review-identity";

const roots: string[] = [];

async function fixture(providerId: "ce-code-review" | "execute" = "execute") {
  const rootDir = await mkdtemp(
    path.join(tmpdir(), "harness-review-evidence-"),
  );
  roots.push(rootDir);
  const storageDir = path.join(rootDir, "git-private", "records");
  const providerRoot = path.join(rootDir, "providers", providerId);
  const runDir = path.join(providerRoot, "run-a");
  await mkdir(runDir, { recursive: true });
  const worktreeId = "worktree-a";
  const candidate = {
    treeSha: "tree-a",
    deliverableTreeSha: "deliverable-a",
    identityVersion: HARNESS_REVIEW_IDENTITY_VERSION,
    baseRef: "origin/main",
    baseTipSha: "base-a",
    diffBaseSha: "merge-base-a",
  };
  const reviewerArtifact = {
    schemaVersion: 1,
    providerId,
    runId: "run-a",
    finalPassId: "pass-a",
    worktreeId,
    candidate,
    reviewerId: "correctness",
    result: "approved",
  };
  await writeFile(
    path.join(runDir, "correctness.json"),
    `${JSON.stringify(reviewerArtifact, null, 2)}\n`,
  );
  const manifest = {
    schemaVersion: 1,
    providerId,
    runId: "run-a",
    providerRunRoot: await realpath(runDir),
    finalPassId: "pass-a",
    worktreeId,
    candidate,
    selectedReviewers: ["correctness"],
    completedReviewers: ["correctness"],
    failedReviewers: [],
    timedOutReviewers: [],
    reviewerArtifacts: ["correctness.json"],
    findings: [],
    mutationSequence: [],
    verdict: "green",
    unresolvedActionableCount: 0,
    blockingCount: 0,
    editedAfterFinalPass: false,
    finalized: true,
  };
  const manifestPath = path.join(runDir, "final-manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    rootDir,
    storageDir,
    providerRoot,
    worktreeId,
    candidate,
    manifest,
    manifestPath,
    reviewerArtifact,
  };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("harness review evidence", () => {
  it.each(["ce-code-review", "execute"] as const)(
    "records the same final-green contract for %s",
    async (providerId) => {
      const setup = await fixture(providerId);
      const result = await recordHarnessReviewEvidence(
        setup.rootDir,
        setup.manifestPath,
        {
          storageDir: setup.storageDir,
          providerRunRoots: { [providerId]: setup.providerRoot },
          captureCandidate: async () => ({
            ok: true,
            candidate: setup.candidate,
          }),
          resolveWorktreeId: async () => setup.worktreeId,
          now: () => "2026-08-11T00:00:00.000Z",
        },
      );
      expect(result.resolution).toMatchObject({
        kind: "evidence",
        providerId,
        outcome: "green",
        unresolvedActionableCount: 0,
      });
      expect(result.candidate).toEqual(setup.candidate);
    },
  );

  it("is idempotent for the same provider run, pass, and candidate", async () => {
    const setup = await fixture();
    const options = {
      storageDir: setup.storageDir,
      providerRunRoots: { execute: setup.providerRoot },
      captureCandidate: async () => ({
        ok: true as const,
        candidate: setup.candidate,
      }),
      resolveWorktreeId: async () => setup.worktreeId,
      now: () => "2026-08-11T00:00:00.000Z",
    };
    const first = await recordHarnessReviewEvidence(
      setup.rootDir,
      setup.manifestPath,
      options,
    );
    const second = await recordHarnessReviewEvidence(
      setup.rootDir,
      setup.manifestPath,
      options,
    );
    expect(second.recordId).toBe(first.recordId);
  });

  it.each([
    ["unresolved actionable findings", { unresolvedActionableCount: 1 }],
    ["blocking findings", { blockingCount: 1 }],
    ["failed reviewers", { failedReviewers: ["correctness"] }],
    ["timed out reviewers", { timedOutReviewers: ["correctness"] }],
    ["post-pass edits", { editedAfterFinalPass: true }],
    ["non-green verdict", { verdict: "not_green" }],
    ["unfinalized manifest", { finalized: false }],
  ])("rejects %s", async (_label, override) => {
    const setup = await fixture();
    await writeFile(
      setup.manifestPath,
      `${JSON.stringify({ ...setup.manifest, ...override }, null, 2)}\n`,
    );
    await expect(
      recordHarnessReviewEvidence(setup.rootDir, setup.manifestPath, {
        storageDir: setup.storageDir,
        providerRunRoots: { execute: setup.providerRoot },
        captureCandidate: async () => ({
          ok: true,
          candidate: setup.candidate,
        }),
        resolveWorktreeId: async () => setup.worktreeId,
      }),
    ).rejects.toThrow();
  });

  it.each([
    ["reviewed content changed", { deliverableTreeSha: "deliverable-after" }],
    ["the raw tree changed", { treeSha: "tree-after" }],
    ["the base tip moved", { baseTipSha: "base-b" }],
    ["the merge base moved", { diffBaseSha: "merge-base-b" }],
  ])(
    "rejects a manifest whose candidate no longer matches because %s",
    async (_label, override) => {
      const setup = await fixture();
      await expect(
        recordHarnessReviewEvidence(setup.rootDir, setup.manifestPath, {
          storageDir: setup.storageDir,
          providerRunRoots: { execute: setup.providerRoot },
          captureCandidate: async () => ({
            ok: true,
            candidate: { ...setup.candidate, ...override },
          }),
          resolveWorktreeId: async () => setup.worktreeId,
        }),
      ).rejects.toThrow(/candidate does not match/);
    },
  );

  it("stays strict on the raw tree at recording time so the audit anchor is verified", async () => {
    const setup = await fixture();

    // Recording happens against the tree that was just prepared and reviewed,
    // so an unverified treeSha would be persisted into the obligation record
    // and the gate decision event as an audit anchor nothing ever checked.
    await expect(
      recordHarnessReviewEvidence(setup.rootDir, setup.manifestPath, {
        storageDir: setup.storageDir,
        providerRunRoots: { execute: setup.providerRoot },
        captureCandidate: async () => ({
          ok: true,
          candidate: { ...setup.candidate, treeSha: "tree-claimed-by-provider" },
        }),
        resolveWorktreeId: async () => setup.worktreeId,
      }),
    ).rejects.toThrow(/candidate does not match/);
  });

  it.each([
    ["a missing deliverable identity", { deliverableTreeSha: undefined }],
    ["an unknown identity version", { identityVersion: "deliverable-tree/v0" }],
    ["a missing identity version", { identityVersion: undefined }],
  ])("rejects a manifest candidate with %s", async (_label, override) => {
    const setup = await fixture();
    const candidate = { ...setup.candidate, ...override };
    for (const [key, value] of Object.entries(override)) {
      if (value === undefined)
        delete (candidate as Record<string, unknown>)[key];
    }
    await writeFile(
      setup.manifestPath,
      `${JSON.stringify({ ...setup.manifest, candidate }, null, 2)}\n`,
    );
    await expect(
      recordHarnessReviewEvidence(setup.rootDir, setup.manifestPath, {
        storageDir: setup.storageDir,
        providerRunRoots: { execute: setup.providerRoot },
        captureCandidate: async () => ({
          ok: true,
          candidate: setup.candidate,
        }),
        resolveWorktreeId: async () => setup.worktreeId,
      }),
    ).rejects.toThrow(/deliverable identity|harness:review-context/);
  });

  it("refuses to hand out a review context without a current preparation receipt", async () => {
    const setup = await fixture();

    await expect(
      collectHarnessReviewContext(setup.rootDir, {
        evaluatePreparation: async () => ({
          prepared: false,
          status: "missing",
          reason: "no current pr:athena preparation receipt was found",
          remediation: "bun run pr:athena:prepare",
        }),
      }),
    ).rejects.toThrow(/Review context is unavailable/);
  });

  it("rejects copied manifests and missing reviewer artifacts", async () => {
    const setup = await fixture();
    const copied = path.join(setup.rootDir, "copied.json");
    await writeFile(copied, `${JSON.stringify(setup.manifest)}\n`);
    const options = {
      storageDir: setup.storageDir,
      providerRunRoots: { execute: setup.providerRoot },
      captureCandidate: async () => ({
        ok: true as const,
        candidate: setup.candidate,
      }),
      resolveWorktreeId: async () => setup.worktreeId,
    };
    await expect(
      recordHarnessReviewEvidence(setup.rootDir, copied, options),
    ).rejects.toThrow(/exact final-manifest location/);
    await rm(path.join(path.dirname(setup.manifestPath), "correctness.json"));
    await expect(
      recordHarnessReviewEvidence(setup.rootDir, setup.manifestPath, options),
    ).rejects.toThrow(/artifact/);
  });

  it.each([
    "../run-a",
    "nested/run-a",
    "nested\\run-a",
    ".",
    "..",
  ])(
    "rejects unsafe or non-single-component run ID %s",
    async (runId) => {
      const setup = await fixture();
      await writeFile(
        setup.manifestPath,
        `${JSON.stringify({ ...setup.manifest, runId }, null, 2)}\n`,
      );
      await expect(
        recordHarnessReviewEvidence(setup.rootDir, setup.manifestPath, {
          storageDir: setup.storageDir,
          providerRunRoots: { execute: setup.providerRoot },
        }),
      ).rejects.toThrow(/runId.*single path component/);
    },
  );

  it("requires the exact provider run root and final-manifest location", async () => {
    const setup = await fixture();
    const options = {
      storageDir: setup.storageDir,
      providerRunRoots: { execute: setup.providerRoot },
    };
    await writeFile(
      setup.manifestPath,
      `${JSON.stringify(
        { ...setup.manifest, providerRunRoot: setup.providerRoot },
        null,
        2,
      )}\n`,
    );
    await expect(
      recordHarnessReviewEvidence(setup.rootDir, setup.manifestPath, options),
    ).rejects.toThrow(/provider run root/);

    await writeFile(
      setup.manifestPath,
      `${JSON.stringify(setup.manifest, null, 2)}\n`,
    );
    const nestedDir = path.join(path.dirname(setup.manifestPath), "nested");
    await mkdir(nestedDir);
    const nestedManifest = path.join(nestedDir, "final-manifest.json");
    await writeFile(nestedManifest, `${JSON.stringify(setup.manifest)}\n`);
    await expect(
      recordHarnessReviewEvidence(setup.rootDir, nestedManifest, options),
    ).rejects.toThrow(/exact final-manifest location/);

    const renamedManifest = path.join(
      path.dirname(setup.manifestPath),
      "review.json",
    );
    await writeFile(renamedManifest, `${JSON.stringify(setup.manifest)}\n`);
    await expect(
      recordHarnessReviewEvidence(setup.rootDir, renamedManifest, options),
    ).rejects.toThrow(/exact final-manifest location/);
  });

  it.each([
    ["missing artifact", ["correctness.json", "missing.json"]],
    ["duplicate artifact", ["correctness.json", "correctness.json"]],
  ])("rejects a %s entry", async (_label, reviewerArtifacts) => {
    const setup = await fixture();
    await writeFile(
      setup.manifestPath,
      `${JSON.stringify(
        { ...setup.manifest, reviewerArtifacts },
        null,
        2,
      )}\n`,
    );
    await expect(
      recordHarnessReviewEvidence(setup.rootDir, setup.manifestPath, {
        storageDir: setup.storageDir,
        providerRunRoots: { execute: setup.providerRoot },
      }),
    ).rejects.toThrow(/artifact/);
  });

  it.each([
    ["missing selected reviewer", { completedReviewers: [] }],
    [
      "unrelated completed reviewer",
      { completedReviewers: ["correctness", "security"] },
    ],
    [
      "duplicate selected reviewer",
      { selectedReviewers: ["correctness", "correctness"] },
    ],
    [
      "duplicate completed reviewer",
      { completedReviewers: ["correctness", "correctness"] },
    ],
  ])("rejects an incomplete reviewer set: %s", async (_label, override) => {
    const setup = await fixture();
    await writeFile(
      setup.manifestPath,
      `${JSON.stringify({ ...setup.manifest, ...override }, null, 2)}\n`,
    );
    await expect(
      recordHarnessReviewEvidence(setup.rootDir, setup.manifestPath, {
        storageDir: setup.storageDir,
        providerRunRoots: { execute: setup.providerRoot },
      }),
    ).rejects.toThrow(/reviewers/);
  });

  it.each([
    ["wrong run", { runId: "run-b" }],
    ["wrong final pass", { finalPassId: "pass-b" }],
    ["wrong worktree", { worktreeId: "worktree-b" }],
    [
      "wrong candidate",
      {
        candidate: {
          treeSha: "tree-b",
          baseRef: "origin/main",
          baseTipSha: "base-a",
          diffBaseSha: "merge-base-a",
        },
      },
    ],
    ["wrong reviewer", { reviewerId: "security" }],
    ["non-approved result", { result: "advisory" }],
    ["wrong provider", { providerId: "ce-code-review" }],
  ])("rejects reviewer artifact with %s", async (_label, override) => {
    const setup = await fixture();
    await writeFile(
      path.join(path.dirname(setup.manifestPath), "correctness.json"),
      `${JSON.stringify(
        { ...setup.reviewerArtifact, ...override },
        null,
        2,
      )}\n`,
    );
    await expect(
      recordHarnessReviewEvidence(setup.rootDir, setup.manifestPath, {
        storageDir: setup.storageDir,
        providerRunRoots: { execute: setup.providerRoot },
      }),
    ).rejects.toThrow(/artifact/);
  });

  it("rejects malformed and unrelated reviewer artifacts", async () => {
    const setup = await fixture();
    const artifactPath = path.join(
      path.dirname(setup.manifestPath),
      "correctness.json",
    );
    await writeFile(artifactPath, "not json\n");
    await expect(
      recordHarnessReviewEvidence(setup.rootDir, setup.manifestPath, {
        storageDir: setup.storageDir,
        providerRunRoots: { execute: setup.providerRoot },
      }),
    ).rejects.toThrow(/reviewer artifact/);

    await writeFile(
      artifactPath,
      `${JSON.stringify(setup.reviewerArtifact)}\n`,
    );
    await writeFile(
      path.join(path.dirname(setup.manifestPath), "security.json"),
      `${JSON.stringify({
        ...setup.reviewerArtifact,
        reviewerId: "security",
      })}\n`,
    );
    await writeFile(
      setup.manifestPath,
      `${JSON.stringify({
        ...setup.manifest,
        reviewerArtifacts: ["correctness.json", "security.json"],
      })}\n`,
    );
    await expect(
      recordHarnessReviewEvidence(setup.rootDir, setup.manifestPath, {
        storageDir: setup.storageDir,
        providerRunRoots: { execute: setup.providerRoot },
      }),
    ).rejects.toThrow(/exactly one reviewer artifact/);
  });

  it("rejects a reviewer artifact path that traverses outside the run", async () => {
    const setup = await fixture();
    await writeFile(
      path.join(path.dirname(path.dirname(setup.manifestPath)), "outside.json"),
      `${JSON.stringify(setup.reviewerArtifact)}\n`,
    );
    await writeFile(
      setup.manifestPath,
      `${JSON.stringify({
        ...setup.manifest,
        reviewerArtifacts: ["../outside.json"],
      })}\n`,
    );
    await expect(
      recordHarnessReviewEvidence(setup.rootDir, setup.manifestPath, {
        storageDir: setup.storageDir,
        providerRunRoots: { execute: setup.providerRoot },
      }),
    ).rejects.toThrow(/outside the run/);
  });

  it.each([
    [
      "unresolved actionable finding",
      {
        id: "finding-a",
        actionable: true,
        blocking: false,
        severity: "P2",
        scope: "in_contract",
        disposition: "unresolved",
      },
    ],
    [
      "ignored actionable finding",
      {
        id: "finding-a",
        actionable: true,
        blocking: false,
        severity: "P2",
        scope: "in_contract",
        disposition: "ignored",
      },
    ],
  ])("rejects an %s despite zero summary counts", async (_label, finding) => {
    const setup = await fixture();
    await writeFile(
      setup.manifestPath,
      `${JSON.stringify(
        { ...setup.manifest, findings: [finding] },
        null,
        2,
      )}\n`,
    );
    await expect(
      recordHarnessReviewEvidence(setup.rootDir, setup.manifestPath, {
        storageDir: setup.storageDir,
        providerRunRoots: { execute: setup.providerRoot },
      }),
    ).rejects.toThrow(/unresolved or ignored actionable/);
  });

  it.each([
    [
      "final pass",
      [{ preparedTreeSha: "tree-a", reviewedInPassId: "pass-before" }],
    ],
    [
      "final candidate",
      [{ preparedTreeSha: "tree-before", reviewedInPassId: "pass-a" }],
    ],
  ])(
    "rejects a mutation sequence mismatched with the %s",
    async (_label, mutationSequence) => {
      const setup = await fixture();
      await writeFile(
        setup.manifestPath,
        `${JSON.stringify(
          { ...setup.manifest, mutationSequence },
          null,
          2,
        )}\n`,
      );
      await expect(
        recordHarnessReviewEvidence(setup.rootDir, setup.manifestPath, {
          storageDir: setup.storageDir,
          providerRunRoots: { execute: setup.providerRoot },
        }),
      ).rejects.toThrow(/final mutation/);
    },
  );

  const deferredFinding = {
    id: "finding-a",
    actionable: true,
    blocking: false,
    severity: "P2",
    scope: "expansion",
    disposition: "deferred",
    deferredIssueId: "V26-1300",
  };

  function recordOptions(setup: Awaited<ReturnType<typeof fixture>>) {
    return {
      storageDir: setup.storageDir,
      providerRunRoots: { execute: setup.providerRoot },
      captureCandidate: async () => ({
        ok: true as const,
        candidate: setup.candidate,
      }),
      resolveWorktreeId: async () => setup.worktreeId,
      now: () => "2026-08-11T00:00:00.000Z",
    };
  }

  it("records a deferred expansion finding and derives loop telemetry", async () => {
    const setup = await fixture();
    await writeFile(
      setup.manifestPath,
      `${JSON.stringify(
        {
          ...setup.manifest,
          findings: [deferredFinding],
          mutationSequence: [
            { preparedTreeSha: "tree-0", reviewedInPassId: "pass-0" },
            { preparedTreeSha: "tree-a", reviewedInPassId: "pass-a" },
          ],
        },
        null,
        2,
      )}\n`,
    );
    const result = await recordHarnessReviewEvidence(
      setup.rootDir,
      setup.manifestPath,
      recordOptions(setup),
    );
    expect(result.resolution).toMatchObject({
      kind: "evidence",
      outcome: "green",
      reviewLoopTelemetry: {
        iterationCount: 2,
        deferredExpansionCount: 1,
        deferredIssueIds: ["V26-1300"],
      },
    });
  });

  it.each([
    ["missing issue id", { ...deferredFinding, deferredIssueId: undefined }],
    ["blocking finding", { ...deferredFinding, blocking: true }],
    ["non-actionable finding", { ...deferredFinding, actionable: false }],
  ])("rejects a deferred %s", async (_label, finding) => {
    const setup = await fixture();
    await writeFile(
      setup.manifestPath,
      `${JSON.stringify(
        { ...setup.manifest, findings: [finding] },
        null,
        2,
      )}\n`,
    );
    await expect(
      recordHarnessReviewEvidence(setup.rootDir, setup.manifestPath, {
        storageDir: setup.storageDir,
        providerRunRoots: { execute: setup.providerRoot },
      }),
    ).rejects.toThrow(/deferred findings must be actionable, non-blocking/);
  });

  it.each([
    [
      "a P0 finding",
      { ...deferredFinding, severity: "P0" },
      /defers a P0\/P1 finding/,
    ],
    [
      "a P1 finding",
      { ...deferredFinding, severity: "P1" },
      /defers a P0\/P1 finding/,
    ],
    [
      "an in-contract finding",
      { ...deferredFinding, scope: "in_contract" },
      /scope is not expansion/,
    ],
    [
      "an adjacent finding",
      { ...deferredFinding, scope: "adjacent" },
      /scope is not expansion/,
    ],
    [
      "a placeholder issue id",
      { ...deferredFinding, deferredIssueId: "TODO" },
      /tracker-shaped follow-up issue id/,
    ],
    [
      "a lowercase issue id",
      { ...deferredFinding, deferredIssueId: "v26-1300" },
      /tracker-shaped follow-up issue id/,
    ],
  ])(
    "refuses to defer %s, so the eligibility rule is machine-checked rather than trusted",
    async (_label, finding, message) => {
      const setup = await fixture();
      await writeFile(
        setup.manifestPath,
        `${JSON.stringify({ ...setup.manifest, findings: [finding] }, null, 2)}\n`,
      );
      await expect(
        recordHarnessReviewEvidence(setup.rootDir, setup.manifestPath, {
          storageDir: setup.storageDir,
          providerRunRoots: { execute: setup.providerRoot },
        }),
      ).rejects.toThrow(message);
    },
  );

  it.each([
    ["a missing severity", { ...deferredFinding, severity: undefined }],
    ["a missing scope", { ...deferredFinding, scope: undefined }],
    ["an unknown severity", { ...deferredFinding, severity: "P9" }],
    ["an unknown scope", { ...deferredFinding, scope: "someday" }],
  ])("rejects a finding with %s", async (_label, finding) => {
    const setup = await fixture();
    await writeFile(
      setup.manifestPath,
      `${JSON.stringify({ ...setup.manifest, findings: [finding] }, null, 2)}\n`,
    );
    await expect(
      recordHarnessReviewEvidence(setup.rootDir, setup.manifestPath, {
        storageDir: setup.storageDir,
        providerRunRoots: { execute: setup.providerRoot },
      }),
    ).rejects.toThrow(/contains an invalid finding/);
  });

  it.each([
    ["a negative finding count", { P0: -1, P1: 0, P2: 0, P3: 0 }],
    ["a fractional finding count", { P0: 0.5, P1: 0, P2: 0, P3: 0 }],
    ["a missing severity key", { P0: 0, P1: 0, P2: 0 }],
  ])("rejects manifest telemetry with %s", async (_label, findingCounts) => {
    // The manifest and record parsers share one predicate now, so this can no
    // longer be validated on only one side.
    const setup = await fixture();
    await writeFile(
      setup.manifestPath,
      `${JSON.stringify(
        {
          ...setup.manifest,
          reviewLoopTelemetry: {
            iterationCount: 1,
            deferredExpansionCount: 0,
            deferredIssueIds: [],
            findingCounts,
          },
        },
        null,
        2,
      )}\n`,
    );
    await expect(
      recordHarnessReviewEvidence(setup.rootDir, setup.manifestPath, {
        storageDir: setup.storageDir,
        providerRunRoots: { execute: setup.providerRoot },
      }),
    ).rejects.toThrow(/telemetry is invalid/);
  });

  it("fails validation rather than crashing on non-string deferral ids", async () => {
    const setup = await fixture();
    await writeFile(
      setup.manifestPath,
      `${JSON.stringify(
        {
          ...setup.manifest,
          reviewLoopTelemetry: {
            iterationCount: 1,
            deferredExpansionCount: 2,
            deferredIssueIds: [1, 2],
          },
        },
        null,
        2,
      )}\n`,
    );
    await expect(
      recordHarnessReviewEvidence(setup.rootDir, setup.manifestPath, {
        storageDir: setup.storageDir,
        providerRunRoots: { execute: setup.providerRoot },
      }),
    ).rejects.toThrow(/telemetry is invalid/);
  });

  it("rejects telemetry claiming finding counts its own findings contradict", async () => {
    // Every finding carries a validated severity, so an all-zero claim over a
    // findings array containing real severities would let a record misdescribe
    // its own run with no trace.
    const setup = await fixture();
    await writeFile(
      setup.manifestPath,
      `${JSON.stringify(
        {
          ...setup.manifest,
          findings: [deferredFinding],
          reviewLoopTelemetry: {
            iterationCount: 1,
            findingCounts: { P0: 0, P1: 0, P2: 0, P3: 0 },
            deferredExpansionCount: 1,
            deferredIssueIds: ["V26-1300"],
          },
        },
        null,
        2,
      )}\n`,
    );
    await expect(
      recordHarnessReviewEvidence(setup.rootDir, setup.manifestPath, {
        storageDir: setup.storageDir,
        providerRunRoots: { execute: setup.providerRoot },
      }),
    ).rejects.toThrow(/findingCounts must match the severities/);
  });

  it("accepts explicit loop telemetry that matches the deferred findings", async () => {
    const setup = await fixture();
    await writeFile(
      setup.manifestPath,
      `${JSON.stringify(
        {
          ...setup.manifest,
          findings: [deferredFinding],
          reviewLoopTelemetry: {
            iterationCount: 3,
            // Must match the manifest's own findings: one deferred P2.
            findingCounts: { P0: 0, P1: 0, P2: 1, P3: 0 },
            deferredExpansionCount: 1,
            deferredIssueIds: ["V26-1300"],
          },
        },
        null,
        2,
      )}\n`,
    );
    const result = await recordHarnessReviewEvidence(
      setup.rootDir,
      setup.manifestPath,
      recordOptions(setup),
    );
    expect(result.resolution).toMatchObject({
      reviewLoopTelemetry: {
        iterationCount: 3,
        findingCounts: { P0: 0, P1: 0, P2: 1, P3: 0 },
        deferredExpansionCount: 1,
        deferredIssueIds: ["V26-1300"],
      },
    });
  });

  it.each([
    [
      "token-metered platform",
      {
        unit: "tokens",
        total: 512345,
        reportedBy: "claude-code",
        byReviewer: { correctness: 190000, adversarial: 150000 },
      },
    ],
    [
      "platform metering fractional units of its own",
      { unit: "credits", total: 12.5, reportedBy: "some-other-runtime" },
    ],
  ])(
    "records a self-reported review cost from a %s",
    async (_label, reviewCost) => {
      const setup = await fixture();
      await writeFile(
        setup.manifestPath,
        `${JSON.stringify(
          {
            ...setup.manifest,
            reviewLoopTelemetry: {
              iterationCount: 2,
              deferredExpansionCount: 0,
              deferredIssueIds: [],
              reviewCost,
            },
          },
          null,
          2,
        )}\n`,
      );
      const result = await recordHarnessReviewEvidence(
        setup.rootDir,
        setup.manifestPath,
        recordOptions(setup),
      );
      expect(result.resolution).toMatchObject({
        reviewLoopTelemetry: { reviewCost },
      });
    },
  );

  it.each([
    ["missing unit", { total: 100 }],
    ["empty unit", { unit: "", total: 100 }],
    ["negative total", { unit: "tokens", total: -1 }],
    // JSON has no infinity: a platform serializing one lands here as null.
    ["null total", { unit: "tokens", total: Number.POSITIVE_INFINITY }],
    [
      "per-reviewer amounts exceeding the run total",
      {
        unit: "tokens",
        total: 100,
        byReviewer: { correctness: 80, adversarial: 40 },
      },
    ],
    [
      "negative per-reviewer amount",
      { unit: "tokens", total: 100, byReviewer: { correctness: -1 } },
    ],
    [
      "empty reporting platform",
      { unit: "tokens", total: 100, reportedBy: "" },
    ],
  ])("rejects a review cost with a %s", async (_label, reviewCost) => {
    const setup = await fixture();
    await writeFile(
      setup.manifestPath,
      `${JSON.stringify(
        {
          ...setup.manifest,
          reviewLoopTelemetry: {
            iterationCount: 1,
            deferredExpansionCount: 0,
            deferredIssueIds: [],
            reviewCost,
          },
        },
        null,
        2,
      )}\n`,
    );
    await expect(
      recordHarnessReviewEvidence(setup.rootDir, setup.manifestPath, {
        storageDir: setup.storageDir,
        providerRunRoots: { execute: setup.providerRoot },
      }),
    ).rejects.toThrow(/reviewCost must name a unit and a non-negative total/);
  });

  it.each([
    [
      "deferral count that disagrees with the findings",
      { iterationCount: 2, deferredExpansionCount: 0, deferredIssueIds: [] },
      /deferral facts must match/,
    ],
    [
      "issue ids that disagree with the findings",
      {
        iterationCount: 2,
        deferredExpansionCount: 1,
        deferredIssueIds: ["V26-9999"],
      },
      /deferral facts must match/,
    ],
    [
      "non-positive iteration count",
      {
        iterationCount: 0,
        deferredExpansionCount: 1,
        deferredIssueIds: ["V26-1300"],
      },
      /iterationCount must be a positive integer/,
    ],
  ])(
    "rejects explicit loop telemetry with a %s",
    async (_label, reviewLoopTelemetry, message) => {
      const setup = await fixture();
      await writeFile(
        setup.manifestPath,
        `${JSON.stringify(
          {
            ...setup.manifest,
            findings: [deferredFinding],
            reviewLoopTelemetry,
          },
          null,
          2,
        )}\n`,
      );
      await expect(
        recordHarnessReviewEvidence(setup.rootDir, setup.manifestPath, {
          storageDir: setup.storageDir,
          providerRunRoots: { execute: setup.providerRoot },
        }),
      ).rejects.toThrow(message);
    },
  );
});
