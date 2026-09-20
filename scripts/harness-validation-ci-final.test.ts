import { describe, expect, it } from "bun:test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  copyFile,
  rm,
  realpath,
  symlink,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  defineHarnessConfig,
  GATE_STRUCTURAL_FINDING_CODES,
  resolveRecordStorage,
} from "../.agent-skills/current/runtime/kernel.mjs";
import { wireRepo } from "../.agent-skills/current/runtime/cli-api.mjs";
import {
  runNativeValidation,
  verifyNativeValidation,
} from "./harness-validation-native";
import { createCiValidationConfiguration } from "./harness-validation-ci-policy";
import { buildValidationPlan } from "./harness-validation-plan";
import { verifyFinalHostedValidation } from "./harness-validation-ci-final";
import type { FinalValidationPorts } from "./harness-validation-ci-final";

async function fixture(mode: "comparison" | "full-health" = "full-health") {
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "athena-cold-final-")),
  );
  const hot = path.join(root, "hot"),
    baseRoot = path.join(root, "base"),
    candidateRoot = path.join(root, "candidate");
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  await mkdir(hot);
  git(hot, "init", "-q", "-b", "main");
  git(hot, "config", "user.name", "Fixture");
  git(hot, "config", "user.email", "fixture@example.test");
  await writeFile(path.join(hot, ".gitignore"), "artifacts/\n");
  await writeFile(path.join(hot, "check.sh"), "#!/bin/sh\nexit 0\n");
  git(hot, "add", ".");
  git(hot, "commit", "-qm", "fixture");
  const sha = git(hot, "rev-parse", "HEAD");
  const legacyBase = {
    gateId: "fixture",
    baseRef: sha,
    storageNamespace: "cold-final/",
    acceptedEnvelopeSpecs: ["delivery-evidence/1"],
    identityVersions: ["fixture/v1"],
    computingIdentityVersion: "fixture/v1",
    reviewNeutral: [{ prefix: "artifacts/validation-ci/", suffix: ".json" }],
    recordNeutral: [{ prefix: "artifacts/validation-ci/", suffix: ".json" }],
    pathClassification: { generated: [], test: [], lockfile: [] },
    sensitivePaths: [],
    activationThreshold: 1,
    agentEnvSignals: [],
    ciPolicies: [],
    ciPolicyEnvKey: "FIXTURE_POLICY",
    preparationWiringPaths: [],
    preparationCommands: [],
    providers: [],
    obligations: [],
    deliveryRecordPath: "artifacts/validation-ci/delivery-record.json",
    deliveryRecordVerification: { baseMovement: "stale" as const },
  };
  const ids = ["athena.selection-guard", "native.unit"];
  const projected = defineHarnessConfig({
    ...legacyBase,
    scopedExecution: {
      version: "scoped-execution/1",
      profiles: [
        {
          id: "plain",
          dependencyInputs: [],
          mutableOutputs: [],
          credentialIdentities: {},
          gitContext: "none",
        },
      ],
      mechanicalProviders: [],
    },
    providers: ids.map((id) => ({
      id,
      findingCodes: [],
      check: {
        command: ["/bin/sh", "check.sh"],
        timeoutMs: 10000,
        scope: {
          version: "scoped-check/1",
          files: ["check.sh"],
          memberships: [],
          tests: [],
          cwd: ".",
          profile: "plain",
          environment: [],
        },
      },
    })),
    obligations: ids.map((id, i) => ({
      id: `validation.${i}`,
      activation: { kind: "always" },
      freshness: "exact_candidate",
      providers: [id],
      acceptedPayloadSpecs: ["checks.passed/1"],
      allowedResolutionKinds: ["satisfied_evidence"],
      humanWaiverAllowed: false,
      minimumAttestationLevel: "self",
      ciDelegationPolicyIds: [],
      waivableCodes: [],
      nonWaivableCodes: [...GATE_STRUCTURAL_FINDING_CODES],
      remediation: {
        default: [{ id: "repair", kind: "manual_action", summary: "Repair" }],
      },
    })),
  });
  const { scopedExecution: _scoped, ...legacyConfig } = projected;
  const invocation =
    "owner/repo:20:1:full-health:00000000-0000-4000-8000-000000000001";
  const config = createCiValidationConfiguration(
    projected,
    mode === "full-health",
  );
  const binding = {
    repository: "owner/repo",
    runId: 20,
    runAttempt: 1,
    headSha: sha,
    baseSha: sha,
    defaultMainSha: sha,
    defaultBranch: "main",
    workflowId: 42,
  };
  const env = {
    PATH: process.env.PATH,
    VALIDATION_GUARD_BASE_SHA: sha,
    GITHUB_WORKSPACE: root,
    GITHUB_EVENT_NAME: "workflow_dispatch",
    ATHENA_VALIDATION_INVOCATION: invocation,
    ATHENA_VALIDATION_HEALTH_REVISION: "a".repeat(64),
  };
  const mapping = { __selection_guard: ids[0], unit: ids[1] };
  const built = await runNativeValidation({
    rootDir: hot,
    config,
    env,
    binding,
    checkIdToProviderId: mapping,
  });
  if (built.status !== "verified") throw Error(JSON.stringify(built));
  git(root, "clone", "-q", hot, baseRoot);
  git(root, "clone", "-q", hot, candidateRoot);
  await mkdir(path.join(candidateRoot, "artifacts/validation-ci"), {
    recursive: true,
  });
  const recordPath = path.join(
    candidateRoot,
    "artifacts/validation-ci/delivery-record.json",
  );
  await copyFile(built.recordRef, recordPath);
  const captured = await (
    await wireRepo(candidateRoot, legacyConfig)
  ).captureCandidate();
  if (!captured.ok) throw Error("capture");
  const makePlan = (selectedMode: typeof mode) =>
    buildValidationPlan(
      {
        schemaVersion: "athena-validation-registry/1",
        alwaysRequired: ["unit"],
        surfaces: [],
        checks: [
          {
            id: "unit",
            profile: "unit",
            argv: ["/bin/sh", "check.sh"],
            cwd: ".",
            membership: [],
            inputs: ["check.sh"],
            absentInputs: [],
            prerequisites: [],
            supersedes: [],
          },
        ],
      },
      [],
      selectedMode,
    );
  const selection = (selectedMode: typeof mode) => ({
    schemaVersion: "athena-native-selection/1" as const,
    candidate: captured.candidate,
    plan: makePlan(selectedMode),
    inventory: [".gitignore", "check.sh"],
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
  let guardCalls = 0;
  const ports: FinalValidationPorts = {
    guard: async () => {
      guardCalls++;
      return {
        binding,
        selection: selection("comparison"),
        readiness: "scoped",
        reason: "unchanged-authority",
        changedControllerPaths: [],
      };
    },
    capture: async (_root, _config, selectedMode) => selection(selectedMode),
    configure: (_root, _legacy, _mode, _env, capture) => ({
      config: projected,
      checks: [
        { checkId: "unit", providerId: ids[1], obligationId: "validation.1" },
      ],
      selection: capture!(candidateRoot, legacyConfig, mode),
    }),
  };
  return {
    root,
    hot,
    baseRoot,
    candidateRoot,
    legacyConfig,
    mode,
    env,
    binding,
    ports,
    config,
    recordPath,
    built,
    selection,
    guardCalls: () => guardCalls,
  };
}

describe("trusted cold final verification", () => {
  it.each(["comparison", "full-health"] as const)(
    "verifies real portable %s evidence without any local attempt store",
    async (mode) => {
      const f = await fixture(mode);
      try {
        const result = await verifyFinalHostedValidation(f, f.ports);
        expect(result.verified.planDigest).toBe(f.selection(mode).plan.digest);
        expect(result.verified.checks[0]).toMatchObject({
          checkId: "unit",
          originalExitCode: 0,
          attributed: false,
          execution: mode === "full-health" ? "executed" : "reused",
        });
        expect(result.native.phases).toEqual([
          { phase: "verify", exitCode: 0 },
        ]);
        expect(f.guardCalls()).toBe(2);
        expect(result.plannedHealthRevision).toBe("a".repeat(64));
        expect(result.candidate.treeSha).toBe(
          f.selection(mode).candidate.treeSha,
        );
        expect(result.selectedAttempts).toHaveLength(2);
      } finally {
        await rm(f.root, { recursive: true, force: true });
      }
    },
    30000,
  );
  it("refuses changed authority before reading or trusting uploaded artifacts", async () => {
    const f = await fixture();
    try {
      f.ports.guard = async () => ({
        binding: f.binding,
        selection: null,
        readiness: "legacy",
        reason: "changed-authority",
        changedControllerPaths: ["scripts/controller.ts"],
      });
      await expect(verifyFinalHostedValidation(f, f.ports)).rejects.toThrow(
        "unchanged",
      );
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  }, 30000);
  it("rejects a preexisting attempt store even for an unrelated provider", async () => {
    const f = await fixture();
    try {
      const storage = await resolveRecordStorage(f.candidateRoot, {
        storageNamespace: f.config.storageNamespace,
        leaf: "scoped-attempts",
      });
      await mkdir(storage.storageDir, { recursive: true });
      await writeFile(path.join(storage.storageDir, "unrelated"), "local");
      await expect(verifyFinalHostedValidation(f, f.ports)).rejects.toThrow(
        "attempt store",
      );
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  }, 30000);
  it("rejects record symlinks rather than following uploaded paths", async () => {
    const f = await fixture();
    try {
      await rm(f.recordPath);
      await symlink(f.built.recordRef, f.recordPath);
      await expect(verifyFinalHostedValidation(f, f.ports)).rejects.toThrow(
        "record",
      );
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  }, 30000);
  it("does not accept uploaded success JSON as a portable native record", async () => {
    const f = await fixture();
    try {
      await writeFile(
        f.recordPath,
        JSON.stringify({
          verified: true,
          plan: f.selection(f.mode).plan,
          status: "success",
        }),
      );
      await expect(verifyFinalHostedValidation(f, f.ports)).rejects.toThrow();
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  }, 30000);
  it("rejects a record from a different authenticated invocation", async () => {
    const f = await fixture();
    try {
      const guard = f.ports.guard!;
      f.ports.guard = async (...args) => ({
        ...(await guard(...args)),
        binding: { ...f.binding, runId: 21 },
      });
      await expect(verifyFinalHostedValidation(f, f.ports)).rejects.toThrow(
        "invocation",
      );
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  }, 30000);
  it("refuses a failed native verifier without projecting success", async () => {
    const f = await fixture();
    try {
      f.ports.verify = async (input) => {
        const result = await verifyNativeValidation(input);
        return { ...result, status: "failed", phase: "verify", exitCode: 7 };
      };
      await expect(verifyFinalHostedValidation(f, f.ports)).rejects.toThrow(
        "verification",
      );
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  }, 30000);
});

// These ports mutate an actual successful cold native result to exercise the
// controller's independent defenses against future verifier regressions.
describe("final controller defense boundaries", () => {
  it.each([
    "missing-check",
    "guard-health",
    "invocation",
    "raw-failure",
  ] as const)(
    "rejects %s in selected native evidence",
    async (fault) => {
      const f = await fixture();
      try {
        f.ports.verify = async (input) => {
          const result = await verifyNativeValidation(input);
          if (result.status !== "verified") throw Error(JSON.stringify(result));
          if (fault === "missing-check") result.selectedAttempts.pop();
          if (fault === "guard-health")
            Object.assign(
              result.selectedAttempts.find(
                (row) => row.checkId === "__selection_guard",
              )!.observation.flags,
              { ATHENA_VALIDATION_HEALTH_REVISION: "b".repeat(64) },
            );
          if (fault === "invocation")
            Object.assign(
              result.selectedAttempts.find((row) => row.checkId === "unit")!
                .observation.flags,
              { ATHENA_VALIDATION_INVOCATION: "other" },
            );
          if (fault === "raw-failure") {
            for (const claim of result.record.claims)
              for (const row of [
                ...(claim.evidence ? [claim.evidence] : []),
                ...(claim.supportingEvidence ?? []),
              ]) {
                if (
                  row.resolution.kind !== "evidence" ||
                  !row.resolution.portable
                )
                  continue;
                const artifacts = row.resolution.portable.artifacts;
                const raw = JSON.parse(
                  Buffer.from(
                    artifacts["check-result.json"],
                    "base64",
                  ).toString(),
                );
                raw.originalExitCode = 7;
                raw.attributed = true;
                Object.assign(artifacts, {
                  "check-result.json": Buffer.from(
                    JSON.stringify(raw),
                  ).toString("base64"),
                });
              }
          }
          return result;
        };
        await expect(verifyFinalHostedValidation(f, f.ports)).rejects.toThrow();
      } finally {
        await rm(f.root, { recursive: true, force: true });
      }
    },
    30000,
  );
  it("refuses a changed authenticated binding after successful verification", async () => {
    const f = await fixture();
    try {
      const guard = f.ports.guard!;
      f.ports.guard = async (...args) => {
        const result = await guard(...args);
        return f.guardCalls() > 1
          ? { ...result, binding: { ...result.binding, runAttempt: 2 } }
          : result;
      };
      await expect(verifyFinalHostedValidation(f, f.ports)).rejects.toThrow(
        "moved",
      );
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  }, 30000);
  it("does not accept tampered portable native claims", async () => {
    const f = await fixture();
    try {
      const record = JSON.parse(await readFile(f.recordPath, "utf8"));
      record.claims = record.claims.filter(
        (row: { obligationId: string }) => row.obligationId !== "validation.1",
      );
      await writeFile(f.recordPath, JSON.stringify(record));
      await expect(verifyFinalHostedValidation(f, f.ports)).rejects.toThrow();
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  }, 30000);
  it("refuses a projection missing a canonical planned check", async () => {
    const f = await fixture();
    try {
      const configure = f.ports.configure!;
      f.ports.configure = (...args) => ({ ...configure(...args), checks: [] });
      await expect(verifyFinalHostedValidation(f, f.ports)).rejects.toThrow(
        "mapping",
      );
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  }, 30000);
});
