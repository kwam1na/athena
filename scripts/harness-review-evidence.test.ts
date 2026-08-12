import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { recordHarnessReviewEvidence } from "./harness-review-evidence";
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

  it("records evidence when only review-neutral content moved the raw tree", async () => {
    const setup = await fixture();
    const result = await recordHarnessReviewEvidence(
      setup.rootDir,
      setup.manifestPath,
      {
        storageDir: setup.storageDir,
        providerRunRoots: { execute: setup.providerRoot },
        captureCandidate: async () => ({
          ok: true,
          candidate: { ...setup.candidate, treeSha: "tree-after-report" },
        }),
        resolveWorktreeId: async () => setup.worktreeId,
        now: () => "2026-08-12T00:00:00.000Z",
      },
    );

    // The record keeps the reviewed tree, not the tree the report landed on.
    expect(result.candidate).toEqual(setup.candidate);
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
    ).rejects.toThrow(/identity|candidate/i);
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
        disposition: "unresolved",
      },
    ],
    [
      "ignored actionable finding",
      {
        id: "finding-a",
        actionable: true,
        blocking: false,
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
});
