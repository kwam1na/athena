import { describe, expect, it } from "vitest";
import base from "./harness-base-config";
import { projectValidationPolicy } from "./harness-validation-policy";
import type { ValidationPlan } from "./harness-validation-plan";

const check = (id: string, prerequisites: string[] = []) => ({
  id,
  argv: ["bun", "run", id],
  cwd: ".",
  profile: "fixture",
  membership: ["src/example.test.ts"],
  inputs: ["src/example.ts"],
  absentInputs: ["src/removed.ts"],
  prerequisites,
  supersedes: [],
  identity: id,
  reasons: ["fixture"],
  coveredChecks: [id],
});
const plan = (
  checks = [check("build", ["types"]), check("types")],
): ValidationPlan => ({
  schemaVersion: "athena-validation-plan/1",
  authority: "legacy-gate",
  mode: "comparison",
  changes: [],
  checks,
  evidence: "not-evaluated",
  digest: "fixture",
});
const execution = {
  profiles: [
    {
      id: "fixture-full",
      gitContext: "full" as const,
      dependencyInputs: ["package.json"],
      mutableOutputs: ["dist/"],
      credentialIdentities: {},
    },
  ],
  profileByCheck: { types: "fixture-full", build: "fixture-full" },
  mechanicalChecks: ["types"],
};

describe("native validation policy projection", () => {
  it("creates one mandatory obligation per check in prerequisite order and retains nonvalidation policy", () => {
    const result = projectValidationPolicy(base, plan(), execution);
    expect(result.checks.map((entry) => entry.checkId)).toEqual([
      "types",
      "build",
    ]);
    expect(
      result.config.obligations.some(
        (entry) => entry.id === "validation.passed",
      ),
    ).toBe(false);
    for (const original of base.obligations.filter(
      (entry) => entry.id !== "validation.passed",
    ))
      expect(result.config.obligations).toContainEqual(original);
    for (const entry of result.checks) {
      const obligation = result.config.obligations.find(
        (item) => item.id === entry.obligationId,
      )!;
      expect(obligation.providers).toEqual([entry.providerId]);
      expect(obligation.humanWaiverAllowed).toBe(false);
      expect(obligation.allowedResolutionKinds).toEqual(["satisfied_evidence"]);
      const provider = result.config.providers.find(
        (item) => item.id === entry.providerId,
      )!;
      expect(provider.check?.scope?.files).toEqual([
        "src/example.ts",
        "src/removed.ts",
      ]);
      expect(provider.check?.scope?.memberships).toEqual(["src/"]);
      expect(provider.check?.scope?.tests).toEqual(["src/example.test.ts"]);
    }
    expect(result.config.scopedExecution?.mechanicalProviders).toEqual([
      "athena.selection-guard",
      result.checks[0].providerId,
    ]);
    expect(result.config.providers[0].id).toBe("athena.selection-guard");
    expect(
      result.config.scopedExecution?.profiles[0].dependencies,
    ).toBeUndefined();
    expect(result.config.scopedExecution?.profiles[0].gitContext).toBe("full");
  });
  it("refuses missing profiles, unknown mechanics, missing prerequisites and cycles", () => {
    expect(() =>
      projectValidationPolicy(base, plan(), {
        ...execution,
        profileByCheck: {},
      }),
    ).toThrow();
    expect(() =>
      projectValidationPolicy(base, plan(), {
        ...execution,
        mechanicalChecks: ["missing"],
      }),
    ).toThrow();
    expect(() =>
      projectValidationPolicy(
        base,
        plan([check("build", ["missing"])]),
        execution,
      ),
    ).toThrow();
    expect(() =>
      projectValidationPolicy(
        base,
        plan([check("build", ["types"]), check("types", ["build"])]),
        execution,
      ),
    ).toThrow();
  });
  it("does not run a nonmechanical prerequisite after its mechanical dependent", () => {
    expect(() =>
      projectValidationPolicy(base, plan(), {
        ...execution,
        mechanicalChecks: ["build"],
      }),
    ).toThrow();
  });
  it("resolves canonical aliases after check partitioning", () => {
    const types = { ...check("types"), coveredChecks: ["old-types"] };
    const result = projectValidationPolicy(
      base,
      plan([types, check("build", ["old-types"])]),
      execution,
    );
    expect(result.checks.map((entry) => entry.checkId)).toEqual([
      "types",
      "build",
    ]);
  });
});

it("binds the exact runner implementation outside the application source scope", () => {
  const unit = {
    ...check("unit"),
    cwd: "packages/athena-webapp",
    profile: "packages/athena-webapp:unit",
    argv: ["bun", "run", "test", "--"],
    membership: ["packages/athena-webapp/src/a.test.ts"],
    inputs: ["packages/athena-webapp/src/a.ts"],
  };
  const result = projectValidationPolicy(base, plan([unit]), {
    ...execution,
    profileByCheck: { unit: "fixture-full" },
    mechanicalChecks: [],
    packageScripts: {
      "packages/athena-webapp": { test: "vitest run --maxWorkers=4" },
    },
  });
  const provider = result.config.providers.find(
    (item) => item.id === result.checks[0].providerId,
  )!;
  expect(provider.check?.scope?.files).toContain(
    "scripts/harness-vitest-membership.mjs",
  );
});

it("keeps private interpreter selection out of authoring repairs", () => {
  const result = projectValidationPolicy(base, plan(), execution);
  for (const repair of result.config.scopedExecution?.repairCommands ?? []) {
    expect(repair.command.slice(0, 3)).toEqual([
      "env",
      "-u",
      "ATHENA_GRAPHIFY_PYTHON",
    ]);
  }
});
