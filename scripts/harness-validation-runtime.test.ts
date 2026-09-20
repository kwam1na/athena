import { expect, it } from "vitest";
import { ATHENA_LEGACY_CONFIG } from "./harness-base-config";
import { configureScopedValidation } from "./harness-validation-runtime";
import type { NativeValidationSelection } from "./harness-validation-load";
import qualifiedFrontend from "./fixtures/affected-validation/frontend-qualified-profiles.json";

it("loads qualified profiles through the public Node execution path", async () => {
  const { execFileSync } = await import("node:child_process");
  const file = new URL("./harness-validation-runtime.ts", import.meta.url).href;
  const output = execFileSync(
    "node",
    [
      "--experimental-strip-types",
      "--input-type=module",
      "-e",
      `const m = await import(${JSON.stringify(file)}); console.log(typeof m.configureScopedValidation)`,
    ],
    { encoding: "utf8" },
  );
  expect(output.trim()).toBe("function");
});

const selection: NativeValidationSelection = {
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
    mode: "comparison",
    authority: "legacy-gate",
    evidence: "not-evaluated",
    digest: "fixture",
    changes: [],
    checks: [
      {
        id: "types",
        profile: "packages/athena-webapp:package-types",
        argv: ["bun", "run", "typecheck"],
        cwd: "packages/athena-webapp",
        membership: [],
        inputs: ["packages/athena-webapp/tsconfig.json"],
        absentInputs: [],
        prerequisites: [],
        supersedes: [],
        identity: "fixture",
        reasons: [],
        coveredChecks: ["types"],
      },
    ],
  },
  inventory: [
    "package.json",
    "bun.lockb",
    "packages/athena-webapp/package.json",
    "scripts/harness-validation-dependencies.py",
    ".graphify-validation-requirements.lock",
  ],
  packageScripts: {
    ".": {
      "landed-report:check":
        "bun scripts/landed-change-report-check.ts --base origin/main",
      "harness:inferential-review": "bun scripts/harness-inferential-review.ts",
    },
    "packages/athena-webapp": {
      build: "vite build && tsc --noEmit",
      "build:assets": "vite build",
      typecheck: "tsc --noEmit",
    },
  },
  timing: {
    initialCaptureMs: 0,
    baseSnapshotMs: 0,
    candidateSnapshotMs: 0,
    planningMs: 0,
    finalCaptureMs: 0,
    totalMs: 0,
  },
};

it("binds captured coordinates and mechanics without exposing controller secrets to checks", () => {
  const env = {
    GH_TOKEN: "controller-secret",
    GITHUB_OUTPUT: "controller-output",
  };
  const result = configureScopedValidation(
    "fixture-root",
    ATHENA_LEGACY_CONFIG,
    "comparison",
    env,
    () => selection,
  );
  expect(env).toMatchObject({
    ATHENA_SELECTION_HEAD: "a".repeat(40),
    ATHENA_SELECTION_TREE: "b".repeat(40),
    ATHENA_SELECTION_BASE: "d".repeat(40),
    ATHENA_SELECTION_MERGE_BASE: "e".repeat(40),
    PYTHONDONTWRITEBYTECODE: "1",
    PLAYWRIGHT_BROWSERS_PATH: "0",
  });
  expect(result.config.scopedExecution?.mechanicalProviders).toHaveLength(2);
  for (const provider of result.config.providers) {
    const names =
      provider.check?.scope?.environment.map((item) => item.name) ?? [];
    expect(names).not.toContain("GH_TOKEN");
    expect(names).not.toContain("GITHUB_OUTPUT");
  }
  const profile = result.config.scopedExecution?.profiles.find(
    (item) => item.id === "athena-core-full",
  )!;
  expect(profile.gitContext).toBe("full");
  expect(profile.mutableOutputs).toEqual([]);
  expect(profile.dependencies?.command).toEqual([
    "python3",
    "scripts/harness-validation-dependencies.py",
    "core",
  ]);
  expect(profile.dependencyInputs).toContain(
    ".graphify-validation-requirements.lock",
  );
});

it("limits live sensor credentials to their declared existing commands", async () => {
  const { validationEnvironment } =
    await import("./harness-validation-runtime");
  expect(
    validationEnvironment({
      profile: "packages/athena-webapp:unit",
      argv: ["bun", "run", "test"],
    }),
  ).toEqual([]);
  expect(
    validationEnvironment({
      profile: ".:command",
      argv: ["bun", "run", "harness:inferential-review"],
    }),
  ).toContainEqual({ name: "ANTHROPIC_API_KEY", kind: "credential" });
  const browser = validationEnvironment({
    profile: "packages/athena-webapp:browser",
    argv: ["bun", "run", "test:e2e:prod:pos"],
  });
  expect(browser).toContainEqual({
    name: "ATHENA_PROD_POS_RECOVERY_CODE",
    kind: "credential",
  });
  expect(browser).not.toContainEqual({
    name: "ANTHROPIC_API_KEY",
    kind: "credential",
  });
});

it("uses the qualified file-only typecheck profile without narrowing cross-package inputs", () => {
  const current = structuredClone(selection);
  current.plan.checks[0].inputs.push(
    "packages/storefront-webapp/src/shared.ts",
  );
  const result = configureScopedValidation(
    "fixture-root",
    ATHENA_LEGACY_CONFIG,
    "comparison",
    {},
    () => current,
  );
  const binding = result.checks.find((check) => check.checkId === "types")!;
  const provider = result.config.providers.find(
    (item) => item.id === binding.providerId,
  )!;
  expect(provider.check?.scope?.profile).toBe("athena-typecheck-none");
  expect(provider.check?.scope?.files).toContain(
    "packages/storefront-webapp/src/shared.ts",
  );
  expect(
    result.config.scopedExecution?.profiles.find(
      (item) => item.id === "athena-typecheck-none",
    )?.gitContext,
  ).toBe("none");
  expect(
    result.config.scopedExecution?.profiles.find(
      (item) => item.id === "athena-selection-guard",
    )?.gitContext,
  ).toBe("full");
});

it("keeps every native output declaration disjoint from the actual tracked inventory", async () => {
  const { execFileSync } = await import("node:child_process");
  const { collectCanonicalValidationRegistry } =
    await import("./harness-repo-validation");
  const { buildValidationPlan } = await import("./harness-validation-plan");
  const { readFileSync } = await import("node:fs");
  const root = new URL("../", import.meta.url).pathname;
  const inventory = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
  expect(inventory).toContain(
    "packages/storefront-webapp/playwright-report/index.html",
  );
  expect(
    inventory.filter(
      (file) => file.startsWith("artifacts/") && file.endsWith(".png"),
    ).length,
  ).toBeGreaterThan(0);
  const current = {
    ...selection,
    inventory,
    plan: buildValidationPlan(
      collectCanonicalValidationRegistry(inventory),
      [],
      "full-health",
    ),
    packageScripts: {
      ".": JSON.parse(readFileSync(`${root}package.json`, "utf8")).scripts,
      ...Object.fromEntries(
        ["athena-webapp", "storefront-webapp"].map((pkg) => [
          `packages/${pkg}`,
          JSON.parse(
            readFileSync(`${root}packages/${pkg}/package.json`, "utf8"),
          ).scripts,
        ]),
      ),
    },
  };
  const configured = configureScopedValidation(
    root,
    ATHENA_LEGACY_CONFIG,
    "full-health",
    {},
    () => current,
  );
  const overlaps = configured.config.scopedExecution!.profiles.flatMap(
    (profile) =>
      profile.mutableOutputs.flatMap((output) =>
        inventory
          .filter(
            (file) =>
              file === output.replace(/\/$/, "") ||
              file.startsWith(output.endsWith("/") ? output : output + "/"),
          )
          .map((file) => ({ profile: profile.id, output, file })),
      ),
  );
  expect(overlaps).toEqual([]);
});

it("gives no-emit typechecks no mutable application or report outputs", () => {
  const configured = configureScopedValidation(
    "fixture-root",
    ATHENA_LEGACY_CONFIG,
    "comparison",
    {},
    () => selection,
  );
  expect(
    configured.config.scopedExecution!.profiles.find(
      (profile) => profile.id === "athena-typecheck-none",
    )!.mutableOutputs,
  ).toEqual([]);
});

it("allows only the package-local Vitest results cache for unit checks", () => {
  for (const pkg of ["athena-webapp", "storefront-webapp"]) {
    const cwd = `packages/${pkg}`;
    const cache = `${cwd}/.cache/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json`;
    const current = {
      ...selection,
      packageScripts: {
        ...selection.packageScripts,
        [cwd]: {
          test:
            pkg === "athena-webapp"
              ? "vitest run --maxWorkers=4"
              : "vitest run",
        },
      },
      plan: {
        ...selection.plan,
        checks: [
          {
            ...selection.plan.checks[0],
            id: "unit",
            coveredChecks: ["unit"],
            cwd,
            profile: `${cwd}:unit`,
            argv: ["bun", "run", "test", "--"],
            membership: [`${cwd}/src/example.test.ts`],
            inputs: [`${cwd}/src/example.test.ts`],
          },
        ],
      },
    };
    const configured = configureScopedValidation(
      "fixture-root",
      ATHENA_LEGACY_CONFIG,
      "comparison",
      {},
      () => current,
    );
    const binding = configured.checks.find(
      (check) => check.checkId === "unit",
    )!;
    const provider = configured.config.providers.find(
      (entry) => entry.id === binding.providerId,
    )!;
    const profile = configured.config.scopedExecution!.profiles.find(
      (entry) => entry.id === provider.check!.scope!.profile,
    )!;
    expect(profile.gitContext).toBe("full");
    expect(profile.mutableOutputs).toEqual([cache]);
    const writable = (file: string) =>
      profile.mutableOutputs.some((output) =>
        output.endsWith("/") ? file.startsWith(output) : file === output,
      );
    for (const file of [
      `${cwd}/src/example.test.ts`,
      `${cwd}/node_modules/vitest/package.json`,
      `${cwd}/node_modules/.vite/deps/module.js`,
      `${cwd}/node_modules/.vite/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json`,
      `${cache}.other`,
      `packages/${pkg === "athena-webapp" ? "storefront-webapp" : "athena-webapp"}/.cache/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json`,
    ])
      expect(writable(file)).toBe(false);
  }
});

it("adopts qualified frontend commands without narrowing inputs or granting diagnostic outputs", () => {
  for (const entry of qualifiedFrontend.commands) {
    const current = structuredClone(selection);
    current.packageScripts[entry.cwd] = {
      build: "vite build && tsc --noEmit",
      "build:assets": "vite build",
      typecheck: "tsc --noEmit",
      test:
        entry.cwd === "packages/athena-webapp"
          ? "vitest run --maxWorkers=4"
          : "vitest run",
    };
    current.plan.checks = [
      {
        ...current.plan.checks[0],
        ...entry.plannerDefinitions[0],
        cwd: entry.cwd,
        membership: entry.membership,
        inputs: [
          ...entry.membership,
          "docs/reports/qualified-report.html",
          "packages/athena-contracts/src/shared.ts",
        ],
      },
    ];
    const configured = configureScopedValidation(
      "fixture-root",
      ATHENA_LEGACY_CONFIG,
      "comparison",
      {},
      () => current,
    );
    expect(configured.config.preparationWiringPaths).toContain(
      "scripts/fixtures/affected-validation/frontend-qualified-profiles.json",
    );
    const provider = configured.config.providers.find(
      (item) => item.id === configured.checks[0].providerId,
    )!;
    const profile = configured.config.scopedExecution!.profiles.find(
      (item) => item.id === provider.check!.scope!.profile,
    )!;
    expect(profile.gitContext).toBe("none");
    expect(provider.check!.scope!.files).toEqual(
      expect.arrayContaining(current.plan.checks[0].inputs),
    );
    expect(profile.mutableOutputs).toEqual(
      entry.kind === "unit"
        ? [
            `${entry.cwd}/.cache/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json`,
          ]
        : entry.kind === "build"
          ? [`${entry.cwd}/dist/`]
          : [],
    );
    expect(profile.mutableOutputs).not.toContain(".qualification-results/");
  }
});

it("keeps changed membership and command shapes on private Git instead of extending qualification", () => {
  const entry = qualifiedFrontend.commands.find(
    (item) => item.kind === "unit" && item.membership.length === 34,
  )!;
  for (const variation of [
    {
      membership: [
        ...entry.membership,
        `${entry.cwd}/convex/unqualified.test.ts`,
      ],
    },
    { membership: entry.membership.slice(1) },
    { argv: ["bun", "run", "test"] },
    { argv: ["bun", "run", "test", "--", "--reporter=verbose"] },
  ]) {
    const current = structuredClone(selection);
    current.packageScripts[entry.cwd] = { test: "vitest run --maxWorkers=4" };
    current.plan.checks = [
      {
        ...current.plan.checks[0],
        ...entry.plannerDefinitions[0],
        cwd: entry.cwd,
        membership: entry.membership,
        ...variation,
      },
    ];
    const configured = configureScopedValidation(
      "fixture-root",
      ATHENA_LEGACY_CONFIG,
      "comparison",
      {},
      () => current,
    );
    const provider = configured.config.providers.find(
      (item) => item.id === configured.checks[0].providerId,
    )!;
    const profile = configured.config.scopedExecution!.profiles.find(
      (item) => item.id === provider.check!.scope!.profile,
    )!;
    expect(profile.gitContext).toBe("full");
    expect(profile.id).toBe("athena-webapp-unit-full");
  }
});

it("retains canonical build, coverage, report and browser output needs in separate profiles", () => {
  const checks = [
    {
      id: "build",
      profile: "packages/athena-webapp:package-build",
      cwd: "packages/athena-webapp",
      argv: ["bun", "run", "build:assets"],
    },
    {
      id: "behavior",
      profile: ".:behavior",
      cwd: ".",
      argv: [
        "/bin/sh",
        "-c",
        "bun run harness:behavior -- --scenario storefront-backend-first-load",
      ],
    },
    {
      id: "coverage",
      profile: ".:aggregate-coverage",
      cwd: ".",
      argv: ["/bin/sh", "-c", "bun run test:coverage"],
    },
    {
      id: "storybook",
      profile: "packages/athena-webapp:command",
      cwd: ".",
      argv: [
        "/bin/sh",
        "-c",
        "bun run --filter '@athena/webapp' storybook:build",
      ],
    },
    {
      id: "review",
      profile: ".:command",
      cwd: ".",
      argv: ["/bin/sh", "-c", "bun run harness:inferential-review"],
    },
    {
      id: "browser",
      profile: "packages/storefront-webapp:browser",
      cwd: ".",
      argv: [
        "/bin/sh",
        "-c",
        "bun run --filter '@athena/storefront-webapp' test:e2e",
      ],
    },
  ].map((check) => ({
    ...selection.plan.checks[0],
    ...check,
    coveredChecks: [check.id],
  }));
  const current = { ...selection, plan: { ...selection.plan, checks } };
  const env: NodeJS.ProcessEnv = {};
  const configured = configureScopedValidation(
    "fixture-root",
    ATHENA_LEGACY_CONFIG,
    "comparison",
    env,
    () => current,
  );
  const outputs = (id: string) => {
    const binding = configured.checks.find((c) => c.checkId === id)!;
    const provider = configured.config.providers.find(
      (p) => p.id === binding.providerId,
    )!;
    return configured.config.scopedExecution!.profiles.find(
      (p) => p.id === provider.check!.scope!.profile,
    )!.mutableOutputs;
  };
  expect(outputs("build")).toEqual(["packages/athena-webapp/dist/"]);
  expect(outputs("behavior")).toEqual(["artifacts/harness-behavior/"]);
  expect(
    configured.config.scopedExecution!.profiles.find(
      (p) => p.id === "athena-behavior-full",
    )!.dependencies!.command,
  ).toEqual([
    "python3",
    "scripts/harness-validation-dependencies.py",
    "browser",
  ]);
  expect(outputs("coverage")).toEqual([
    "coverage/",
    "packages/athena-webapp/coverage/",
    "packages/storefront-webapp/coverage/",
    "packages/athena-webapp/.cache/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json",
    "packages/storefront-webapp/.cache/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json",
  ]);
  expect(outputs("storybook")).toEqual([
    "packages/athena-webapp/storybook-static/",
    "packages/athena-webapp/.cache/storybook-build/",
  ]);
  expect(env.CACHE_DIR).toBe(".cache/storybook-build");
  for (const binding of configured.checks) {
    const provider = configured.config.providers.find(
      (entry) => entry.id === binding.providerId,
    )!;
    expect(
      provider.check!.scope!.environment.some((entry) => entry.name === "CACHE_DIR"),
    ).toBe(binding.checkId === "storybook");
  }
  expect(outputs("review")).toEqual(["artifacts/harness-inferential-review/"]);
  expect(outputs("browser")).toEqual(["artifacts/validation-playwright/"]);
  expect(env.PLAYWRIGHT_HTML_OUTPUT_DIR).toBe(
    "../../artifacts/validation-playwright/html",
  );
  expect(env.PLAYWRIGHT_OUTPUT_DIR).toBe(
    "../../artifacts/validation-playwright/results",
  );
  const browser = configured.config.providers.find(
    (p) =>
      p.id ===
      configured.checks.find((c) => c.checkId === "browser")!.providerId,
  )!;
  expect(browser.check!.scope!.environment).toEqual(
    expect.arrayContaining([
      { name: "PLAYWRIGHT_HTML_OUTPUT_DIR", kind: "flag" },
      { name: "PLAYWRIGHT_OUTPUT_DIR", kind: "flag" },
    ]),
  );
});

it("keeps fallback and timing checks in full Git with only their Vitest cache writable", () => {
  const cases = [
    {
      profile: "packages/athena-webapp:fallback-suite",
      argv: ["bun", "run", "--filter", "@athena/webapp", "test"],
    },
    {
      profile: "packages/athena-webapp:timer-stress",
      argv: [
        "/bin/sh",
        "-c",
        "bun run --filter '@athena/webapp' test:timing-parity",
      ],
    },
  ];
  for (const check of cases) {
    for (const exact of [true, false]) {
      const current = structuredClone(selection);
      const argv = exact
        ? check.argv
        : [...check.argv.slice(0, -1), `${check.argv.at(-1)} --unexpected`];
      current.plan.checks = [
        {
          ...current.plan.checks[0],
          profile: check.profile,
          argv,
          id: "backend",
          coveredChecks: ["backend"],
          cwd: ".",
        },
      ];
      const configured = configureScopedValidation(
        "fixture-root",
        ATHENA_LEGACY_CONFIG,
        "comparison",
        {},
        () => current,
      );
      const binding = configured.checks.find(
        (entry) => entry.checkId === "backend",
      )!;
      const provider = configured.config.providers.find(
        (entry) => entry.id === binding.providerId,
      )!;
      const profile = configured.config.scopedExecution!.profiles.find(
        (entry) => entry.id === provider.check!.scope!.profile,
      )!;
      expect(profile.gitContext).toBe("full");
      expect(profile.mutableOutputs).toEqual(
        exact
          ? [
              "packages/athena-webapp/.cache/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json",
            ]
          : [],
      );
      expect(provider.check!.command).toEqual(argv);
    }
  }
});

it("does not grant Storybook cache writes to an altered command or execution context", () => {
  const canonical = {
    ...selection.plan.checks[0],
    profile: "packages/athena-webapp:command",
    cwd: ".",
    argv: [
      "/bin/sh",
      "-c",
      "bun run --filter '@athena/webapp' storybook:build",
    ],
  };
  for (const changed of [
    { ...canonical, cwd: "packages/athena-webapp" },
    { ...canonical, profile: ".:command" },
    { ...canonical, argv: [...canonical.argv, "--unexpected"] },
  ]) {
    const current = structuredClone(selection);
    current.plan.checks = [changed];
    const configured = configureScopedValidation(
      "fixture-root",
      ATHENA_LEGACY_CONFIG,
      "comparison",
      {},
      () => current,
    );
    const binding = configured.checks.find(
      (entry) => entry.checkId === changed.id,
    )!;
    const provider = configured.config.providers.find(
      (entry) => entry.id === binding.providerId,
    )!;
    expect(provider.check!.scope!.profile).toBe("athena-core-full");
    expect(provider.check!.scope!.environment.map((entry) => entry.name))
      .not.toContain("CACHE_DIR");
  }
});
