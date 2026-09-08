import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  HARNESS_APP_REGISTRY,
  type HarnessAppName,
  type ValidationCommand,
} from "./harness-app-registry";
import { importHarnessConfig } from "../.agent-skills/current/runtime/cli-api.mjs";
import { validateHarnessConfig } from "../.agent-skills/current/runtime/kernel.mjs";
import {
  createHarnessBlocker,
  HarnessBlockedError,
  runHarnessCliBoundary,
} from "./harness-blockers";
import { validateHarnessDocs } from "./harness-check";

const AUDIT_TARGETS = HARNESS_APP_REGISTRY.map((app) => ({
  appName: app.appName,
  auditedRoots: app.auditedRoots,
  testingDocPath: app.harnessDocs.testingPath,
  validationMapPath: app.harnessDocs.validationMapPath,
}));

type ValidationSurface = {
  id: string;
  reviewSensitive: boolean;
  name: string;
  pathPrefixes: string[];
  commands: ValidationCommand[];
  behaviorScenarios?: string[];
};

export const DELIVERY_PRODUCT_SCRIPTS: Readonly<Record<string, string>> = {
  "pr:athena": "bun run pr:athena:delivery-run",
  "pr:athena:delivery-run": "bun scripts/pr-athena-delivery-run.ts",
  "pr:athena:prepare": "bun scripts/delivery-product.ts prepare",
  "pr:athena:validate": "bun scripts/delivery-product.ts gate",
  "pr:athena:validate-provider": "bun scripts/delivery-product.ts gate",
  "harness:review-context":
    "bun scripts/delivery-product.ts review-context --json",
  "harness:review-evidence": "bun scripts/delivery-product.ts submit-evidence",
  "harness:review-outcome":
    "bun scripts/delivery-product.ts emit-review-evidence",
  "delivery:record": "bun scripts/delivery-product.ts record",
  "delivery:verify": "bun scripts/delivery-product.ts verify",
};

export async function auditHarnessGateObligationContract(rootDir: string) {
  const findings: string[] = [];
  const packagePath = path.join(rootDir, "package.json");
  // A package-only audit has no root delivery contract.
  if (!(await fileExists(packagePath))) return findings;
  try {
    const loaded = await importHarnessConfig(rootDir);
    const validation = validateHarnessConfig(loaded);
    if (validation.ok === false) {
      findings.push(...validation.blockers.map((blocker) => blocker.summary));
    } else {
      const config = validation.config;
      const declared = HARNESS_APP_REGISTRY.flatMap((app) =>
        app.validationScenarios
          .filter((scenario) => scenario.reviewSensitive)
          .map((scenario) => scenario.id),
      ).sort();
      const configured = config.sensitivePaths.map((group) => group.id).sort();
      if (JSON.stringify(declared) !== JSON.stringify(configured)) {
        findings.push(
          "Product sensitive groups must exactly cover Athena review-sensitive scenarios.",
        );
      }
      if (config.activationThreshold !== 50)
        findings.push("Athena review activation threshold must remain 50.");
      for (const id of [
        "review.green",
        "validation.passed",
        "documentation.accepted",
        "documentation.current",
        "telemetry.recorded",
      ]) {
        if (!config.obligations.some((obligation) => obligation.id === id))
          findings.push(
            `Product policy is missing required Athena obligation ${id}.`,
          );
      }
      if (
        !config.preparationCommands?.some(
          (command) =>
            JSON.stringify(command.command) ===
            JSON.stringify(["bun", "run", "pr:athena:mechanical"]),
        )
      ) {
        findings.push(
          "Product preparation must execute Athena mechanical checks before review.",
        );
      }
      if (config.ciPolicies.length !== 0)
        findings.push(
          "Athena CI must verify the product record rather than delegate obligations.",
        );
    }
  } catch (error) {
    findings.push(
      `Installed product configuration could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const packageJson = await readJsonFile<{ scripts?: Record<string, string> }>(
    packagePath,
  );
  const scripts = packageJson.scripts ?? {};
  for (const [script, expected] of Object.entries(DELIVERY_PRODUCT_SCRIPTS)) {
    if (scripts[script] !== expected)
      findings.push(
        `Public gate script ${script} must be exactly: ${expected}`,
      );
  }
  for (const repoPath of [
    "harness.config.ts",
    "scripts/delivery-product.ts",
    ".agent-skills/current/runtime/kernel.mjs",
    ".agent-skills/current/runtime/cli-api.mjs",
  ]) {
    if (!(await fileExists(path.join(rootDir, repoPath))))
      findings.push(`Installed delivery contract is missing ${repoPath}`);
  }
  for (const name of [
    "harness-candidate",
    "harness-review-identity",
    "harness-gate-registry",
    "harness-gate-obligations",
    "harness-obligation-records",
    "harness-delivery-run-ledger",
  ]) {
    if (await fileExists(path.join(rootDir, `scripts/${name}.ts`)))
      findings.push(
        `Retired delivery engine must be absent: scripts/${name}.ts`,
      );
  }
  const workflowPath = path.join(
    rootDir,
    ".github/workflows/athena-pr-tests.yml",
  );
  const hasWorkflow = await fileExists(workflowPath);
  if (!hasWorkflow)
    findings.push("Athena CI product verification workflow is missing.");
  const workflow = hasWorkflow ? await readFile(workflowPath, "utf8") : "";
  for (const token of [
    "ATHENA_HARNESS_CI_POLICY",
    "--repo-validation-provided-by",
    "--provider-evidence",
    "--validation-provided-by",
  ]) {
    if (
      workflow.includes(token) ||
      Object.values(scripts).some((script) => script.includes(token))
    )
      findings.push(`Retired CI delegation bypass must be absent: ${token}`);
  }
  for (const token of [
    "github.event.pull_request.head.sha",
    "bun run delivery:verify",
  ]) {
    if (!workflow.includes(token))
      findings.push(`Athena CI product verification is missing ${token}`);
  }
  return findings.sort((left, right) => left.localeCompare(right));
}

type ValidationMap = {
  workspace: string;
  packageDir: string;
  surfaces: ValidationSurface[];
};

type LoadedAuditTarget = {
  appName: HarnessAppName;
  auditedRoots: readonly string[];
  packageDir: string;
  surfaces: ValidationSurface[];
  testingDocContents: string;
};

function normalizeRepoPath(repoPath: string) {
  return repoPath.replaceAll("\\", "/");
}

function matchesPathPrefix(filePath: string, pathPrefix: string) {
  const normalizedFilePath = normalizeRepoPath(filePath);
  const normalizedPathPrefix = normalizeRepoPath(pathPrefix);

  if (normalizedPathPrefix.endsWith("/")) {
    return normalizedFilePath.startsWith(normalizedPathPrefix);
  }

  return (
    normalizedFilePath === normalizedPathPrefix ||
    normalizedFilePath.startsWith(`${normalizedPathPrefix}/`)
  );
}

async function fileExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function hasAnyHarnessDocs(
  rootDir: string,
  target: { testingDocPath: string; validationMapPath: string },
) {
  const packageDocsRoot = path.dirname(target.testingDocPath);

  for (const repoRelativePath of [
    target.testingDocPath,
    target.validationMapPath,
    path.posix.join(packageDocsRoot, "index.md"),
    path.posix.join(path.posix.dirname(packageDocsRoot), "AGENTS.md"),
  ]) {
    if (await fileExists(path.join(rootDir, repoRelativePath))) {
      return true;
    }
  }

  return false;
}

async function readJsonFile<T>(filePath: string) {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

function normalizeValidationCommand(
  command: ValidationCommand,
): ValidationCommand {
  return command.kind === "raw"
    ? { kind: "raw", command: command.command.trim() }
    : { kind: "script", script: command.script };
}

function normalizeBehaviorScenarioName(scenario: string) {
  return scenario.trim();
}

function addGroupedError(
  groupedErrors: Map<string, string[]>,
  group: string,
  error: string,
) {
  const existingErrors = groupedErrors.get(group);
  if (existingErrors) {
    existingErrors.push(error);
    return;
  }

  groupedErrors.set(group, [error]);
}

function formatMissingValidationPathError(
  validationMapPath: string,
  pathPrefix: string,
) {
  return [
    `Stale validation surface: ${validationMapPath} references missing path "${pathPrefix}".`,
    `Fixture drift: add "${pathPrefix}" to the harness audit fixture, or repo drift: remove or update the stale validation-map path.`,
  ].join(" ");
}

function inferGroupFromError(error: string) {
  const match = error.match(/packages\/([^/]+)\//);
  return match?.[1] ?? "repo";
}

function shouldSkipSurfaceEntry(entryName: string) {
  return (
    entryName.startsWith(".") ||
    entryName === "_generated" ||
    entryName === "AGENTS.md" ||
    entryName === "docs" ||
    entryName === "README.md" ||
    entryName === "package.json" ||
    entryName === "coverage" ||
    entryName === "dist" ||
    entryName === "node_modules"
  );
}

async function collectLiveSurfaceEntries(
  rootDir: string,
  packageDir: string,
  auditedRoots: readonly string[],
) {
  const liveEntries = new Set<string>();

  for (const auditedRoot of auditedRoots) {
    const absoluteRoot = path.join(rootDir, packageDir, auditedRoot);
    if (!(await fileExists(absoluteRoot))) {
      continue;
    }

    const entries = await readdir(absoluteRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (shouldSkipSurfaceEntry(entry.name)) {
        continue;
      }

      const repoPath = normalizeRepoPath(
        path.posix.join(packageDir, auditedRoot, entry.name),
      );
      liveEntries.add(entry.isDirectory() ? `${repoPath}/` : repoPath);
    }
  }

  return [...liveEntries].sort();
}

async function loadAuditTarget(
  rootDir: string,
  target: (typeof AUDIT_TARGETS)[number],
) {
  const groupedErrors = new Map<string, string[]>();
  const absoluteValidationMapPath = path.join(
    rootDir,
    target.validationMapPath,
  );
  const absoluteTestingDocPath = path.join(rootDir, target.testingDocPath);
  if (!(await fileExists(absoluteValidationMapPath))) {
    addGroupedError(
      groupedErrors,
      target.appName,
      `Missing validation map: ${target.validationMapPath}`,
    );
    return {
      groupedErrors,
      loadedTarget: null,
    };
  }

  if (!(await fileExists(absoluteTestingDocPath))) {
    addGroupedError(
      groupedErrors,
      target.appName,
      `Missing testing guide: ${target.testingDocPath}`,
    );
    return {
      groupedErrors,
      loadedTarget: null,
    };
  }

  const testingDocContents = await readFile(absoluteTestingDocPath, "utf8");
  for (const requiredSnippet of [
    "`bun run harness:check`",
    "`bun run harness:review`",
    "`bun run harness:audit`",
    "(./validation-map.json)",
  ]) {
    if (!testingDocContents.includes(requiredSnippet)) {
      addGroupedError(
        groupedErrors,
        target.appName,
        `Stale harness audit docs: ${target.testingDocPath} must mention ${requiredSnippet}.`,
      );
    }
  }

  const validationMap = await readJsonFile<ValidationMap>(
    absoluteValidationMapPath,
  );
  const packageJsonPath = path.join(
    rootDir,
    validationMap.packageDir,
    "package.json",
  );

  if (!(await fileExists(packageJsonPath))) {
    addGroupedError(
      groupedErrors,
      target.appName,
      `Stale validation map: ${target.validationMapPath} references missing package surface "${validationMap.packageDir}".`,
    );
    return {
      groupedErrors,
      loadedTarget: null,
    };
  }

  const packageJson = await readJsonFile<{
    name?: string;
    scripts?: Record<string, string>;
  }>(packageJsonPath);

  if (packageJson.name !== validationMap.workspace) {
    addGroupedError(
      groupedErrors,
      target.appName,
      `Stale validation map: ${target.validationMapPath} expected workspace "${validationMap.workspace}" at ${validationMap.packageDir}.`,
    );
  }

  const surfaces = Array.isArray(validationMap.surfaces)
    ? validationMap.surfaces
    : [];

  if (surfaces.length === 0) {
    addGroupedError(
      groupedErrors,
      target.appName,
      `Missing validation surfaces in ${target.validationMapPath}.`,
    );
  }

  for (const surface of surfaces) {
    if (!surface.id || typeof surface.reviewSensitive !== "boolean") {
      addGroupedError(
        groupedErrors,
        target.appName,
        `Validation surface ${surface.name ?? "<unknown>"} is missing a stable id or explicit reviewSensitive boolean.`,
      );
    }
    if (
      !Array.isArray(surface.pathPrefixes) ||
      surface.pathPrefixes.length === 0
    ) {
      addGroupedError(
        groupedErrors,
        target.appName,
        `Empty validation surface "${surface.name}" in ${target.validationMapPath}.`,
      );
    }

    if (!Array.isArray(surface.commands)) {
      addGroupedError(
        groupedErrors,
        target.appName,
        `Missing commands for validation surface "${surface.name}" in ${target.validationMapPath}.`,
      );
      continue;
    }

    for (const pathPrefix of surface.pathPrefixes) {
      if (!(await fileExists(path.join(rootDir, pathPrefix)))) {
        addGroupedError(
          groupedErrors,
          target.appName,
          formatMissingValidationPathError(
            target.validationMapPath,
            pathPrefix,
          ),
        );
      }
    }

    for (const command of surface.commands.map(normalizeValidationCommand)) {
      if (command.kind === "script") {
        if (!packageJson.scripts?.[command.script]) {
          addGroupedError(
            groupedErrors,
            target.appName,
            `Stale validation surface: ${target.validationMapPath} references missing script "${validationMap.workspace}:${command.script}".`,
          );
        }
        continue;
      }

      if (!command.command) {
        addGroupedError(
          groupedErrors,
          target.appName,
          `Stale validation surface: ${target.validationMapPath} includes an empty raw command in "${surface.name}".`,
        );
      }
    }

    if (
      surface.behaviorScenarios !== undefined &&
      !Array.isArray(surface.behaviorScenarios)
    ) {
      addGroupedError(
        groupedErrors,
        target.appName,
        `Stale validation surface: ${target.validationMapPath} includes invalid behavior scenarios in "${surface.name}".`,
      );
    }

    for (const scenario of surface.behaviorScenarios ?? []) {
      if (
        typeof scenario !== "string" ||
        !normalizeBehaviorScenarioName(scenario)
      ) {
        addGroupedError(
          groupedErrors,
          target.appName,
          `Stale validation surface: ${target.validationMapPath} includes an empty behavior scenario in "${surface.name}".`,
        );
      }
    }
  }

  return {
    groupedErrors,
    loadedTarget: {
      appName: target.appName,
      auditedRoots: target.auditedRoots,
      packageDir: normalizeRepoPath(validationMap.packageDir),
      surfaces: surfaces.map((surface) => ({
        id: surface.id,
        reviewSensitive: surface.reviewSensitive,
        name: surface.name,
        pathPrefixes: surface.pathPrefixes.map(normalizeRepoPath),
        commands: surface.commands.map(normalizeValidationCommand),
        behaviorScenarios: (surface.behaviorScenarios ?? []).map(
          normalizeBehaviorScenarioName,
        ),
      })),
      testingDocContents,
    } satisfies LoadedAuditTarget,
  };
}

function formatGroupedErrors(groupedErrors: Map<string, string[]>) {
  const lines = ["Harness audit failed."];

  for (const [group, errors] of [...groupedErrors.entries()].sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    lines.push(`[${group}]`);
    for (const error of [...errors].sort()) {
      lines.push(`- ${error}`);
    }
  }

  return lines.join("\n");
}

export async function runHarnessAudit(rootDir: string) {
  const groupedErrors = new Map<string, string[]>();

  for (const error of await auditHarnessGateObligationContract(rootDir)) {
    addGroupedError(groupedErrors, "gate-obligations", error);
  }

  for (const error of await validateHarnessDocs(rootDir)) {
    addGroupedError(groupedErrors, inferGroupFromError(error), error);
  }

  const loadedTargets: LoadedAuditTarget[] = [];
  const auditTargets = [];
  for (const app of HARNESS_APP_REGISTRY) {
    const target = {
      appName: app.appName,
      auditedRoots: app.auditedRoots,
      testingDocPath: app.harnessDocs.testingPath,
      validationMapPath: app.harnessDocs.validationMapPath,
    };
    if (
      app.onboardingStatus === "planned" &&
      !(await hasAnyHarnessDocs(rootDir, target))
    ) {
      continue;
    }
    auditTargets.push(target);
  }

  for (const target of auditTargets) {
    const { groupedErrors: targetErrors, loadedTarget } = await loadAuditTarget(
      rootDir,
      target,
    );

    for (const [group, errors] of targetErrors) {
      for (const error of errors) {
        addGroupedError(groupedErrors, group, error);
      }
    }

    if (loadedTarget) {
      loadedTargets.push(loadedTarget);
    }
  }

  for (const target of loadedTargets) {
    const liveSurfaceEntries = await collectLiveSurfaceEntries(
      rootDir,
      target.packageDir,
      target.auditedRoots,
    );
    const coveredPrefixes = target.surfaces.flatMap(
      (surface) => surface.pathPrefixes,
    );

    for (const liveSurfaceEntry of liveSurfaceEntries) {
      if (
        !coveredPrefixes.some((pathPrefix) =>
          matchesPathPrefix(liveSurfaceEntry, pathPrefix),
        )
      ) {
        addGroupedError(
          groupedErrors,
          target.appName,
          `Uncovered live surface: ${liveSurfaceEntry}`,
        );
      }
    }

    if (!target.testingDocContents.includes(target.appName)) {
      // no-op placeholder to keep testing doc contents loaded for future audits
    }
  }

  if (groupedErrors.size > 0) {
    // Expected audit findings, so they carry their own code and repair rather
    // than arriving as an unexpected internal error.
    throw new HarnessBlockedError([
      createHarnessBlocker({
        code: "harness_audit_failed",
        source: { kind: "command", id: "harness:audit" },
        summary: `The harness audit found issues in ${groupedErrors.size} area(s).`,
        details: formatGroupedErrors(groupedErrors),
        remediations: [
          {
            id: "regenerate-harness-docs",
            kind: "command",
            command: ["bun", "run", "harness:generate"],
            summary: "Regenerate the harness docs from their registry sources.",
          },
          {
            id: "resolve-harness-audit-findings",
            kind: "code_change",
            summary:
              "Resolve each audited finding at its source; the audit reports app-registry and documentation drift, not a transient failure.",
          },
        ],
      }),
      // The message keeps the grouped detail so programmatic callers that only
      // see the thrown Error still get the full diagnostic.
    ], formatGroupedErrors(groupedErrors));
  }

  console.log(
    `Harness audit passed for ${AUDIT_TARGETS.map((target) => target.appName).join(", ")}.`,
  );
}

if (import.meta.main) {
  process.exitCode = await runHarnessCliBoundary({
    source: { kind: "command", id: "harness:audit" },
    reproduce: ["bun", "run", "harness:audit"],
    run: () => runHarnessAudit(process.cwd()),
  });
}
