import { expect, it } from "vitest";
import { ATHENA_LEGACY_CONFIG } from "../harness.config";
import { projectValidationPolicy } from "./harness-validation-policy";
import {
  createCiValidationConfiguration,
  healthCandidateScopes,
} from "./harness-validation-ci-policy";
import type { ValidationPlan } from "./harness-validation-plan";

const plan: ValidationPlan = {
  schemaVersion: "athena-validation-plan/1",
  mode: "full-health",
  authority: "legacy-gate",
  evidence: "not-evaluated",
  digest: "fixture",
  changes: [],
  checks: [
    {
      id: "unit",
      profile: "unit",
      cwd: ".",
      argv: ["bun", "test"],
      membership: [],
      inputs: ["src/a.ts"],
      absentInputs: [],
      prerequisites: [],
      supersedes: [],
      identity: "fixture",
      reasons: [],
      coveredChecks: ["unit"],
    },
  ],
};

it("separates native CI validation claims from delivery review and artifact identity", () => {
  const projected = projectValidationPolicy(ATHENA_LEGACY_CONFIG, plan, {
    profiles: [
      {
        id: "fixture",
        gitContext: "full",
        dependencyInputs: [],
        mutableOutputs: ["artifacts/"],
        credentialIdentities: {},
      },
    ],
    profileByCheck: { unit: "fixture" },
    mechanicalChecks: [],
  });
  const ci = createCiValidationConfiguration(projected.config, true);
  expect(ci.gateId).toBe("athena.validation-ci");
  expect(ci.computingIdentityVersion).toBe("athena-validation-ci/v1");
  expect(ci.recordNeutral).toEqual([
    { prefix: "artifacts/validation-ci/", suffix: ".json" },
  ]);
  expect(ci.reviewNeutral).toEqual(ci.recordNeutral);
  expect(ci.deliveryRecordPath).toBe(
    "artifacts/validation-ci/delivery-record.json",
  );
  expect(ci.scopedExecution?.repairCommands).toEqual([]);
  expect(
    ci.obligations.every((item) => item.id.startsWith("validation.")),
  ).toBe(true);
  expect(ci.providers.every((item) => item.check?.scope)).toBe(true);
  expect(
    ci.providers
      .filter((item) =>
        item.check?.scope?.environment.some(
          (entry) => entry.name === "ATHENA_VALIDATION_HEALTH_REVISION",
        ),
      )
      .map((item) => item.id),
  ).toEqual(["athena.selection-guard"]);
  expect(
    ci.providers.every((item) =>
      item.check!.scope!.environment.some(
        (item) => item.name === "ATHENA_VALIDATION_INVOCATION",
      ),
    ),
  ).toBe(true);
  expect(ATHENA_LEGACY_CONFIG.computingIdentityVersion).toBe(
    "deliverable-tree/v1",
  );
});

it("treats root policy changes conservatively and groups package health scopes", () => {
  expect(
    healthCandidateScopes([{ path: "scripts/x.ts", status: "modified" }]),
  ).toEqual([{ kind: "repo" }]);
  expect(
    healthCandidateScopes([
      { path: "packages/storefront-webapp/src/a.ts", status: "modified" },
    ]),
  ).toEqual([{ kind: "package", package: "packages/storefront-webapp" }]);
  expect(
    healthCandidateScopes([
      { path: "docs/reports/a.html", status: "modified" },
    ]),
  ).toEqual([{ kind: "paths", package: ".", paths: ["docs/reports/a.html"] }]);
});
