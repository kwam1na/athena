import { existsSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { HARNESS_APP_REGISTRY, type ValidationCommand } from "./harness-app-registry";
import {
  HarnessBlockedError,
  createHarnessBlocker,
  HarnessUsageError,
  runHarnessCliBoundary,
} from "./harness-blockers";
import { runHarnessCheck } from "./harness-check";
import {
  collectHarnessRepoValidationSelection,
} from "./harness-repo-validation";

const HARNESS_APP_REGISTRY_PATH = "scripts/harness-app-registry.ts";

const REVIEW_TARGETS = HARNESS_APP_REGISTRY.map((app) => ({
  packageDir: app.packageDir,
  testingDocPath: app.harnessDocs.testingPath,
  validationMapPath: app.harnessDocs.validationMapPath,
}));

/** Required Athena sensors run for every candidate; mapped sensors extend this set. */
export const ATHENA_ALWAYS_VALIDATION_COMMANDS = [
  // Preflight already runs the audit, self-review, contract fixtures and sibling policy.
  { kind: "raw", command: "bun run pr:athena:preflight" },
  { kind: "raw", command: "bun run reports:presentation:check" },
  { kind: "raw", command: "bun run docs:links:check" },
  { kind: "raw", command: "bun run workflow:check" },
  { kind: "script", workspace: "@athena/webapp", script: "audit:convex" },
  { kind: "script", workspace: "@athena/webapp", script: "lint:convex:changed" },
  { kind: "script", workspace: "@athena/webapp", script: "lint:frontend:changed" },
  { kind: "raw", command: "bun run architecture:check" },
  { kind: "raw", command: "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json" },
  { kind: "raw", command: "bun run test:coverage" },
] as const;

/** Run after mapped checks and behavior scenarios, once each. */
export const ATHENA_FINAL_VALIDATION_COMMANDS = [
  { kind: "raw", command: "bun run harness:inferential-review" },
  { kind: "raw", command: "bun run graphify:check" },
  { kind: "raw", command: "bun run pr:athena:scorecard" },
] as const;

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

type LoadedReviewTarget = {
  packageDir: string;
  validationMapPath: string;
  workspace: string;
  surfaces: ValidationSurface[];
};

type HarnessReviewLogger = Pick<Console, "log" | "error">;

/** Athena selects repository sensors; the product owns evidence reuse. */
type ParsedHarnessReviewArgs = { baseRef?: string };
type HarnessReviewOptions = {
  baseRef?: string;
  getChangedFiles?: (rootDir: string, baseRef?: string) => Promise<string[]>;
  logger?: HarnessReviewLogger;
  runHarnessCheck?: (rootDir: string) => Promise<void>;
  runPackageScript?: (workspace: string, script: string) => Promise<void>;
  runRawCommand?: (command: string) => Promise<void>;
  runHarnessBehaviorScenario?: (scenario: string) => Promise<void>;
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

function formatMissingPathPrefixError(
  validationMapPath: string,
  pathPrefix: string
) {
  return [
    `Stale harness review config: ${validationMapPath} references missing path prefix "${pathPrefix}".`,
    `This path is generated from ${HARNESS_APP_REGISTRY_PATH}; update the registry validation scenario, then rerun \`bun run harness:generate\`.`,
  ].join(" ");
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
  target: { testingDocPath: string; validationMapPath: string }
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

function sortUniquePaths(paths: string[]) {
  return [...new Set(paths.map((entry) => normalizeRepoPath(entry).trim()).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right)
  );
}

async function loadReviewTarget(
  rootDir: string,
  testingDocPath: string,
  validationMapPath: string
) {
  const absoluteTestingDocPath = path.join(rootDir, testingDocPath);
  const absoluteValidationMapPath = path.join(rootDir, validationMapPath);
  if (!(await fileExists(absoluteTestingDocPath))) {
    throw new Error(
      `Stale harness review config: missing testing guide ${testingDocPath}.`
    );
  }

  if (!(await fileExists(absoluteValidationMapPath))) {
    throw new Error(
      `Stale harness review config: missing validation map ${validationMapPath}.`
    );
  }

  const testingDocContents = await readFile(
    absoluteTestingDocPath,
    "utf8"
  );

  if (!testingDocContents.includes("`bun run harness:review`")) {
    throw new Error(
      `Stale harness review config: ${testingDocPath} must mention \`bun run harness:review\`.`
    );
  }

  if (!testingDocContents.includes("(./validation-map.json)")) {
    throw new Error(
      `Stale harness review config: ${testingDocPath} must link ./validation-map.json.`
    );
  }

  const validationMap = await readJsonFile<ValidationMap>(absoluteValidationMapPath);
  const packageJsonPath = path.join(rootDir, validationMap.packageDir, "package.json");

  if (!(await fileExists(packageJsonPath))) {
    throw new Error(
      `Stale harness review config: ${validationMapPath} references missing package surface "${validationMap.packageDir}".`
    );
  }

  const packageJson = await readJsonFile<{
    name?: string;
    scripts?: Record<string, string>;
  }>(packageJsonPath);

  if (packageJson.name !== validationMap.workspace) {
    throw new Error(
      `Stale harness review config: ${validationMapPath} expected workspace "${validationMap.workspace}" at ${validationMap.packageDir}.`
    );
  }

  const surfaces = Array.isArray(validationMap.surfaces)
    ? validationMap.surfaces
    : [];

  if (surfaces.length === 0) {
    throw new Error(
      `Stale harness review config: ${validationMapPath} must define at least one validation surface.`
    );
  }

  for (const surface of surfaces) {
    if (!Array.isArray(surface.pathPrefixes) || surface.pathPrefixes.length === 0) {
      throw new Error(
        `Stale harness review config: ${validationMapPath} includes an empty path prefix list for "${surface.name}".`
      );
    }

    if (!Array.isArray(surface.commands)) {
      throw new Error(
        `Stale harness review config: ${validationMapPath} is missing commands for "${surface.name}".`
      );
    }

    for (const pathPrefix of surface.pathPrefixes) {
      if (!(await fileExists(path.join(rootDir, pathPrefix)))) {
        throw new Error(
          formatMissingPathPrefixError(validationMapPath, pathPrefix)
        );
      }
    }

    for (const command of surface.commands.map(normalizeValidationCommand)) {
      if (command.kind === "script") {
        if (!packageJson.scripts?.[command.script]) {
          throw new Error(
            `Stale harness review config: ${validationMapPath} references missing script "${validationMap.workspace}:${command.script}".`
          );
        }
        continue;
      }

      if (!command.command) {
        throw new Error(
          `Stale harness review config: ${validationMapPath} includes an empty raw command for "${surface.name}".`
        );
      }
    }

    if (
      surface.behaviorScenarios !== undefined &&
      !Array.isArray(surface.behaviorScenarios)
    ) {
      throw new Error(
        `Stale harness review config: ${validationMapPath} includes invalid behavior scenarios for "${surface.name}".`
      );
    }

    for (const scenario of surface.behaviorScenarios ?? []) {
      if (typeof scenario !== "string" || !normalizeBehaviorScenarioName(scenario)) {
        throw new Error(
          `Stale harness review config: ${validationMapPath} includes an empty behavior scenario for "${surface.name}".`
        );
      }
    }
  }

  return {
    packageDir: normalizeRepoPath(validationMap.packageDir),
    validationMapPath,
    workspace: validationMap.workspace,
    surfaces: surfaces.map((surface) => ({
      name: surface.name,
      pathPrefixes: surface.pathPrefixes.map(normalizeRepoPath),
      commands: surface.commands.map(normalizeValidationCommand),
      behaviorScenarios: (surface.behaviorScenarios ?? []).map(
        normalizeBehaviorScenarioName
      ),
    })),
  } satisfies LoadedReviewTarget;
}

async function loadReviewTargets(rootDir: string) {
  const targets: LoadedReviewTarget[] = [];

  const reviewTargets = [];
  for (const app of HARNESS_APP_REGISTRY) {
    const target = {
      packageDir: app.packageDir,
      testingDocPath: app.harnessDocs.testingPath,
      validationMapPath: app.harnessDocs.validationMapPath,
    };
    if (
      app.onboardingStatus === "planned" &&
      !(await hasAnyHarnessDocs(rootDir, target))
    ) {
      continue;
    }
    reviewTargets.push(target);
  }

  for (const target of reviewTargets) {
    const loadedTarget = await loadReviewTarget(
      rootDir,
      target.testingDocPath,
      target.validationMapPath
    );
    if (loadedTarget) {
      targets.push(loadedTarget);
    }
  }

  return targets;
}

async function collectCommandsForChangedFiles(
  rootDir: string,
  changedFiles: string[],
  targets: LoadedReviewTarget[]
) {
  const normalizedChangedFiles = changedFiles.map(normalizeRepoPath).sort();
  const selectedCommands: Array<
    | { kind: "script"; workspace: string; script: string }
    | { kind: "raw"; command: string }
  > = [];
  const selectedBehaviorScenarios: string[] = [];
  const seenBehaviorScenarios = new Set<string>();
  const uncoveredFiles: string[] = [];
  const targetFiles = normalizedChangedFiles.filter((filePath) =>
    targets.some((target) => matchesPathPrefix(filePath, `${target.packageDir}/`))
  );

  for (const target of targets) {
    const targetChangedFiles = targetFiles.filter((filePath) =>
      matchesPathPrefix(filePath, `${target.packageDir}/`)
    );

    if (targetChangedFiles.length === 0) {
      continue;
    }

    const seenCommands = new Set<string>();
    const fileMatches = targetChangedFiles.map((changedFile) => ({
      changedFile,
      matchingSurfaces: target.surfaces.filter((surface) =>
        surface.pathPrefixes.some((pathPrefix) =>
          matchesPathPrefix(changedFile, pathPrefix)
        )
      ),
    }));
    const hasDirectCoverage = fileMatches.some(
      ({ matchingSurfaces }) => matchingSurfaces.length > 0
    );

    for (const { changedFile, matchingSurfaces } of fileMatches) {
      if (matchingSurfaces.length === 0) {
        const changedFileExists = await fileExists(path.join(rootDir, changedFile));
        if (!changedFileExists && hasDirectCoverage) {
          continue;
        }

        uncoveredFiles.push(changedFile);
        continue;
      }

      for (const surface of matchingSurfaces) {
        for (const command of surface.commands) {
          const commandKey =
            command.kind === "script"
              ? `${target.workspace}:${command.script}`
              : `raw:${command.command}`;

          if (seenCommands.has(commandKey)) {
            continue;
          }

          if (command.kind === "script") {
            selectedCommands.push({
              kind: "script",
              workspace: target.workspace,
              script: command.script,
            });
          } else {
            selectedCommands.push({
              kind: "raw",
              command: command.command,
            });
          }
          seenCommands.add(commandKey);
        }

        for (const scenario of surface.behaviorScenarios ?? []) {
          if (seenBehaviorScenarios.has(scenario)) {
            continue;
          }

          selectedBehaviorScenarios.push(scenario);
          seenBehaviorScenarios.add(scenario);
        }
      }
    }
  }

  return {
    selectedCommands,
    selectedBehaviorScenarios,
    uncoveredFiles,
    targetFiles,
  };
}

async function runGitCommand(rootDir: string, command: string[]) {
  const process = Bun.spawn(command, {
    cwd: rootDir,
    stdout: "pipe",
    stderr: "pipe",
    env: buildGitProcessEnv(),
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  return {
    stdout,
    stderr,
    exitCode,
  };
}

export function buildGitProcessEnv(env: NodeJS.ProcessEnv = process.env) {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => !key.startsWith("GIT_"))
  );
}

export async function getChangedFilesForHarnessReview(
  rootDir: string,
  baseRef?: string
) {
  const trackedDiff = runGitCommand(rootDir, [
    "git",
    "diff",
    "--name-only",
    "--diff-filter=ACDMRTUXB",
    "HEAD",
    "--",
  ]);
  const untrackedDiff = runGitCommand(rootDir, [
    "git",
    "ls-files",
    "--others",
    "--exclude-standard",
  ]);

  if (!baseRef) {
    const [trackedResult, untrackedResult] = await Promise.all([
      trackedDiff,
      untrackedDiff,
    ]);

    if (trackedResult.exitCode !== 0) {
      throw new Error(
        trackedResult.stderr.trim() || "Failed to read tracked git changes."
      );
    }

    if (untrackedResult.exitCode !== 0) {
      throw new Error(
        untrackedResult.stderr.trim() || "Failed to read untracked git changes."
      );
    }

    return sortUniquePaths([
      ...trackedResult.stdout.split("\n"),
      ...untrackedResult.stdout.split("\n"),
    ]);
  }

  const refCheck = await runGitCommand(rootDir, [
    "git",
    "rev-parse",
    "--verify",
    baseRef,
  ]);

  if (refCheck.exitCode !== 0) {
    const detail = refCheck.stderr.trim() || `${baseRef} is not reachable.`;
    throw new Error(`Base ref check failed for ${baseRef}: ${detail}`);
  }

  const [baseDiff, trackedResult, untrackedResult] = await Promise.all([
    runGitCommand(rootDir, [
      "git",
      "diff",
      "--name-only",
      "--diff-filter=ACDMRTUXB",
      `${baseRef}...HEAD`,
      "--",
    ]),
    trackedDiff,
    untrackedDiff,
  ]);

  if (baseDiff.exitCode !== 0) {
    throw new Error(
      baseDiff.stderr.trim() ||
        `Failed to read changed files against ${baseRef}.`
    );
  }

  if (trackedResult.exitCode !== 0) {
    throw new Error(
      trackedResult.stderr.trim() || "Failed to read tracked git changes."
    );
  }

  if (untrackedResult.exitCode !== 0) {
    throw new Error(
      untrackedResult.stderr.trim() || "Failed to read untracked git changes."
    );
  }

  return sortUniquePaths([
    ...baseDiff.stdout.split("\n"),
    ...trackedResult.stdout.split("\n"),
    ...untrackedResult.stdout.split("\n"),
  ]);
}

async function runPackageScript(rootDir: string, workspace: string, script: string) {
  const command = ["bun", "run", "--filter", workspace, script];
  const subprocess = Bun.spawn(command, {
    cwd: rootDir,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await subprocess.exited;

  if (exitCode !== 0) {
    throw new Error(`Command failed (${exitCode}): ${command.join(" ")}`);
  }
}

export function resolveHarnessReviewShell(options: {
  env?: NodeJS.ProcessEnv;
  fileExists?: (filePath: string) => boolean;
} = {}) {
  const env = options.env ?? process.env;
  const fileExists = options.fileExists ?? existsSync;
  const candidates = [env.SHELL, "/bin/zsh", "/bin/bash", "/bin/sh"];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    if (fileExists(candidate)) {
      return candidate;
    }
  }

  return "/bin/sh";
}

export async function runRawCommand(rootDir: string, command: string, options: {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  logger?: Pick<Console, "log">;
  spawn?: (command: string[], options: { cwd: string; stdout: "inherit"; stderr: "inherit" }) => { exited: Promise<number> };
} = {}) {
  const shellPath = resolveHarnessReviewShell();
  const env = options.env ?? process.env;
  const timedCoverage = (options.platform ?? process.platform) === "linux" &&
    env.GITHUB_ACTIONS === "true" && command === "bun run test:coverage";
  if (timedCoverage) {
    (options.logger ?? console).log(`Coverage worker limit: ${env.ATHENA_COVERAGE_MAX_WORKERS || "2"}`);
  }
  const argv = [shellPath, "-lc", command];
  const subprocess = (options.spawn ?? Bun.spawn)(timedCoverage ? ["/usr/bin/time", "-v", ...argv] : argv, {
    cwd: rootDir,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await subprocess.exited;

  if (exitCode !== 0) {
    throw new Error(`Command failed (${exitCode}): ${command}`);
  }
}

async function runHarnessBehaviorScenario(rootDir: string, scenario: string) {
  const command = ["bun", "run", "harness:behavior", "--scenario", scenario];
  const subprocess = Bun.spawn(command, {
    cwd: rootDir,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await subprocess.exited;

  if (exitCode !== 0) {
    throw new Error(`Command failed (${exitCode}): ${command.join(" ")}`);
  }
}

export async function runHarnessReview(
  rootDir: string,
  options: HarnessReviewOptions = {}
) {
  const logger = options.logger ?? console;
  const runCheck = options.runHarnessCheck ?? runHarnessCheck;
  const baseRef = options.baseRef;
  const changedFiles =
    (await (options.getChangedFiles ?? getChangedFilesForHarnessReview)(
      rootDir,
      baseRef
    )) ?? [];

  await runCheck(rootDir);

  const reviewTargets = await loadReviewTargets(rootDir);
  const {
    selectedCommands,
    selectedBehaviorScenarios,
    uncoveredFiles,
    targetFiles,
  } =
    await collectCommandsForChangedFiles(rootDir, changedFiles, reviewTargets);
  const repoValidation = collectHarnessRepoValidationSelection(changedFiles);

  if (uncoveredFiles.length > 0) {
    throw new Error(
      uncoveredFiles
        .map(
          (filePath) =>
            `Harness review coverage gap: ${filePath} is not covered by any validation mapping.`
        )
        .join("\n")
    );
  }

  if (targetFiles.length === 0 && repoValidation.matchedFiles.length === 0) {
    const packageDirList = reviewTargets.map((target) => target.packageDir);
    logger.log(
      `No target-app validations selected; no touched files under ${packageDirList.join(" or ")}.`
    );
  }

  const commands = [
    ...ATHENA_ALWAYS_VALIDATION_COMMANDS,
    ...repoValidation.selectedCommands.map(command => ({ kind: "raw" as const, command })),
    ...selectedCommands,
    ...ATHENA_FINAL_VALIDATION_COMMANDS,
  ];

  const seen = new Set<string>();
  const combinedCommands = commands.filter(command => {
    const key = command.kind === "script" ? `${command.workspace}:${command.script}` : `raw:${command.command}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const runSelectedCommand = async (command: (typeof commands)[number]) => {
    if (command.kind === "script") {
      logger.log(`Running ${command.workspace}:${command.script}`);
      await (options.runPackageScript ?? ((nextWorkspace, nextScript) =>
        runPackageScript(rootDir, nextWorkspace, nextScript)))(
        command.workspace,
        command.script
      );
      return;
    }

    logger.log(`Running raw command: ${command.command}`);
    await (options.runRawCommand ?? ((nextCommand) =>
      runRawCommand(rootDir, nextCommand)))(command.command);
  };
  const finalCommands = new Set<string>(ATHENA_FINAL_VALIDATION_COMMANDS.map(command => command.command));
  for (const command of combinedCommands) {
    if (command.kind !== "raw" || !finalCommands.has(command.command)) await runSelectedCommand(command);
  }

  if (selectedBehaviorScenarios.length === 0) {
    logger.log("No runtime behavior scenarios selected from touched surfaces.");
  } else {
    logger.log(`Selected runtime behavior scenarios: ${selectedBehaviorScenarios.join(", ")}`);
  }

  for (const scenario of selectedBehaviorScenarios) {
    logger.log(`Running harness:behavior scenario: ${scenario}`);
    await (options.runHarnessBehaviorScenario ?? ((nextScenario) =>
      runHarnessBehaviorScenario(rootDir, nextScenario)))(scenario);
  }
  for (const command of ATHENA_FINAL_VALIDATION_COMMANDS) await runSelectedCommand(command);
}

export function parseHarnessReviewArgs(
  argv: string[]
): ParsedHarnessReviewArgs {
  let baseRef: string | undefined;

  const usage = {
    source: { kind: "command", id: "harness:review" } as const,
    validFlags: [
      "--base <ref>",
    ],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--base") {
      const value = argv[index + 1]?.trim();
      if (!value) {
        throw new HarnessUsageError({
          ...usage,
          message:
            "Missing value for --base. Usage: bun run harness:review --base origin/main",
        });
      }
      baseRef = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--base=")) {
      const value = arg.slice("--base=".length).trim();
      if (!value) {
        throw new HarnessUsageError({
          ...usage,
          message:
            "Missing value for --base. Usage: bun run harness:review --base origin/main",
        });
      }
      baseRef = value;
      continue;
    }

    throw new HarnessUsageError({
      ...usage,
      message: `Unknown argument: ${arg}. Usage: bun run harness:review [--base <ref>]`,
    });
  }

  return { baseRef };
}

export function harnessReviewBlockedBlocker(detail: string) {
  return createHarnessBlocker({
    code: "harness_review_blocked",
    source: { kind: "command", id: "harness:review" },
    summary: "The harness review blocked this candidate.",
    details: detail,
    remediations: [
      {
        id: "repair-harness-review-finding",
        kind: "code_change",
        summary:
          "Resolve the reported finding at its source, then rerun the review.",
      },
      {
        id: "rerun-harness-review",
        kind: "command",
        command: ["bun", "run", "harness:review"],
        summary: "Rerun the harness review.",
      },
    ],
  });
}

/**
 * Every throw inside runHarnessReview is a policy block, not a crash. Reaching
 * the boundary bare, they rendered as `harness_internal_error` with a stack -
 * the form the operator contract reserves for genuinely unexpected exceptions.
 */
async function runHarnessReviewCli() {
  try {
    const parsed = parseHarnessReviewArgs(Bun.argv.slice(2));
    await runHarnessReview(process.cwd(), {
      baseRef: parsed.baseRef,
    });
  } catch (error) {
    if (error instanceof HarnessBlockedError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new HarnessBlockedError([harnessReviewBlockedBlocker(detail)], detail);
  }
}

if (import.meta.main) {
  process.exitCode = await runHarnessCliBoundary({
    source: { kind: "command", id: "harness:review" },
    reproduce: ["bun", "run", "harness:review", ...Bun.argv.slice(2)],
    run: runHarnessReviewCli,
  });
}
