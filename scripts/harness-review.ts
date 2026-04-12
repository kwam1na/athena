import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { HARNESS_APP_REGISTRY, type ValidationCommand } from "./harness-app-registry";
import { runHarnessCheck } from "./harness-check";

const REVIEW_TARGETS = HARNESS_APP_REGISTRY.map((app) => ({
  packageDir: app.packageDir,
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

type LoadedReviewTarget = {
  packageDir: string;
  validationMapPath: string;
  workspace: string;
  surfaces: ValidationSurface[];
};

type HarnessReviewLogger = Pick<Console, "log" | "error">;

type HarnessReviewOptions = {
  getChangedFiles?: (rootDir: string) => Promise<string[]>;
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

async function loadReviewTarget(
  rootDir: string,
  testingDocPath: string,
  validationMapPath: string
) {
  const absoluteTestingDocPath = path.join(rootDir, testingDocPath);
  const absoluteValidationMapPath = path.join(rootDir, validationMapPath);
  const [testingDocExists, validationMapExists] = await Promise.all([
    fileExists(absoluteTestingDocPath),
    fileExists(absoluteValidationMapPath),
  ]);

  if (!testingDocExists && !validationMapExists) {
    return null;
  }

  if (!testingDocExists) {
    throw new Error(
      `Stale harness review config: missing testing guide ${testingDocPath}.`
    );
  }

  if (!validationMapExists) {
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
          `Stale harness review config: ${validationMapPath} references missing path prefix "${pathPrefix}".`
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

  for (const target of REVIEW_TARGETS) {
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

function collectCommandsForChangedFiles(
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

    for (const changedFile of targetChangedFiles) {
      const matchingSurfaces = target.surfaces.filter((surface) =>
        surface.pathPrefixes.some((pathPrefix) =>
          matchesPathPrefix(changedFile, pathPrefix)
        )
      );

      if (matchingSurfaces.length === 0) {
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

async function getChangedFilesFromGit(rootDir: string) {
  const trackedDiff = Bun.spawn(
    ["git", "diff", "--name-only", "--diff-filter=ACDMRTUXB", "HEAD", "--"],
    {
      cwd: rootDir,
      stdout: "pipe",
      stderr: "pipe",
    }
  );
  const untrackedDiff = Bun.spawn(["git", "ls-files", "--others", "--exclude-standard"], {
    cwd: rootDir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [trackedOutput, untrackedOutput, trackedExitCode, untrackedExitCode] =
    await Promise.all([
      new Response(trackedDiff.stdout).text(),
      new Response(untrackedDiff.stdout).text(),
      trackedDiff.exited,
      untrackedDiff.exited,
    ]);

  if (trackedExitCode !== 0) {
    const stderr = await new Response(trackedDiff.stderr).text();
    throw new Error(stderr.trim() || "Failed to read tracked git changes.");
  }

  if (untrackedExitCode !== 0) {
    const stderr = await new Response(untrackedDiff.stderr).text();
    throw new Error(stderr.trim() || "Failed to read untracked git changes.");
  }

  return [...trackedOutput.split("\n"), ...untrackedOutput.split("\n")]
    .map((filePath) => filePath.trim())
    .filter(Boolean);
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

async function runRawCommand(rootDir: string, command: string) {
  const subprocess = Bun.spawn(["/bin/zsh", "-lc", command], {
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
  const changedFiles =
    (await (options.getChangedFiles ?? getChangedFilesFromGit)(rootDir)) ?? [];

  await runCheck(rootDir);

  const reviewTargets = await loadReviewTargets(rootDir);
  const {
    selectedCommands,
    selectedBehaviorScenarios,
    uncoveredFiles,
    targetFiles,
  } =
    collectCommandsForChangedFiles(changedFiles, reviewTargets);

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

  if (targetFiles.length === 0) {
    const packageDirList = REVIEW_TARGETS.map((target) => target.packageDir);
    logger.log(
      `No target-app validations selected; no touched files under ${packageDirList.join(" or ")}.`
    );
    return;
  }

  for (const command of selectedCommands) {
    if (command.kind === "script") {
      logger.log(`Running ${command.workspace}:${command.script}`);
      await (options.runPackageScript ?? ((nextWorkspace, nextScript) =>
        runPackageScript(rootDir, nextWorkspace, nextScript)))(
        command.workspace,
        command.script
      );
      continue;
    }

    logger.log(`Running raw command: ${command.command}`);
    await (options.runRawCommand ?? ((nextCommand) =>
      runRawCommand(rootDir, nextCommand)))(command.command);
  }

  if (selectedBehaviorScenarios.length === 0) {
    logger.log("No runtime behavior scenarios selected from touched surfaces.");
    return;
  }

  logger.log(
    `Selected runtime behavior scenarios: ${selectedBehaviorScenarios.join(", ")}`
  );

  for (const scenario of selectedBehaviorScenarios) {
    logger.log(`Running harness:behavior scenario: ${scenario}`);
    await (options.runHarnessBehaviorScenario ?? ((nextScenario) =>
      runHarnessBehaviorScenario(rootDir, nextScenario)))(scenario);
  }
}

if (import.meta.main) {
  await runHarnessReview(process.cwd());
}
