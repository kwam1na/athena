import { describe, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ATHENA_LEGACY_CONFIG } from "./harness-base-config";
import { wireRepo } from "../.agent-skills/current/runtime/cli-api.mjs";
import type { DeliveryRecord } from "../.agent-skills/current/runtime/kernel.mjs";
import {
  createValidationCiRuntime,
  type ValidationCiAdapterPorts,
} from "./harness-validation-ci-adapter";
import { projectValidationPolicy } from "./harness-validation-policy";
import { selectionEnvironment } from "./harness-validation-runtime";
import {
  runNativeValidation,
  verifyNativeValidation,
  type NativeValidationInput,
  type NativeValidationResult,
} from "./harness-validation-native";
import type { NativeValidationSelection } from "./harness-validation-load";
import type { HealthSnapshot } from "./harness-validation-health";
import type { ValidationPlan } from "./harness-validation-plan";

const healthy = (revision = "health-1"): HealthSnapshot => ({
  schemaVersion: "athena-validation-health/1",
  revision,
  observedAt: Date.now(),
  availability: "available",
  lastComplete: {
    runId: 1,
    headSha: "a".repeat(40),
    outcome: "success",
    completedAt: Date.now(),
  },
  findings: [],
  closedFindings: [],
});

async function fixture(
  test: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>,
  qualify = false,
) {
  const f = await setup(qualify);
  try {
    await test(f);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
}
async function setup(qualify: boolean) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "athena-ci-adapter-")),
  );
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.test");
  await writeFile(join(root, ".gitignore"), "artifacts/\n");
  await writeFile(join(root, "check.sh"), "#!/bin/sh\nexit 0\n");
  await mkdir(join(root, "scripts"));
  await writeFile(
    join(root, "scripts/harness-validation-selection-guard.mjs"),
    await readFile(
      new URL("./harness-validation-selection-guard.mjs", import.meta.url),
    ),
  );
  git("add", ".");
  git("commit", "-qm", "fixture");
  const sha = git("rev-parse", "HEAD");
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
  const native = await wireRepo(root, {
    ...ATHENA_LEGACY_CONFIG,
    baseRef: sha,
  });
  const captured = await native.captureCandidate();
  if (!captured.ok) throw new Error(JSON.stringify(captured.blockers));
  const plan = (mode: "comparison" | "full-health"): ValidationPlan => ({
    schemaVersion: "athena-validation-plan/1",
    mode,
    authority: "legacy-gate",
    evidence: "not-evaluated",
    digest: mode,
    changes: [{ path: "check.sh", status: "modified" }],
    checks: [
      {
        id: "check",
        profile: "command",
        cwd: ".",
        argv: ["/bin/sh", "check.sh"],
        membership: [],
        inputs: ["check.sh"],
        absentInputs: [],
        prerequisites: [],
        supersedes: [],
        identity: "check-identity",
        reasons: [],
        coveredChecks: ["check"],
      },
    ],
  });
  const selection = (
    mode: "comparison" | "full-health",
  ): NativeValidationSelection => ({
    schemaVersion: "athena-native-selection/1",
    candidate: captured.candidate,
    plan: plan(mode),
    inventory: ["check.sh", "scripts/harness-validation-selection-guard.mjs"],
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
  const context = (mode: "comparison" | "full-health", health = healthy()) => ({
    invocationId: `owner/repo:20:1:${mode}`,
    health,
  });
  const makeResult = (input: NativeValidationInput): NativeValidationResult => {
    const selectedAttempts = Object.entries(input.checkIdToProviderId).map(
      ([checkId, providerId], index) => ({
        checkId,
        providerId,
        attempt: {
          version: "scoped-attempt/1" as const,
          providerId,
          attemptId: `attempt-${index}`,
          generation: 1,
          inputDigest: "input",
          profileDigest: "profile",
          status: "passed" as const,
          origin: {
            runId: "native-run",
            candidate: {
              treeSha: captured.candidate.treeSha,
              baseRef: sha,
              baseTipSha: sha,
              mergeBaseSha: sha,
              workspaceId: captured.candidate.workspaceId,
              identityToken: input.config.computingIdentityVersion,
              deliverableDigest: captured.candidate.deliverable.digest,
            },
          },
        },
        observation: {
          version: "scoped-runtime/1" as const,
          runtimeDigest: "runtime",
          flags: {
            ATHENA_VALIDATION_INVOCATION:
              input.env.ATHENA_VALIDATION_INVOCATION!,
            ATHENA_VALIDATION_HEALTH_REVISION:
              input.env.ATHENA_VALIDATION_HEALTH_REVISION!,
          },
          credentials: {},
        },
        checkBinding: {
          definitionDigest: "definition",
          validationDigest: "validation",
          policyDigest: "policy",
          wiringFingerprint: "wiring",
          outputsDigest: "outputs",
        },
      }),
    );
    return {
      status: "verified",
      recordRef: join(root, "artifacts/validation-ci/native-fixture.json"),
      record: {} as DeliveryRecord,
      selectedAttempts,
      observations: {
        version: "scoped-check-observations/1",
        providers: selectedAttempts.map((row) => ({
          providerId: row.providerId,
          attempts: [row.attempt],
        })),
      },
      beforeObservations: {
        version: "scoped-check-observations/1",
        providers: selectedAttempts.map((row) => ({
          providerId: row.providerId,
          attempts: [],
        })),
      },
      phases: [{ phase: "verify", exitCode: 0 }],
    };
  };
  let last: NativeValidationResult | undefined;
  const ports: ValidationCiAdapterPorts = {
    controllerRoot: root,
    env: {
      PATH: process.env.PATH,
      ...(qualify ? { VALIDATION_GUARD_BASE_SHA: sha } : {}),
    },
    authenticate: async () => binding,
    loadLegacy: async () => ({
      ...ATHENA_LEGACY_CONFIG,
      preparationCommands: [],
      preparationWiringPaths: [],
      additionalReviewLenses: [],
    }),
    captureSelection: async (_root, _config, mode) => selection(mode),
    guard: async () => ({
      binding,
      selection: selection("comparison"),
      readiness: "scoped",
      reason: "unchanged-authority",
      changedControllerPaths: [],
    }),
    configure: (_root, base, mode, env) => {
      if (mode === "delivery")
        throw new Error("Fixture supports hosted modes only");
      const current = selection(mode);
      Object.assign(env!, selectionEnvironment(current));
      const projected = projectValidationPolicy(base, current.plan, {
        profiles: [
          {
            id: "plain",
            gitContext: "none",
            dependencyInputs: [],
            mutableOutputs: [],
            credentialIdentities: {},
          },
        ],
        profileByCheck: { check: "plain" },
        mechanicalChecks: [],
      });
      return {
        ...projected,
        config: { ...projected.config, preparationWiringPaths: [] },
        selection: current,
      };
    },
    executeNative: async (input) => (last = makeResult(input)),
    verifyNative: async () => {
      if (!last) throw new Error("No fixture execution");
      return last;
    },
  };
  const runtime = async (overrides: ValidationCiAdapterPorts = {}) => {
    const api = await createValidationCiRuntime(root, {
      ...ports,
      ...overrides,
    });
    await api.healthInventory(sha);
    return api;
  };
  return {
    root,
    binding,
    ports,
    runtime,
    plan,
    context,
    selection,
    makeResult,
    git,
    getLast: () => last,
  };
}

describe("native CI adapter boundaries", () => {
  it("does not accept a mutated plan body with an unchanged digest label", async () =>
    fixture(async (f) => {
      const api = await f.runtime();
      const plan = await api.recomputePlan(f.binding, "full-health", healthy());
      const altered = structuredClone(plan);
      altered.checks[0].identity = "forged";
      await expect(
        api.execute(altered, f.binding, f.context("full-health")),
      ).rejects.toThrow("plan");
    }));
  it("does not expose its stored plan for mutation", async () =>
    fixture(async (f) => {
      const api = await f.runtime();
      const plan = await api.recomputePlan(f.binding, "full-health", healthy());
      plan.checks[0].identity = "forged";
      await expect(
        api.execute(plan, f.binding, f.context("full-health")),
      ).rejects.toThrow("plan");
    }));
  it("clears previous execution evidence when a later native invocation throws", async () =>
    fixture(async (f) => {
      let calls = 0;
      const api = await f.runtime({
        executeNative: async (input) => {
          if (++calls === 2) throw new Error("native startup failed");
          return f.makeResult(input);
        },
      });
      const plan = await api.recomputePlan(f.binding, "full-health", healthy());
      await api.execute(plan, f.binding, f.context("full-health"));
      await expect(
        api.execute(plan, f.binding, f.context("full-health")),
      ).rejects.toThrow("startup");
      expect(
        (await api.readFailureObservations(plan, f.binding)).every(
          (row) => row.outcome === "unavailable",
        ),
      ).toBe(true);
    }));
  it("cannot upgrade an old partial verification into full-health admission", async () =>
    fixture(async (f) => {
      const api = await f.runtime();
      const health = healthy();
      const partial = await api.recomputePlan(f.binding, "comparison", health);
      await api.execute(partial, f.binding, f.context("comparison", health));
      await api.verifyExecution(partial, f.binding);
      const full = await api.recomputePlan(f.binding, "full-health", health);
      await expect(
        api.verifyHealthAdmission(full, f.binding, {
          planned: health,
          current: {
            ...health,
            availability: "missing-seed",
            lastComplete: undefined,
          },
        }),
      ).rejects.toThrow();
    }, true));
  it("does not call a preexisting full-health attempt freshly executed", async () =>
    fixture(async (f) => {
      let result: NativeValidationResult;
      const api = await f.runtime({
        executeNative: async (input) => {
          result = f.makeResult(input);
          result.beforeObservations = structuredClone(result.observations);
          return result;
        },
        verifyNative: async () => result,
      });
      const plan = await api.recomputePlan(f.binding, "full-health", healthy());
      await api.execute(plan, f.binding, f.context("full-health"));
      await expect(api.verifyExecution(plan, f.binding)).rejects.toThrow();
    }));
  it("rejects a caller-supplied invocation prefix outside the authenticated run", async () =>
    fixture(async (f) => {
      const api = await f.runtime();
      const plan = await api.recomputePlan(f.binding, "full-health", healthy());
      await expect(
        api.execute(plan, f.binding, {
          ...f.context("full-health"),
          invocationId: "other/repo:99:1:full-health",
        }),
      ).rejects.toThrow("invocation");
    }));
  it("does not report new attempts for another candidate as this candidate's success", async () =>
    fixture(async (f) => {
      const api = await f.runtime({
        executeNative: async (input) => {
          const r = f.makeResult(input);
          for (const provider of r.observations.providers)
            for (const attempt of provider.attempts)
              (attempt.origin.candidate as { treeSha: string }).treeSha =
                "f".repeat(40);
          return {
            status: "failed",
            phase: "gate",
            exitCode: 1,
            observations: r.observations,
            beforeObservations: r.beforeObservations,
            phases: r.phases,
          };
        },
      });
      const plan = await api.recomputePlan(f.binding, "full-health", healthy());
      await expect(
        api.execute(plan, f.binding, f.context("full-health")),
      ).rejects.toThrow();
      expect(
        (await api.readFailureObservations(plan, f.binding))[0].outcome,
      ).toBe("unavailable");
    }));
});

it("requires fresh repair evidence when a relevant health revision changes", async () =>
  fixture(async (f) => {
    const api = await f.runtime();
    const health = healthy();
    const plan = await api.recomputePlan(f.binding, "full-health", health);
    await api.execute(plan, f.binding, f.context("full-health", health));
    await api.verifyExecution(plan, f.binding);
    const late: HealthSnapshot = {
      ...health,
      revision: "health-2",
      findings: [
        {
          id: "failure",
          revision: "failure-2",
          checkId: "check",
          scope: { kind: "repo" },
          runId: 21,
          headSha: f.binding.headSha,
        },
      ],
    };
    await expect(
      api.verifyHealthAdmission(plan, f.binding, {
        planned: health,
        current: late,
      }),
    ).rejects.toThrow("health refused");
  }));
it("accepts verified full inventory for its planned missing-seed revision", async () =>
  fixture(async (f) => {
    const api = await f.runtime();
    const health: HealthSnapshot = {
      ...healthy(),
      availability: "missing-seed",
      lastComplete: undefined,
    };
    const plan = await api.recomputePlan(f.binding, "comparison", health);
    expect(plan.mode).toBe("full-health");
    await api.execute(plan, f.binding, f.context("full-health", health));
    await api.verifyExecution(plan, f.binding);
    await api.verifyHealthAdmission(plan, f.binding, {
      planned: health,
      current: health,
    });
  }));
it("fails closed when the protected inventory moved after it was loaded", async () =>
  fixture(async (f) => {
    const api = await f.runtime({
      authenticate: async () => ({
        ...f.binding,
        defaultMainSha: "f".repeat(40),
      }),
    });
    await expect(
      api.recomputePlan(f.binding, "full-health", healthy()),
    ).rejects.toThrow("binding moved");
  }));
it("an unchanged revision does not let callers mutate stored execution health", async () =>
  fixture(async (f) => {
    const api = await f.runtime();
    const health = healthy();
    const plan = await api.recomputePlan(f.binding, "full-health", health);
    await api.execute(plan, f.binding, f.context("full-health", health));
    await api.verifyExecution(plan, f.binding);
    health.revision = "caller-mutated";
    await expect(
      api.verifyHealthAdmission(plan, f.binding, {
        planned: health,
        current: health,
      }),
    ).rejects.toThrow("planned revision");
  }));
it(
  "uses the actual public native lifecycle and health admission through the adapter",
  async () =>
    fixture(async (f) => {
      const log: string[] = [];
      const api = await f.runtime({
        executeNative: async (input) => {
          const result = await runNativeValidation({
            ...input,
            stdout: (text) => log.push(text),
            stderr: (text) => log.push(text),
          });
          if (result.status !== "verified")
            throw new Error(JSON.stringify({ result, log }));
          return result;
        },
        verifyNative: verifyNativeValidation,
      });
      const health: HealthSnapshot = {
        ...healthy(),
        availability: "missing-seed",
        lastComplete: undefined,
      };
      const plan = await api.recomputePlan(f.binding, "full-health", health);
      await api.execute(plan, f.binding, f.context("full-health", health));
      const verified = await api.verifyExecution(plan, f.binding);
      const transported = JSON.parse(
        await readFile(
          join(f.root, "artifacts/validation-ci/delivery-record.json"),
          "utf8",
        ),
      );
      expect(transported).toEqual(
        JSON.parse(await readFile(verified.recordRef, "utf8")),
      );
      expect(verified.checks).toHaveLength(1);
      expect(verified.checks[0]).toMatchObject({
        outcome: "success",
        originalExitCode: 0,
        execution: "executed",
        attributed: false,
      });
      await api.verifyHealthAdmission(plan, f.binding, {
        planned: health,
        current: health,
      });
    }),
  20000,
);
it(
  "retains actual native check failure with unknown original numeric exit",
  async () =>
    fixture(async (f) => {
      await writeFile(
        join(f.root, "check.sh"),
        `#!/bin/sh\necho '{"status":"passed"}'\nexit 9\n`,
      );
      f.git("add", ".");
      f.git("commit", "-qm", "failing check");
      const sha = f.git("rev-parse", "HEAD");
      // Use a new fixture binding and captured selection for the changed committed source.
      const binding = {
        ...f.binding,
        headSha: sha,
        baseSha: sha,
        defaultMainSha: sha,
      };
      const captured = await (
        await wireRepo(f.root, { ...ATHENA_LEGACY_CONFIG, baseRef: sha })
      ).captureCandidate();
      if (!captured.ok) throw new Error(JSON.stringify(captured.blockers));
      const selected = f.selection("full-health");
      selected.candidate = captured.candidate;
      const api = await createValidationCiRuntime(f.root, {
        ...f.ports,
        authenticate: async () => binding,
        captureSelection: async () => selected,
        configure: (root, base, mode, env, capture) => {
          const projected = f.ports.configure!(root, base, mode, env, capture);
          Object.assign(env!, selectionEnvironment(selected));
          return { ...projected, selection: selected };
        },
        executeNative: runNativeValidation,
        verifyNative: verifyNativeValidation,
      });
      await api.healthInventory(sha);
      const plan = await api.recomputePlan(binding, "full-health", healthy());
      await expect(
        api.execute(plan, binding, f.context("full-health")),
      ).rejects.toThrow("Native validation failed");
      const rows = await api.readFailureObservations(plan, binding);
      expect(rows[0]).toMatchObject({
        outcome: "failure",
        originalExitCode: null,
        attributed: false,
        execution: "executed",
      });
    }),
  20000,
);

it("requires the verified selection guard to bind the executed health revision", async () =>
  fixture(async (f) => {
    let result: NativeValidationResult;
    const api = await f.runtime({
      executeNative: async (input) => {
        result = f.makeResult(input);
        if (result.status === "verified")
          result.selectedAttempts.find(
            (row) => row.checkId === "__selection_guard",
          )!.observation = {
            ...result.selectedAttempts.find(
              (row) => row.checkId === "__selection_guard",
            )!.observation,
            flags: {
              ATHENA_VALIDATION_INVOCATION:
                input.env.ATHENA_VALIDATION_INVOCATION!,
              ATHENA_VALIDATION_HEALTH_REVISION: "different-health",
            },
          };
        return result;
      },
      verifyNative: async () => result,
    });
    const plan = await api.recomputePlan(f.binding, "full-health", healthy());
    await api.execute(plan, f.binding, f.context("full-health"));
    await expect(api.verifyExecution(plan, f.binding)).rejects.toThrow(
      "health revision",
    );
  }));
