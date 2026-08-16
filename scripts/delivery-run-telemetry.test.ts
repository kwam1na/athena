import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildDeliveryRunTelemetryRecord,
  collectDeliveryRunTelemetryFindings,
  evaluateDeliveryRunTelemetryCheck,
  parseArgs,
  recordDeliveryRunTelemetry,
  deliveryRunTelemetryPath,
  readDeliveryRunTelemetryRecords,
  readLatestPassingDeliveryRunTelemetry,
  writeDeliveryRunTelemetryRecord,
  type DeliveryRunTelemetryRecord,
} from "./delivery-run-telemetry";
import { createDeliveryRunLedger } from "./harness-delivery-run-ledger";
import { isReviewNeutralPath } from "./harness-review-identity";
import {
  collectDeliverableDiffFingerprint,
  isDeliverableFingerprintPath,
} from "./delivery-diff-fingerprint";

const roots: string[] = [];

async function createTempRoot() {
  const rootDir = await mkdtemp(path.join(tmpdir(), "athena-delivery-tel-"));
  roots.push(rootDir);
  return rootDir;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function ledger(
  generatedAt: string,
  status: "pass" | "blocked" = "pass",
  reviewCost?: { unit: string; total: number; reportedBy?: string },
) {
  return createDeliveryRunLedger({
    generatedAt,
    status,
    proofState: status === "pass" ? "proof_recorded" : "proof_not_recorded",
    commandSpans: [
      {
        phase: "validate",
        command: "bun run pr:athena:validate",
        startedAt: generatedAt,
        endedAt: generatedAt,
        durationMs: 4000,
        status: status === "pass" ? "pass" : "fail",
        exitCode: status === "pass" ? 0 : 1,
      },
    ],
    reviewLoop: {
      providerId: "execute",
      runId: "run-a",
      finalPassId: "pass-a",
      recordedAt: generatedAt,
      iterationCount: 2,
      deferredExpansionCount: 0,
      deferredIssueIds: [],
      ...(reviewCost ? { reviewCost } : {}),
    },
  });
}

describe("delivery run telemetry", () => {
  it("builds a durable record carrying run outcome, branch identity, and review telemetry", () => {
    const record = buildDeliveryRunTelemetryRecord(
      ledger("2026-06-18T12:00:00.000Z", "pass", {
        unit: "tokens",
        total: 512_345,
        reportedBy: "claude-code",
      }),
      {
        branch: "codex/v26-1300-thing",
        headSha: "abc123",
        deliverableDiffFingerprint: "fingerprint-a",
      },
    );

    expect(record).toMatchObject({
      schemaVersion: 1,
      generatedAt: "2026-06-18T12:00:00.000Z",
      branch: "codex/v26-1300-thing",
      headSha: "abc123",
      status: "pass",
      proofState: "proof_recorded",
      summary: { totalDurationMs: 4000 },
      reviewLoop: {
        iterationCount: 2,
        reviewCost: { unit: "tokens", total: 512_345 },
      },
    });
  });

  it("groups files by UTC day and names them by timestamp and branch", () => {
    const forBranch = (branch: string) =>
      deliveryRunTelemetryPath(
        buildDeliveryRunTelemetryRecord(ledger("2026-06-18T12:00:00.000Z"), {
          branch,
          headSha: "abc123",
          deliverableDiffFingerprint: "fingerprint-a",
        }),
      );

    expect(forBranch("codex/v26-1300-thing")).toBe(
      "telemetry/delivery-runs/2026-06-18/2026-06-18T12-00-00-000Z-codex-v26-1300-thing.json",
    );
    expect(forBranch("codex/v26-1301-other")).not.toBe(
      forBranch("codex/v26-1300-thing"),
    );
  });

  it("round-trips records and returns them oldest-first", async () => {
    const rootDir = await createTempRoot();
    for (const stamp of [
      "2026-06-20T12:00:00.000Z",
      "2026-06-18T12:00:00.000Z",
      "2026-06-19T12:00:00.000Z",
    ]) {
      await writeDeliveryRunTelemetryRecord(
        rootDir,
        buildDeliveryRunTelemetryRecord(ledger(stamp), {
          branch: `codex/run-${stamp}`,
          headSha: "abc123",
          deliverableDiffFingerprint: "fingerprint-a",
        }),
      );
    }

    const records = await readDeliveryRunTelemetryRecords(rootDir);
    expect(records.map((record) => record.generatedAt)).toEqual([
      "2026-06-18T12:00:00.000Z",
      "2026-06-19T12:00:00.000Z",
      "2026-06-20T12:00:00.000Z",
    ]);
  });

  it("reads legacy flat records alongside day-folder records", async () => {
    const rootDir = await createTempRoot();
    const telemetryDir = path.join(rootDir, "telemetry/delivery-runs");
    await mkdir(telemetryDir, { recursive: true });
    const legacyRecord = buildDeliveryRunTelemetryRecord(
      ledger("2026-06-17T12:00:00.000Z"),
      {
        branch: "codex/legacy",
        headSha: "abc123",
        deliverableDiffFingerprint: "fingerprint-a",
      },
    );
    await writeFile(
      path.join(telemetryDir, "2026-06-17T12-00-00-000Z-codex-legacy.json"),
      `${JSON.stringify(legacyRecord, null, 2)}\n`,
    );
    await writeDeliveryRunTelemetryRecord(
      rootDir,
      buildDeliveryRunTelemetryRecord(ledger("2026-06-18T12:00:00.000Z"), {
        branch: "codex/day-folder",
        headSha: "def456",
        deliverableDiffFingerprint: "fingerprint-b",
      }),
    );

    await expect(readDeliveryRunTelemetryRecords(rootDir)).resolves.toMatchObject([
      { branch: "codex/legacy" },
      { branch: "codex/day-folder" },
    ]);
  });

  it("selects the newest passing record as the cross-delivery baseline", async () => {
    const rootDir = await createTempRoot();
    await writeDeliveryRunTelemetryRecord(
      rootDir,
      buildDeliveryRunTelemetryRecord(ledger("2026-06-18T12:00:00.000Z"), {
        branch: "codex/passing",
        headSha: "abc123",
        deliverableDiffFingerprint: "fingerprint-a",
      }),
    );
    await writeDeliveryRunTelemetryRecord(
      rootDir,
      buildDeliveryRunTelemetryRecord(
        ledger("2026-06-19T12:00:00.000Z", "blocked"),
        {
          branch: "codex/blocked",
          headSha: "def456",
          deliverableDiffFingerprint: "fingerprint-a",
        },
      ),
    );

    await expect(
      readLatestPassingDeliveryRunTelemetry(rootDir),
    ).resolves.toMatchObject({
      generatedAt: "2026-06-18T12:00:00.000Z",
      status: "pass",
    });
  });

  it("tolerates a missing directory, malformed files, and unknown schema versions", async () => {
    const emptyRoot = await createTempRoot();
    await expect(readDeliveryRunTelemetryRecords(emptyRoot)).resolves.toEqual(
      [],
    );
    await expect(
      readLatestPassingDeliveryRunTelemetry(emptyRoot),
    ).resolves.toBeNull();

    const rootDir = await createTempRoot();
    const telemetryDir = path.join(rootDir, "telemetry/delivery-runs");
    await mkdir(telemetryDir, { recursive: true });
    await writeFile(path.join(telemetryDir, "broken.json"), "{not json");
    await writeFile(
      path.join(telemetryDir, "future.json"),
      `${JSON.stringify({ schemaVersion: 99, generatedAt: "2026-06-18" })}\n`,
    );
    await writeFile(path.join(telemetryDir, "notes.txt"), "ignored\n");
    await writeDeliveryRunTelemetryRecord(
      rootDir,
      buildDeliveryRunTelemetryRecord(ledger("2026-06-18T12:00:00.000Z"), {
        branch: "codex/good",
        headSha: "abc123",
        deliverableDiffFingerprint: "fingerprint-a",
      }),
    );

    const records = await readDeliveryRunTelemetryRecords(rootDir);
    expect(records).toHaveLength(1);
    expect(records[0]?.branch).toBe("codex/good");
  });

  it("writes records that pretty-print as JSON on disk", async () => {
    const rootDir = await createTempRoot();
    const record = buildDeliveryRunTelemetryRecord(
      ledger("2026-06-18T12:00:00.000Z"),
      {
        branch: "codex/good",
        headSha: "abc123",
        deliverableDiffFingerprint: "fingerprint-a",
      },
    );
    const written = await writeDeliveryRunTelemetryRecord(rootDir, record);
    const onDisk = await readFile(
      path.join(rootDir, written.path),
      "utf8",
    );

    expect(onDisk.endsWith("\n")).toBe(true);
    expect(JSON.parse(onDisk) as DeliveryRunTelemetryRecord).toEqual(record);
  });

  const costReviewLoopForRecord = {
    providerId: "execute",
    runId: "run-a",
    finalPassId: "pass-a",
    recordedAt: "2026-06-18T11:59:00.000Z",
    iterationCount: 2,
    deferredExpansionCount: 0,
    deferredIssueIds: [] as string[],
  };

  describe("telemetry.recorded sensor", () => {
    const recordPath =
      "telemetry/delivery-runs/2026-06-18T12-00-00-000Z-codex-good.json";
    const validRecord = buildDeliveryRunTelemetryRecord(
      ledger("2026-06-18T12:00:00.000Z"),
      {
        branch: "codex/good",
        headSha: "abc123",
        deliverableDiffFingerprint: "fingerprint-a",
      },
    );

    function check(
      overrides: Partial<
        Parameters<typeof collectDeliveryRunTelemetryFindings>[0]
      >,
    ) {
      return collectDeliveryRunTelemetryFindings({
        changedPaths: ["scripts/some-change.ts"],
        sourceLineTotal: 500,
        changedRecordContents: new Map(),
        trackedPaths: new Set([recordPath]),
        deliverableDiffFingerprint: "fingerprint-a",
        // A run has completed against this exact deliverable, so a record is
        // producible and the demand is satisfiable.
        localLedgerFingerprint: "fingerprint-a",
        ciMode: false,
        ...overrides,
      });
    }

    it("demands nothing from a small change, matching the solution-note threshold", () => {
      // A one-line fix owes no telemetry: the artifact scales with the
      // delivery, exactly as compound:check and landed-report:check do.
      expect(check({ sourceLineTotal: 149 })).toEqual([]);
      expect(check({ sourceLineTotal: 149, ciMode: true })).toEqual([]);
      expect(check({ sourceLineTotal: 150 })).toHaveLength(1);
    });

    it("passes when a current record was committed with the delivery", () => {
      expect(
        check({
          changedPaths: ["scripts/some-change.ts", recordPath],
          changedRecordContents: new Map([[recordPath, validRecord]]),
        }),
      ).toEqual([]);
    });

    it("fails a substantial delivery with no record once a gate has run here", () => {
      const findings = check({});
      expect(findings).toHaveLength(1);
      expect(findings[0]?.code).toBe("telemetry_record_missing");
      expect(findings[0]?.message).toContain("delivery:telemetry-record");
    });

    it("fails a record that describes an older deliverable diff once a run has caught up", () => {
      // Presence is not enough: telemetry recorded before later fix rounds
      // would misreport what actually merges. The demand only fires once a run
      // has completed against the new deliverable, so re-recording is possible.
      const findings = check({
        changedPaths: ["scripts/some-change.ts", recordPath],
        changedRecordContents: new Map([[recordPath, validRecord]]),
        deliverableDiffFingerprint: "fingerprint-b",
        localLedgerFingerprint: "fingerprint-b",
      });
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain("older deliverable diff");
    });

    it("stays quiet until a run has completed for this exact deliverable, but never in CI", () => {
      // No run yet: demanding a record would block the run that produces it.
      expect(check({ localLedgerFingerprint: null })).toEqual([]);
      // A run happened, but the deliverable has moved since — the only record
      // producible now would describe a different tree, so stay quiet locally
      // and let the next run re-establish currency.
      expect(check({ localLedgerFingerprint: "fingerprint-older" })).toEqual([]);
      // CI is the merge authority: no bootstrap leniency.
      expect(
        check({ localLedgerFingerprint: null, ciMode: true }),
      ).toHaveLength(1);
    });

    it("refuses a record whose run did not pass", () => {
      const blockedRecord = buildDeliveryRunTelemetryRecord(
        ledger("2026-06-18T12:00:00.000Z", "blocked"),
        {
          branch: "codex/good",
          headSha: "abc123",
          deliverableDiffFingerprint: "fingerprint-a",
        },
      );
      const findings = check({
        changedPaths: ["scripts/some-change.ts", recordPath],
        changedRecordContents: new Map([[recordPath, blockedRecord]]),
      });
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain("did not pass");
    });

    it("refuses an untracked record, which would not survive the worktree", () => {
      const findings = check({
        changedPaths: ["scripts/some-change.ts", recordPath],
        changedRecordContents: new Map([[recordPath, validRecord]]),
        trackedPaths: new Set<string>(),
      });
      expect(findings).toHaveLength(1);
      expect(findings[0]?.code).toBe("telemetry_record_missing");
    });

    it.each([
      ["a non-ISO timestamp", { generatedAt: "18 June 2026" }],
      ["an empty branch", { branch: "" }],
      ["an empty head sha", { headSha: "" }],
      ["an empty fingerprint", { deliverableDiffFingerprint: "" }],
      ["an unknown status", { status: "mostly-fine" }],
      ["an unknown proof state", { proofState: "probably" }],
      [
        "a non-finite summary number",
        { summary: { ...validRecord.summary, totalDurationMs: Number.NaN } },
      ],
    ])("rejects a record with %s", (_label, override) => {
      // These fields are read back from the tracked tree and rendered into the
      // run summary, so a loose predicate turns a hand-authored file into
      // printed output and into the cross-delivery baseline.
      const findings = check({
        changedPaths: ["scripts/some-change.ts", recordPath],
        changedRecordContents: new Map([
          [recordPath, { ...validRecord, ...override }],
        ]),
      });
      expect(findings.some((f) => f.code === "telemetry_record_malformed")).toBe(
        true,
      );
    });

    it("rejects a record whose review telemetry is structurally invalid", () => {
      // Otherwise an unvalidated reviewLoop from a committed record reaches the
      // summary formatter's string operations.
      const poisoned = {
        ...validRecord,
        reviewLoop: {
          ...costReviewLoopForRecord,
          iterationCount: 0,
          deferredExpansionCount: 1,
          deferredIssueIds: [],
        },
      };
      const findings = check({
        changedPaths: ["scripts/some-change.ts", recordPath],
        changedRecordContents: new Map([[recordPath, poisoned]]),
      });
      expect(findings.some((f) => f.code === "telemetry_record_malformed")).toBe(
        true,
      );
    });

    it("flags a hand-edited or malformed record even when another valid one exists", () => {
      const brokenPath =
        "telemetry/delivery-runs/2026-06-19T12-00-00-000Z-codex-bad.json";
      const findings = check({
        changedPaths: ["scripts/some-change.ts", recordPath, brokenPath],
        changedRecordContents: new Map<string, unknown>([
          [recordPath, validRecord],
          [brokenPath, { schemaVersion: 99 }],
        ]),
      });
      expect(findings).toHaveLength(1);
      // A distinct code matters: only a missing record is waivable, so a
      // malformed one must not arrive wearing the waivable code.
      expect(findings[0]?.code).toBe("telemetry_record_malformed");
      expect(findings[0]?.message).toContain(brokenPath);
    });
  });

  it("keeps the telemetry tree out of the reviewed deliverable and the report fingerprint", () => {
    const telemetryFile =
      "telemetry/delivery-runs/2026-06-18T12-00-00-000Z-codex-good.json";

    // Recording a run describes work already reviewed; counting it as reviewed
    // content would let the observability write invalidate its own evidence.
    expect(isReviewNeutralPath(telemetryFile)).toBe(true);
    expect(isDeliverableFingerprintPath(telemetryFile)).toBe(false);
    expect(isReviewNeutralPath("scripts/harness-delivery-run-ledger.ts")).toBe(
      false,
    );
  });
});

describe("delivery run telemetry against a real repository", () => {
  function git(rootDir: string, args: string[]) {
    const result = spawnSync("git", args, {
      cwd: rootDir,
      encoding: "utf8",
      env: Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
      ),
    });
    if (result.status !== 0) {
      throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
    }
    return result.stdout.trim();
  }

  async function repoFixture() {
    const rootDir = await createTempRoot();
    git(rootDir, ["init", "--initial-branch=main"]);
    git(rootDir, ["config", "user.email", "fixture@example.com"]);
    git(rootDir, ["config", "user.name", "Fixture"]);
    await writeFile(path.join(rootDir, "seed.txt"), "seed\n");
    git(rootDir, ["add", "."]);
    git(rootDir, ["commit", "-m", "seed"]);
    git(rootDir, ["branch", "base-ref"]);
    git(rootDir, ["checkout", "-b", "codex/delivery"]);
    return rootDir;
  }

  async function writeLedger(
    rootDir: string,
    status: "pass" | "blocked",
    fingerprint?: string,
  ) {
    const ledger = createDeliveryRunLedger({
      generatedAt: "2026-06-18T12:00:00.000Z",
      status,
      proofState: status === "pass" ? "proof_recorded" : "proof_not_recorded",
      commandSpans: [],
      ...(fingerprint ? { deliverableDiffFingerprint: fingerprint } : {}),
    });
    await mkdir(path.join(rootDir, "artifacts/harness-delivery-runs"), {
      recursive: true,
    });
    await writeFile(
      path.join(rootDir, "artifacts/harness-delivery-runs/latest.json"),
      `${JSON.stringify(ledger, null, 2)}\n`,
    );
  }

  it("records a real run: branch, head, and the fingerprint it measured", async () => {
    const rootDir = await repoFixture();
    await writeFile(path.join(rootDir, "src.ts"), "export const a = 1;\n");
    git(rootDir, ["add", "."]);
    git(rootDir, ["commit", "-m", "work"]);
    await writeLedger(
      rootDir,
      "pass",
      collectDeliverableDiffFingerprint(
        rootDir,
        "base-ref",
        changedPathsForFixture(rootDir),
      ),
    );

    const written = await recordDeliveryRunTelemetry(rootDir, {
      baseRef: "base-ref",
    });

    expect(written.record.branch).toBe("codex/delivery");
    expect(written.record.headSha).toBe(git(rootDir, ["rev-parse", "HEAD"]));
    expect(written.record.deliverableDiffFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(written.path).toContain("telemetry/delivery-runs/");
    expect(
      JSON.parse(await readFile(path.join(rootDir, written.path), "utf8")),
    ).toMatchObject({ status: "pass" });
  });

  it("refuses to record a passing run that measured a different tree", async () => {
    // Otherwise the record would stamp the current deliverable onto a run of an
    // older one — telemetry claiming a tree it never measured.
    const rootDir = await repoFixture();
    await writeFile(path.join(rootDir, "src.ts"), "export const a = 1;\n");
    git(rootDir, ["add", "."]);
    git(rootDir, ["commit", "-m", "work"]);
    await writeLedger(rootDir, "pass", "fingerprint-of-an-older-tree");

    await expect(
      recordDeliveryRunTelemetry(rootDir, { baseRef: "base-ref" }),
    ).rejects.toThrow(/measured a different deliverable/);
  });

  it("refuses to record a run that did not pass", async () => {
    const rootDir = await repoFixture();
    await writeLedger(rootDir, "blocked");

    await expect(
      recordDeliveryRunTelemetry(rootDir, { baseRef: "base-ref" }),
    ).rejects.toThrow(/describes a blocked run/);
  });

  it("refuses to record with no ledger at all", async () => {
    const rootDir = await repoFixture();

    await expect(
      recordDeliveryRunTelemetry(rootDir, { baseRef: "base-ref" }),
    ).rejects.toThrow(/No delivery-run ledger to record/);
  });

  it("evaluates end to end: quiet, then demanding, then satisfied by a committed record", async () => {
    const rootDir = await repoFixture();
    // Must live where the shared source-line counter looks, or it is not
    // "considerable" and the threshold is never reached.
    await mkdir(path.join(rootDir, "scripts"), { recursive: true });
    await writeFile(
      path.join(rootDir, "scripts/big.ts"),
      Array.from(
        { length: 400 },
        (_, index) => `export const v${index} = ${index};`,
      ).join("\n"),
    );
    git(rootDir, ["add", "."]);
    git(rootDir, ["commit", "-m", "substantial"]);

    // No ledger: the demand would block the run that satisfies it. ciMode is
    // explicit because the default reads process.env.CI, which is set in CI —
    // a local-behavior assertion must not depend on where it runs.
    expect(
      evaluateDeliveryRunTelemetryCheck(rootDir, {
        baseRef: "base-ref",
        ciMode: false,
      }),
    ).toMatchObject({ status: "pass" });

    // CI has no bootstrap leniency.
    const inCi = evaluateDeliveryRunTelemetryCheck(rootDir, {
      baseRef: "base-ref",
      ciMode: true,
    });
    expect(inCi.status).toBe("fail");
    expect(inCi.findings[0]?.code).toBe("telemetry_record_missing");

    // A run completed for this exact deliverable: now the demand is fair.
    const fingerprint = await recordAfterLedger(rootDir);
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);

    // Recorded but uncommitted: does not survive the worktree, so no pass.
    expect(
      evaluateDeliveryRunTelemetryCheck(rootDir, {
        baseRef: "base-ref",
        ciMode: true,
      }).status,
    ).toBe("fail");

    git(rootDir, ["add", "."]);
    git(rootDir, ["commit", "-m", "telemetry"]);
    expect(
      evaluateDeliveryRunTelemetryCheck(rootDir, {
        baseRef: "base-ref",
        ciMode: true,
      }),
    ).toMatchObject({ status: "pass" });
  });

  async function recordAfterLedger(rootDir: string) {
    const fingerprint = collectDeliverableDiffFingerprint(
      rootDir,
      "base-ref",
      changedPathsForFixture(rootDir),
    );
    await writeLedger(rootDir, "pass", fingerprint);
    await recordDeliveryRunTelemetry(rootDir, { baseRef: "base-ref" });
    return fingerprint;
  }

  function changedPathsForFixture(rootDir: string) {
    return [
      ...new Set([
        ...git(rootDir, ["diff", "--name-only", "base-ref...HEAD"]).split("\n"),
        ...git(rootDir, ["ls-files", "--others", "--exclude-standard"]).split("\n"),
      ]),
    ]
      .map((line) => line.trim())
      .filter(Boolean)
      .sort();
  }

  it("stays quiet when only a non-passing run reached this deliverable", async () => {
    // A blocked run stamps the current fingerprint too. If that counted, the
    // sensor would enforce while recordDeliveryRunTelemetry refuses non-passing
    // ledgers — nothing could satisfy it and a non-interactive agent would be
    // stuck. This drives the real ledger-reading path, not a hand-built input.
    const rootDir = await repoFixture();
    await mkdir(path.join(rootDir, "scripts"), { recursive: true });
    await writeFile(
      path.join(rootDir, "scripts/big.ts"),
      Array.from(
        { length: 400 },
        (_, index) => `export const v${index} = ${index};`,
      ).join("\n"),
    );
    git(rootDir, ["add", "."]);
    git(rootDir, ["commit", "-m", "substantial"]);
    const fingerprint = collectDeliverableDiffFingerprint(
      rootDir,
      "base-ref",
      changedPathsForFixture(rootDir),
    );

    await writeLedger(rootDir, "blocked", fingerprint);
    expect(
      evaluateDeliveryRunTelemetryCheck(rootDir, {
        baseRef: "base-ref",
        ciMode: false,
      }),
    ).toMatchObject({ status: "pass" });

    // The same fingerprint from a *passing* run does make the demand fair.
    await writeLedger(rootDir, "pass", fingerprint);
    expect(
      evaluateDeliveryRunTelemetryCheck(rootDir, {
        baseRef: "base-ref",
        ciMode: false,
      }).status,
    ).toBe("fail");
  });

  it("honors an explicit local mode even when the CI env var is set", async () => {
    // The gate passes ciMode:false explicitly. An agent sandbox that exports CI
    // must not flip the in-gate evaluation into strict mode, which would
    // disable the bootstrap leniency and leave no legal move.
    const rootDir = await repoFixture();
    await mkdir(path.join(rootDir, "scripts"), { recursive: true });
    await writeFile(
      path.join(rootDir, "scripts/big.ts"),
      Array.from(
        { length: 400 },
        (_, index) => `export const v${index} = ${index};`,
      ).join("\n"),
    );
    git(rootDir, ["add", "."]);
    git(rootDir, ["commit", "-m", "substantial"]);

    const previous = process.env.CI;
    process.env.CI = "true";
    try {
      expect(
        evaluateDeliveryRunTelemetryCheck(rootDir, {
          baseRef: "base-ref",
          ciMode: false,
        }),
      ).toMatchObject({ status: "pass" });
      // Without the explicit flag the env var decides, and it demands a record.
      expect(
        evaluateDeliveryRunTelemetryCheck(rootDir, { baseRef: "base-ref" })
          .status,
      ).toBe("fail");
    } finally {
      if (previous === undefined) delete process.env.CI;
      else process.env.CI = previous;
    }
  });

  it("parses the sensor CLI options like its sibling sensors", () => {
    expect(parseArgs(["check"])).toEqual({
      command: "check",
      baseRef: "origin/main",
    });
    expect(parseArgs(["record", "--base", "origin/release"])).toEqual({
      command: "record",
      baseRef: "origin/release",
    });
    expect(() => parseArgs([])).toThrow(/Usage/);
    expect(() => parseArgs(["publish"])).toThrow(/Usage/);
    expect(() => parseArgs(["check", "--base"])).toThrow(/Missing value/);
    expect(() => parseArgs(["check", "--nope"])).toThrow(/Unknown argument/);
  });
});
