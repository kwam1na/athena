import { describe, expect, test } from "bun:test";
import {
  createValidationHealthDigest,
  createVerifiedValidationHealthDigest,
  summarizeHostedValidation,
  REQUIRED_VALIDATION_CONTEXTS,
  parseValidationCiArgs,
  resolveHostedValidationBinding,
  runValidationCiCli,
  type ValidationCiRuntime,
  type HealthObservation,
} from "./harness-validation-ci";
import { buildValidationPlan } from "./harness-validation-plan";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { HealthPolicy, HealthSnapshot } from "./harness-validation-health";
import {
  HEALTH_HISTORY_CHECK_ID,
  evaluateValidationHealth,
} from "./harness-validation-health";

const sha = "a".repeat(40);
const policy: HealthPolicy = {
  repository: "kwam1na/athena",
  defaultBranch: "main",
  workflowId: 42,
  workflowPath: ".github/workflows/athena-pr-tests.yml",
  artifactName: "health",
  classificationPath: ".agents/health-classifications.json",
  checks: ["unit", "aggregate-coverage", "production"].map((checkId) => ({
    checkId,
    scope: { kind: "repo" },
  })),
};
const run = {
  repository: policy.repository,
  runId: 20,
  runAttempt: 1,
  headSha: sha,
};
const previous = (): HealthSnapshot => ({
  schemaVersion: "athena-validation-health/1",
  revision: "prior",
  observedAt: 1,
  availability: "available",
  historyComplete: true,
  findings: [
    {
      id: "old",
      revision: "old-rev",
      checkId: "unit",
      scope: { kind: "repo" },
      runId: 10,
      headSha: sha,
    },
  ],
  closedFindings: [],
  lastComplete: { runId: 10, headSha: sha, outcome: "failure", completedAt: 1 },
});
const results = (): HealthObservation[] =>
  policy.checks.map(({ checkId }) => ({
    ...run,
    checkId,
    outcome: "success",
    originalExitCode: 0,
    execution: "executed",
    attributed: false,
  }));
const produce = (observations = results(), history = previous()) =>
  createValidationHealthDigest({
    policy,
    run,
    observations,
    previous: history,
  });

describe("hosted CLI request and authenticated binding", () => {
  test("parses explicit qualification/health modes and refuses unsupported flags", () => {
    expect(parseValidationCiArgs(["qualify"])).toEqual({
      command: "qualify",
      bootstrap: false,
      recoverUnknownHistory: false,
    });
    expect(
      parseValidationCiArgs([
        "health",
        "--bootstrap",
        "--recover-unknown-history",
      ]),
    ).toEqual({
      command: "health",
      bootstrap: true,
      recoverUnknownHistory: true,
    });
    for (const args of [
      [],
      ["unknown"],
      ["qualify", "--bootstrap"],
      ["health", "--input", "forged.json"],
      ["health", "--bootstrap", "--bootstrap"],
    ])
      expect(() => parseValidationCiArgs(args)).toThrow("Usage");
  });
  function bindingFixture() {
    const env = {
      GITHUB_REPOSITORY: policy.repository,
      GITHUB_RUN_ID: "20",
      GITHUB_RUN_ATTEMPT: "1",
      GITHUB_SHA: sha,
      GITHUB_EVENT_NAME: "workflow_dispatch",
      GITHUB_REF: "refs/heads/main",
    };
    const metadata = {
      id: 20,
      run_attempt: 1,
      head_sha: sha,
      event: "workflow_dispatch",
      head_branch: "main",
      workflow_id: 42,
      path: ".github/workflows/athena-validation-health.yml",
      repository: { full_name: policy.repository },
      head_repository: { full_name: policy.repository },
    };
    const workflow = { id: 42 };
    const pull = {
      base: {
        sha: "c".repeat(40),
        ref: "main",
        repo: { full_name: policy.repository },
      },
      head: { sha, repo: { full_name: policy.repository } },
    };
    const request = async (endpoint: string): Promise<unknown> =>
      endpoint.includes("/actions/workflows/")
        ? { ...workflow, path: metadata.path }
        : endpoint.endsWith("/actions/runs/20")
          ? metadata
          : endpoint.endsWith("/commits/main")
            ? { sha: "b".repeat(40) }
            : endpoint.endsWith(policy.repository)
              ? { default_branch: "main" }
              : pull;
    return { env, metadata, workflow, pull, request };
  }
  test.each(["health", "qualify"] as const)(
    "%s binds the exact workflow endpoint identity",
    async (command) => {
      const f = bindingFixture();
      if (command === "qualify")
        f.metadata.path = ".github/workflows/athena-pr-tests.yml";
      const endpoint = `/repos/${policy.repository}/actions/workflows/${command === "health" ? "athena-validation-health.yml" : "athena-pr-tests.yml"}`;
      const seen: string[] = [];
      await resolveHostedValidationBinding(command, f.env, async (path) => {
        seen.push(path);
        return f.request(path);
      });
      expect(seen).toContain(endpoint);
      for (const response of [
        null,
        {},
        { id: 43, path: f.metadata.path },
        { id: "42", path: f.metadata.path },
        { id: 42, path: ".github/workflows/other.yml" },
      ]) {
        await expect(
          resolveHostedValidationBinding(command, f.env, async (path) =>
            path === endpoint ? response : f.request(path),
          ),
        ).rejects.toThrow("workflow");
      }
      await expect(
        resolveHostedValidationBinding(command, f.env, async (path) => {
          if (path === endpoint)
            throw new Error("workflow endpoint unavailable");
          return f.request(path);
        }),
      ).rejects.toThrow("unavailable");
    },
  );
  test.each([
    {
      base: {
        sha: "c".repeat(40),
        ref: "other",
        repo: { full_name: policy.repository },
      },
    },
    {
      base: {
        sha: "c".repeat(40),
        ref: "main",
        repo: { full_name: "other/repo" },
      },
    },
    { base: { sha: "c".repeat(40), ref: "main", repo: null } },
    { base: { sha: "c".repeat(40), repo: { full_name: policy.repository } } },
    { head: { sha, repo: { full_name: "fork/repo" } } },
    { head: { sha, repo: null } },
    { head: { sha } },
  ])(
    "rejects a PR outside the authenticated repository/default branch: %j",
    async (patch) => {
      const f = bindingFixture();
      f.metadata.event = "pull_request";
      f.metadata.path = ".github/workflows/athena-pr-tests.yml";
      Object.assign(f.pull, patch);
      await expect(
        resolveHostedValidationBinding(
          "qualify",
          {
            ...f.env,
            GITHUB_EVENT_NAME: "pull_request",
            VALIDATION_PR_NUMBER: "123",
          },
          f.request,
        ),
      ).rejects.toThrow("Pull request");
    },
  );
  test("binds actual run and protected default branch without uploaded local coordinates", async () => {
    const f = bindingFixture();
    expect(
      await resolveHostedValidationBinding("health", f.env, f.request),
    ).toMatchObject({
      ...run,
      baseSha: "b".repeat(40),
      workflowId: 42,
      defaultBranch: "main",
    });
  });
  test("a changed base cannot reuse the earlier independent guard", async () => {
    const f = bindingFixture();
    f.metadata.path = ".github/workflows/athena-pr-tests.yml";
    await expect(
      resolveHostedValidationBinding(
        "qualify",
        { ...f.env, VALIDATION_GUARD_BASE_SHA: "c".repeat(40) },
        f.request,
      ),
    ).rejects.toThrow("guard");
  });
  test("PR checkout uses authenticated head instead of GitHub's ambient merge SHA", async () => {
    const f = bindingFixture();
    f.metadata.event = "pull_request";
    f.metadata.path = ".github/workflows/athena-pr-tests.yml";
    const binding = await resolveHostedValidationBinding(
      "qualify",
      {
        ...f.env,
        GITHUB_EVENT_NAME: "pull_request",
        GITHUB_SHA: "d".repeat(40),
        VALIDATION_CANDIDATE_SHA: sha,
        VALIDATION_PR_NUMBER: "123",
      },
      f.request,
    );
    expect(binding.headSha).toBe(sha);
  });
  test.each([
    { head_sha: "d".repeat(40) },
    { run_attempt: 2 },
    { head_repository: { full_name: "fork/repo" } },
    { path: ".github/workflows/other.yml" },
    { head_branch: "feature" },
  ])("health refuses mismatched authenticated run: %j", async (patch) => {
    const f = bindingFixture();
    Object.assign(f.metadata, patch);
    await expect(
      resolveHostedValidationBinding("health", f.env, f.request),
    ).rejects.toThrow();
  });
  test("health refuses reruns and nondefault dispatch, qualification accepts a bound PR base", async () => {
    const f = bindingFixture();
    await expect(
      resolveHostedValidationBinding(
        "health",
        { ...f.env, GITHUB_RUN_ATTEMPT: "2" },
        f.request,
      ),
    ).rejects.toThrow("dispatch a new");
    await expect(
      resolveHostedValidationBinding(
        "health",
        { ...f.env, GITHUB_REF: "refs/heads/feature" },
        f.request,
      ),
    ).rejects.toThrow();
    f.metadata.event = "pull_request";
    f.metadata.path = ".github/workflows/athena-pr-tests.yml";
    const pr = await resolveHostedValidationBinding(
      "qualify",
      {
        ...f.env,
        GITHUB_EVENT_NAME: "pull_request",
        VALIDATION_PR_NUMBER: "123",
      },
      f.request,
    );
    expect(pr.baseSha).toBe("c".repeat(40));
  });
});

describe("hosted CLI runtime wiring", () => {
  async function fixture(command: "health" | "qualify" = "health") {
    const rootDir = await mkdtemp(path.join(tmpdir(), "validation-ci-"));
    const env = {
      GITHUB_REPOSITORY: policy.repository,
      GITHUB_RUN_ID: "20",
      GITHUB_RUN_ATTEMPT: "1",
      GITHUB_SHA: sha,
      GITHUB_EVENT_NAME: "workflow_dispatch",
      GITHUB_REF: "refs/heads/main",
      GITHUB_OUTPUT: path.join(rootDir, "output"),
    };
    const binding = { ...run, baseSha: sha };
    const makePlan = (mode: "comparison" | "full-health") =>
      buildValidationPlan(
        {
          schemaVersion: "athena-validation-registry/1",
          alwaysRequired: ["unit"],
          surfaces: [],
          checks: [
            {
              id: "unit",
              profile: "unit",
              argv: ["bun", "test"],
              cwd: ".",
              membership: ["scripts/unit.test.ts"],
              inputs: ["scripts/unit.ts"],
              absentInputs: [],
              prerequisites: [],
              supersedes: [],
            },
          ],
        },
        [],
        mode,
      );
    const calls: string[] = [];
    const observation = {
      ...run,
      checkId: "unit",
      outcome: "success" as const,
      originalExitCode: 0,
      execution: "executed" as const,
      attributed: false,
    };
    const runtime: ValidationCiRuntime = {
      recomputePlan: async (_binding, mode, health) => {
        expect(health?.revision).toBe("planning");
        calls.push("plan");
        return makePlan(mode);
      },
      healthInventory: async () => makePlan("full-health"),
      execute: async (_plan, _binding, context) => {
        calls.push("execute");
        expect(context.invocationId).toContain(":20:1:");
      },
      verifyExecution: async (plan) => {
        calls.push("verify");
        return {
          ...binding,
          planDigest: plan.digest,
          recordRef: "native:record",
          checks: [
            {
              ...observation,
              identity: plan.checks[0].identity,
              profile: plan.checks[0].profile,
            },
          ],
        };
      },
      readFailureObservations: async () => {
        calls.push("observations");
        return [observation];
      },
      verifyHealthAdmission: async (_plan, _binding, health) => {
        calls.push("admission");
        expect(health.current.revision).toBe("late");
      },
    };
    let reads = 0;
    const readHealth: typeof import("./harness-validation-health").readValidationHealth =
      async () => {
        calls.push("health");
        return { ...previous(), revision: reads++ === 0 ? "planning" : "late" };
      };
    const requestJson = async (endpoint: string): Promise<unknown> =>
      endpoint.includes("/actions/runs/")
        ? {
            id: 20,
            run_attempt: 1,
            head_sha: sha,
            event: "workflow_dispatch",
            head_branch: "main",
            workflow_id: command === "health" ? 42 : 43,
            path:
              command === "health"
                ? ".github/workflows/athena-validation-health.yml"
                : ".github/workflows/athena-pr-tests.yml",
            repository: { full_name: policy.repository },
            head_repository: { full_name: policy.repository },
          }
        : endpoint.includes("/actions/workflows/")
          ? endpoint.endsWith("athena-pr-tests.yml")
            ? { id: 43, path: ".github/workflows/athena-pr-tests.yml" }
            : { id: 42, path: ".github/workflows/athena-validation-health.yml" }
          : endpoint.includes("/commits/")
            ? { sha }
            : { default_branch: "main" };
    return {
      rootDir,
      env,
      runtime,
      readHealth,
      requestJson,
      calls,
      observation,
      makePlan,
      verifyDeliveryTelemetry: async () => {
        calls.push("delivery-telemetry");
      },
    };
  }
  test("cold final command verifies native evidence and current health without executing checks", async () => {
    const f = await fixture("qualify");
    try {
      const env = {
        ...f.env,
        VALIDATION_EXECUTION_RESULT: "success",
        VALIDATION_PLAN_MODE: "full-health",
      };
      let verifiedCalls = 0;
      const plan = f.makePlan("full-health");
      await runValidationCiCli(["verify-final"], {
        ...f,
        env,
        readHealth: async () => ({
          ...previous(),
          revision: "bound",
          availability: "missing-seed",
        }),
        finalVerifier: async () => {
          verifiedCalls++;
          return {
            plan,
            candidate: { treeSha: "tree" },
            plannedHealthRevision: "bound",
            verified: await f.runtime.verifyExecution(plan, {
              ...run,
              baseSha: sha,
            }),
          };
        },
      });
      expect(verifiedCalls).toBe(1);
      expect(f.calls).not.toContain("execute");
      expect(f.calls).toContain("delivery-telemetry");
      expect(await readFile(env.GITHUB_OUTPUT, "utf8")).toContain(
        "verified=true",
      );
    } finally {
      await rm(f.rootDir, { recursive: true, force: true });
    }
  });
  test.each([
    "failed-job",
    "invalid-mode",
    "native-refusal",
    "changed-health",
    "missing-telemetry",
  ])("cold final command withholds success on %s", async (failure) => {
    const f = await fixture("qualify");
    try {
      const env = {
        ...f.env,
        VALIDATION_EXECUTION_RESULT:
          failure === "failed-job" ? "failure" : "success",
        VALIDATION_PLAN_MODE:
          failure === "invalid-mode" ? "uploaded-plan" : "full-health",
      };
      const plan = f.makePlan("full-health");
      await expect(
        runValidationCiCli(["verify-final"], {
          ...f,
          env,
          verifyDeliveryTelemetry: async () => {
            if (failure === "missing-telemetry")
              throw new Error("Current delivery export missing");
          },
          readHealth: async () => ({
            ...previous(),
            revision: failure === "changed-health" ? "new" : "bound",
            availability: "missing-seed",
          }),
          finalVerifier: async () => {
            if (failure === "native-refusal") throw new Error("Native refused");
            return {
              plan,
              candidate: { treeSha: "tree" },
              plannedHealthRevision: "bound",
              verified: await f.runtime.verifyExecution(plan, {
                ...run,
                baseSha: sha,
              }),
            };
          },
        }),
      ).rejects.toThrow();
      expect(
        await readFile(env.GITHUB_OUTPUT, "utf8").catch(() => ""),
      ).not.toContain("verified=true");
      expect(f.calls).not.toContain("execute");
    } finally {
      await rm(f.rootDir, { recursive: true, force: true });
    }
  });
  test.each(["api-unavailable", "intersecting"] as const)(
    "loads protected health before qualification fallback and reuses that snapshot: %s",
    async (condition) => {
      const f = await fixture("qualify");
      const planned: HealthSnapshot = {
        ...previous(),
        revision: "planning",
        availability: condition === "api-unavailable" ? condition : "available",
      };
      const current: HealthSnapshot = {
        ...previous(),
        revision: "late",
        findings: [],
      };
      const order: string[] = [];
      const plans: ReturnType<typeof f.makePlan>[] = [];
      const unitCheck = f.makePlan("comparison").checks[0];
      const fullPlan = buildValidationPlan(
        {
          schemaVersion: "athena-validation-registry/1",
          alwaysRequired: [unitCheck.id],
          surfaces: [],
          checks: [
            unitCheck,
            {
              ...unitCheck,
              id: "other",
              membership: ["scripts/other.test.ts"],
              inputs: ["scripts/other.ts"],
            },
          ],
        },
        [],
        "full-health",
      );
      const verify = f.runtime.verifyExecution;
      f.runtime.verifyExecution = async (plan, binding) => ({
        ...(await verify(plan, binding)),
        checks: plan.checks.map((check) => ({
          ...f.observation,
          checkId: check.id,
          identity: check.identity,
          profile: check.profile,
        })),
      });
      let reads = 0;
      f.runtime.healthInventory = async () => {
        order.push("inventory");
        return fullPlan;
      };
      f.readHealth = async () => {
        order.push("health");
        return reads++ === 0 ? planned : current;
      };
      f.runtime.recomputePlan = async (_binding, mode, health) => {
        order.push("plan");
        expect(mode).toBe("comparison");
        expect(health).toBe(planned);
        const plan = fullPlan;
        plans.push(plan);
        return plan;
      };
      f.runtime.execute = async (plan, _binding, context) => {
        order.push("execute");
        expect(plan.mode).toBe("full-health");
        expect(plan.checks.map((check) => check.id)).toEqual(["other", "unit"]);
        expect(context.health).toBe(planned);
        expect(context.invocationId.endsWith(":full-health")).toBe(true);
      };
      try {
        await runValidationCiCli(["qualify"], f);
        expect(order).toEqual([
          "inventory",
          "health",
          "plan",
          "execute",
          "health",
          "plan",
        ]);
        expect(plans).toHaveLength(2);
        expect(plans[0].digest).toBe(plans[1].digest);
        const summary: Awaited<ReturnType<typeof summarizeHostedValidation>> =
          JSON.parse(
            await readFile(
              path.join(f.rootDir, "artifacts/validation-ci/summary.json"),
              "utf8",
            ),
          );
        expect(
          Object.values(summary.contexts).every(
            (context) => context.conclusion === "success",
          ),
        ).toBe(true);
      } finally {
        await rm(f.rootDir, { recursive: true, force: true });
      }
    },
  );

  test.each([
    ["health", "comparison"],
    ["qualify", "pretend-full"],
  ] as const)(
    "refuses invalid native mode for %s before execution",
    async (command, mode) => {
      const f = await fixture(command);
      f.runtime.recomputePlan = async () =>
        ({ ...f.makePlan("comparison"), mode }) as ReturnType<
          typeof f.makePlan
        >;
      try {
        await expect(runValidationCiCli([command], f)).rejects.toThrow("mode");
        expect(f.calls).not.toContain("execute");
      } finally {
        await rm(f.rootDir, { recursive: true, force: true });
      }
    },
  );

  test("rejects a changed invalid mode during final qualification recomputation", async () => {
    const f = await fixture("qualify");
    let plans = 0;
    f.runtime.recomputePlan = async () =>
      ({
        ...f.makePlan("comparison"),
        mode: plans++ === 0 ? "comparison" : "invalid",
      }) as ReturnType<typeof f.makePlan>;
    try {
      await expect(runValidationCiCli(["qualify"], f)).rejects.toThrow(
        "summary refused",
      );
      expect(f.calls).toContain("execute");
      expect(f.calls).not.toContain("verify");
      const summary: Awaited<ReturnType<typeof summarizeHostedValidation>> =
        JSON.parse(
          await readFile(
            path.join(f.rootDir, "artifacts/validation-ci/summary.json"),
            "utf8",
          ),
        );
      expect(
        Object.values(summary.contexts).every(
          (context) => context.conclusion === "failure",
        ),
      ).toBe(true);
    } finally {
      await rm(f.rootDir, { recursive: true, force: true });
    }
  });

  test("derives package health scope only from an explicit canonical package profile", async () => {
    const f = await fixture();
    const profiles = [
      "packages/athena-webapp:unit",
      "packages/storefront-webapp:package-types",
      "aggregate-coverage",
      "unit",
      "packages/../:unit",
      "packages/athena-webapp",
      "packages/athena-webapp:",
    ];
    f.runtime.healthInventory = async () => {
      const plan = f.makePlan("full-health");
      return {
        ...plan,
        checks: profiles.map((profile, i) => ({
          ...plan.checks[0],
          id: `check-${i}`,
          profile,
          cwd: "packages/athena-webapp",
        })),
      };
    };
    f.readHealth = async (policy) => {
      expect(policy.checks.map((check) => check.scope)).toEqual([
        { kind: "package", package: "packages/athena-webapp" },
        { kind: "package", package: "packages/storefront-webapp" },
        ...profiles.slice(2).map(() => ({ kind: "repo" as const })),
      ]);
      throw new Error("scope inspected");
    };
    try {
      await expect(runValidationCiCli(["health"], f)).rejects.toThrow(
        "scope inspected",
      );
    } finally {
      await rm(f.rootDir, { recursive: true, force: true });
    }
  });

  test("healthy producer uses native verification and final current health before publishing", async () => {
    const f = await fixture();
    try {
      await runValidationCiCli(["health"], f);
      const digest = JSON.parse(
        await readFile(
          path.join(f.rootDir, "artifacts/validation-ci/health.json"),
          "utf8",
        ),
      );
      expect(digest.complete).toBe(true);
      expect(digest.findings[0].id).toBe("old");
      expect(f.calls).toEqual([
        "health",
        "plan",
        "execute",
        "health",
        "observations",
        "plan",
        "verify",
        "admission",
      ]);
    } finally {
      await rm(f.rootDir, { recursive: true, force: true });
    }
  });
  test("metadata failure removes an earlier health artifact before an always-upload step can reuse it", async () => {
    const f = await fixture();
    try {
      const outputDir = path.join(f.rootDir, "artifacts/validation-ci");
      await mkdir(outputDir, { recursive: true });
      await writeFile(path.join(outputDir, "health.json"), "stale");
      await expect(
        runValidationCiCli(["health"], {
          ...f,
          requestJson: async () => {
            throw new Error("offline");
          },
        }),
      ).rejects.toThrow();
      await expect(
        readFile(path.join(outputDir, "health.json")),
      ).rejects.toThrow();
    } finally {
      await rm(f.rootDir, { recursive: true, force: true });
    }
  });
  test("real failed observation publishes without inventing a passing record or integer exit", async () => {
    const f = await fixture();
    try {
      f.runtime.execute = async () => {
        throw new Error("native gate failed");
      };
      f.runtime.readFailureObservations = async () => [
        { ...f.observation, outcome: "failure", originalExitCode: null },
      ];
      f.runtime.verifyExecution = async () => {
        throw new Error("must not claim admission");
      };
      await expect(runValidationCiCli(["health"], f)).rejects.toThrow(
        "health.json retained",
      );
      const digest = JSON.parse(
        await readFile(
          path.join(f.rootDir, "artifacts/validation-ci/health.json"),
          "utf8",
        ),
      );
      expect(digest.checks[0].outcome).toBe("failure");
      expect(digest.findings).toHaveLength(2);
    } finally {
      await rm(f.rootDir, { recursive: true, force: true });
    }
  });
  test("native verification refusal or late admission refusal leaves no success artifact", async () => {
    for (const stage of ["verifyExecution", "verifyHealthAdmission"] as const) {
      const f = await fixture();
      try {
        f.runtime[stage] = async () => {
          throw new Error("refused");
        };
        await expect(runValidationCiCli(["health"], f)).rejects.toThrow();
        await expect(
          readFile(path.join(f.rootDir, "artifacts/validation-ci/health.json")),
        ).rejects.toThrow();
      } finally {
        await rm(f.rootDir, { recursive: true, force: true });
      }
    }
  });
});

describe("single native execution projected to required hosted contexts", () => {
  function summaryFixture() {
    const plan = buildValidationPlan(
      {
        schemaVersion: "athena-validation-registry/1",
        alwaysRequired: ["reports"],
        surfaces: [],
        checks: [
          {
            id: "reports",
            profile: "docs-publishing",
            argv: ["bun", "run", "reports:presentation:check"],
            cwd: ".",
            membership: [],
            inputs: ["docs/reports/report.html"],
            absentInputs: [],
            prerequisites: [],
            supersedes: [],
          },
        ],
      },
      [],
      "comparison",
    );
    const binding = { ...run, baseSha: "b".repeat(40) };
    const verified = {
      ...binding,
      planDigest: plan.digest,
      recordRef: "native:verified-record",
      checks: [
        {
          ...results()[0],
          checkId: plan.checks[0].id,
          identity: plan.checks[0].identity,
          profile: plan.checks[0].profile,
        },
      ],
    };
    return { plan, binding, verified };
  }
  test("report-only plan resolves all five contexts through verified canonical execution without unrelated work", async () => {
    const { plan, binding, verified } = summaryFixture();
    let read = 0,
      verify = 0;
    const summary = await summarizeHostedValidation({
      binding,
      executionJobResult: "success",
      recomputePlan: async () => {
        read++;
        return plan;
      },
      verifyExecution: async (actual) => {
        verify++;
        expect(actual).toEqual(plan);
        return verified;
      },
    });
    expect(read).toBe(1);
    expect(verify).toBe(1);
    expect(Object.keys(summary.contexts)).toEqual([
      ...REQUIRED_VALIDATION_CONTEXTS,
    ]);
    expect(
      Object.values(summary.contexts).every((c) => c.conclusion === "success"),
    ).toBe(true);
    expect(summary.checkIds).toEqual(["reports"]);
  });
  test.each(["failure", "cancelled", "skipped", "missing"])(
    "%s native job cannot green any required context",
    async (executionJobResult) => {
      const { plan, binding, verified } = summaryFixture();
      const summary = await summarizeHostedValidation({
        binding,
        executionJobResult,
        recomputePlan: async () => plan,
        verifyExecution: async () => verified,
      });
      expect(
        Object.values(summary.contexts).every(
          (c) => c.conclusion === "failure",
        ),
      ).toBe(true);
    },
  );
  test("missing native verification or untrusted uploaded local selection cannot substitute for recomputation", async () => {
    const { plan, binding, verified } = summaryFixture();
    const summary = await summarizeHostedValidation({
      binding,
      executionJobResult: "success",
      recomputePlan: async () => {
        throw new Error("pinned recomputation failed");
      },
      verifyExecution: async () => verified,
      uploadedPlan: plan,
    } as Parameters<typeof summarizeHostedValidation>[0]);
    expect(
      Object.values(summary.contexts).every((c) => c.conclusion === "failure"),
    ).toBe(true);
    const noVerifier = await summarizeHostedValidation({
      binding,
      executionJobResult: "success",
      recomputePlan: async () => plan,
    } as unknown as Parameters<typeof summarizeHostedValidation>[0]);
    expect(
      Object.values(noVerifier.contexts).every(
        (c) => c.conclusion === "failure",
      ),
    ).toBe(true);
  });
  test.each([
    { planDigest: "forged" },
    { baseSha: "c".repeat(40) },
    { headSha: "d".repeat(40) },
    { runAttempt: 2 },
    { recordRef: "" },
    { checks: [] },
  ])(
    "incompatible or partial verified output fails every context: %j",
    async (patch) => {
      const { plan, binding, verified } = summaryFixture();
      const summary = await summarizeHostedValidation({
        binding,
        executionJobResult: "success",
        recomputePlan: async () => plan,
        verifyExecution: async () => ({
          ...verified,
          ...patch,
          checks:
            patch.checks !== undefined ? [...patch.checks] : verified.checks,
        }),
      });
      expect(
        Object.values(summary.contexts).every(
          (c) => c.conclusion === "failure",
        ),
      ).toBe(true);
    },
  );
  test.each([
    { identity: "other" },
    { profile: "different" },
    { originalExitCode: 1 },
    { attributed: true },
    { outcome: "cancelled" as const },
    { runId: 19 },
  ])("selected check mismatch/failure is never hidden: %j", async (patch) => {
    const { plan, binding, verified } = summaryFixture();
    const summary = await summarizeHostedValidation({
      binding,
      executionJobResult: "success",
      recomputePlan: async () => plan,
      verifyExecution: async () => ({
        ...verified,
        checks: [{ ...verified.checks[0], ...patch }],
      }),
    });
    expect(
      Object.values(summary.contexts).every((c) => c.conclusion === "failure"),
    ).toBe(true);
  });
});

describe("trusted full-health digest production", () => {
  test("publication wrapper requires actual full-inventory verification and rejects GitHub reruns", async () => {
    let calls = 0;
    const verifyFullInventory = async () => {
      calls++;
      return results();
    };
    expect(
      (
        await createVerifiedValidationHealthDigest({
          policy,
          run,
          previous: previous(),
          verifyFullInventory,
        })
      ).complete,
    ).toBe(true);
    expect(calls).toBe(1);
    await expect(
      createVerifiedValidationHealthDigest({
        policy,
        run: { ...run, runAttempt: 2 },
        previous: previous(),
        verifyFullInventory,
      }),
    ).rejects.toThrow("dispatch a new");
    expect(calls).toBe(1);
    await expect(
      createVerifiedValidationHealthDigest({
        policy,
        run,
        previous: previous(),
      } as Parameters<typeof createVerifiedValidationHealthDigest>[0]),
    ).rejects.toThrow("verification");
    await expect(
      createVerifiedValidationHealthDigest({
        policy,
        run,
        previous: previous(),
        verifyFullInventory: async () => {
          throw new Error("native verification refused");
        },
      }),
    ).rejects.toThrow("native verification refused");
  });
  test("explicit full recovery retains a missing first artifact as global unknown history", () => {
    const missing: HealthSnapshot = {
      ...previous(),
      availability: "artifact-unavailable",
      historyComplete: false,
      lastComplete: undefined,
      lastAttempt: {
        runId: 10,
        runAttempt: 2,
        headSha: sha,
        outcome: "cancelled",
        completedAt: 1,
      },
    };
    const result = createValidationHealthDigest({
      policy,
      run,
      observations: results(),
      previous: missing,
      recoverUnknownHistory: true,
    });
    const gap = result.findings.find(
      (f) => f.checkId === HEALTH_HISTORY_CHECK_ID,
    )!;
    expect(gap).toMatchObject({ runId: 10, runAttempt: 2, headSha: sha });
    expect(result.findings.some((f) => f.id === "old")).toBe(true);
    const health: HealthSnapshot = {
      ...previous(),
      findings: [{ ...gap, scope: { kind: "repo" } }],
    };
    const candidate = {
      candidateRef: "candidate",
      profile: "hosted" as const,
      scopes: [{ kind: "package" as const, package: "unrelated" }],
    };
    expect(evaluateValidationHealth({ health, candidate, now: 2 }).status).toBe(
      "repair-required",
    );
    const full = {
      mode: "full-health" as const,
      candidateRef: "candidate",
      profile: "hosted" as const,
      healthRevision: health.revision,
      outcome: "success" as const,
      evidenceRef: "verified-full-record",
    };
    expect(
      evaluateValidationHealth({
        health,
        candidate,
        fullValidation: full,
        now: 2,
      }).status,
    ).toBe("eligible");
    expect(
      evaluateValidationHealth({
        health,
        candidate,
        fullValidation: { ...full, profile: "local" },
        now: 2,
      }).status,
    ).toBe("repair-required");
    expect(
      evaluateValidationHealth({
        health,
        candidate,
        fullValidation: { ...full, healthRevision: "stale" },
        now: 2,
      }).status,
    ).toBe("repair-required");
    expect(
      evaluateValidationHealth({
        health,
        candidate,
        proofs: [
          {
            candidateRef: candidate.candidateRef,
            profile: "hosted",
            healthRevision: health.revision,
            findingId: gap.id,
            findingRevision: gap.revision,
            checkId: gap.checkId,
            scope: { kind: "repo" },
            outcome: "success",
            evidenceRef: "single-check-proof",
          },
        ],
        now: 2,
      }).status,
    ).toBe("repair-required");
  });
  test("unknown-history recovery refuses partial/failed execution and absent origin identity", () => {
    const missing: HealthSnapshot = {
      ...previous(),
      availability: "artifact-unavailable",
      historyComplete: false,
      lastComplete: undefined,
      lastAttempt: {
        runId: 10,
        runAttempt: 2,
        headSha: sha,
        outcome: "cancelled",
        completedAt: 1,
      },
    };
    for (const observations of [
      results().slice(1),
      results().map((o) => ({ ...o, originalExitCode: 1 })),
      results().map((o) => ({ ...o, execution: "reused" as const })),
    ]) {
      expect(() =>
        createValidationHealthDigest({
          policy,
          run,
          observations,
          previous: missing,
          recoverUnknownHistory: true,
        }),
      ).toThrow("complete successful");
    }
    expect(() =>
      createValidationHealthDigest({
        policy,
        run,
        observations: results(),
        previous: { ...missing, lastAttempt: undefined },
        recoverUnknownHistory: true,
      }),
    ).toThrow("origin");
    expect(() =>
      createValidationHealthDigest({
        policy,
        run,
        observations: results(),
        previous: { ...missing, availability: "api-unavailable" },
        recoverUnknownHistory: true,
      }),
    ).toThrow("history");
  });
  test("complete successful inventory carries historical failures through green reruns", () => {
    const result = produce();
    expect(result.complete).toBe(true);
    expect(result.checks.every((c) => c.outcome === "success")).toBe(true);
    expect(result.findings.map((f) => f.id)).toEqual(["old"]);
    expect(result.findings[0]).not.toHaveProperty("scope");
  });
  test("retains approved closure history so a later revoked approval cannot erase the finding", () => {
    const history = previous();
    history.closedFindings.push({
      finding: history.findings[0],
      reference: "approval",
      mainSha: sha,
      revalidationRunId: 11,
    });
    history.findings = [];
    expect(produce(results(), history).findings.map((f) => f.id)).toEqual([
      "old",
    ]);
  });
  test("attributes a real failure to its actual run and attempt, even if product attribution reports success", () => {
    const observations = results();
    observations[0] = {
      ...observations[0],
      originalExitCode: 1,
      attributed: true,
    };
    const result = produce(observations);
    expect(result.checks[0].outcome).toBe("failure");
    expect(result.complete).toBe(true);
    expect(result.findings).toHaveLength(2);
    const failure = result.findings.find((f) => f.runId === 20)!;
    expect(failure).toMatchObject({ checkId: "unit", headSha: sha });
    expect(produce(observations).findings).toEqual(result.findings);
    const retry = createValidationHealthDigest({
      policy,
      run: { ...run, runAttempt: 2 },
      observations: observations.map((o) => ({ ...o, runAttempt: 2 })),
      previous: previous(),
    });
    expect(retry.findings.find((f) => f.runId === 20)?.id).not.toBe(failure.id);
  });
  test.each(["cancelled", "unavailable"] as const)(
    "%s inventory cannot publish complete",
    (outcome) => {
      const observations = results();
      observations[1] = { ...observations[1], outcome, originalExitCode: null };
      expect(produce(observations).complete).toBe(false);
    },
  );
  test("missing aggregate coverage is unavailable, never inferred from passing unit tests", () => {
    const result = produce(
      results().filter((r) => r.checkId !== "aggregate-coverage"),
    );
    expect(result.complete).toBe(false);
    expect(
      result.checks.find((c) => c.checkId === "aggregate-coverage")?.outcome,
    ).toBe("unavailable");
  });
  test.each([
    { runId: 19 },
    { runAttempt: 2 },
    { headSha: "b".repeat(40) },
    { repository: "fork/athena" },
    { execution: "reused" },
    { originalExitCode: null },
    { attributed: true },
  ])(
    "incompatible or reused observation is not a new successful health result: %j",
    (patch) => {
      const observations = results();
      observations[0] = { ...observations[0], ...patch } as HealthObservation;
      expect(produce(observations).checks[0].outcome).toBe("unavailable");
      expect(produce(observations).complete).toBe(false);
    },
  );
  test("rejects duplicate/unknown observations rather than selecting a convenient result", () => {
    expect(() => produce([...results(), results()[0]])).toThrow("Duplicate");
    expect(() =>
      produce([...results(), { ...results()[0], checkId: "extra" }]),
    ).toThrow("Unknown");
  });
  test.each([
    "api-unavailable",
    "artifact-unavailable",
    "invalid-health",
    "incomplete",
  ] as const)(
    "%s prior history cannot bootstrap an empty ledger",
    (availability) => {
      const history = { ...previous(), availability, historyComplete: false };
      expect(() => produce(results(), history)).toThrow("history");
    },
  );
  test("overdue but completely read history can be renewed without losing failures", () => {
    expect(
      produce(results(), { ...previous(), availability: "overdue" }).findings,
    ).toHaveLength(1);
  });
  test("confirmed complete history from a cancelled attempt can be carried into recovery", () => {
    expect(
      produce(results(), {
        ...previous(),
        availability: "incomplete",
        historyComplete: true,
      }).findings,
    ).toHaveLength(1);
  });
  test("initial bootstrap requires explicit missing-seed with no prior observation", () => {
    const empty: HealthSnapshot = {
      ...previous(),
      availability: "missing-seed",
      findings: [],
      lastComplete: undefined,
    };
    expect(() => produce(results(), empty)).toThrow("bootstrap");
    expect(
      createValidationHealthDigest({
        policy,
        run,
        observations: results(),
        previous: empty,
        bootstrap: true,
      }).complete,
    ).toBe(true);
    expect(() =>
      createValidationHealthDigest({
        policy,
        run,
        observations: results(),
        previous: {
          ...empty,
          lastAttempt: {
            runId: 19,
            headSha: sha,
            outcome: "failure",
            completedAt: 1,
          },
        },
        bootstrap: true,
      }),
    ).toThrow("bootstrap");
  });
  test("does not publish an older invocation over a newer ledger", () => {
    expect(() =>
      produce(results(), {
        ...previous(),
        lastAttempt: {
          runId: 21,
          headSha: sha,
          outcome: "success",
          completedAt: 2,
        },
      }),
    ).toThrow("newer");
  });
});
