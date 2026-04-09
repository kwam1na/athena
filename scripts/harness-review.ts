import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { runHarnessCheck } from "./harness-check";

const REVIEW_TARGETS = [
  {
    testingDocPath: "packages/athena-webapp/docs/agent/testing.md",
    validationMapPath: "packages/athena-webapp/docs/agent/validation-map.json",
  },
  {
    testingDocPath: "packages/storefront-webapp/docs/agent/testing.md",
    validationMapPath: "packages/storefront-webapp/docs/agent/validation-map.json",
  },
] as const;

type ValidationRule = {
  pathPrefix: string;
  scripts: string[];
};

type ValidationMap = {
  workspace: string;
  packageDir: string;
  rules: ValidationRule[];
};

type LoadedReviewTarget = {
  packageDir: string;
  validationMapPath: string;
  workspace: string;
  rules: ValidationRule[];
};

type HarnessReviewLogger = Pick<Console, "log" | "error">;

type HarnessReviewOptions = {
  getChangedFiles?: (rootDir: string) => Promise<string[]>;
  logger?: HarnessReviewLogger;
  runHarnessCheck?: (rootDir: string) => Promise<void>;
  runPackageScript?: (workspace: string, script: string) => Promise<void>;
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

async function loadReviewTarget(
  rootDir: string,
  testingDocPath: string,
  validationMapPath: string
) {
  const testingDocContents = await readFile(
    path.join(rootDir, testingDocPath),
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

  const absoluteValidationMapPath = path.join(rootDir, validationMapPath);
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

  for (const rule of validationMap.rules) {
    if (!(await fileExists(path.join(rootDir, rule.pathPrefix)))) {
      throw new Error(
        `Stale harness review config: ${validationMapPath} references missing path prefix "${rule.pathPrefix}".`
      );
    }

    for (const script of rule.scripts) {
      if (!packageJson.scripts?.[script]) {
        throw new Error(
          `Stale harness review config: ${validationMapPath} references missing script "${validationMap.workspace}:${script}".`
        );
      }
    }
  }

  return {
    packageDir: normalizeRepoPath(validationMap.packageDir),
    validationMapPath,
    workspace: validationMap.workspace,
    rules: validationMap.rules.map((rule) => ({
      pathPrefix: normalizeRepoPath(rule.pathPrefix),
      scripts: rule.scripts,
    })),
  } satisfies LoadedReviewTarget;
}

async function loadReviewTargets(rootDir: string) {
  const targets: LoadedReviewTarget[] = [];

  for (const target of REVIEW_TARGETS) {
    targets.push(
      await loadReviewTarget(
        rootDir,
        target.testingDocPath,
        target.validationMapPath
      )
    );
  }

  return targets;
}

function collectScriptsForChangedFiles(
  changedFiles: string[],
  targets: LoadedReviewTarget[]
) {
  const normalizedChangedFiles = changedFiles.map(normalizeRepoPath);
  const selectedScripts: Array<{ workspace: string; script: string }> = [];
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

    const seenScripts = new Set<string>();

    for (const changedFile of targetChangedFiles) {
      const matchingRules = target.rules.filter((rule) =>
        matchesPathPrefix(changedFile, rule.pathPrefix)
      );

      if (matchingRules.length === 0) {
        uncoveredFiles.push(changedFile);
        continue;
      }

      for (const rule of matchingRules) {
        for (const script of rule.scripts) {
          if (seenScripts.has(script)) {
            continue;
          }

          selectedScripts.push({
            workspace: target.workspace,
            script,
          });
          seenScripts.add(script);
        }
      }
    }
  }

  return {
    selectedScripts,
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
  const { selectedScripts, uncoveredFiles, targetFiles } =
    collectScriptsForChangedFiles(changedFiles, reviewTargets);

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
    logger.log(
      "No target-app validations selected; no touched files under packages/athena-webapp or packages/storefront-webapp."
    );
    return;
  }

  for (const { workspace, script } of selectedScripts) {
    logger.log(`Running ${workspace}:${script}`);
    await (options.runPackageScript ?? ((nextWorkspace, nextScript) =>
      runPackageScript(rootDir, nextWorkspace, nextScript)))(workspace, script);
  }
}

if (import.meta.main) {
  await runHarnessReview(process.cwd());
}
