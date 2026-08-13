import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  discoverHarnessObligationRecords,
  isValidReviewCost,
  isValidReviewLoopTelemetry,
  publishHarnessObligationRecord,
} from "./harness-obligation-records";
import { HARNESS_REVIEW_IDENTITY_VERSION } from "./harness-review-identity";

const roots: string[] = [];

async function fixture() {
  const root = await mkdtemp(
    path.join(tmpdir(), "harness-obligation-records-"),
  );
  roots.push(root);
  const storageDir = path.join(root, "git-private", "records");
  return { root, storageDir };
}

const candidate = {
  treeSha: "tree-a",
  deliverableTreeSha: "deliverable-a",
  identityVersion: HARNESS_REVIEW_IDENTITY_VERSION,
  baseRef: "origin/main",
  baseTipSha: "base-a",
  diffBaseSha: "merge-base-a",
};

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("review loop telemetry validation", () => {
  const valid = {
    iterationCount: 2,
    deferredExpansionCount: 1,
    deferredIssueIds: ["V26-1300"],
    findingCounts: { P0: 0, P1: 1, P2: 2, P3: 0 },
  };

  it("accepts a complete telemetry block", () => {
    expect(isValidReviewLoopTelemetry(valid)).toBe(true);
    expect(
      isValidReviewLoopTelemetry({ ...valid, findingCounts: undefined }),
    ).toBe(true);
  });

  it.each([
    ["a zero iteration count", { ...valid, iterationCount: 0 }],
    ["a fractional iteration count", { ...valid, iterationCount: 1.5 }],
    [
      "deferral ids that disagree with the count",
      { ...valid, deferredIssueIds: [] },
    ],
    [
      "a negative finding count",
      { ...valid, findingCounts: { P0: -1, P1: 0, P2: 0, P3: 0 } },
    ],
    [
      "a fractional finding count",
      { ...valid, findingCounts: { P0: 0.5, P1: 0, P2: 0, P3: 0 } },
    ],
    [
      "an invalid cost report",
      { ...valid, reviewCost: { unit: "", total: 1 } },
    ],
  ])("rejects %s", (_label, telemetry) => {
    // findingCounts in particular: the record and manifest parsers used to
    // validate this differently, so one definition now serves both.
    expect(isValidReviewLoopTelemetry(telemetry)).toBe(false);
  });
});

describe("review cost validation", () => {
  it("accepts any metered unit and rejects shapes that are not costs", () => {
    // Shape, not membership in a fixed unit set: a platform metering fractional
    // credits is as valid as one counting whole tokens.
    expect(isValidReviewCost({ unit: "tokens", total: 10 })).toBe(true);
    expect(isValidReviewCost({ unit: "credits", total: 1.5 })).toBe(true);
    expect(isValidReviewCost({ unit: "", total: 10 })).toBe(false);
    expect(isValidReviewCost({ unit: "tokens", total: -1 })).toBe(false);
    // Per-reviewer amounts may sum below the run total, never above it.
    expect(
      isValidReviewCost({
        unit: "tokens",
        total: 100,
        byReviewer: { a: 60, b: 40 },
      }),
    ).toBe(true);
    expect(
      isValidReviewCost({
        unit: "tokens",
        total: 100,
        byReviewer: { a: 60, b: 41 },
      }),
    ).toBe(false);
  });
});

describe("harness obligation records", () => {
  it("round-trips an immutable candidate-bound waiver without evidence fields", async () => {
    const { root, storageDir } = await fixture();
    const first = await publishHarnessObligationRecord(
      root,
      {
        gateId: "athena.pr-validation",
        obligationId: "review.green",
        candidate,
        resolution: { kind: "waiver" },
      },
      { storageDir, now: () => "2026-08-11T00:00:00.000Z" },
    );
    const replay = await publishHarnessObligationRecord(
      root,
      {
        gateId: "athena.pr-validation",
        obligationId: "review.green",
        candidate,
        resolution: { kind: "waiver" },
      },
      { storageDir, now: () => "2026-08-11T01:00:00.000Z" },
    );

    expect(replay.recordId).toBe(first.recordId);
    expect(replay).toEqual(first);
    expect(replay.resolution).toEqual({ kind: "waiver" });
    expect(await readFile(first.path, "utf8")).toContain('"kind": "waiver"');

    const discovered = await discoverHarnessObligationRecords(root, {
      gateId: first.gateId,
      obligationId: first.obligationId,
      storageDir,
    });
    expect(discovered.records).toEqual([first.record]);
    expect(discovered.diagnostics).toEqual([]);
  });

  it("keeps a record that predates the deliverable identity readable and self-consistent", async () => {
    const { root, storageDir } = await fixture();
    const legacyCandidate = { ...candidate } as Record<string, unknown>;
    delete legacyCandidate.deliverableTreeSha;
    delete legacyCandidate.identityVersion;
    const published = await publishHarnessObligationRecord(
      root,
      {
        gateId: "athena.pr-validation",
        obligationId: "review.green",
        candidate: legacyCandidate as typeof candidate,
        resolution: { kind: "waiver" },
      },
      { storageDir, now: () => "2026-08-11T00:00:00.000Z" },
    );

    const discovered = await discoverHarnessObligationRecords(root, {
      gateId: published.gateId,
      obligationId: published.obligationId,
      storageDir,
    });

    // A record written before the identity existed still proves its own slot
    // identity, so it is readable rather than reported as tampering. It simply
    // cannot match a current candidate; see harness-gate-obligations.test.ts.
    expect(discovered.records).toEqual([published.record]);
    expect(discovered.diagnostics).toEqual([]);
  });

  it("keeps evidence semantic identity distinct by provider run and final pass", async () => {
    const { root, storageDir } = await fixture();
    const make = (finalPassId: string) =>
      publishHarnessObligationRecord(
        root,
        {
          gateId: "athena.pr-validation",
          obligationId: "review.green",
          candidate,
          resolution: {
            kind: "evidence" as const,
            providerId: "execute-review",
            runId: "run-a",
            finalPassId,
            manifestDigest: "manifest-a",
            outcome: "green" as const,
            blockingCount: 0,
            unresolvedActionableCount: 0,
            degradedReviewerCount: 0,
          },
        },
        { storageDir, now: () => "2026-08-11T00:00:00.000Z" },
      );

    const [a, b] = await Promise.all([make("pass-a"), make("pass-b")]);
    expect(a.recordId).not.toBe(b.recordId);
  });

  it("atomically converges concurrent publishers on one semantic identity", async () => {
    const { root, storageDir } = await fixture();
    const publish = (createdAt: string) =>
      publishHarnessObligationRecord(
        root,
        {
          gateId: "athena.pr-validation",
          obligationId: "review.green",
          candidate,
          resolution: { kind: "waiver" },
        },
        { storageDir, now: () => createdAt },
      );

    const publications = await Promise.all(
      Array.from({ length: 16 }, (_, index) =>
        publish(`2026-08-11T00:00:${String(index).padStart(2, "0")}.000Z`),
      ),
    );
    expect(new Set(publications.map(({ recordId }) => recordId)).size).toBe(1);
    expect(
      new Set(publications.map(({ path: recordPath }) => recordPath)).size,
    ).toBe(1);
    expect(publications.map(({ record }) => record)).toEqual(
      Array.from({ length: publications.length }, () => publications[0].record),
    );
    expect(JSON.parse(await readFile(publications[0].path, "utf8"))).toEqual(
      publications[0].record,
    );
  });

  it("ignores crash-boundary temporaries before and after atomic publication", async () => {
    const { root, storageDir } = await fixture();
    await mkdir(storageDir, { recursive: true });
    const interruptedTemporary = path.join(
      storageDir,
      ".interrupted-publication.tmp",
    );
    await writeFile(interruptedTemporary, "{partial");

    const before = await discoverHarnessObligationRecords(root, {
      gateId: "athena.pr-validation",
      obligationId: "review.green",
      storageDir,
    });
    expect(before.records).toEqual([]);
    expect(before.diagnostics).toEqual([
      { kind: "ignored_neighbor", path: interruptedTemporary },
    ]);

    const published = await publishHarnessObligationRecord(
      root,
      {
        gateId: "athena.pr-validation",
        obligationId: "review.green",
        candidate,
        resolution: { kind: "waiver" },
      },
      { storageDir, now: () => "2026-08-11T00:00:00.000Z" },
    );
    const after = await discoverHarnessObligationRecords(root, {
      gateId: published.gateId,
      obligationId: published.obligationId,
      storageDir,
    });
    expect(after.records).toEqual([published.record]);
    expect(after.diagnostics).toEqual([
      { kind: "ignored_neighbor", path: interruptedTemporary },
    ]);
  });

  it("reports malformed candidate records without hiding a valid neighbor", async () => {
    const { root, storageDir } = await fixture();
    const valid = await publishHarnessObligationRecord(
      root,
      {
        gateId: "athena.pr-validation",
        obligationId: "review.green",
        candidate,
        resolution: { kind: "waiver" },
      },
      { storageDir, now: () => "2026-08-11T00:00:00.000Z" },
    );
    await writeFile(
      path.join(storageDir, "athena.pr-validation--review.green--broken.json"),
      "{partial",
    );
    await writeFile(path.join(storageDir, "unrelated.txt"), "ignored");

    const discovered = await discoverHarnessObligationRecords(root, {
      gateId: valid.gateId,
      obligationId: valid.obligationId,
      storageDir,
    });
    expect(discovered.records).toEqual([valid.record]);
    expect(discovered.diagnostics).toEqual([
      expect.objectContaining({ kind: "malformed_record" }),
      expect.objectContaining({ kind: "ignored_neighbor" }),
    ]);
  });

  it("does not overwrite a conflicting pre-existing record", async () => {
    const { root, storageDir } = await fixture();
    const published = await publishHarnessObligationRecord(
      root,
      {
        gateId: "athena.pr-validation",
        obligationId: "review.green",
        candidate,
        resolution: { kind: "waiver" },
      },
      { storageDir, now: () => "2026-08-11T00:00:00.000Z" },
    );
    await writeFile(published.path, "{}\n");

    await expect(
      publishHarnessObligationRecord(
        root,
        {
          gateId: "athena.pr-validation",
          obligationId: "review.green",
          candidate,
          resolution: { kind: "waiver" },
        },
        { storageDir, now: () => "2026-08-11T00:00:00.000Z" },
      ),
    ).rejects.toThrow(/conflicting existing obligation record/);
    expect(await readFile(published.path, "utf8")).toBe("{}\n");
  });

  it("round-trips evidence resolutions carrying review-loop telemetry", async () => {
    const { root, storageDir } = await fixture();
    const evidenceResolution = {
      kind: "evidence" as const,
      providerId: "execute",
      runId: "run-a",
      finalPassId: "pass-a",
      manifestDigest: "digest-a",
      outcome: "green" as const,
      blockingCount: 0 as const,
      unresolvedActionableCount: 0 as const,
      degradedReviewerCount: 0 as const,
      reviewLoopTelemetry: {
        iterationCount: 2,
        findingCounts: { P0: 0, P1: 1, P2: 2, P3: 0 },
        deferredExpansionCount: 1,
        deferredIssueIds: ["V26-1300"],
      },
    };
    await publishHarnessObligationRecord(
      root,
      {
        gateId: "athena.pr-validation",
        obligationId: "review.green",
        candidate,
        resolution: evidenceResolution,
      },
      { storageDir, now: () => "2026-08-11T00:00:00.000Z" },
    );

    const discovered = await discoverHarnessObligationRecords(root, {
      gateId: "athena.pr-validation",
      obligationId: "review.green",
      storageDir,
    });
    expect(discovered.records).toHaveLength(1);
    expect(discovered.records[0]?.resolution).toMatchObject({
      kind: "evidence",
      reviewLoopTelemetry: {
        iterationCount: 2,
        deferredExpansionCount: 1,
        deferredIssueIds: ["V26-1300"],
      },
    });
  });

  it("round-trips self-reported token usage on the evidence resolution", async () => {
    const { root, storageDir } = await fixture();
    await publishHarnessObligationRecord(
      root,
      {
        gateId: "athena.pr-validation",
        obligationId: "review.green",
        candidate,
        resolution: {
          kind: "evidence",
          providerId: "execute",
          runId: "run-a",
          finalPassId: "pass-a",
          manifestDigest: "digest-a",
          outcome: "green",
          blockingCount: 0,
          unresolvedActionableCount: 0,
          degradedReviewerCount: 0,
          reviewLoopTelemetry: {
            iterationCount: 2,
            deferredExpansionCount: 0,
            deferredIssueIds: [],
            reviewCost: {
              unit: "tokens",
              total: 512345,
              reportedBy: "claude-code",
              byReviewer: { correctness: 190000, adversarial: 150000 },
            },
          },
        },
      },
      { storageDir, now: () => "2026-08-11T00:00:00.000Z" },
    );

    const discovered = await discoverHarnessObligationRecords(root, {
      gateId: "athena.pr-validation",
      obligationId: "review.green",
      storageDir,
    });
    expect(discovered.records[0]?.resolution).toMatchObject({
      reviewLoopTelemetry: {
        reviewCost: {
          unit: "tokens",
          total: 512345,
          reportedBy: "claude-code",
          byReviewer: { correctness: 190000, adversarial: 150000 },
        },
      },
    });
  });

  it.each([
    ["a negative total", { unit: "tokens", total: -1 }],
    ["no unit", { total: 100 }],
    [
      "per-reviewer amounts above the run total",
      {
        unit: "tokens",
        total: 100,
        byReviewer: { correctness: 80, adversarial: 40 },
      },
    ],
  ])(
    "reports records with %s in the review cost as diagnostics",
    async (_label, reviewCost) => {
      const { root, storageDir } = await fixture();
      const published = await publishHarnessObligationRecord(
        root,
        {
          gateId: "athena.pr-validation",
          obligationId: "review.green",
          candidate,
          resolution: {
            kind: "evidence",
            providerId: "execute",
            runId: "run-a",
            finalPassId: "pass-a",
            manifestDigest: "digest-a",
            outcome: "green",
            blockingCount: 0,
            unresolvedActionableCount: 0,
            degradedReviewerCount: 0,
            reviewLoopTelemetry: {
              iterationCount: 1,
              deferredExpansionCount: 0,
              deferredIssueIds: [],
              reviewCost: { unit: "tokens", total: 100 },
            },
          },
        },
        { storageDir, now: () => "2026-08-11T00:00:00.000Z" },
      );
      const stored = JSON.parse(await readFile(published.path, "utf8"));
      stored.resolution.reviewLoopTelemetry.reviewCost = reviewCost;
      await writeFile(published.path, `${JSON.stringify(stored, null, 2)}\n`);

      const discovered = await discoverHarnessObligationRecords(root, {
        gateId: "athena.pr-validation",
        obligationId: "review.green",
        storageDir,
      });
      expect(discovered.records).toEqual([]);
      expect(discovered.diagnostics).toMatchObject([
        {
          kind: "malformed_record",
          reason: "review loop cost report is invalid",
        },
      ]);
    },
  );

  it.each([
    ["a fractional iteration count", 1.5],
    ["a zero iteration count", 0],
  ])(
    "reports records with %s as diagnostics",
    async (_label, iterationCount) => {
      const { root, storageDir } = await fixture();
      const published = await publishHarnessObligationRecord(
        root,
        {
          gateId: "athena.pr-validation",
          obligationId: "review.green",
          candidate,
          resolution: {
            kind: "evidence",
            providerId: "execute",
            runId: "run-a",
            finalPassId: "pass-a",
            manifestDigest: "digest-a",
            outcome: "green",
            blockingCount: 0,
            unresolvedActionableCount: 0,
            degradedReviewerCount: 0,
            reviewLoopTelemetry: {
              iterationCount: 2,
              deferredExpansionCount: 0,
              deferredIssueIds: [],
            },
          },
        },
        { storageDir, now: () => "2026-08-11T00:00:00.000Z" },
      );
      const stored = JSON.parse(await readFile(published.path, "utf8"));
      stored.resolution.reviewLoopTelemetry.iterationCount = iterationCount;
      await writeFile(published.path, `${JSON.stringify(stored, null, 2)}\n`);

      const discovered = await discoverHarnessObligationRecords(root, {
        gateId: "athena.pr-validation",
        obligationId: "review.green",
        storageDir,
      });
      expect(discovered.records).toEqual([]);
      expect(discovered.diagnostics).toMatchObject([
        { kind: "malformed_record", reason: "review loop telemetry is invalid" },
      ]);
    },
  );

  it("reports records with malformed review-loop telemetry as diagnostics", async () => {
    const { root, storageDir } = await fixture();
    const published = await publishHarnessObligationRecord(
      root,
      {
        gateId: "athena.pr-validation",
        obligationId: "review.green",
        candidate,
        resolution: {
          kind: "evidence",
          providerId: "execute",
          runId: "run-a",
          finalPassId: "pass-a",
          manifestDigest: "digest-a",
          outcome: "green",
          blockingCount: 0,
          unresolvedActionableCount: 0,
          degradedReviewerCount: 0,
          reviewLoopTelemetry: {
            iterationCount: 2,
            deferredExpansionCount: 1,
            deferredIssueIds: ["V26-1300"],
          },
        },
      },
      { storageDir, now: () => "2026-08-11T00:00:00.000Z" },
    );
    const stored = JSON.parse(await readFile(published.path, "utf8"));
    stored.resolution.reviewLoopTelemetry.deferredIssueIds = [];
    await writeFile(published.path, `${JSON.stringify(stored, null, 2)}\n`);

    const discovered = await discoverHarnessObligationRecords(root, {
      gateId: "athena.pr-validation",
      obligationId: "review.green",
      storageDir,
    });
    expect(discovered.records).toEqual([]);
    expect(discovered.diagnostics).toMatchObject([
      { kind: "malformed_record", reason: "review loop telemetry is invalid" },
    ]);
  });

  it("discovers only records in the current worktree-local directory", async () => {
    const { root, storageDir } = await fixture();
    const otherStorageDir = path.join(root, "other-worktree", "records");
    await mkdir(otherStorageDir, { recursive: true });
    await publishHarnessObligationRecord(
      root,
      {
        gateId: "athena.pr-validation",
        obligationId: "review.green",
        candidate,
        resolution: { kind: "waiver" },
      },
      { storageDir: otherStorageDir, now: () => "2026-08-11T00:00:00.000Z" },
    );

    const discovered = await discoverHarnessObligationRecords(root, {
      gateId: "athena.pr-validation",
      obligationId: "review.green",
      storageDir,
    });
    expect(discovered.records).toEqual([]);
  });
});
