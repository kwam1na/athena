import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  consumeHarnessGateDecisionEvents,
  parseProviderSkippedEvents,
  resolveSummaryBaseline,
  runPrAthenaDeliveryRun,
  writePrAthenaProviderEvidence,
  runPrAthenaDeliveryRunCli,
} from "./pr-athena-delivery-run";
import {
  createDeliveryRunLedger,
  writeDeliveryRunLedger,
} from "./harness-delivery-run-ledger";
import {
  buildDeliveryRunTelemetryRecord,
  writeDeliveryRunTelemetryRecord,
} from "./delivery-run-telemetry";

const candidate = {
  treeSha: "tree-a",
  baseRef: "origin/main",
  baseTipSha: "base-a",
  diffBaseSha: "merge-base-a",
  worktreeId: "worktree-a",
};

function ledgerEvent(
  expected: {
    invocationId: string;
    parentStartToken: string;
    gateId: string;
    candidate: typeof candidate;
  },
  sequence: "evaluated" | "candidate_changed" | "provider_failed" | "completed",
  admitted: boolean,
) {
  return {
    invocationId: expected.invocationId,
    invocationMode: "outer" as const,
    parentIdentity: "pr:athena:delivery-run" as const,
    parentStartToken: expected.parentStartToken,
    sequence,
    gateId: expected.gateId,
    ...expected.candidate,
    context: "agent",
    admitted,
    preventedCostClass: "merge_grade_validation",
    resolutionKinds: admitted ? ["satisfied_evidence"] : ["blocked"],
    blockerCodes: admitted ? [] : ["review_evidence_missing"],
    timestamp:
      sequence === "evaluated"
        ? "2026-08-11T00:00:00.000Z"
        : "2026-08-11T00:00:01.000Z",
  };
}

function gateEventHarness() {
  return {
    resolveGateDecisionExpectation: async (
      _rootDir: string,
      invocationId: string,
      parentStartToken: string,
    ) => ({
      invocationId,
      parentStartToken,
      gateId: "athena.pr-validation",
      candidate,
    }),
    consumeGateDecisionEvents: async (
      _rootDir: string,
      expected: Parameters<typeof ledgerEvent>[0],
      providerExitCode: number,
    ) =>
      providerExitCode === 0
        ? [
            ledgerEvent(expected, "evaluated", true),
            ledgerEvent(expected, "completed", true),
          ]
        : [ledgerEvent(expected, "evaluated", false)],
  };
}

function persistedEvent(
  expected: Parameters<typeof ledgerEvent>[0],
  sequence: "evaluated" | "candidate_changed" | "provider_failed" | "completed",
  admitted: boolean,
) {
  return {
    schemaVersion: 2,
    kind: "gate_decision",
    invocationId: expected.invocationId,
    invocationMode: "outer",
    parentIdentity: "pr:athena:delivery-run",
    parentStartToken: expected.parentStartToken,
    sequence,
    gateId: expected.gateId,
    candidate: expected.candidate,
    context: "agent",
    admitted,
    preventedCostClass: "merge_grade_validation",
    timestamp:
      sequence === "evaluated"
        ? "2026-08-11T00:00:00.000Z"
        : "2026-08-11T00:00:01.000Z",
    decision: {
      gateId: expected.gateId,
      candidate: expected.candidate,
      preventedCostClass: "merge_grade_validation",
      admitted,
      resolutions: [
        {
          kind: admitted ? "satisfied_evidence" : "blocked",
          gateId: expected.gateId,
          obligationId: "review.green",
        },
      ],
      diagnostics: [],
    },
    blockerEnvelope: {
      schemaVersion: 1,
      blockers: admitted
        ? []
        : [
            {
              code: "review_evidence_missing",
              source: { kind: "obligation", id: "review.green" },
              summary: "Review evidence is missing.",
              remediations: [
                {
                  id: "complete-review",
                  kind: "manual_action",
                  summary: "Complete review.",
                },
              ],
            },
          ],
    },
  };
}

function runGit(rootDir: string, args: string[]) {
  const result = spawnSync("git", args, {
    cwd: rootDir,
    encoding: "utf8",
    env: gitFixtureEnv(),
  });

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
  }

  return result.stdout.trim();
}

function gitFixtureEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
}

async function createDecisionEventFixture() {
  const rootDir = await mkdtemp(path.join(tmpdir(), "athena-gate-events-"));
  runGit(rootDir, ["init"]);
  const eventsDir = path.resolve(
    rootDir,
    runGit(rootDir, [
      "rev-parse",
      "--git-path",
      "codex/harness-obligations/v2/events",
    ]),
  );
  await mkdir(eventsDir, { recursive: true });
  const expected = {
    invocationId: "invocation-a",
    parentStartToken: "start-a",
    gateId: "athena.pr-validation",
    candidate,
  };
  return { rootDir, eventsDir, expected };
}

async function writeDecisionEvent(
  eventsDir: string,
  event: ReturnType<typeof persistedEvent> | Record<string, unknown>,
  fileName = `${String(event.invocationId)}--${String(event.sequence)}.json`,
) {
  await Bun.write(path.join(eventsDir, fileName), `${JSON.stringify(event)}\n`);
}

describe("pr-athena delivery run wrapper", () => {
  it("runs prepare, static preflight, validate, and record-proof phases while recording spans", async () => {
    const commands: string[][] = [];
    let tick = 0;

    const result = await runPrAthenaDeliveryRun("/repo", {
      ...gateEventHarness(),
      nowIso: () => `2026-06-18T12:00:0${tick}.000Z`,
      monotonicMs: () => tick++ * 1000,
      writeLedger: false,
      runCommand: async (command) => {
        commands.push(command);
        return { exitCode: 0 };
      },
    });

    expect(result.exitCode).toBe(0);
    expect(commands).toEqual([
      ["bun", "run", "pr:athena:prepare"],
      ["bun", "run", "pr:athena:preflight"],
      ["bun", "run", "pr:athena:validate"],
      ["bun", "run", "pr:athena:record-proof"],
      ["bun", "run", "pr:athena:scorecard"],
    ]);
    expect(result.ledger).toMatchObject({
      status: "pass",
      proofState: "proof_recorded",
      summary: {
        commandCount: 5,
        failedCommandCount: 0,
      },
      commandSpans: [
        { phase: "prepare", status: "pass", exitCode: 0 },
        { phase: "preflight", status: "pass", exitCode: 0 },
        { phase: "validate", status: "pass", exitCode: 0 },
        { phase: "record-proof", status: "pass", exitCode: 0 },
        { phase: "scorecard", status: "pass", exitCode: 0 },
      ],
    });
  });

  it("records a preflight failure before provider validation or proof recording", async () => {
    const commands: string[][] = [];
    let tick = 0;

    const result = await runPrAthenaDeliveryRun("/repo", {
      ...gateEventHarness(),
      nowIso: () => `2026-06-18T12:00:0${tick}.000Z`,
      monotonicMs: () => tick++ * 1000,
      writeLedger: false,
      runCommand: async (command) => {
        commands.push(command);
        return { exitCode: command.includes("pr:athena:preflight") ? 23 : 0 };
      },
    });

    expect(result.exitCode).toBe(23);
    expect(commands).toEqual([
      ["bun", "run", "pr:athena:prepare"],
      ["bun", "run", "pr:athena:preflight"],
    ]);
    expect(result.ledger).toMatchObject({
      status: "blocked",
      proofState: "proof_not_recorded",
      blockedReason: "pr:athena:preflight exited with code 23",
      commandSpans: [
        { phase: "prepare", status: "pass", exitCode: 0 },
        { phase: "preflight", status: "fail", exitCode: 23 },
      ],
      providerSkippedEvents: [],
    });
  });

  it("records provider skip events emitted during validation", async () => {
    let tick = 0;

    const result = await runPrAthenaDeliveryRun("/repo", {
      ...gateEventHarness(),
      nowIso: () => `2026-06-18T12:00:0${tick}.000Z`,
      monotonicMs: () => tick++ * 1000,
      writeLedger: false,
      runCommand: async (command) => ({
        exitCode: 0,
        providerSkippedEvents: command.includes("pr:athena:validate")
          ? [
              {
                providerName: "pr:athena:delivery-run",
                coveredBy: "@athena/webapp:test",
                reason: "athena-webapp-vitest",
              },
            ]
          : [],
      }),
    });

    expect(result.ledger.providerSkippedEvents).toEqual([
      {
        providerName: "pr:athena:delivery-run",
        status: "covered_by_provider",
        coveredBy: "@athena/webapp:test",
        reason: "athena-webapp-vitest",
      },
    ]);
    expect(result.ledger.summary.providerSkippedCount).toBe(1);
  });

  it("parses provider skip events from mixed command output", () => {
    expect(
      parseProviderSkippedEvents(
        [
          "Running @athena/webapp:test",
          JSON.stringify({
            type: "provider_skipped",
            status: "covered_by_provider",
            capability: "athena-webapp-vitest",
            command: "@athena/webapp:test",
            providedBy: "pr:athena:delivery-run",
          }),
          "{not-json",
        ].join("\n"),
      ),
    ).toEqual([
      {
        providerName: "pr:athena:delivery-run",
        coveredBy: "@athena/webapp:test",
        reason: "athena-webapp-vitest",
      },
    ]);
  });

  it("passes one invocation id and parent token to the Git-private event consumer", async () => {
    let tick = 0;
    let observedExpectation: Parameters<typeof ledgerEvent>[0] | undefined;
    const result = await runPrAthenaDeliveryRun("/repo", {
      ...gateEventHarness(),
      nowIso: () => `2026-08-11T00:00:0${tick}.000Z`,
      monotonicMs: () => tick++ * 1000,
      writeLedger: false,
      runCommand: async (command, options) => {
        if (!command.includes("pr:athena:validate")) return { exitCode: 0 };
        expect(options.env?.ATHENA_HARNESS_INVOCATION_ID).toBeTruthy();
        expect(options.env?.ATHENA_HARNESS_PARENT_START_TOKEN).toBeTruthy();
        return { exitCode: 0 };
      },
      consumeGateDecisionEvents: async (_rootDir, expected) => {
        observedExpectation = expected;
        return [ledgerEvent(expected, "evaluated", true)];
      },
    });
    expect(observedExpectation).toMatchObject({
      invocationId: expect.any(String),
      parentStartToken: expect.any(String),
      candidate,
    });
    expect(result.ledger.gateDecisionEvents).toHaveLength(1);
    expect(result.ledger.summary.gateDecisionCount).toBe(1);
  });

  it("ingests the exact successful Git-private event sequence once", async () => {
    const { rootDir, eventsDir, expected } = await createDecisionEventFixture();
    try {
      await writeDecisionEvent(
        eventsDir,
        persistedEvent(expected, "evaluated", true),
      );
      await writeDecisionEvent(
        eventsDir,
        persistedEvent(expected, "completed", true),
      );
      await writeDecisionEvent(
        eventsDir,
        persistedEvent(
          { ...expected, invocationId: "stale-invocation" },
          "evaluated",
          false,
        ),
      );

      await expect(
        consumeHarnessGateDecisionEvents(rootDir, expected, 0),
      ).resolves.toMatchObject([
        { sequence: "evaluated", worktreeId: "worktree-a" },
        { sequence: "completed", worktreeId: "worktree-a" },
      ]);
      await expect(
        consumeHarnessGateDecisionEvents(rootDir, expected, 0),
      ).rejects.toThrow(/already consumed/i);
      await expect(
        readFile(
          path.join(eventsDir, "consumed/invocation-a--evaluated.json"),
          "utf8",
        ),
      ).resolves.toContain('"invocationId":"invocation-a"');
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("rejects legacy gate-decision schemas and string projections", async () => {
    const v1 = await createDecisionEventFixture();
    const projected = await createDecisionEventFixture();
    try {
      await writeDecisionEvent(v1.eventsDir, {
        ...persistedEvent(v1.expected, "evaluated", false),
        schemaVersion: 1,
      });
      await expect(
        consumeHarnessGateDecisionEvents(v1.rootDir, v1.expected, 1),
      ).rejects.toThrow(/correlation validation/i);

      const legacy = persistedEvent(projected.expected, "evaluated", false);
      await writeDecisionEvent(projected.eventsDir, {
        ...legacy,
        decision: {
          ...legacy.decision,
          findings: [{ code: "review_evidence_missing" }],
          remediation: { machine: [], human: [] },
        },
      });
      await expect(
        consumeHarnessGateDecisionEvents(
          projected.rootDir,
          projected.expected,
          1,
        ),
      ).rejects.toThrow(/correlation validation/i);
    } finally {
      await Promise.all([
        rm(v1.rootDir, { recursive: true, force: true }),
        rm(projected.rootDir, { recursive: true, force: true }),
      ]);
    }
  });

  it("rejects missing, partial, duplicate, and forged event sequences", async () => {
    const missing = await createDecisionEventFixture();
    const partial = await createDecisionEventFixture();
    const duplicate = await createDecisionEventFixture();
    try {
      await expect(
        consumeHarnessGateDecisionEvents(missing.rootDir, missing.expected, 0),
      ).rejects.toThrow(/missing/i);

      await writeDecisionEvent(
        partial.eventsDir,
        persistedEvent(partial.expected, "evaluated", true),
      );
      await expect(
        consumeHarnessGateDecisionEvents(partial.rootDir, partial.expected, 0),
      ).rejects.toThrow(/provider outcome/i);

      const evaluated = persistedEvent(duplicate.expected, "evaluated", true);
      await writeDecisionEvent(duplicate.eventsDir, evaluated);
      await writeDecisionEvent(
        duplicate.eventsDir,
        evaluated,
        "invocation-a--evaluated-copy.json",
      );
      await writeDecisionEvent(
        duplicate.eventsDir,
        persistedEvent(duplicate.expected, "completed", true),
      );
      await expect(
        consumeHarnessGateDecisionEvents(
          duplicate.rootDir,
          duplicate.expected,
          0,
        ),
      ).rejects.toThrow(/filename|cardinality/i);
    } finally {
      await Promise.all(
        [missing.rootDir, partial.rootDir, duplicate.rootDir].map((rootDir) =>
          rm(rootDir, { recursive: true, force: true }),
        ),
      );
    }
  });

  it.each([
    ["invocation mode", { invocationMode: "standalone" }],
    ["parent identity", { parentIdentity: "direct" }],
    ["parent start token", { parentStartToken: "forged-start" }],
    ["gate", { gateId: "other.gate" }],
  ])("rejects a correlated event with forged %s", async (_label, overrides) => {
    const { rootDir, eventsDir, expected } = await createDecisionEventFixture();
    try {
      await writeDecisionEvent(eventsDir, {
        ...persistedEvent(expected, "evaluated", false),
        ...overrides,
      });
      await expect(
        consumeHarnessGateDecisionEvents(rootDir, expected, 1),
      ).rejects.toThrow(/correlation/i);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it.each([
    ["candidate", { treeSha: "wrong-tree" }],
    ["base", { baseTipSha: "wrong-base" }],
    ["worktree", { worktreeId: "wrong-worktree" }],
  ])("rejects an event for the wrong %s", async (_label, candidateOverride) => {
    const { rootDir, eventsDir, expected } = await createDecisionEventFixture();
    try {
      await writeDecisionEvent(eventsDir, {
        ...persistedEvent(expected, "evaluated", false),
        candidate: { ...candidate, ...candidateOverride },
      });
      await expect(
        consumeHarnessGateDecisionEvents(rootDir, expected, 1),
      ).rejects.toThrow(/correlation/i);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("preserves the failing phase exit code and does not record proof after validation failure", async () => {
    const commands: string[][] = [];
    let tick = 0;

    const result = await runPrAthenaDeliveryRun("/repo", {
      ...gateEventHarness(),
      nowIso: () => `2026-06-18T12:00:0${tick}.000Z`,
      monotonicMs: () => tick++ * 1000,
      writeLedger: false,
      runCommand: async (command) => {
        commands.push(command);
        return { exitCode: command.includes("pr:athena:validate") ? 42 : 0 };
      },
    });

    expect(result.exitCode).toBe(42);
    expect(commands).toEqual([
      ["bun", "run", "pr:athena:prepare"],
      ["bun", "run", "pr:athena:preflight"],
      ["bun", "run", "pr:athena:validate"],
    ]);
    expect(result.ledger).toMatchObject({
      status: "blocked",
      proofState: "proof_not_recorded",
      blockedReason: "pr:athena:validate exited with code 42",
      commandSpans: [
        { phase: "prepare", status: "pass", exitCode: 0 },
        { phase: "preflight", status: "pass", exitCode: 0 },
        { phase: "validate", status: "fail", exitCode: 42 },
      ],
    });
  });

  it("does not mark proof recorded when record-proof fails", async () => {
    const commands: string[][] = [];
    let tick = 0;

    const result = await runPrAthenaDeliveryRun("/repo", {
      ...gateEventHarness(),
      nowIso: () => `2026-06-18T12:00:0${tick}.000Z`,
      monotonicMs: () => tick++ * 1000,
      writeLedger: false,
      runCommand: async (command) => {
        commands.push(command);
        return { exitCode: command.includes("pr:athena:record-proof") ? 1 : 0 };
      },
    });

    expect(result.exitCode).toBe(1);
    expect(commands).toEqual([
      ["bun", "run", "pr:athena:prepare"],
      ["bun", "run", "pr:athena:preflight"],
      ["bun", "run", "pr:athena:validate"],
      ["bun", "run", "pr:athena:record-proof"],
    ]);
    expect(result.ledger).toMatchObject({
      status: "blocked",
      proofState: "proof_not_recorded",
      blockedReason: "pr:athena:record-proof exited with code 1",
      commandSpans: [
        { phase: "prepare", status: "pass", exitCode: 0 },
        { phase: "preflight", status: "pass", exitCode: 0 },
        { phase: "validate", status: "pass", exitCode: 0 },
        { phase: "record-proof", status: "fail", exitCode: 1 },
      ],
    });
  });

  it("records interrupted runs distinctly from blocked command failures", async () => {
    let tick = 0;

    const result = await runPrAthenaDeliveryRun("/repo", {
      ...gateEventHarness(),
      nowIso: () => `2026-06-18T12:00:0${tick}.000Z`,
      monotonicMs: () => tick++ * 1000,
      writeLedger: false,
      runCommand: async () => {
        throw Object.assign(new Error("SIGINT"), { signal: "SIGINT" });
      },
    });

    expect(result.exitCode).toBe(130);
    expect(result.ledger).toMatchObject({
      status: "interrupted",
      proofState: "proof_not_recorded",
      interruptedReason: "SIGINT",
      commandSpans: [
        {
          phase: "prepare",
          status: "interrupted",
          exitCode: 130,
        },
      ],
    });
  });

  it("writes the default latest ledger artifact", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "athena-pr-ledger-"));
    let tick = 0;

    try {
      await runPrAthenaDeliveryRun(rootDir, {
        ...gateEventHarness(),
        nowIso: () => `2026-06-18T12:00:0${tick}.000Z`,
        monotonicMs: () => tick++ * 1000,
        runCommand: async () => ({ exitCode: 0 }),
      });

      const latest = JSON.parse(
        await readFile(
          path.join(rootDir, "artifacts/harness-delivery-runs/latest.json"),
          "utf8",
        ),
      );

      expect(latest).toMatchObject({
        status: "pass",
        proofState: "proof_recorded",
        summary: { commandCount: 5 },
      });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("promotes a passing previous latest to baseline, appends history, and folds review-loop telemetry", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "athena-pr-baseline-"));
    let tick = 0;
    const reviewLoop = {
      providerId: "execute",
      runId: "run-a",
      finalPassId: "pass-a",
      recordedAt: "2026-06-17T12:00:00.000Z",
      iterationCount: 2,
      deferredExpansionCount: 1,
      deferredIssueIds: ["V26-1300"],
    };

    try {
      const run = () =>
        runPrAthenaDeliveryRun(rootDir, {
          ...gateEventHarness(),
          nowIso: () => `2026-06-18T12:00:0${tick}.000Z`,
          monotonicMs: () => tick++ * 1000,
          runCommand: async () => ({ exitCode: 0 }),
          resolveReviewLoopSummary: async () => reviewLoop,
        });

      const first = await run();
      expect(first.ledger.reviewLoop).toMatchObject({
        iterationCount: 2,
        deferredExpansionCount: 1,
        deferredIssueIds: ["V26-1300"],
      });
      const firstGeneratedAt = first.ledger.generatedAt;

      const second = await run();

      const baseline = JSON.parse(
        await readFile(
          path.join(rootDir, "artifacts/harness-delivery-runs/baseline.json"),
          "utf8",
        ),
      );
      expect(baseline).toMatchObject({
        status: "pass",
        generatedAt: firstGeneratedAt,
      });

      const historyDir = path.join(
        rootDir,
        "artifacts/harness-delivery-runs/history",
      );
      const historyEntries = (await readdir(historyDir)).sort();
      expect(historyEntries).toHaveLength(2);
      expect(historyEntries.at(-1)).toBe(
        `${second.ledger.generatedAt.replace(/[:.]/g, "-")}.json`,
      );
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("prefers the tracked telemetry corpus over the worktree baseline", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "athena-pr-tracked-"));

    try {
      const ledger = createDeliveryRunLedger({
        generatedAt: "2026-06-17T12:00:00.000Z",
        status: "pass",
        proofState: "proof_recorded",
        commandSpans: [],
      });

      await expect(resolveSummaryBaseline(rootDir)).resolves.toEqual({
        baseline: null,
      });

      await writeDeliveryRunLedger(rootDir, ledger, {
        baselinePath: "artifacts/harness-delivery-runs/baseline.json",
      });
      await expect(resolveSummaryBaseline(rootDir)).resolves.toMatchObject({
        baselineSource: "worktree",
      });

      await writeDeliveryRunTelemetryRecord(
        rootDir,
        buildDeliveryRunTelemetryRecord(
          createDeliveryRunLedger({
            generatedAt: "2026-06-18T12:00:00.000Z",
            status: "pass",
            proofState: "proof_recorded",
            commandSpans: [],
          }),
          {
            branch: "codex/landed",
            headSha: "abc123",
            deliverableDiffFingerprint: "fingerprint-a",
          },
        ),
      );
      await expect(resolveSummaryBaseline(rootDir)).resolves.toMatchObject({
        baselineSource: "tracked",
        baseline: { generatedAt: "2026-06-18T12:00:00.000Z" },
      });

      // A branch must not compare against its own committed record: that is a
      // near-zero self-delta dressed as a cross-delivery trend.
      await expect(
        resolveSummaryBaseline(rootDir, { currentBranch: "codex/landed" }),
      ).resolves.toMatchObject({ baselineSource: "worktree" });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("writes provider evidence for the current index tree", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "athena-pr-provider-"));

    try {
      runGit(rootDir, ["init"]);
      await Bun.write(path.join(rootDir, "package.json"), "{}\n");
      runGit(rootDir, ["add", "package.json"]);
      const treeSha = runGit(rootDir, ["write-tree"]);

      await writePrAthenaProviderEvidence(rootDir);

      const evidence = JSON.parse(
        await readFile(
          path.join(
            rootDir,
            "artifacts/harness-delivery-runs/provider-evidence.json",
          ),
          "utf8",
        ),
      );

      expect(evidence).toMatchObject({
        schemaVersion: 1,
        provider: "pr:athena:delivery-run",
        treeSha,
        capabilities: [
          {
            capability: "root-script-tests",
            command: "bun run test:coverage:scripts",
          },
          {
            capability: "athena-webapp-vitest",
            command: "bun run --filter '@athena/webapp' test:coverage",
            coverage: { mode: "full" },
          },
          {
            capability: "athena-webapp-typecheck",
            command:
              "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
          },
        ],
      });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("persists a blocked ledger when the scorecard phase fails after proof recording", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "athena-pr-scorecard-"));
    let tick = 0;

    try {
      runGit(rootDir, ["init"]);
      const proofPath = path.join(
        rootDir,
        runGit(rootDir, [
          "rev-parse",
          "--git-path",
          "codex/pre-push-pr-athena-proof.json",
        ]),
      );
      await mkdir(path.dirname(proofPath), { recursive: true });
      await Bun.write(proofPath, "{}\n");

      const result = await runPrAthenaDeliveryRun(rootDir, {
        ...gateEventHarness(),
        nowIso: () => `2026-06-18T12:00:0${tick}.000Z`,
        monotonicMs: () => tick++ * 1000,
        runCommand: async (command) => ({
          exitCode: command.includes("pr:athena:scorecard") ? 7 : 0,
        }),
      });

      expect(result.exitCode).toBe(7);
      expect(result.ledger).toMatchObject({
        status: "blocked",
        proofState: "proof_not_recorded",
        blockedReason: "pr:athena:scorecard exited with code 7",
        commandSpans: [
          { phase: "prepare", status: "pass", exitCode: 0 },
          { phase: "preflight", status: "pass", exitCode: 0 },
          { phase: "validate", status: "pass", exitCode: 0 },
          { phase: "record-proof", status: "pass", exitCode: 0 },
          { phase: "scorecard", status: "fail", exitCode: 7 },
        ],
      });

      const latest = JSON.parse(
        await readFile(
          path.join(rootDir, "artifacts/harness-delivery-runs/latest.json"),
          "utf8",
        ),
      );
      expect(latest).toMatchObject({
        status: "blocked",
        proofState: "proof_not_recorded",
        blockedReason: "pr:athena:scorecard exited with code 7",
      });
      await expect(readFile(proofPath, "utf8")).rejects.toThrow();
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

describe("runPrAthenaDeliveryRunCli", () => {
  it("renders a typed blocker when the block originates in the orchestrator", async () => {
    const errors: string[] = [];

    const exitCode = await runPrAthenaDeliveryRunCli(
      [],
      {
        writeLedger: false,
        // A gate decision event written by an older checkout: the v1 -> v2
        // break makes this an expected upgrade condition, and runStep swallows
        // it into blockedReason rather than rethrowing.
        resolveGateDecisionExpectation: async () => {
          throw new Error(
            "Harness gate decision event failed correlation validation.",
          );
        },
        runCommand: async () => ({ exitCode: 0 }),
      } as never,
      { error: (line: string) => errors.push(line) },
    );

    const rendered = errors.join("\n");

    // Before this, the only operator-facing output was the prose run summary:
    // no code, no source, no remediation, on the spine itself.
    expect(exitCode).not.toBe(0);
    expect(rendered).toContain("delivery_run_blocked");
    expect(rendered).toContain("command:pr:athena:delivery-run");
    expect(rendered).toContain("rerun-delivery-run");
    expect(rendered).toContain(
      "Harness gate decision event failed correlation validation.",
    );
  });

  it("renders delivery_run_interrupted when a phase is killed by a non-SIGINT signal", async () => {
    const errors: string[] = [];

    const exitCode = await runPrAthenaDeliveryRunCli(
      [],
      {
        writeLedger: false,
        runCommand: async () => {
          throw Object.assign(new Error("child terminated"), {
            signal: "SIGTERM",
          });
        },
      } as never,
      { error: (line: string) => errors.push(line) },
    );

    const rendered = errors.join("\n");

    // Before this, a signaled run printed only the prose summary and exited
    // non-zero with no contract-form output at all - indistinguishable from a
    // crash at the terminal.
    expect(exitCode).toBe(1);
    expect(rendered).toContain("delivery_run_interrupted");
    expect(rendered).toContain("command:pr:athena:delivery-run");
    expect(rendered).toContain("rerun-interrupted-delivery-run");
    expect(rendered).toContain("SIGTERM");
  });

  it("renders delivery_run_interrupted for SIGINT so the terminal can tell interruption from a crash", async () => {
    const errors: string[] = [];

    const exitCode = await runPrAthenaDeliveryRunCli(
      [],
      {
        writeLedger: false,
        runCommand: async () => {
          throw Object.assign(new Error("child interrupted"), {
            signal: "SIGINT",
          });
        },
      } as never,
      { error: (line: string) => errors.push(line) },
    );

    const rendered = errors.join("\n");

    expect(exitCode).toBe(130);
    expect(rendered).toContain("delivery_run_interrupted");
    expect(rendered).toContain("command:pr:athena:delivery-run");
    expect(rendered).toContain("rerun-interrupted-delivery-run");
    expect(rendered).not.toContain("harness_internal_error");
  });
});
