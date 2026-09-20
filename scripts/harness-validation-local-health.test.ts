import { describe, expect, test } from "bun:test";
import { ATHENA_LEGACY_CONFIG } from "./harness-base-config.ts";
import { configureScopedValidation } from "./harness-validation-runtime.ts";
import { configureLocalScopedValidation } from "./harness-validation-local-runtime.ts";
import { checkLocalValidationHealth } from "./harness-validation-local-health-check.ts";
import type { NativeValidationSelection } from "./harness-validation-load.ts";
import { HEALTH_HISTORY_CHECK_ID } from "./harness-validation-health.ts";
import {
  assertLocalValidationHealthCurrent,
  bindLocalValidationHealth,
  chooseLocalValidationMode,
  LOCAL_HEALTH_OBLIGATION,
  LOCAL_HEALTH_PROVIDER,
  type LocalHealthAuthority,
} from "./harness-validation-local-health.ts";

type Mutable<T> = { -readonly [P in keyof T]: Mutable<T[P]> };
const mutable = <T>(value: T): Mutable<T> =>
  structuredClone(value) as Mutable<T>;
const now = Date.now();
const changes = [
  {
    path: "packages/athena-webapp/src/example.ts",
    status: "modified" as const,
  },
];
function fixture(mode: "comparison" | "full-health" = "full-health") {
  const checks = ["unit", "types"].map((id) => ({
    id,
    profile: "packages/athena-webapp:unit",
    argv: ["bun", "run", "test"],
    cwd: "packages/athena-webapp",
    membership: [`packages/athena-webapp/src/${id}.test.ts`],
    inputs: ["packages/athena-webapp/src/example.ts"],
    absentInputs: [],
    prerequisites: [],
    supersedes: [],
    identity: id,
    reasons: ["fixture"],
    coveredChecks: [id],
  }));
  const selection: Mutable<NativeValidationSelection> = {
    schemaVersion: "athena-native-selection/1",
    candidate: {
      vcs: "git",
      headSha: "a".repeat(40),
      treeSha: "b".repeat(40),
      mode: "clean",
      deliverable: { digest: "c".repeat(64), identity: "deliverable-tree/v1" },
      base: {
        ref: "origin/main",
        tipSha: "d".repeat(40),
        mergeBaseSha: "e".repeat(40),
      },
      workspaceId: "f".repeat(64),
      statusEntries: [],
      untrackedFiles: [],
    },
    plan: {
      schemaVersion: "athena-validation-plan/1",
      mode,
      authority: "legacy-gate",
      evidence: "not-evaluated",
      digest: "fixture",
      changes,
      checks,
    },
    inventory: [
      "package.json",
      "bun.lockb",
      "packages/athena-webapp/package.json",
    ],
    packageScripts: { "packages/athena-webapp": { test: "vitest run" } },
    timing: {
      initialCaptureMs: 0,
      baseSnapshotMs: 0,
      candidateSnapshotMs: 0,
      planningMs: 0,
      finalCaptureMs: 0,
      totalMs: 0,
    },
  };
  const full = structuredClone(selection);
  full.plan.mode = "full-health";
  const authority: LocalHealthAuthority = {
    inventory: {
      schemaVersion: "athena-validation-health-inventory/1",
      checks: checks.map((check) => ({
        checkId: check.id,
        profile: check.profile,
        scope: { kind: "package", package: "packages/athena-webapp" },
      })),
    },
    health: {
      schemaVersion: "athena-validation-health/1",
      revision: "revision-1",
      observedAt: now,
      availability: "available",
      historyComplete: true,
      findings: [],
      closedFindings: [],
      lastComplete: {
        runId: 1,
        headSha: "a".repeat(40),
        outcome: "success",
        completedAt: now - 1000,
      },
    },
  };
  const project = (value = selection) =>
    configureScopedValidation(
      ".",
      ATHENA_LEGACY_CONFIG,
      value.plan.mode,
      {},
      () => value,
    ).config;
  const config = mutable(project());
  const bind = () =>
    bindLocalValidationHealth(config, selection, full, authority, now);
  return { selection, full, authority, config, project, bind };
}
function finding(checkId = "unit") {
  return {
    id: "failed-unit",
    revision: "finding-1",
    checkId,
    scope: { kind: "package" as const, package: "packages/athena-webapp" },
    runId: 2,
    headSha: "a".repeat(40),
  };
}

describe("local health planning and native conjunction", () => {
  test("runtime replaces injected flags and live admission rejects a different candidate", async () => {
    const f = fixture("comparison");
    const env: NodeJS.ProcessEnv = {
      ATHENA_VALIDATION_HEALTH_REVISION: "forged",
      ATHENA_LOCAL_HEALTH_CONTEXT: "forged",
    };
    const configured = await configureLocalScopedValidation(
      ".",
      ATHENA_LEGACY_CONFIG,
      "comparison",
      env,
      {
        capture: () => f.selection,
        readAuthority: async () => f.authority,
        now: () => now,
      },
    );
    expect(env.ATHENA_VALIDATION_HEALTH_REVISION).toBe(
      f.authority.health.revision,
    );
    expect(env.ATHENA_LOCAL_HEALTH_CONTEXT).not.toBe("forged");
    const request = {
      gateId: configured.config.gateId,
      providerId: LOCAL_HEALTH_PROVIDER,
      obligationIds: [LOCAL_HEALTH_OBLIGATION],
      candidate: f.selection.candidate,
    };
    expect(() =>
      checkLocalValidationHealth(configured.context, request, configured),
    ).not.toThrow();
    expect(() =>
      checkLocalValidationHealth(
        configured.context,
        {
          ...request,
          candidate: { ...request.candidate, treeSha: "9".repeat(40) },
        },
        configured,
      ),
    ).toThrow("current native candidate");
  });
  test("runtime escalates unavailable health and refuses source drift during recapture", async () => {
    const f = fixture("comparison");
    f.authority.health.availability = "api-unavailable";
    const modes: string[] = [];
    const capture = (
      _root: string,
      _config: typeof ATHENA_LEGACY_CONFIG,
      mode: "comparison" | "full-health" | "delivery",
    ) => {
      modes.push(mode);
      return mode === "full-health" ? f.full : f.selection;
    };
    const configured = await configureLocalScopedValidation(
      ".",
      ATHENA_LEGACY_CONFIG,
      "comparison",
      {},
      { capture, readAuthority: async () => f.authority, now: () => now },
    );
    expect(modes).toEqual(["comparison", "full-health"]);
    expect(configured.context.mode).toBe("full-health");
    f.full.candidate.treeSha = "9".repeat(40);
    await expect(
      configureLocalScopedValidation(
        ".",
        ATHENA_LEGACY_CONFIG,
        "comparison",
        {},
        { capture, readAuthority: async () => f.authority, now: () => now },
      ),
    ).rejects.toThrow("Candidate changed");
  });
  test("healthy and unrelated health retain comparison; intersecting health requires full", () => {
    const { authority } = fixture();
    expect(
      chooseLocalValidationMode(authority.health, changes, "comparison", now),
    ).toBe("comparison");
    authority.health.findings.push({
      ...finding(),
      scope: { kind: "package", package: "packages/storefront-webapp" },
    });
    expect(
      chooseLocalValidationMode(authority.health, changes, "comparison", now),
    ).toBe("comparison");
    authority.health.findings.push(finding());
    expect(
      chooseLocalValidationMode(authority.health, changes, "comparison", now),
    ).toBe("full-health");
  });
  test.each([
    "missing-seed",
    "api-unavailable",
    "artifact-unavailable",
    "invalid-health",
    "incomplete",
    "overdue",
  ] as const)("%s requires full execution", (availability) => {
    const { authority } = fixture();
    authority.health.availability = availability;
    expect(
      chooseLocalValidationMode(authority.health, changes, "comparison", now),
    ).toBe("full-health");
  });
  test("missing or expired complete seed requires full even when availability says available", () => {
    const { authority } = fixture();
    authority.health.lastComplete!.completedAt = now - 49 * 60 * 60 * 1000;
    expect(
      chooseLocalValidationMode(authority.health, changes, "comparison", now),
    ).toBe("full-health");
    delete authority.health.lastComplete;
    expect(
      chooseLocalValidationMode(authority.health, changes, "comparison", now),
    ).toBe("full-health");
  });
  test("full repair binds a last nonwaivable live fact while global finding stays open", () => {
    const f = fixture();
    f.authority.health.findings.push(finding());
    const before = structuredClone(f.authority);
    const bound = f.bind();
    expect(bound.config.obligations.at(-1)).toMatchObject({
      id: LOCAL_HEALTH_OBLIGATION,
      freshness: "live",
      activation: { kind: "always" },
      allowedResolutionKinds: ["satisfied_live_fact"],
      humanWaiverAllowed: false,
      ciDelegationPolicyIds: [],
      waivableCodes: [],
    });
    assertLocalValidationHealthCurrent(
      bound.context,
      bound.config,
      f.selection,
      f.full,
      f.authority,
      now,
    );
    expect(f.authority).toEqual(before);
    expect(
      bound.config.providers
        .find((p) => p.id === LOCAL_HEALTH_PROVIDER)
        ?.command?.slice(0, 3),
    ).toEqual(["bun", "scripts/delivery-live-sensor.ts", "validation-health"]);
  });
  test("binds only the guard, preserving application checks and unrelated obligations", () => {
    const f = fixture();
    const bound = f.bind();
    for (const p of f.config.providers.filter(
      (p) => p.id !== "athena.selection-guard",
    ))
      expect(bound.config.providers.find((item) => item.id === p.id)).toEqual(
        p,
      );
    expect(bound.config.obligations.slice(0, -1)).toEqual([
      ...f.config.obligations,
    ]);
    expect(
      bound.config.providers.find((p) => p.id === "athena.selection-guard")
        ?.check?.scope?.environment,
    ).toContainEqual({ name: "ATHENA_LOCAL_HEALTH_CONTEXT", kind: "flag" });
    expect(bound.environment.ATHENA_VALIDATION_HEALTH_REVISION).toBe(
      "revision-1",
    );
  });
  test("selected parent cannot claim full health repair", () => {
    const f = fixture("comparison");
    f.authority.health.findings.push(finding());
    expect(f.bind).toThrow("complete full-health");
  });
  test("missing mandatory obligation and waiver mutation refuse", () => {
    const f = fixture();
    f.config.obligations.splice(1, 1);
    expect(f.bind).toThrow("mandatory obligations");
    const g = fixture();
    g.config.obligations[1].allowedResolutionKinds.push("waived");
    expect(g.bind).toThrow("mandatory obligations");
  });
  test("parent scoped membership cannot be narrowed behind a full plan", () => {
    const f = fixture();
    f.config.providers.find((p) =>
      p.id.startsWith("athena.scoped."),
    )!.check!.scope!.tests = [];
    expect(f.bind).toThrow("mandatory obligations");
  });
  test("consistent reduced plan and parent still fail against independently captured full selection", () => {
    const f = fixture();
    f.selection.plan.checks.pop();
    expect(() =>
      bindLocalValidationHealth(
        f.project(),
        f.selection,
        f.full,
        f.authority,
        now,
      ),
    ).toThrow("freshly recomputed");
  });
  test("consistent narrowed plan and config fail against full membership", () => {
    const f = fixture();
    f.selection.plan.checks[0].membership = [];
    expect(() =>
      bindLocalValidationHealth(
        f.project(),
        f.selection,
        f.full,
        f.authority,
        now,
      ),
    ).toThrow("freshly recomputed");
  });
  test("both plans missing a protected check refuse inventory coverage", () => {
    const f = fixture();
    f.selection.plan.checks.pop();
    f.full.plan.checks.pop();
    expect(() =>
      bindLocalValidationHealth(
        f.project(),
        f.selection,
        f.full,
        f.authority,
        now,
      ),
    ).toThrow("protected check types");
  });
  test("unknown finding and wider-than-protected scope refuse", () => {
    const f = fixture();
    f.authority.health.findings.push(finding("unknown"));
    expect(f.bind).toThrow("does not cover health finding");
    const g = fixture();
    g.authority.health.findings.push({ ...finding(), scope: { kind: "repo" } });
    expect(g.bind).toThrow("does not cover health finding");
  });
  test("reserved incomplete-history obligation requires full coverage", () => {
    const f = fixture();
    f.authority.health.findings.push(finding(HEALTH_HISTORY_CHECK_ID));
    expect(f.bind().context.mode).toBe("full-health");
    f.authority.inventory.checks.push({
      checkId: "missing",
      profile: ".:unit",
      scope: { kind: "repo" },
    });
    expect(f.bind).toThrow("protected check missing");
  });
  test("revision race refuses instead of relabeling the original context", () => {
    const f = fixture();
    const bound = f.bind();
    f.authority.health.revision = "revision-2";
    expect(() =>
      assertLocalValidationHealthCurrent(
        bound.context,
        bound.config,
        f.selection,
        f.full,
        f.authority,
        now,
      ),
    ).toThrow("Health changed");
  });
  test("guard context omission and health obligation waiver refuse", () => {
    for (const mutation of [
      "guard",
      "waiver",
      "provider",
      "obligation",
    ] as const) {
      const f = fixture();
      const bound = mutable(f.bind());
      if (mutation === "guard")
        bound.config.providers
          .find((p) => p.id === "athena.selection-guard")!
          .check!.scope!.environment.pop();
      if (mutation === "waiver")
        bound.config.obligations
          .at(-1)!
          .allowedResolutionKinds.push("not_applicable");
      if (mutation === "provider")
        bound.config.providers = bound.config.providers.filter(
          (p) => p.id !== LOCAL_HEALTH_PROVIDER,
        );
      if (mutation === "obligation") bound.config.obligations.pop();
      expect(() =>
        assertLocalValidationHealthCurrent(
          bound.context,
          bound.config,
          f.selection,
          f.full,
          f.authority,
          now,
        ),
      ).toThrow();
    }
  });
  test("inventory and base changes invalidate context", () => {
    const f = fixture();
    const bound = f.bind();
    f.authority.inventory.schemaVersion += "-changed";
    expect(() =>
      assertLocalValidationHealthCurrent(
        bound.context,
        bound.config,
        f.selection,
        f.full,
        f.authority,
        now,
      ),
    ).toThrow("context changed");
    const g = fixture();
    const prior = g.bind();
    g.selection.candidate.base.tipSha = "9".repeat(40);
    g.full.candidate.base.tipSha = "9".repeat(40);
    expect(() =>
      assertLocalValidationHealthCurrent(
        prior.context,
        prior.config,
        g.selection,
        g.full,
        g.authority,
        now,
      ),
    ).toThrow("context changed");
  });
  test("record-neutral raw tree, HEAD, plan reasons and changes do not alter command context", () => {
    const f = fixture();
    const prior = f.bind();
    f.selection.candidate.treeSha = "9".repeat(40);
    f.selection.candidate.headSha = "8".repeat(40);
    f.selection.plan.digest = "transport";
    f.selection.plan.changes.push({
      path: "telemetry/delivery-runs/record.json",
      status: "added",
    });
    f.selection.plan.checks[0].reasons.push("transport");
    const after = f.bind();
    expect(after.context).toEqual(prior.context);
    expect(after.environment).toEqual(prior.environment);
    expect(after.config.providers.at(-1)).toEqual(
      prior.config.providers.at(-1),
    );
    assertLocalValidationHealthCurrent(
      prior.context,
      after.config,
      f.selection,
      f.full,
      f.authority,
      now,
    );
  });
});

describe("characterized full-unit protected inventory admission", () => {
  async function characterized(changedConfig = false) {
    const { readFileSync } = await import("node:fs");
    const { buildValidationPlan } = await import("./harness-validation-plan");
    const { collectCanonicalValidationRegistry, OPERATOR_FULL_UNIT_CONTRACT } =
      await import("./harness-repo-validation");
    const { generateValidationHealthInventory } =
      await import("./harness-validation-health-inventory");
    const root = "packages/athena-webapp";
    const files: Record<string, string> = Object.fromEntries(
      [
        "package.json",
        `${root}/package.json`,
        "packages/storefront-webapp/package.json",
        ...Object.keys(OPERATOR_FULL_UNIT_CONTRACT.sources),
      ].map((path) => [path, readFileSync(path, "utf8")]),
    );
    files[`${root}/src/example.test.ts`] = "export {};";
    files["packages/storefront-webapp/src/example.test.ts"] = "export {};";
    files["scripts/example.test.ts"] = "export {};";
    if (changedConfig)
      files[`${root}/vitest.config.ts`] += "\n// uncharacterized";
    const selection = fixture().selection;
    selection.inventory = Object.keys(files).sort();
    selection.packageScripts = Object.fromEntries(
      Object.entries(files)
        .filter(([path]) => path.endsWith("package.json"))
        .map(([path, text]) => [
          path === "package.json" ? "." : path.slice(0, -13),
          JSON.parse(text).scripts,
        ]),
    );
    // Exercise the data-only JSON boundary used by the native planning child.
    selection.plan = JSON.parse(
      JSON.stringify(
        buildValidationPlan(
          collectCanonicalValidationRegistry(selection.inventory),
          [],
          "full-health",
          { base: files, candidate: files },
        ),
      ),
    );
    const authority = fixture().authority;
    authority.inventory = generateValidationHealthInventory(
      buildValidationPlan(
        collectCanonicalValidationRegistry([]),
        [],
        "full-health",
      ),
    );
    const bind = () => {
      const config = configureScopedValidation(
        ".",
        ATHENA_LEGACY_CONFIG,
        "full-health",
        {},
        () => selection,
      ).config;
      return bindLocalValidationHealth(
        config,
        selection,
        structuredClone(selection),
        authority,
        now,
      );
    };
    return { selection, authority, bind, root };
  }
  test("admits the actual characterized full plan against generated protected inventory", async () => {
    const f = await characterized();
    expect(
      f.selection.plan.checks.some(
        (check) => check.profile === `${f.root}:unit`,
      ),
    ).toBe(false);
    expect(
      f.selection.plan.checks.filter(
        (check) => check.profile === `${f.root}:fallback-suite`,
      ),
    ).toHaveLength(1);
    expect(
      f.authority.inventory.checks.some(
        (check) => check.profile === `${f.root}:unit`,
      ),
    ).toBe(true);
    expect(f.bind().context.mode).toBe("full-health");
  });
  test("keeps changed configuration on its original protected profiles", async () => {
    const f = await characterized(true);
    expect(
      f.selection.plan.checks.some(
        (check) => check.profile === `${f.root}:unit`,
      ),
    ).toBe(true);
    expect(f.bind().context.mode).toBe("full-health");
  });
  for (const tamper of [
    "declaration",
    "declared-id",
    "declared-profile",
    "covered-id",
    "profile",
    "membership",
    "script",
  ]) {
    test(`refuses ${tamper} tampering instead of trusting coveredChecks`, async () => {
      const f = await characterized();
      const suite = f.selection.plan.checks.find(
        (check) => check.profile === `${f.root}:fallback-suite`,
      )!;
      if (tamper === "declaration") delete suite.ordinaryFullSuite;
      if (tamper === "declared-id")
        suite.ordinaryFullSuite = {
          contract: "athena-operator-full-unit/1",
          coveredProfiles: [{ checkId: "forged", profile: `${f.root}:unit` }],
        };
      if (tamper === "declared-profile")
        suite.ordinaryFullSuite = {
          contract: "athena-operator-full-unit/1",
          coveredProfiles: suite.coveredChecks.map((checkId) => ({
            checkId,
            profile: `${f.root}:arbitrary`,
          })),
        };
      if (tamper === "profile") suite.profile = `${f.root}:arbitrary`;
      if (tamper === "membership") suite.membership = [];
      if (tamper === "script")
        f.selection.packageScripts[f.root].test += " --coverage";
      if (tamper === "covered-id") {
        suite.coveredChecks.push("forged-unit");
        f.authority.inventory.checks.push({
          checkId: "forged-unit",
          profile: `${f.root}:unit`,
          scope: { kind: "package", package: f.root },
        });
      }
      expect(f.bind).toThrow("does not cover protected check");
    });
  }
});
