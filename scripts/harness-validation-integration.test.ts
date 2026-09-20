import { describe, expect, it } from "vitest";
import {
  copyFile,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, join, posix } from "node:path";
import { tmpdir } from "node:os";
import {
  defineHarnessConfig,
  GATE_STRUCTURAL_FINDING_CODES,
} from "../.agent-skills/current/runtime/kernel.mjs";
import { buildValidationPlan } from "./harness-validation-plan";
import { projectValidationPolicy } from "./harness-validation-policy";
import { runNativeValidation } from "./harness-validation-native";
import {
  reportFollowupScenarios,
  qualificationFile,
  qualificationUnit,
  type QualificationScenario,
} from "./fixtures/affected-validation/qualification-corpus";

type NativeResult = Awaited<ReturnType<typeof runNativeValidation>> & {
  output: string;
};

function passed(result: NativeResult) {
  if (result.status !== "verified")
    throw new Error(`Native lifecycle failed: ${JSON.stringify(result)}`);
  expect(result.phases.map((phase) => phase.phase)).toEqual([
    "prepare",
    "gate",
    "record",
    "verify",
  ]);
  return result;
}

function attempt(result: ReturnType<typeof passed>, checkId: string) {
  const selected = result.selectedAttempts.find(
    (row) => row.checkId === checkId,
  );
  if (!selected) throw new Error(`Missing selected check ${checkId}`);
  return selected.attempt.attemptId;
}

async function fixture(
  run: (
    execute: (scenario: QualificationScenario) => Promise<NativeResult>,
  ) => Promise<void>,
) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "athena-integration-")),
  );
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const writeSnapshot = async (snapshot: Record<string, string>) => {
    for (const [file, text] of Object.entries(snapshot)) {
      await mkdir(dirname(join(root, file)), { recursive: true });
      await writeFile(join(root, file), text);
    }
  };
  const commit = () => {
    git("add", ".");
    git("-c", "commit.gpgsign=false", "commit", "-qm", "Synthetic candidate");
  };
  try {
    git("init", "-q", "-b", "main");
    git("config", "user.name", "Fixture");
    git("config", "user.email", "fixture@example.invalid");
    await writeFile(join(root, ".gitignore"), "artifacts/\n");
    await mkdir(join(root, "scripts"));
    await copyFile(
      join(import.meta.dirname, "harness-validation-selection-guard.mjs"),
      join(root, "scripts/harness-validation-selection-guard.mjs"),
    );
    await writeSnapshot(reportFollowupScenarios()[0].snapshots.base);
    commit();
    const base = git("rev-parse", "HEAD");
    const legacy = defineHarnessConfig({
      gateId: "fixture.integration",
      baseRef: base,
      storageNamespace: "integration-fixture/",
      acceptedEnvelopeSpecs: ["delivery-evidence/1"],
      identityVersions: ["fixture-integration/v1"],
      computingIdentityVersion: "fixture-integration/v1",
      reviewNeutral: [{ prefix: "artifacts/", suffix: ".json" }],
      recordNeutral: [{ prefix: "artifacts/", suffix: ".json" }],
      pathClassification: { generated: [], test: [], lockfile: [] },
      sensitivePaths: [],
      activationThreshold: 1,
      agentEnvSignals: [],
      ciPolicies: [],
      ciPolicyEnvKey: "FIXTURE_POLICY",
      preparationWiringPaths: [],
      preparationCommands: [],
      providers: [
        {
          id: "athena.validation",
          findingCodes: [],
          check: { command: ["bun", "--version"], timeoutMs: 1000 },
        },
      ],
      obligations: [
        {
          id: "validation.passed",
          activation: { kind: "always" },
          freshness: "exact_candidate",
          providers: ["athena.validation"],
          acceptedPayloadSpecs: ["checks.passed/1"],
          allowedResolutionKinds: ["satisfied_evidence"],
          humanWaiverAllowed: false,
          minimumAttestationLevel: "self",
          ciDelegationPolicyIds: [],
          waivableCodes: [],
          nonWaivableCodes: [...GATE_STRUCTURAL_FINDING_CODES],
          remediation: {
            default: [
              {
                id: "repair",
                kind: "manual_action",
                summary: "Repair synthetic fixture",
              },
            ],
          },
        },
      ],
      deliveryRecordPath: "artifacts/validation-ci/record.json",
      deliveryRecordVerification: { baseMovement: "stale" },
    });
    await run(async (scenario) => {
      await writeSnapshot(scenario.snapshots.candidate);
      commit();
      const plan = buildValidationPlan(
        scenario.registry,
        scenario.changes,
        "comparison",
        scenario.snapshots,
      );
      const projected = projectValidationPolicy(legacy, plan, {
        profiles: [
          {
            id: "toy-bun",
            gitContext: "none",
            dependencyInputs: [],
            mutableOutputs: [],
            credentialIdentities: {},
          },
        ],
        profileByCheck: Object.fromEntries(
          plan.checks.map((check) => [check.id, "toy-bun"]),
        ),
        mechanicalChecks: [],
        environment: [],
      });
      const providers = projected.config.providers.map((provider) => {
        const mapping = projected.checks.find(
          (row) => row.providerId === provider.id,
        );
        if (!mapping) return provider; // Preserve the real full-Git selection guard.
        const check = plan.checks.find((row) => row.id === mapping.checkId)!;
        // These fixtures use bun:test, not Athena Vitest. Exact planned members
        // are argv as well as native scope.tests; never invoke a whole suite.
        const command: [string, ...string[]] = check.membership.length
          ? [
              "bun",
              "test",
              ...check.membership.map(
                (file) => `./${posix.relative(check.cwd, file)}`,
              ),
            ]
          : [
              "bun",
              "-e",
              'const fs=require("fs"); for(const f of fs.readdirSync("../../docs/reports")){if(!fs.readFileSync("../../docs/reports/"+f,"utf8").includes("<article>")) process.exit(9)}',
            ];
        return { ...provider, check: { ...provider.check!, command } };
      });
      const config = defineHarnessConfig({
        ...projected.config,
        providers,
        preparationWiringPaths: [
          "scripts/harness-validation-selection-guard.mjs",
        ],
      });
      const head = git("rev-parse", "HEAD");
      let output = "";
      const result = await runNativeValidation({
        stdout: (text) => {
          output += text;
        },
        stderr: (text) => {
          output += text;
        },
        rootDir: root,
        config,
        binding: { headSha: head, baseSha: base },
        env: {
          PATH: process.env.PATH,
          ATHENA_SELECTION_HEAD: head,
          ATHENA_SELECTION_TREE: git("rev-parse", "HEAD^{tree}"),
          ATHENA_SELECTION_BASE: base,
          ATHENA_SELECTION_MERGE_BASE: base,
        },
        checkIdToProviderId: Object.fromEntries([
          ["__selection_guard", "athena.selection-guard"],
          ...projected.checks.map((row) => [row.checkId, row.providerId]),
        ]),
      });
      return Object.assign(result, { output });
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("planner to native evidence integration", () => {
  it("reuses independent attempts across report changes and preserves successes through app failure and repair", async () => {
    await fixture(async (execute) => {
      const [code, modified, added] = reportFollowupScenarios();
      const initial = passed(await execute(code));
      const original = attempt(initial, qualificationUnit);
      const appProvider = initial.selectedAttempts.find(
        (row) => row.checkId === qualificationUnit,
      )!.providerId;
      const report = passed(await execute(modified));
      expect(attempt(report, qualificationUnit)).toBe(original);
      const publishing = report.selectedAttempts.filter(
        (row) =>
          row.checkId !== qualificationUnit &&
          row.checkId !== "__selection_guard",
      );
      expect(publishing.length).toBeGreaterThan(0);
      const newReport = passed(await execute(added));
      expect(attempt(newReport, qualificationUnit)).toBe(original);
      for (const row of publishing) {
        expect(attempt(newReport, row.checkId)).not.toBe(row.attempt.attemptId);
      }
      const fault = structuredClone(added);
      fault.snapshots.candidate[qualificationFile("value.ts")] =
        "export const value = 99;";
      const failed = await execute(fault);
      expect(failed.status).toBe("failed");
      if (failed.status !== "failed")
        throw new Error("Fault unexpectedly passed");
      expect(failed.phase).toBe("gate");
      expect("recordRef" in failed).toBe(false);
      expect(
        failed.phases.some(
          (phase) => phase.phase === "record" || phase.phase === "verify",
        ),
      ).toBe(false);
      const priorAttempts = new Set(
        failed.beforeObservations.providers.flatMap((row) =>
          row.attempts.map((attempt) => attempt.attemptId),
        ),
      );
      const failures = failed.observations.providers
        .filter((row) => row.providerId === appProvider)
        .flatMap((row) => row.attempts)
        .filter(
          (row) => row.status === "failed" && !priorAttempts.has(row.attemptId),
        );
      expect(failures).toHaveLength(1);
      // The public failed-attempt observation exposes identity/status, not raw
      // command stderr. Require the public CLI diagnostic for this exact provider.
      expect(failed.output).toContain(
        `[check_command_failed] Declared scoped check ${appProvider} did not complete successfully (exit 1).`,
      );
      const repaired = passed(await execute(added));
      for (const row of newReport.selectedAttempts.filter(
        (row) => row.checkId !== "__selection_guard",
      )) {
        expect(attempt(repaired, row.checkId)).toBe(row.attempt.attemptId);
      }
      const retained = repaired.observations.providers.flatMap(
        (row) => row.attempts,
      );
      for (const failure of failures) {
        expect(
          retained.some(
            (row) =>
              row.attemptId === failure.attemptId && row.status === "failed",
          ),
        ).toBe(true);
      }
    });
  }, 120000);
});
