const HARNESS_REPO_VALIDATION_PATTERNS = [
  /^scripts\//,
  /^packages\/[^/]+\/docs\/agent\//,
  /^packages\/[^/]+\/AGENTS\.md$/,
  /^packages\/AGENTS\.md$/,
  /^README\.md$/,
  /^package\.json$/,
  /^manage-athena-versions\.sh$/,
  /^\.github\/workflows\/athena-pr-tests\.yml$/,
  /^\.husky\/pre-commit$/,
  /^\.husky\/pre-push$/,
] as const;

const HARNESS_REPO_VALIDATION_COMMANDS = [
  "bun run workflow:check",
  "bun run harness:test",
  "bun run delivery:documentation-check",
  "bun run test:coverage",
  "bun run harness:inferential-review",
] as const;

const HARNESS_REPO_VALIDATION_SURFACE_NAME =
  "repo harness implementation and workflow wiring";

export type HarnessValidationCapability = "root-script-tests";

export type HarnessRepoSurfaceCoverage = {
  surfaceName: string;
  files: string[];
};

function normalizeRepoPath(repoPath: string) {
  return repoPath.replaceAll("\\", "/");
}

function sortUniquePaths(paths: string[]) {
  return [
    ...new Set(
      paths.map((entry) => normalizeRepoPath(entry).trim()).filter(Boolean),
    ),
  ].sort((left, right) => left.localeCompare(right));
}

export function matchesHarnessRepoValidationPath(filePath: string) {
  const normalizedPath = normalizeRepoPath(filePath);

  return HARNESS_REPO_VALIDATION_PATTERNS.some((pattern) =>
    pattern.test(normalizedPath),
  );
}

export function collectHarnessRepoValidationSelection(changedFiles: string[]) {
  const matchedFiles = sortUniquePaths(
    changedFiles.filter((filePath) =>
      matchesHarnessRepoValidationPath(filePath),
    ),
  );

  return {
    matchedFiles,
    matchedSurfaces:
      matchedFiles.length === 0
        ? []
        : [
            {
              surfaceName: HARNESS_REPO_VALIDATION_SURFACE_NAME,
              files: matchedFiles,
            },
          ],
    selectedCommands:
      matchedFiles.length === 0 ? [] : [...HARNESS_REPO_VALIDATION_COMMANDS],
  };
}

export function collectHarnessRepoValidationCapabilities() {
  return [
    {
      capability: "root-script-tests" as const,
      commands: ["bun run harness:test"],
    },
  ];
}

import { createHash } from "node:crypto";
import {
  HARNESS_APP_REGISTRY,
  VALIDATION_PLAN_POLICY,
  VALIDATION_TEST_MEMBERSHIP,
  VALIDATION_RUNTIME_RELATIONSHIPS,
  VALIDATION_IMPACT_TEST_PATTERNS,
  type CanonicalValidationCheck,
  type CanonicalValidationRegistry,
} from "./harness-app-registry";

/** Derived from authored scenario commands; this does not change legacy selection. */
export function collectCanonicalValidationRegistry(
  inventory: string[],
): CanonicalValidationRegistry {
  const checks = new Map<string, CanonicalValidationCheck>();
  const surfaces: CanonicalValidationRegistry["surfaces"] = [];
  const add = (
    argv: string[],
    cwd = ".",
    profile = "command",
    membership: string[] = [],
    stableId?: string,
  ) => {
    const id =
      stableId ??
      `athena.check.${createHash("sha256").update(JSON.stringify({ argv, cwd, profile })).digest("hex").slice(0, 16)}`;
    const old = checks.get(id);
    const inputs = [
      ...VALIDATION_PLAN_POLICY.sharedInputs,
      ...(cwd === "."
        ? []
        : [
            `${cwd}/package.json`,
            `${cwd}/tsconfig.json`,
            `${cwd}/vitest.config.ts`,
          ]),
    ];
    checks.set(id, {
      id,
      argv,
      cwd,
      profile,
      membership: sortUniquePaths([...(old?.membership ?? []), ...membership]),
      inputs: sortUniquePaths(inputs),
      absentInputs: [],
      prerequisites: [],
      supersedes: [],
    });
    return id;
  };
  const commandCheck = (
    command: string,
    packageDir = ".",
    stableId?: string,
  ) => {
    // Authored commands retain shell behavior unless they are the characterized plain test form.
    const match = command.match(
      /^bun run --filter ['"]?(@athena\/(?:webapp|storefront-webapp))['"]? test(?: -- (.+))?$/,
    );
    if (match) {
      const cwd =
        match[1] === "@athena/webapp"
          ? "packages/athena-webapp"
          : "packages/storefront-webapp";
      const tokens =
        match[2]
          ?.match(/'[^']*'|"[^"]*"|[^\s]+/g)
          ?.map((token) => token.replace(/^['"]|['"]$/g, "")) ?? [];
      if (
        tokens.some((token) => token.startsWith("-") || /[;&|<>`]/.test(token))
      )
        return add(["/bin/sh", "-c", command], ".", "opaque-command");
      const membership = inventory.filter(
        (file) =>
          file.startsWith(`${cwd}/`) &&
          (cwd === "packages/athena-webapp"
            ? VALIDATION_TEST_MEMBERSHIP.operatorUnit
            : VALIDATION_TEST_MEMBERSHIP.storefrontUnit
          ).test(file) &&
          (tokens.length === 0 ||
            tokens.some((token) => file.slice(cwd.length + 1).includes(token))),
      );
      // Stable execution identity excludes selected membership; the plan binds membership separately.
      return add(
        ["bun", "run", "test", "--"],
        cwd,
        `${cwd}:unit`,
        membership,
        stableId,
      );
    }
    const profile = /^bun run --filter ['"]?[^'" ]+['"]? typecheck$/.test(
      command,
    )
      ? "package-types"
      : command.includes("coverage")
        ? "aggregate-coverage"
        : command.includes("timing-parity")
          ? "timer-stress"
          : command.includes("test:e2e")
            ? "browser"
            : command.includes("harness:behavior")
              ? "behavior"
              : "command";
    const membership =
      profile === "aggregate-coverage"
        ? inventory.filter((file) =>
            [
              VALIDATION_TEST_MEMBERSHIP.operatorUnit,
              VALIDATION_TEST_MEMBERSHIP.storefrontUnit,
              VALIDATION_TEST_MEMBERSHIP.rootUnit,
            ].some((pattern) => pattern.test(file)),
          )
        : profile === "timer-stress"
          ? inventory.filter(
              (file) =>
                VALIDATION_TEST_MEMBERSHIP.operatorUnit.test(file) &&
                file.startsWith("packages/athena-webapp/src/lib/pos/"),
            )
          : profile === "browser"
            ? inventory.filter((file) =>
                (packageDir === "packages/storefront-webapp"
                  ? VALIDATION_TEST_MEMBERSHIP.storefrontBrowser
                  : VALIDATION_TEST_MEMBERSHIP.operatorBrowser
                ).test(file),
              )
            : command === "bun run harness:test"
              ? inventory.filter((file) =>
                  VALIDATION_TEST_MEMBERSHIP.rootUnit.test(file),
                )
              : [];
    return add(
      ["/bin/sh", "-c", command],
      ".",
      `${packageDir}:${profile}`,
      membership,
    );
  };
  const integrity = add(["bun", "run", "harness:check"], ".", "plan-integrity");
  const publishing = VALIDATION_PLAN_POLICY.publishingCommands.map((script) =>
    add(["bun", "run", script], ".", "docs-publishing"),
  );
  publishing.push(
    add(
      ["bun", "run", "--filter", "@athena/webapp", "build"],
      ".",
      "docs-publishing",
    ),
  );
  surfaces.push({
    id: "docs-publishing",
    pathPrefixes: [...VALIDATION_PLAN_POLICY.publishingPrefixes],
    checks: publishing,
    reason: "Reports and solutions are consumed by the docs publishing plugin",
  });
  const rootChecks = VALIDATION_PLAN_POLICY.fullHealthCommands.map((script) =>
    commandCheck(`bun run ${script}`),
  );
  surfaces.push({
    id: "repository-validation",
    pathPrefixes: [
      "scripts",
      ".github",
      ".husky",
      ".agents",
      ".agent-skills",
      "package.json",
      "bun.lockb",
      "bunfig.toml",
      "harness.config.ts",
      "AGENTS.md",
      "README.md",
      "packages/AGENTS.md",
      "manage-athena-versions.sh",
    ],
    checks: [integrity, ...rootChecks],
    reason:
      "Repository policy, runtime or validation wiring changed; broad root validation required",
  });
  surfaces.push({
    id: "generated-graph",
    pathPrefixes: ["graphify-out"],
    checks: [commandCheck("bun run graphify:check")],
    reason: "Validate generated navigation artifacts",
  });
  surfaces.push({
    id: "delivery-records",
    pathPrefixes: ["telemetry/delivery-runs"],
    checks: [commandCheck("bun run delivery:telemetry-check")],
    reason: "Validate retained delivery record",
  });
  for (const app of HARNESS_APP_REGISTRY) {
    const workspace =
      app.appName === "athena-webapp"
        ? "@athena/webapp"
        : app.appName === "storefront-webapp"
          ? "@athena/storefront-webapp"
          : "valkey-proxy-server";
    for (const scenario of app.validationScenarios) {
      const scenarioChecks = scenario.commands.map((command, index) =>
        commandCheck(
          command.kind === "raw"
            ? command.command
            : `bun run --filter '${workspace}' ${command.script}`,
          app.packageDir,
          `${scenario.id}.check-${index}`,
        ),
      );
      for (const behavior of scenario.behaviorScenarios ?? [])
        scenarioChecks.push(
          commandCheck(`bun run harness:behavior -- --scenario ${behavior}`),
        );
      surfaces.push({
        id: scenario.id,
        pathPrefixes: scenario.touchedPaths.map(
          (p) => `${app.packageDir}/${p}`,
        ),
        checks: sortUniquePaths(scenarioChecks),
        reason: scenario.note,
      });
    }
    surfaces.push({
      id: `${app.appName}.harness-docs`,
      pathPrefixes: [
        `${app.packageDir}/AGENTS.md`,
        `${app.packageDir}/docs/agent`,
      ],
      checks: [integrity, ...rootChecks],
      reason: "Generated and authored package harness documentation contract",
    });
  }
  const impactPackages: NonNullable<
    CanonicalValidationRegistry["impact"]
  >["packages"] = [];
  for (const [root, patterns] of Object.entries(
    VALIDATION_IMPACT_TEST_PATTERNS,
  )) {
    const unitChecks = [...checks.values()]
      .filter((check) => check.cwd === root && check.profile.endsWith(":unit"))
      .map((check) => check.id);
    const workspace =
      root === "packages/athena-webapp"
        ? "@athena/webapp"
        : root === "packages/storefront-webapp"
          ? "@athena/storefront-webapp"
          : "valkey-proxy-server";
    const fallbackChecks =
      root === "."
        ? [commandCheck("bun run harness:test")]
        : [
            add(
              ["bun", "run", "--filter", workspace, "test"],
              ".",
              `${root}:fallback-suite`,
            ),
          ];
    if (root !== "." && workspace !== "valkey-proxy-server") {
      fallbackChecks.push(
        add(
          ["bun", "run", "--filter", workspace, "typecheck"],
          ".",
          `${root}:package-types`,
        ),
        add(
          ["bun", "run", "--filter", workspace, "build"],
          ".",
          `${root}:package-build`,
        ),
      );
    }
    impactPackages.push({
      root,
      testPatterns: [...patterns],
      unitChecks,
      fallbackChecks: [...unitChecks, ...fallbackChecks],
    });
  }
  const relationships = VALIDATION_RUNTIME_RELATIONSHIPS.map((contract) => ({
    id: contract.id,
    inputs: [...contract.inputs],
    consumers: [...contract.consumers],
    ...("kind" in contract ? { kind: contract.kind } : {}),
    ...("guards" in contract ? { guards: { ...contract.guards } } : {}),
    ...("lazyProducers" in contract
      ? { lazyProducers: { ...contract.lazyProducers } }
      : {}),
    ...("publishing" in contract ? { publishingChecks: publishing } : {}),
    ...("command" in contract
      ? { checks: [commandCheck(contract.command)] }
      : {}),
    ...("boundedConsumers" in contract
      ? { boundedConsumers: { ...contract.boundedConsumers } }
      : {}),
  }));
  return {
    schemaVersion: "athena-validation-registry/1",
    checks: [...checks.values()].sort((a, b) => a.id.localeCompare(b.id)),
    surfaces,
    alwaysRequired: [integrity],
    impact: { packages: impactPackages, relationships },
  };
}
