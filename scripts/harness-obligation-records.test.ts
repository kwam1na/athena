import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  discoverHarnessObligationRecords,
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

  it("ignores a record that predates the deliverable identity instead of blocking on it", async () => {
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
    const legacy = JSON.parse(await readFile(published.path, "utf8"));
    delete legacy.candidate.deliverableTreeSha;
    delete legacy.candidate.identityVersion;
    await writeFile(published.path, `${JSON.stringify(legacy, null, 2)}\n`);

    const discovered = await discoverHarnessObligationRecords(root, {
      gateId: published.gateId,
      obligationId: published.obligationId,
      storageDir,
    });

    // A superseded identity is a version transition, not tampering: the record
    // must not satisfy anything, and must not block the gate either.
    expect(discovered.records).toEqual([]);
    expect(discovered.diagnostics).toEqual([
      expect.objectContaining({
        kind: "superseded_record",
        path: published.path,
      }),
    ]);
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
