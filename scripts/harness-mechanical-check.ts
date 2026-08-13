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
 * Keep this set deterministic. Tests and builds stay in the heavy provider
 * because they are neither cheap nor purely mechanical; project typecheck is
 * included because it is exactly the deterministic class the ticket names
 * (lint/format/typecheck) and ~45s at prepare is far cheaper than the review
 * round a late type error would invalidate.
 */
export const MECHANICAL_PACKAGE_SCRIPTS = [
  "lint:convex:changed",
  "lint:frontend:changed",
  "lint:architecture",
] as const;

/**
 * Registry `raw` commands that qualify as mechanical. Matched by shape rather
 * than by a copied literal so a registry edit cannot silently drop the check,
 * and kept strict enough that the command can be spawned as argv with no shell:
 * anything carrying an operator, redirect, or extra argument fails the match.
 */
const MECHANICAL_RAW_COMMAND_PATTERN =
  /^bunx tsc --noEmit -p packages\/[a-z0-9-]+\/tsconfig\.json$/;

export function isMechanicalRawCommand(command: string) {
  return MECHANICAL_RAW_COMMAND_PATTERN.test(command.trim());
}

export type MechanicalPackageScript =
  (typeof MECHANICAL_PACKAGE_SCRIPTS)[number];

export type MechanicalCommand =
  | { kind: "script"; packageDir: string; script: MechanicalPackageScript }
  | { kind: "raw"; command: string };

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
  runRawCommand?: (rootDir: string, command: string) => Promise<number>;
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
  const normalizedTouchedPath = normalizeRepoPath(touchedPath);
  const prefix = normalizeRepoPath(
    normalizedTouchedPath
      ? `${normalizeRepoPath(packageDir)}/${normalizedTouchedPath}`
      : normalizeRepoPath(packageDir),
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
    // Changed-file lints are scenario-scoped, exactly as `harness:review`
    // selects them.
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
        selected.push({
          kind: "script",
          packageDir: app.packageDir,
          script: command.script,
        });
      }
    }

    // Typecheck is not scenario-scoped, because `tsc -p` is not: any changed
    // file in the package can break the project build, including one whose
    // validation scenario happens not to list the typecheck command. Scoping it
    // per scenario would let a type error reach review, which is the whole
    // failure this stage exists to prevent.
    const packageTouched = changedFiles.some((changedFile) =>
      matchesTouchedPath(changedFile, app.packageDir, ""),
    );
    if (!packageTouched) continue;

    for (const scenario of app.validationScenarios) {
      for (const command of scenario.commands) {
        if (command.kind !== "raw" || !isMechanicalRawCommand(command.command)) {
          continue;
        }
        const normalized = command.command.trim();
        const key = `raw:${normalized}`;
        if (seen.has(key)) continue;
        seen.add(key);
        selected.push({ kind: "raw", command: normalized });
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

async function defaultRunRawCommand(rootDir: string, command: string) {
  // Spawned as argv, never through a shell: the pattern that admitted this
  // command already rejects operators, redirects, and extra arguments.
  const child = Bun.spawn(command.split(" "), {
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
  const runRawCommand = options.runRawCommand ?? defaultRunRawCommand;
  const ranCommands: string[] = [];
  const skippedCommands: string[] = [];
  const failures: MechanicalFailure[] = [];

  for (const command of selected) {
    if (command.kind === "raw") {
      logger.log(`[pr:athena] Mechanical check: ${command.command}`);
      const exitCode = await runRawCommand(rootDir, command.command);
      if (exitCode !== 0) {
        failures.push({
          command: command.command,
          exitCode,
          reason: `${command.command} exited with code ${exitCode}`,
        });
        continue;
      }
      ranCommands.push(command.command);
      continue;
    }

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
