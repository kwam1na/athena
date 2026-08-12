import { readFile } from "node:fs/promises";
import path from "node:path";

import { HARNESS_APP_REGISTRY } from "./harness-app-registry";
import { getChangedFilesForHarnessReview } from "./harness-review";

/**
 * The mechanical gate: deterministic, per-package checks that need no human
 * judgement and no review evidence to run.
 *
 * They used to live only inside the heavy `pr:athena` provider, which is gated
 * behind `review.green`. A lint rule could therefore only fail *after* an
 * expensive multi-agent review had been recorded, and the one-line fix then
 * invalidated that review. Running them as the last stage of
 * `pr:athena:prepare` makes the ordering structural: no preparation receipt for
 * a tree that fails a mechanical rule, and no review context or gate admission
 * without a receipt.
 *
 * Keep this list deterministic and cheap. Tests, builds, and typecheck stay in
 * the heavy provider; a check that needs minutes does not belong in every
 * prepare.
 */
export const MECHANICAL_PACKAGE_SCRIPTS = [
  "lint:convex:changed",
  "lint:frontend:changed",
  "lint:architecture",
] as const;

export type MechanicalPackageScript =
  (typeof MECHANICAL_PACKAGE_SCRIPTS)[number];

export type MechanicalCommand = {
  packageDir: string;
  script: MechanicalPackageScript;
};

export type MechanicalFailure = {
  command: string;
  exitCode: number | null;
  reason: string;
};

export type HarnessMechanicalCheckResult = {
  status: "pass" | "fail";
  changedFileCount: number;
  ranCommands: string[];
  skippedCommands: string[];
  failures: MechanicalFailure[];
};

type PackageManifest = { name?: string; scripts?: Record<string, string> };

type MechanicalCheckOptions = {
  baseRef?: string;
  getChangedFiles?: (rootDir: string, baseRef?: string) => Promise<string[]>;
  readPackageManifest?: (
    packageDir: string,
    rootDir: string,
  ) => Promise<PackageManifest | null>;
  runPackageScript?: (
    rootDir: string,
    workspace: string,
    script: string,
  ) => Promise<number>;
  logger?: Pick<Console, "log" | "error">;
};

const DEFAULT_BASE_REF = "origin/main";

function normalizeRepoPath(repoPath: string) {
  return repoPath.replaceAll("\\", "/").replace(/^\.\//, "");
}

function isMechanicalScript(script: string): script is MechanicalPackageScript {
  return (MECHANICAL_PACKAGE_SCRIPTS as readonly string[]).includes(script);
}

function matchesTouchedPath(
  changedFile: string,
  packageDir: string,
  touchedPath: string,
) {
  const prefix = normalizeRepoPath(
    `${normalizeRepoPath(packageDir)}/${normalizeRepoPath(touchedPath)}`,
  );
  const normalizedFile = normalizeRepoPath(changedFile);
  return (
    normalizedFile === prefix || normalizedFile.startsWith(`${prefix}/`)
  );
}

/**
 * Selection reuses the same registry scenarios `harness:review` selects from,
 * so the mechanical gate can never drift into checking a surface the validation
 * map does not own.
 */
export function selectMechanicalCommands(
  changedFiles: readonly string[],
): MechanicalCommand[] {
  const selected: MechanicalCommand[] = [];
  const seen = new Set<string>();

  for (const app of HARNESS_APP_REGISTRY) {
    for (const scenario of app.validationScenarios) {
      const matched = changedFiles.some((changedFile) =>
        scenario.touchedPaths.some((touchedPath) =>
          matchesTouchedPath(changedFile, app.packageDir, touchedPath),
        ),
      );
      if (!matched) continue;

      for (const command of scenario.commands) {
        if (command.kind !== "script" || !isMechanicalScript(command.script)) {
          continue;
        }
        const key = `${app.packageDir}:${command.script}`;
        if (seen.has(key)) continue;
        seen.add(key);
        selected.push({ packageDir: app.packageDir, script: command.script });
      }
    }
  }

  return selected;
}

async function defaultReadPackageManifest(
  packageDir: string,
  rootDir: string,
): Promise<PackageManifest | null> {
  try {
    return JSON.parse(
      await readFile(path.join(rootDir, packageDir, "package.json"), "utf8"),
    ) as PackageManifest;
  } catch {
    return null;
  }
}

async function defaultRunPackageScript(
  rootDir: string,
  workspace: string,
  script: string,
) {
  const child = Bun.spawn(["bun", "run", "--filter", workspace, script], {
    cwd: rootDir,
    stdout: "inherit",
    stderr: "inherit",
  });
  return child.exited;
}

export async function runHarnessMechanicalCheck(
  rootDir: string,
  options: MechanicalCheckOptions = {},
): Promise<HarnessMechanicalCheckResult> {
  const logger = options.logger ?? console;
  const baseRef = options.baseRef ?? DEFAULT_BASE_REF;
  const changedFiles = await (
    options.getChangedFiles ?? getChangedFilesForHarnessReview
  )(rootDir, baseRef);
  const selected = selectMechanicalCommands(changedFiles);
  const readManifest =
    options.readPackageManifest ?? defaultReadPackageManifest;
  const runPackageScript = options.runPackageScript ?? defaultRunPackageScript;
  const ranCommands: string[] = [];
  const skippedCommands: string[] = [];
  const failures: MechanicalFailure[] = [];

  for (const command of selected) {
    const manifest = await readManifest(command.packageDir, rootDir);
    const workspace = manifest?.name;
    if (!workspace) {
      failures.push({
        command: `${command.packageDir}:${command.script}`,
        exitCode: null,
        reason: `could not read a workspace name from ${command.packageDir}/package.json`,
      });
      continue;
    }
    const displayName = `${workspace}:${command.script}`;
    if (!manifest.scripts?.[command.script]) {
      skippedCommands.push(displayName);
      continue;
    }

    logger.log(`[pr:athena] Mechanical check: ${displayName}`);
    const exitCode = await runPackageScript(
      rootDir,
      workspace,
      command.script,
    );
    if (exitCode !== 0) {
      failures.push({
        command: displayName,
        exitCode,
        reason: `${displayName} exited with code ${exitCode}`,
      });
      continue;
    }
    ranCommands.push(displayName);
  }

  return {
    status: failures.length === 0 ? "pass" : "fail",
    changedFileCount: changedFiles.length,
    ranCommands,
    skippedCommands,
    failures,
  };
}

export function formatMechanicalCheckFailure(
  result: HarnessMechanicalCheckResult,
) {
  return [
    `Mechanical checks failed for ${result.failures.length} command(s):`,
    ...result.failures.map((failure) => `- ${failure.reason}`),
    "",
    "These are deterministic rules, not review judgement. Fix them and prepare again;",
    "no review evidence should be spent on a tree that cannot pass them.",
  ].join("\n");
}

async function main() {
  const result = await runHarnessMechanicalCheck(process.cwd());
  if (result.status === "fail") {
    console.error(formatMechanicalCheckFailure(result));
    process.exit(1);
  }
  console.log(
    result.ranCommands.length === 0
      ? "Mechanical checks: no deterministic package checks selected for the changed files."
      : `Mechanical checks passed: ${result.ranCommands.join(", ")}.`,
  );
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
