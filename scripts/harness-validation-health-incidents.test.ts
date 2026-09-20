import { expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ATHENA_LEGACY_CONFIG } from "./harness-base-config";
import { wireRepo } from "../.agent-skills/current/runtime/cli-api.mjs";
import { createValidationHealthDigest } from "./harness-validation-ci";
import { createValidationCiRuntime } from "./harness-validation-ci-adapter";
import { chooseLocalValidationMode } from "./harness-validation-local-health";
import {
  evaluateValidationHealth,
  readValidationHealth,
  type HealthPolicy,
  type HealthSnapshot,
} from "./harness-validation-health";
import { buildValidationPlan } from "./harness-validation-plan";
import type { NativeValidationSelection } from "./harness-validation-load";
import {
  createHealthIncidentReport,
  renderHealthIncidentReport,
} from "./harness-validation-health-incidents";

const scope = { kind: "package" as const, package: "packages/athena-webapp" };
const policy: HealthPolicy = {
  repository: "owner/repo",
  defaultBranch: "main",
  workflowId: 42,
  workflowPath: ".github/workflows/athena-validation-health.yml",
  artifactName: "health",
  classificationPath: ".agents/health-classifications.json",
  checks: [{ checkId: "unit", scope }],
};
const now = Date.now();
const empty: HealthSnapshot = {
  schemaVersion: "athena-validation-health/1",
  revision: "seed",
  observedAt: now,
  availability: "missing-seed",
  historyComplete: true,
  findings: [],
  closedFindings: [],
};

// The only executed check is a tiny assertion. Hosted calls and product execution
// are injected boundaries: this proves orchestration, not hosted/native qualification.
test("failed check creates an owned incident and broadens the next local and hosted plans without candidate closure", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "health-incident-")),
  );
  try {
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
    git("init", "-q", "-b", "main");
    git("config", "user.name", "Fixture");
    git("config", "user.email", "fixture@example.invalid");
    await writeFile(join(root, "README.md"), "fixture\n");
    git("add", ".");
    git("-c", "commit.gpgsign=false", "commit", "-qm", "fixture");
    const sha = git("rev-parse", "HEAD");
    const run = {
      repository: policy.repository,
      runId: 20,
      runAttempt: 1,
      headSha: sha,
    };
    const failure = spawnSync(
      "bun",
      [
        "-e",
        'import assert from "node:assert/strict"; const leaf=99; const consumer=()=>leaf; assert.equal(consumer(),42,"downstream regression");',
      ],
      { encoding: "utf8" },
    );
    expect(failure.status).toBe(1);
    expect(failure.stderr).toContain("downstream regression");
    const digest = createValidationHealthDigest({
      policy,
      run,
      previous: empty,
      bootstrap: true,
      observations: [
        {
          ...run,
          checkId: "unit",
          outcome: "failure",
          originalExitCode: failure.status,
          attributed: false,
          execution: "executed",
        },
      ],
    });
    const read = async (candidateClassification: boolean) =>
      readValidationHealth(policy, {
        now,
        // A candidate-supplied closure, even transported in the main document,
        // has no independent approval capability and cannot close this finding.
        requestJson: async (url) => {
          if (url.includes("/commits/")) return { sha };
          if (url.includes("/contents/"))
            return {
              encoding: "base64",
              content: Buffer.from(
                JSON.stringify({
                  schemaVersion: "athena-health-classifications/1",
                  entries: candidateClassification
                    ? [
                        {
                          findingId: digest.findings[0].id,
                          findingRevision: digest.findings[0].revision,
                          reference: "candidate:close",
                          revalidationRunId: 21,
                        },
                      ]
                    : [],
                }),
              ).toString("base64"),
            };
          if (url.includes("/artifacts"))
            return {
              total_count: 1,
              artifacts: [
                {
                  id: 99,
                  name: policy.artifactName,
                  expired: false,
                  workflow_run: { id: run.runId, head_sha: sha },
                },
              ],
            };
          return {
            total_count: 1,
            workflow_runs: [
              {
                id: run.runId,
                run_attempt: 1,
                workflow_id: 42,
                path: policy.workflowPath,
                head_branch: "main",
                head_sha: sha,
                event: "schedule",
                status: "completed",
                conclusion: "failure",
                updated_at: new Date(now).toISOString(),
                repository: { full_name: policy.repository },
                head_repository: { full_name: policy.repository },
              },
            ],
          };
        },
        loadArtifact: async () => digest,
      });
    const health = await read(false);
    expect(health.availability).toBe("available");
    expect(health.findings).toHaveLength(1);
    const report = createHealthIncidentReport(digest, policy, health);
    expect(report.incidents[0]).toMatchObject({
      finding: { ...digest.findings[0], scope },
      classification: "pending",
    });
    expect(report.owner).toBe("Athena repository maintainer");
    expect(report.triageBy).toBe("next working day");
    expect(report.incidents[0].runUrl).toBe(
      "https://github.com/owner/repo/actions/runs/20",
    );
    expect(renderHealthIncidentReport(report)).toContain("selection miss");
    const api = await wireRepo(root, { ...ATHENA_LEGACY_CONFIG, baseRef: sha });
    const captured = await api.captureCandidate();
    if (!captured.ok) throw new Error(JSON.stringify(captured.blockers));
    const binding = {
      ...run,
      runId: 22,
      baseSha: sha,
      defaultMainSha: sha,
      defaultBranch: "main",
      workflowId: 43,
    };
    let change = "packages/athena-webapp/src/value.ts";
    const selection = (
      mode: "comparison" | "full-health",
    ): NativeValidationSelection => ({
      schemaVersion: "athena-native-selection/1",
      candidate: captured.candidate,
      plan: buildValidationPlan(
        {
          schemaVersion: "athena-validation-registry/1",
          alwaysRequired: ["unit"],
          surfaces: [
            {
              id: "fixture",
              pathPrefixes: ["packages"],
              checks: ["unit"],
              reason: "fixture source",
            },
          ],
          checks: [
            {
              id: "unit",
              profile: "packages/athena-webapp:unit",
              cwd: ".",
              argv: ["bun", "test"],
              membership: [],
              inputs: ["README.md"],
              absentInputs: [],
              prerequisites: [],
              supersedes: [],
            },
          ],
        },
        [{ path: change, status: "modified" }],
        mode,
      ),
      inventory: ["README.md"],
      packageScripts: {},
      timing: {
        initialCaptureMs: 0,
        baseSnapshotMs: 0,
        candidateSnapshotMs: 0,
        planningMs: 0,
        finalCaptureMs: 0,
        totalMs: 0,
      },
    });
    const hosted = await createValidationCiRuntime(root, {
      controllerRoot: root,
      env: { VALIDATION_GUARD_BASE_SHA: sha },
      authenticate: async () => binding,
      loadLegacy: async () => ATHENA_LEGACY_CONFIG,
      captureSelection: async (_root, _config, mode) => selection(mode),
      guard: async () => ({
        binding,
        selection: selection("comparison"),
        readiness: "scoped",
        reason: "unchanged-authority",
        changedControllerPaths: [],
      }),
      executeNative: async () => {
        throw new Error("No native execution permitted in this fixture");
      },
    });
    await hosted.healthInventory(sha);
    const plans = async (expected: "comparison" | "full-health") => {
      expect(
        chooseLocalValidationMode(
          health,
          [{ path: change, status: "modified" }],
          "comparison",
          now,
        ),
      ).toBe(expected);
      expect(
        (await hosted.recomputePlan(binding, "comparison", health)).mode,
      ).toBe(expected);
    };
    await plans("full-health");
    change = "packages/storefront-webapp/src/other.ts";
    await plans("comparison");
    change = "packages/athena-webapp/src/repair.ts";
    const finding = health.findings[0];
    const candidate = {
      candidateRef: "repair",
      profile: "local" as const,
      scopes: [scope],
    };
    const proof = {
      candidateRef: "repair",
      profile: "local" as const,
      healthRevision: health.revision,
      findingId: finding.id,
      findingRevision: finding.revision,
      checkId: finding.checkId,
      scope,
      outcome: "success" as const,
      evidenceRef: "fixture:verified-repair",
    };
    // Verified-proof input is a fixture capability, not a claim of native proof.
    expect(
      evaluateValidationHealth({ health, candidate, proofs: [proof], now })
        .status,
    ).toBe("eligible");
    expect(health.findings).toHaveLength(1);
    expect(
      evaluateValidationHealth({
        health,
        candidate: { ...candidate, candidateRef: "second" },
        proofs: [proof],
        now,
      }).status,
    ).toBe("repair-required");
    await plans("full-health");
    expect((await read(true)).findings).toEqual(health.findings);
    expect(digest.checks[0].outcome).toBe("failure");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("incident presentation distinguishes unavailable inventory, unknown scope and authenticated closed history", () => {
  const digest = createValidationHealthDigest({
    policy,
    run: {
      repository: policy.repository,
      runId: 20,
      runAttempt: 1,
      headSha: "a".repeat(40),
    },
    previous: empty,
    bootstrap: true,
    observations: [],
  });
  const report = createHealthIncidentReport(digest, policy, empty);
  expect(report.inventoryComplete).toBe(false);
  expect(report.incidents).toEqual([]);
  expect(renderHealthIncidentReport(report)).toContain(
    "no successful inventory is claimed",
  );
  const finding = {
    id: "prior",
    revision: "r1",
    checkId: "removed-check",
    runId: 10,
    headSha: "b".repeat(40),
  };
  digest.findings.push(finding);
  expect(
    createHealthIncidentReport(digest, policy, empty).incidents[0].finding
      .scope,
  ).toEqual({ kind: "repo" });
  const closed = {
    ...empty,
    closedFindings: [
      {
        finding: { ...finding, scope },
        reference: "verified-main-approval",
        mainSha: "c".repeat(40),
        revalidationRunId: 19,
      },
    ],
  };
  expect(createHealthIncidentReport(digest, policy, closed).incidents).toEqual(
    [],
  );
  expect(digest.findings).toEqual([finding]);
  expect(() =>
    createHealthIncidentReport(
      { ...digest, repository: "other/repo" },
      policy,
      empty,
    ),
  ).toThrow("protected policy");
});

test("setup failure produces owned actionable output without a digest or trusted finding", async () => {
  const workflow = await readFile(
    new URL(
      "../.github/workflows/athena-validation-health.yml",
      import.meta.url,
    ),
    "utf8",
  );
  const step = workflow
    .split("      - name: Surface owned health triage\n")[1]
    .split("      - name:")[0];
  expect(step).toContain("if: always()");
  const script = step
    .split("        run: |\n")[1]
    .split("\n")
    .map((line) => line.replace(/^          /, ""))
    .join("\n");
  const root = await mkdtemp(join(tmpdir(), "health-setup-failure-"));
  try {
    const summary = join(root, "summary.md");
    const result = spawnSync("bash", ["-e", "-c", script], {
      cwd: root,
      env: {
        ...process.env,
        GITHUB_STEP_SUMMARY: summary,
        HEALTH_RUN_URL:
          "https://github.com/owner/repo/actions/runs/20/attempts/1",
        HEALTH_HEAD: "a".repeat(40),
      },
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    const body = await readFile(summary, "utf8");
    expect(body).toContain("Athena repository maintainer");
    expect(body).toContain("next working day");
    expect(body).toContain(
      "No trusted finding or successful inventory is claimed",
    );
    expect(body).toContain("actions/runs/20/attempts/1");
    expect(
      await readFile(
        join(root, "artifacts/validation-ci/health-incidents.md"),
        "utf8",
      ),
    ).toBe(body);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
