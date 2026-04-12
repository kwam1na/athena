import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  HARNESS_APP_REGISTRY,
  type HarnessAppName,
  type ValidationCommand,
} from "./harness-app-registry";
import { validateHarnessDocs } from "./harness-check";

const AUDIT_TARGETS = HARNESS_APP_REGISTRY.map((app) => ({
  appName: app.appName,
  auditedRoots: app.auditedRoots,
  testingDocPath: app.harnessDocs.testingPath,
  validationMapPath: app.harnessDocs.validationMapPath,
}));

type ValidationSurface = {
  name: string;
  pathPrefixes: string[];
  commands: ValidationCommand[];
  behaviorScenarios?: string[];
};

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

async function readJsonFile<T>(filePath: string) {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

function normalizeValidationCommand(
  command: ValidationCommand
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
  error: string
) {
  const existingErrors = groupedErrors.get(group);
  if (existingErrors) {
    existingErrors.push(error);
    return;
  }

  groupedErrors.set(group, [error]);
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
  auditedRoots: readonly string[]
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
        path.posix.join(packageDir, auditedRoot, entry.name)
      );
      liveEntries.add(entry.isDirectory() ? `${repoPath}/` : repoPath);
    }
  }

  return [...liveEntries].sort();
}

async function loadAuditTarget(
  rootDir: string,
  target: (typeof AUDIT_TARGETS)[number]
) {
  const groupedErrors = new Map<string, string[]>();
  const absoluteValidationMapPath = path.join(rootDir, target.validationMapPath);
  const absoluteTestingDocPath = path.join(rootDir, target.testingDocPath);
  const [validationMapExists, testingDocExists] = await Promise.all([
    fileExists(absoluteValidationMapPath),
    fileExists(absoluteTestingDocPath),
  ]);

  if (!validationMapExists && !testingDocExists) {
    return {
      groupedErrors,
      loadedTarget: null,
    };
  }

  if (!validationMapExists) {
    addGroupedError(
      groupedErrors,
      target.appName,
      `Missing validation map: ${target.validationMapPath}`
    );
    return {
      groupedErrors,
      loadedTarget: null,
    };
  }

  if (!testingDocExists) {
    addGroupedError(
      groupedErrors,
      target.appName,
      `Missing testing guide: ${target.testingDocPath}`
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
        `Stale harness audit docs: ${target.testingDocPath} must mention ${requiredSnippet}.`
      );
    }
  }

  const validationMap = await readJsonFile<ValidationMap>(absoluteValidationMapPath);
  const packageJsonPath = path.join(rootDir, validationMap.packageDir, "package.json");

  if (!(await fileExists(packageJsonPath))) {
    addGroupedError(
      groupedErrors,
      target.appName,
      `Stale validation map: ${target.validationMapPath} references missing package surface "${validationMap.packageDir}".`
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
      `Stale validation map: ${target.validationMapPath} expected workspace "${validationMap.workspace}" at ${validationMap.packageDir}.`
    );
  }

  const surfaces = Array.isArray(validationMap.surfaces)
    ? validationMap.surfaces
    : [];

  if (surfaces.length === 0) {
    addGroupedError(
      groupedErrors,
      target.appName,
      `Missing validation surfaces in ${target.validationMapPath}.`
    );
  }

  for (const surface of surfaces) {
    if (!Array.isArray(surface.pathPrefixes) || surface.pathPrefixes.length === 0) {
      addGroupedError(
        groupedErrors,
        target.appName,
        `Empty validation surface "${surface.name}" in ${target.validationMapPath}.`
      );
    }

    if (!Array.isArray(surface.commands)) {
      addGroupedError(
        groupedErrors,
        target.appName,
        `Missing commands for validation surface "${surface.name}" in ${target.validationMapPath}.`
      );
      continue;
    }

    for (const pathPrefix of surface.pathPrefixes) {
      if (!(await fileExists(path.join(rootDir, pathPrefix)))) {
        addGroupedError(
          groupedErrors,
          target.appName,
          `Stale validation surface: ${pathPrefix}`
        );
      }
    }

    for (const command of surface.commands.map(normalizeValidationCommand)) {
      if (command.kind === "script") {
        if (!packageJson.scripts?.[command.script]) {
          addGroupedError(
            groupedErrors,
            target.appName,
            `Stale validation surface: ${target.validationMapPath} references missing script "${validationMap.workspace}:${command.script}".`
          );
        }
        continue;
      }

      if (!command.command) {
        addGroupedError(
          groupedErrors,
          target.appName,
          `Stale validation surface: ${target.validationMapPath} includes an empty raw command in "${surface.name}".`
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
        `Stale validation surface: ${target.validationMapPath} includes invalid behavior scenarios in "${surface.name}".`
      );
    }

    for (const scenario of surface.behaviorScenarios ?? []) {
      if (typeof scenario !== "string" || !normalizeBehaviorScenarioName(scenario)) {
        addGroupedError(
          groupedErrors,
          target.appName,
          `Stale validation surface: ${target.validationMapPath} includes an empty behavior scenario in "${surface.name}".`
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
        name: surface.name,
        pathPrefixes: surface.pathPrefixes.map(normalizeRepoPath),
        commands: surface.commands.map(normalizeValidationCommand),
        behaviorScenarios: (surface.behaviorScenarios ?? []).map(
          normalizeBehaviorScenarioName
        ),
      })),
      testingDocContents,
    } satisfies LoadedAuditTarget,
  };
}

function formatGroupedErrors(groupedErrors: Map<string, string[]>) {
  const lines = ["Harness audit failed."];

  for (const [group, errors] of [...groupedErrors.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
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

  for (const error of await validateHarnessDocs(rootDir)) {
    addGroupedError(groupedErrors, inferGroupFromError(error), error);
  }

  const loadedTargets: LoadedAuditTarget[] = [];
  for (const target of AUDIT_TARGETS) {
    const { groupedErrors: targetErrors, loadedTarget } = await loadAuditTarget(
      rootDir,
      target
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
      target.auditedRoots
    );
    const coveredPrefixes = target.surfaces.flatMap((surface) => surface.pathPrefixes);

    for (const liveSurfaceEntry of liveSurfaceEntries) {
      if (
        !coveredPrefixes.some((pathPrefix) =>
          matchesPathPrefix(liveSurfaceEntry, pathPrefix)
        )
      ) {
        addGroupedError(
          groupedErrors,
          target.appName,
          `Uncovered live surface: ${liveSurfaceEntry}`
        );
      }
    }

    if (!target.testingDocContents.includes(target.appName)) {
      // no-op placeholder to keep testing doc contents loaded for future audits
    }
  }

  if (groupedErrors.size > 0) {
    throw new Error(formatGroupedErrors(groupedErrors));
  }

  console.log(
    `Harness audit passed for ${AUDIT_TARGETS.map((target) => target.appName).join(", ")}.`
  );
}

if (import.meta.main) {
  await runHarnessAudit(process.cwd());
}
