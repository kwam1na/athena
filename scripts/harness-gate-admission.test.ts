import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  defaultScenarios,
  runHarnessGateAdmission,
  WAIVABLE_FINDING_CODES,
  writeHarnessGateDecisionEvent,
} from "./harness-gate-admission";
import { HARNESS_APP_REGISTRY } from "./harness-app-registry";
import {
  ATHENA_PR_VALIDATION_GATE_ID,
  HARNESS_GATE_REGISTRY,
} from "./harness-gate-registry";
import { withoutGitRepositoryContext } from "./git-environment";
import { HARNESS_REVIEW_IDENTITY_VERSION } from "./harness-review-identity";

const HEAVY_PROVIDER_COMMANDS =
  HARNESS_GATE_REGISTRY.gates[ATHENA_PR_VALIDATION_GATE_ID]
    .privateProviderCommands;

const candidate = {
  schemaVersion: 1 as const,
  headSha: "head-a",
  treeSha: "tree-a",
  deliverableTreeSha: "deliverable-a",
  identityVersion: HARNESS_REVIEW_IDENTITY_VERSION,
  mode: "clean" as const,
  baseRef: "origin/main" as const,
  baseTipSha: "base-a",
  diffBaseSha: "merge-base-a",
  status: "",
  untrackedFiles: [],
};

function greenOptions(overrides: Record<string, unknown> = {}) {
  const spawnHeavy = vi.fn(async () => 0);
  const writeDecisionEvent = vi.fn(async () => "/events/event.json");
  return {
    invocationId: "invocation-a",
    evaluatePreparation: async () => ({
      prepared: true as const,
      status: "prepared" as const,
      candidate,
      receipt: {},
      receiptPath: "/receipt.json",
    }),
    projectActivation: async () => ({
      relevantLineCount: 0,
      relevantPaths: [],
      excludedPaths: [],
      binaryPaths: [],
      sensitiveScenarioIds: [],
    }),
    classifyContext: () => ({
      kind: "agent" as const,
      signal: "CODEX_THREAD_ID" as const,
    }),
    discoverRecords: async () => ({ records: [], diagnostics: [] }),
    evaluateDocumentation: () => ({ status: "pass" as const, findings: [] }),
    evaluateTelemetry: () => ({ status: "pass" as const, findings: [] }),
    resolveWorktreeId: async () => "worktree-a",
    captureCandidate: async () => ({ ok: true as const, candidate }),
    writeDecisionEvent,
    spawnHeavy,
    promptForWaiver: vi.fn(async () => false),
    publishWaiver: vi.fn(async () => undefined),
    ...overrides,
    _spies: { spawnHeavy, writeDecisionEvent },
  };
}

function humanWaiverOptions(overrides: Record<string, unknown> = {}) {
  return greenOptions({
    classifyContext: () => ({
      kind: "human" as const,
      interactive: true as const,
    }),
    projectActivation: async () => ({
      relevantLineCount: 50,
      relevantPaths: ["src/app.ts"],
      excludedPaths: [],
      binaryPaths: [],
      sensitiveScenarioIds: [],
    }),
    ...overrides,
  });
}

const temporaryDirectories: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("harness gate admission", () => {
  it("gives every waivable obligation a non-empty finding-code allow-list", () => {
    // The registry invariant pairs humanWaiverAllowed with the waived
    // resolution kind; this is the third half of the same decision. Without it
    // a future obligation can declare a waiver that admission silently never
    // offers — the inert-flag failure this delivery exists to prevent.
    for (const [id, obligation] of Object.entries(
      HARNESS_GATE_REGISTRY.obligations,
    )) {
      if (!obligation.humanWaiverAllowed) continue;
      expect(
        WAIVABLE_FINDING_CODES[id as keyof typeof WAIVABLE_FINDING_CODES],
      ).toBeTruthy();
      expect(
        WAIVABLE_FINDING_CODES[id as keyof typeof WAIVABLE_FINDING_CODES]
          ?.length,
      ).toBeGreaterThan(0);
    }
  });

  it("blocks qualifying agent work without evidence before any heavy spawn", async () => {
    const options = greenOptions({
      projectActivation: async () => ({
        relevantLineCount: 50,
        relevantPaths: ["src/app.ts"],
        excludedPaths: [],
        binaryPaths: [],
        sensitiveScenarioIds: [],
      }),
    });
    const result = await runHarnessGateAdmission("/repo", options as never);
    expect(result).toMatchObject({ admitted: false, status: "blocked" });
    expect(options._spies.spawnHeavy).not.toHaveBeenCalled();
    expect(options._spies.writeDecisionEvent).toHaveBeenCalledTimes(1);
  });

  it("runs wrapper-owned heavy commands for a non-qualifying green candidate", async () => {
    const options = greenOptions();
    const result = await runHarnessGateAdmission("/repo", options as never);
    expect(result).toMatchObject({ admitted: true, status: "passed" });
    expect(
      options._spies.spawnHeavy.mock.calls.map(([command]) => command),
    ).toEqual(HEAVY_PROVIDER_COMMANDS);
  });

  it("records which candidate identity authorized the decision", async () => {
    const options = greenOptions();
    await runHarnessGateAdmission("/repo", options as never);
    expect(options._spies.writeDecisionEvent).toHaveBeenCalledTimes(2);
    for (const [, event] of options._spies.writeDecisionEvent.mock.calls) {
      expect(event.candidate).toMatchObject({
        treeSha: candidate.treeSha,
        deliverableTreeSha: candidate.deliverableTreeSha,
        identityVersion: HARNESS_REVIEW_IDENTITY_VERSION,
      });
    }
  });

  it("admits recorded evidence whose raw tree predates a review-neutral commit", async () => {
    const options = greenOptions({
      projectActivation: async () => ({
        relevantLineCount: 50,
        relevantPaths: ["src/app.ts"],
        excludedPaths: [],
        binaryPaths: [],
        sensitiveScenarioIds: [],
      }),
      discoverRecords: async () => ({
        records: [
          {
            schemaVersion: 1 as const,
            recordId: "record-a",
            worktreeId: "worktree-a",
            gateId: ATHENA_PR_VALIDATION_GATE_ID,
            obligationId: "review.green" as const,
            candidate: {
              treeSha: "tree-before-report",
              deliverableTreeSha: candidate.deliverableTreeSha,
              identityVersion: HARNESS_REVIEW_IDENTITY_VERSION,
              baseRef: candidate.baseRef,
              baseTipSha: candidate.baseTipSha,
              diffBaseSha: candidate.diffBaseSha,
            },
            resolution: {
              kind: "evidence" as const,
              providerId: "execute",
              runId: "run-a",
              finalPassId: "pass-a",
              manifestDigest: "digest-a",
              outcome: "green" as const,
              blockingCount: 0 as const,
              unresolvedActionableCount: 0 as const,
              degradedReviewerCount: 0 as const,
            },
            createdAt: "2026-08-12T00:00:00.000Z",
          },
        ],
        diagnostics: [],
      }),
    });

    const result = await runHarnessGateAdmission("/repo", options as never);
    expect(result).toMatchObject({ admitted: true, status: "passed" });
  });

  it("aggregates documentation and review blockers and does not prompt", async () => {
    const promptForWaiver = vi.fn(async () => true);
    const options = greenOptions({
      projectActivation: async () => ({
        relevantLineCount: 50,
        relevantPaths: ["src/app.ts"],
        excludedPaths: [],
        binaryPaths: [],
        sensitiveScenarioIds: [],
      }),
      evaluateDocumentation: () => ({
        status: "fail" as const,
        findings: [
          {
            policy: "compound-solution",
            label: "Solution notes",
            message: "missing",
          },
          {
            policy: "landed-change-report",
            label: "Landed-change reports",
            message: "stale",
          },
        ],
      }),
      promptForWaiver,
    });
    const result = await runHarnessGateAdmission("/repo", options as never);
    expect(result.decision.findings.map((finding) => finding.code)).toEqual([
      "review_evidence_missing",
      "compound-solution",
      "landed-change-report",
    ]);
    expect(promptForWaiver).not.toHaveBeenCalled();
    expect(options._spies.spawnHeavy).not.toHaveBeenCalled();
  });

  it("lets an interactive human waive both delivery documentation requirements", async () => {
    const promptForWaiver = vi.fn(async () => true);
    const publishWaiver = vi.fn(async () => undefined);
    const options = greenOptions({
      classifyContext: () => ({
        kind: "human" as const,
        interactive: true as const,
      }),
      evaluateDocumentation: () => ({
        status: "fail" as const,
        findings: [
          {
            policy: "compound-solution" as const,
            label: "Solution notes" as const,
            message: "A current solution note is required.",
          },
          {
            policy: "landed-change-report" as const,
            label: "Landed-change reports" as const,
            message: "A current changed report is required.",
          },
        ],
      }),
      promptForWaiver,
      publishWaiver,
    });

    const result = await runHarnessGateAdmission("/repo", options as never);

    expect(result.status).toBe("passed");
    expect(promptForWaiver).toHaveBeenCalledWith(
      expect.anything(),
      ["documentation.current"],
    );
    expect(publishWaiver).not.toHaveBeenCalled();
  });

  it("admits a trusted candidate-bound documentation waiver in repository CI", async () => {
    const options = greenOptions({
      classifyContext: () => ({
        kind: "ci" as const,
        policyId: "athena-pr-tests" as const,
      }),
      evaluateDocumentation: () => ({
        status: "fail" as const,
        findings: [
          {
            policy: "compound-solution" as const,
            label: "Solution notes" as const,
            message: "missing",
          },
        ],
      }),
      discoverDocumentationWaiver: async () => ({
        recordId: "github-check:789",
        approvedBy: "human-reviewer",
        attestationUrl: "https://github.com/v26-labs/athena/actions/runs/456",
        attestation: {} as never,
      }),
    });

    const result = await runHarnessGateAdmission("/repo", options as never);

    expect(result.status).toBe("passed");
    expect(
      result.decision.resolutions.find(
        (resolution) => resolution.obligationId === "documentation.current",
      ),
    ).toMatchObject({
      kind: "waived",
      waiverRecordId: "github-check:789",
    });
  });

  const missingTelemetry = () => ({
    status: "fail" as const,
    findings: [
      {
        code: "telemetry_record_missing" as const,
        message: "Deliverable change detected without a telemetry record.",
      },
    ],
  });

  it("blocks an agent on a missing telemetry record and never offers it a waiver", async () => {
    const promptForWaiver = vi.fn(async () => true);
    const options = greenOptions({
      evaluateTelemetry: missingTelemetry,
      promptForWaiver,
    });
    const result = await runHarnessGateAdmission("/repo", options as never);
    expect(result.status).not.toBe("passed");
    expect(result.decision.findings.map((finding) => finding.code)).toContain(
      "telemetry_record_missing",
    );
    // The waiver path is interactive-human only — agents are exactly the
    // population this obligation exists to hold to account.
    expect(promptForWaiver).not.toHaveBeenCalled();
    expect(options._spies.spawnHeavy).not.toHaveBeenCalled();
  });

  it("lets an interactive human waive a missing telemetry record and publishes that waiver by name", async () => {
    const publishWaiver = vi.fn(async () => undefined);
    const options = greenOptions({
      classifyContext: () => ({
        kind: "human" as const,
        interactive: true as const,
      }),
      evaluateTelemetry: missingTelemetry,
      promptForWaiver: vi.fn(async () => true),
      publishWaiver,
    });
    const result = await runHarnessGateAdmission("/repo", options as never);

    expect(result.status).toBe("passed");
    // telemetry.recorded is a live obligation: its waiver is invocation-scoped,
    // so no durable record is published — one would never be read back, and the
    // decision event is its audit trail.
    expect(publishWaiver).not.toHaveBeenCalled();
  });

  it("refuses to waive a malformed telemetry record, which is not the waivable code", async () => {
    const promptForWaiver = vi.fn(async () => true);
    const options = greenOptions({
      classifyContext: () => ({
        kind: "human" as const,
        interactive: true as const,
      }),
      evaluateTelemetry: () => ({
        status: "fail" as const,
        findings: [
          {
            code: "telemetry_record_malformed" as const,
            message: "Changed telemetry record is not a valid record.",
          },
        ],
      }),
      promptForWaiver,
    });
    const result = await runHarnessGateAdmission("/repo", options as never);

    expect(result.status).not.toBe("passed");
    // A waiver means "I accept this missing artifact", never "I accept this
    // corrupt one" — so the malformed code must not reach the waiver path.
    expect(promptForWaiver).not.toHaveBeenCalled();
    expect(result.decision.findings.map((finding) => finding.code)).toContain(
      "telemetry_record_malformed",
    );
  });

  it("waives every blocked obligation under one prompt, and names them all in it", async () => {
    const publishWaiver = vi.fn(async () => undefined);
    const promptForWaiver = vi.fn(async () => true);
    const options = greenOptions({
      classifyContext: () => ({
        kind: "human" as const,
        interactive: true as const,
      }),
      projectActivation: async () => ({
        relevantLineCount: 50,
        relevantPaths: ["src/app.ts"],
        excludedPaths: [],
        binaryPaths: [],
        sensitiveScenarioIds: [],
      }),
      discoverRecords: async () => ({ records: [], diagnostics: [] }),
      evaluateTelemetry: missingTelemetry,
      promptForWaiver,
      publishWaiver,
    });
    const result = await runHarnessGateAdmission("/repo", options as never);

    expect(result.status).toBe("passed");
    // One "yes" now covers more than review evidence, so the prompt must name
    // everything that single confirmation waives.
    const promptedIds = promptForWaiver.mock.calls[0]?.[1] as string[];
    expect([...promptedIds].sort()).toEqual([
      "review.green",
      "telemetry.recorded",
    ]);
    // Both are waived by the one confirmation, but only the historical
    // obligation gets a durable record; the live one is invocation-scoped.
    expect(publishWaiver).toHaveBeenCalledTimes(1);
    expect(publishWaiver.mock.calls[0]?.[2]).toBe("review.green");
  });

  it("does not offer a documentation waiver to an agent", async () => {
    const promptForWaiver = vi.fn(async () => true);
    const options = greenOptions({
      evaluateDocumentation: () => ({
        status: "fail" as const,
        findings: [
          {
            policy: "compound-solution" as const,
            label: "Solution notes" as const,
            message: "missing",
          },
        ],
      }),
      promptForWaiver,
    });
    const result = await runHarnessGateAdmission("/repo", options as never);

    expect(result.status).not.toBe("passed");
    expect(promptForWaiver).not.toHaveBeenCalled();
  });

  it("uses an invocation waiver and publishes it only after successful unchanged validation", async () => {
    const publishWaiver = vi.fn(async () => undefined);
    const options = humanWaiverOptions({
      promptForWaiver: vi.fn(async () => true),
      publishWaiver,
    });
    const result = await runHarnessGateAdmission("/repo", options as never);
    expect(result.status).toBe("passed");
    expect(publishWaiver).toHaveBeenCalledTimes(1);
  });

  it.each(["decline", "EOF or lost TTY"])(
    "blocks a human waiver on %s without spawning or publishing",
    async () => {
      const publishWaiver = vi.fn(async () => undefined);
      const options = humanWaiverOptions({
        promptForWaiver: vi.fn(async () => false),
        publishWaiver,
      });

      const result = await runHarnessGateAdmission("/repo", options as never);

      expect(result.status).toBe("blocked");
      expect(result.decision.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "waiver_declined" }),
        ]),
      );
      expect(options._spies.spawnHeavy).not.toHaveBeenCalled();
      expect(publishWaiver).not.toHaveBeenCalled();
      expect(
        options._spies.writeDecisionEvent.mock.calls.map(([, event]) =>
          event.sequence,
        ),
      ).toEqual(["evaluated"]);
    },
  );

  it("blocks prompt-time candidate drift without spawning or publishing", async () => {
    let captureCount = 0;
    const publishWaiver = vi.fn(async () => undefined);
    const options = humanWaiverOptions({
      promptForWaiver: vi.fn(async () => true),
      captureCandidate: async () => {
        captureCount += 1;
        return {
          ok: true as const,
          candidate:
            captureCount === 1
              ? candidate
              : { ...candidate, treeSha: "tree-prompt-drift" },
        };
      },
      publishWaiver,
    });

    const result = await runHarnessGateAdmission("/repo", options as never);

    expect(result.status).toBe("blocked");
    expect(result.decision.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "candidate_changed_during_prompt" }),
      ]),
    );
    expect(options._spies.spawnHeavy).not.toHaveBeenCalled();
    expect(publishWaiver).not.toHaveBeenCalled();
    expect(
      options._spies.writeDecisionEvent.mock.calls.map(([, event]) =>
        event.sequence,
      ),
    ).toEqual(["evaluated"]);
  });

  it("does not publish a human waiver when a provider fails", async () => {
    const publishWaiver = vi.fn(async () => undefined);
    const spawnHeavy = vi.fn(async () => 17);
    const options = humanWaiverOptions({
      promptForWaiver: vi.fn(async () => true),
      spawnHeavy,
      publishWaiver,
    });

    const result = await runHarnessGateAdmission("/repo", options as never);

    expect(result).toMatchObject({
      admitted: true,
      status: "provider_failed",
      exitCode: 17,
    });
    expect(spawnHeavy).toHaveBeenCalledTimes(1);
    expect(publishWaiver).not.toHaveBeenCalled();
    expect(
      options._spies.writeDecisionEvent.mock.calls.map(([, event]) =>
        event.sequence,
      ),
    ).toEqual(["evaluated", "provider_failed"]);
  });

  it("emits terminal candidate-changed telemetry and does not publish a waiver after provider drift", async () => {
    let captureCount = 0;
    const publishWaiver = vi.fn(async () => undefined);
    const options = humanWaiverOptions({
      promptForWaiver: vi.fn(async () => true),
      captureCandidate: async () => {
        captureCount += 1;
        return {
          ok: true as const,
          candidate:
            captureCount < 4
              ? candidate
              : { ...candidate, treeSha: "tree-provider-drift" },
        };
      },
      publishWaiver,
    });

    const result = await runHarnessGateAdmission("/repo", options as never);

    expect(result.status).toBe("provider_changed_candidate");
    expect(options._spies.spawnHeavy).toHaveBeenCalledTimes(
      HEAVY_PROVIDER_COMMANDS.length,
    );
    expect(publishWaiver).not.toHaveBeenCalled();
    expect(
      options._spies.writeDecisionEvent.mock.calls.map(([, event]) => ({
        invocationId: event.invocationId,
        sequence: event.sequence,
      })),
    ).toEqual([
      { invocationId: "invocation-a", sequence: "evaluated" },
      { invocationId: "invocation-a", sequence: "candidate_changed" },
    ]);
  });

  it("fails closed when telemetry cannot be persisted", async () => {
    const options = greenOptions({
      writeDecisionEvent: async () => {
        throw new Error("disk unavailable");
      },
    });
    await expect(
      runHarnessGateAdmission("/repo", options as never),
    ).rejects.toThrow(/disk unavailable/);
    expect(options._spies.spawnHeavy).not.toHaveBeenCalled();
  });

  it("rechecks the exact candidate immediately before spawning", async () => {
    let captureCount = 0;
    const options = greenOptions({
      captureCandidate: async () => {
        captureCount += 1;
        return {
          ok: true as const,
          candidate:
            captureCount === 1
              ? candidate
              : { ...candidate, treeSha: "tree-raced" },
        };
      },
    });
    const result = await runHarnessGateAdmission("/repo", options as never);
    expect(result.status).toBe("candidate_changed");
    expect(options._spies.spawnHeavy).not.toHaveBeenCalled();
  });

  it.each([
    { field: "id", value: undefined },
    { field: "id", value: "" },
    { field: "id", value: "Malformed ID" },
    { field: "reviewSensitive", value: undefined },
    { field: "reviewSensitive", value: "yes" },
  ])("fails closed for malformed scenario $field", ({ field, value }) => {
    const scenario = HARNESS_APP_REGISTRY[0].validationScenarios[0] as unknown as
      Record<string, unknown>;
    const original = scenario[field];
    scenario[field] = value;
    try {
      expect(() => defaultScenarios()).toThrow(/validation scenario/i);
    } finally {
      scenario[field] = original;
    }
  });

  it("rejects unsafe invocation ids before evaluating or spawning", async () => {
    const evaluatePreparation = vi.fn();
    const options = greenOptions({
      invocationId: "../../outside",
      evaluatePreparation,
    });

    await expect(
      runHarnessGateAdmission("/repo", options as never),
    ).rejects.toThrow(/invocation id/i);
    expect(evaluatePreparation).not.toHaveBeenCalled();
    expect(options._spies.spawnHeavy).not.toHaveBeenCalled();
  });

  it("writes events inside the Git-private directory without overwriting", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "athena-admission-"));
    temporaryDirectories.push(rootDir);
    await execFileAsync("git", ["init", "--quiet"], {
      cwd: rootDir,
      env: withoutGitRepositoryContext(),
    });
    const options = greenOptions();
    await runHarnessGateAdmission("/repo", options as never);
    const event = options._spies.writeDecisionEvent.mock.calls[0][1];

    const destination = await writeHarnessGateDecisionEvent(rootDir, event);
    const gitDir = path.join(rootDir, ".git");
    expect(path.relative(gitDir, destination)).toBe(
      path.join(
        "codex/harness-obligations/v1/events",
        "invocation-a--evaluated.json",
      ),
    );
    expect(JSON.parse(await readFile(destination, "utf8"))).toMatchObject({
      invocationId: "invocation-a",
      sequence: "evaluated",
    });
    await expect(
      writeHarnessGateDecisionEvent(rootDir, event),
    ).rejects.toMatchObject({ code: "EEXIST" });
  });
});
