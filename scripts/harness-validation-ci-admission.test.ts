import { expect, it } from "vitest";
import { admitFinalValidationHealth } from "./harness-validation-ci-admission";
import type { ValidationPlan } from "./harness-validation-plan";
import type { VerifiedHostedValidation } from "./harness-validation-ci";
import type { HealthSnapshot } from "./harness-validation-health";

function fixture() {
  const binding = {
    repository: "owner/repo",
    runId: 10,
    runAttempt: 1,
    headSha: "a".repeat(40),
    baseSha: "b".repeat(40),
  };
  const plan: ValidationPlan = {
    schemaVersion: "athena-validation-plan/1",
    mode: "full-health",
    authority: "legacy-gate",
    evidence: "not-evaluated",
    digest: "plan",
    changes: [{ path: "scripts/a.ts", status: "modified" }],
    checks: [
      {
        id: "unit",
        profile: ".:unit",
        cwd: ".",
        argv: ["bun", "test"],
        membership: [],
        inputs: [],
        absentInputs: [],
        prerequisites: [],
        supersedes: [],
        identity: "identity",
        reasons: [],
        coveredChecks: ["unit"],
      },
    ],
  };
  const verified: VerifiedHostedValidation = {
    ...binding,
    planDigest: "plan",
    recordRef: "native-record",
    checks: [
      {
        ...binding,
        checkId: "unit",
        identity: "identity",
        profile: ".:unit",
        outcome: "success",
        originalExitCode: 0,
        attributed: false,
        execution: "executed",
      },
    ],
  };
  const health: HealthSnapshot = {
    schemaVersion: "athena-validation-health/1",
    revision: "original",
    observedAt: Date.now(),
    availability: "missing-seed",
    findings: [],
    closedFindings: [],
  };
  return {
    plan,
    verified,
    health,
    candidateRef: "tree",
    plannedHealthRevision: "original",
  };
}

it("allows native complete full-health against its actual bound missing-seed revision", () => {
  expect(admitFinalValidationHealth(fixture()).status).toBe("eligible");
});
it("does not relabel a complete proof when unavailable health changes", () => {
  const input = fixture();
  input.health.revision = "new";
  expect(() => admitFinalValidationHealth(input)).toThrow("health");
});
it("does not let comparison mode discharge unknown health", () => {
  const input = fixture();
  input.plan.mode = "comparison";
  expect(() => admitFinalValidationHealth(input)).toThrow("health");
});
it("requires all raw successful checks and new execution for a full-health proof", () => {
  for (const mutate of [
    (v: VerifiedHostedValidation) => {
      v.checks = [];
    },
    (v: VerifiedHostedValidation) => {
      v.checks[0].attributed = true;
    },
    (v: VerifiedHostedValidation) => {
      v.checks[0].originalExitCode = 9;
    },
    (v: VerifiedHostedValidation) => {
      v.checks[0].execution = "reused";
    },
    (v: VerifiedHostedValidation) => {
      v.checks[0].identity = "foreign";
    },
    (v: VerifiedHostedValidation) => {
      v.checks[0].headSha = "foreign";
    },
  ]) {
    const input = fixture();
    mutate(input.verified);
    expect(() => admitFinalValidationHealth(input)).toThrow("verified");
  }
});
it("preserves an intersecting failure until the exact current revision has repair evidence", () => {
  const input = fixture();
  input.plan.mode = "comparison";
  input.health.availability = "available";
  input.health.lastComplete = {
    runId: 9,
    headSha: "b".repeat(40),
    outcome: "success",
    completedAt: Date.now(),
  };
  input.health.findings = [
    {
      id: "failure",
      revision: "finding-revision",
      checkId: "unit",
      scope: { kind: "repo" },
      runId: 9,
      headSha: "b".repeat(40),
    },
  ];
  expect(() => admitFinalValidationHealth(input)).toThrow("health");
  input.plan.mode = "full-health";
  expect(admitFinalValidationHealth(input).status).toBe("eligible");
  input.health.revision = "new";
  expect(() => admitFinalValidationHealth(input)).toThrow("health");
  expect(input.health.findings).toHaveLength(1);
});
