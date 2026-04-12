import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { validateHarnessDocs } from "./harness-check";

const SELF_REVIEW_TARGETS = [
  {
    appLabel: "Athena Webapp",
    packageDir: "packages/athena-webapp",
    testingDocPath: "packages/athena-webapp/docs/agent/testing.md",
    validationMapPath: "packages/athena-webapp/docs/agent/validation-map.json",
    validationGuidePath: "packages/athena-webapp/docs/agent/validation-guide.md",
  },
  {
    appLabel: "Storefront Webapp",
    packageDir: "packages/storefront-webapp",
    testingDocPath: "packages/storefront-webapp/docs/agent/testing.md",
    validationMapPath: "packages/storefront-webapp/docs/agent/validation-map.json",
    validationGuidePath: "packages/storefront-webapp/docs/agent/validation-guide.md",
  },
] as const;

const GRAPHIFY_ARTIFACTS = [
  "graphify-out/GRAPH_REPORT.md",
  "graphify-out/graph.json",
] as const;
const WORKTREE_METADATA_PREFIXES = [
  ".worktrees/",
  "worktrees/",
  "packages/.claude/worktrees/",
] as const;
const LOCAL_GENERATED_ARTIFACT_PREFIXES = ["artifacts/"] as const;

type ValidationCommand =
  | { kind: "script"; script: string }
  | { kind: "raw"; command: string };

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

type LoadedSelfReviewTarget = {
  appLabel: string;
  packageDir: string;
  workspace: string;
  validationMapPath: string;
  surfaces: ValidationSurface[];
  runtimeScenarios: string[];
};

type ChangedFiles = {
  baseFiles: string[];
  trackedFiles: string[];
  untrackedFiles: string[];
};

type GraphifyFreshness = {
  status: "fresh" | "stale" | "missing-artifacts" | "partial" | "n/a";
  detail: string;
};

type HarnessSelfReviewResult = {
  markdown: string;
  blockers: string[];
  warnings: string[];
  info: string[];
  selectedValidations: string[];
  recommendedValidations: string[];
};

type HarnessSelfReviewOptions = {
  baseRef: string;
  getChangedFiles?: (rootDir: string, baseRef: string) => Promise<ChangedFiles>;
  runHarnessCheck?: (rootDir: string) => Promise<void>;
};

type SurfaceCoverage = {
  surfaceName: string;
  files: string[];
};

type TargetCoverage = {
  target: LoadedSelfReviewTarget;
  touchedFiles: string[];
  uncoveredFiles: string[];
  matchedSurfaces: SurfaceCoverage[];
};

function normalizeRepoPath(repoPath: string) {
  return repoPath.replaceAll("\\", "/");
}

function sortUniquePaths(paths: string[]) {
  return [...new Set(paths.map((entry) => normalizeRepoPath(entry).trim()).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right)
  );
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

function formatValidationCommand(workspace: string, command: ValidationCommand) {
  if (command.kind === "script") {
    return `bun run --filter '${workspace}' ${command.script}`;
  }

  return command.command;
}

function quoteCode(entry: string) {
  return `\`${entry}\``;
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

async function runCommand(rootDir: string, command: string[]) {
  const process = Bun.spawn(command, {
    cwd: rootDir,
    stdout: "pipe",
    stderr: "pipe",
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

async function getChangedFilesFromGit(
  rootDir: string,
  baseRef: string
): Promise<ChangedFiles> {
  const baseRefCheck = await runCommand(rootDir, [
    "git",
    "rev-parse",
    "--verify",
    baseRef,
  ]);

  if (baseRefCheck.exitCode !== 0) {
    const message = baseRefCheck.stderr.trim() || `${baseRef} is not reachable.`;
    throw new Error(`Base ref check failed for ${baseRef}: ${message}`);
  }

  const [baseDiff, trackedDiff, untrackedDiff] = await Promise.all([
    runCommand(rootDir, [
      "git",
      "diff",
      "--name-only",
      "--diff-filter=ACDMRTUXB",
      `${baseRef}...HEAD`,
      "--",
    ]),
    runCommand(rootDir, [
      "git",
      "diff",
      "--name-only",
      "--diff-filter=ACDMRTUXB",
      "HEAD",
      "--",
    ]),
    runCommand(rootDir, ["git", "ls-files", "--others", "--exclude-standard"]),
  ]);

  if (baseDiff.exitCode !== 0) {
    throw new Error(
      baseDiff.stderr.trim() ||
        `Failed to read changed files against ${baseRef}.`
    );
  }

  if (trackedDiff.exitCode !== 0) {
    throw new Error(
      trackedDiff.stderr.trim() ||
        "Failed to read tracked working-tree changes."
    );
  }

  if (untrackedDiff.exitCode !== 0) {
    throw new Error(
      untrackedDiff.stderr.trim() ||
        "Failed to read untracked working-tree changes."
    );
  }

  return {
    baseFiles: sortUniquePaths(baseDiff.stdout.split("\n")),
    trackedFiles: sortUniquePaths(trackedDiff.stdout.split("\n")),
    untrackedFiles: sortUniquePaths(untrackedDiff.stdout.split("\n")),
  };
}

function parseRuntimeScenarios(contents: string) {
  return [...contents.matchAll(/^##\s+(.+)$/gm)]
    .map((match) => match[1]?.trim() ?? "")
    .filter(Boolean);
}

async function loadSelfReviewTarget(
  rootDir: string,
  target: (typeof SELF_REVIEW_TARGETS)[number]
): Promise<LoadedSelfReviewTarget> {
  const testingDocContents = await readFile(
    path.join(rootDir, target.testingDocPath),
    "utf8"
  );

  if (!testingDocContents.includes("`bun run harness:review`")) {
    throw new Error(
      `Stale harness self-review config: ${target.testingDocPath} must mention \`bun run harness:review\`.`
    );
  }

  if (!testingDocContents.includes("(./validation-map.json)")) {
    throw new Error(
      `Stale harness self-review config: ${target.testingDocPath} must link ./validation-map.json.`
    );
  }

  const absoluteValidationMapPath = path.join(rootDir, target.validationMapPath);
  const validationMap = await readJsonFile<ValidationMap>(absoluteValidationMapPath);
  const packageJsonPath = path.join(rootDir, validationMap.packageDir, "package.json");

  if (!(await fileExists(packageJsonPath))) {
    throw new Error(
      `Stale harness self-review config: ${target.validationMapPath} references missing package surface "${validationMap.packageDir}".`
    );
  }

  const packageJson = await readJsonFile<{
    name?: string;
    scripts?: Record<string, string>;
  }>(packageJsonPath);

  if (packageJson.name !== validationMap.workspace) {
    throw new Error(
      `Stale harness self-review config: ${target.validationMapPath} expected workspace "${validationMap.workspace}" at ${validationMap.packageDir}.`
    );
  }

  const surfaces = Array.isArray(validationMap.surfaces)
    ? validationMap.surfaces
    : [];

  if (surfaces.length === 0) {
    throw new Error(
      `Stale harness self-review config: ${target.validationMapPath} must define at least one validation surface.`
    );
  }

  for (const surface of surfaces) {
    if (!Array.isArray(surface.pathPrefixes) || surface.pathPrefixes.length === 0) {
      throw new Error(
        `Stale harness self-review config: ${target.validationMapPath} includes an empty path prefix list for "${surface.name}".`
      );
    }

    if (!Array.isArray(surface.commands)) {
      throw new Error(
        `Stale harness self-review config: ${target.validationMapPath} is missing commands for "${surface.name}".`
      );
    }

    for (const pathPrefix of surface.pathPrefixes) {
      if (!(await fileExists(path.join(rootDir, pathPrefix)))) {
        throw new Error(
          `Stale harness self-review config: ${target.validationMapPath} references missing path prefix "${pathPrefix}".`
        );
      }
    }

    for (const command of surface.commands.map(normalizeValidationCommand)) {
      if (command.kind === "script") {
        if (!packageJson.scripts?.[command.script]) {
          throw new Error(
            `Stale harness self-review config: ${target.validationMapPath} references missing script "${validationMap.workspace}:${command.script}".`
          );
        }
        continue;
      }

      if (!command.command) {
        throw new Error(
          `Stale harness self-review config: ${target.validationMapPath} includes an empty raw command for "${surface.name}".`
        );
      }
    }

    if (
      surface.behaviorScenarios !== undefined &&
      !Array.isArray(surface.behaviorScenarios)
    ) {
      throw new Error(
        `Stale harness self-review config: ${target.validationMapPath} includes invalid behavior scenarios for "${surface.name}".`
      );
    }

    for (const scenario of surface.behaviorScenarios ?? []) {
      if (typeof scenario !== "string" || !normalizeBehaviorScenarioName(scenario)) {
        throw new Error(
          `Stale harness self-review config: ${target.validationMapPath} includes an empty behavior scenario for "${surface.name}".`
        );
      }
    }
  }

  const absoluteValidationGuidePath = path.join(rootDir, target.validationGuidePath);
  const runtimeScenarios = (await fileExists(absoluteValidationGuidePath))
    ? parseRuntimeScenarios(
        await readFile(absoluteValidationGuidePath, "utf8")
      )
    : [];

  return {
    appLabel: target.appLabel,
    packageDir: normalizeRepoPath(validationMap.packageDir),
    validationMapPath: target.validationMapPath,
    workspace: validationMap.workspace,
    surfaces: surfaces.map((surface) => ({
      name: surface.name,
      pathPrefixes: surface.pathPrefixes.map(normalizeRepoPath),
      commands: surface.commands.map(normalizeValidationCommand),
      behaviorScenarios: (surface.behaviorScenarios ?? []).map(
        normalizeBehaviorScenarioName
      ),
    })),
    runtimeScenarios,
  } satisfies LoadedSelfReviewTarget;
}

async function loadSelfReviewTargets(rootDir: string) {
  const loadedTargets: LoadedSelfReviewTarget[] = [];
  const blockers: string[] = [];

  for (const target of SELF_REVIEW_TARGETS) {
    try {
      loadedTargets.push(await loadSelfReviewTarget(rootDir, target));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      blockers.push(message);
    }
  }

  return {
    loadedTargets,
    blockers: sortUniquePaths(blockers),
  };
}

function collectCoverage(
  changedFiles: string[],
  targets: LoadedSelfReviewTarget[]
) {
  const coverageByTarget: TargetCoverage[] = [];
  const blockers: string[] = [];
  const selectedValidationCommands = ["bun run harness:check"];
  const selectedCommandKeys = new Set(selectedValidationCommands);

  for (const target of targets) {
    const touchedFiles = changedFiles.filter((filePath) =>
      matchesPathPrefix(filePath, `${target.packageDir}/`)
    );

    if (touchedFiles.length === 0) {
      continue;
    }

    const matchedSurfaces: SurfaceCoverage[] = [];
    const coveredFiles = new Set<string>();

    for (const surface of target.surfaces) {
      const matchedFiles = touchedFiles.filter((filePath) =>
        surface.pathPrefixes.some((pathPrefix) =>
          matchesPathPrefix(filePath, pathPrefix)
        )
      );

      if (matchedFiles.length === 0) {
        continue;
      }

      const sortedMatchedFiles = sortUniquePaths(matchedFiles);
      matchedSurfaces.push({
        surfaceName: surface.name,
        files: sortedMatchedFiles,
      });

      for (const matchedFile of sortedMatchedFiles) {
        coveredFiles.add(matchedFile);
      }

      for (const command of surface.commands) {
        const formattedCommand = formatValidationCommand(target.workspace, command);
        if (selectedCommandKeys.has(formattedCommand)) {
          continue;
        }

        selectedCommandKeys.add(formattedCommand);
        selectedValidationCommands.push(formattedCommand);
      }
    }

    const uncoveredFiles = sortUniquePaths(
      touchedFiles.filter((filePath) => !coveredFiles.has(filePath))
    );

    for (const filePath of uncoveredFiles) {
      blockers.push(
        `Harness review coverage gap: ${filePath} is not covered by any validation mapping.`
      );
    }

    coverageByTarget.push({
      target,
      touchedFiles: sortUniquePaths(touchedFiles),
      uncoveredFiles,
      matchedSurfaces,
    });
  }

  return {
    coverageByTarget,
    blockers: sortUniquePaths(blockers),
    selectedValidationCommands,
  };
}

function isLikelyCodeOrConfig(filePath: string) {
  const ext = path.posix.extname(filePath).toLowerCase();
  if (!ext) {
    return true;
  }

  return ![
    ".md",
    ".txt",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".svg",
    ".ico",
    ".lock",
    ".log",
  ].includes(ext);
}

function isWorktreeMetadataPath(filePath: string) {
  const normalizedPath = normalizeRepoPath(filePath);
  return WORKTREE_METADATA_PREFIXES.some(
    (pathPrefix) =>
      normalizedPath === pathPrefix.slice(0, -1) ||
      normalizedPath.startsWith(pathPrefix)
  );
}

function isLocalGeneratedArtifactPath(filePath: string) {
  const normalizedPath = normalizeRepoPath(filePath);
  return LOCAL_GENERATED_ARTIFACT_PREFIXES.some(
    (pathPrefix) =>
      normalizedPath === pathPrefix.slice(0, -1) ||
      normalizedPath.startsWith(pathPrefix)
  );
}

async function evaluateGraphifyFreshness(
  rootDir: string,
  changedFiles: string[]
): Promise<GraphifyFreshness> {
  const [reportExists, graphExists] = await Promise.all(
    GRAPHIFY_ARTIFACTS.map((artifactPath) =>
      fileExists(path.join(rootDir, artifactPath))
    )
  );

  const missingArtifacts: string[] = [];
  if (!reportExists) {
    missingArtifacts.push("graphify-out/GRAPH_REPORT.md");
  }
  if (!graphExists) {
    missingArtifacts.push("graphify-out/graph.json");
  }

  if (missingArtifacts.length > 0) {
    return {
      status: "missing-artifacts",
      detail: `Missing Graphify artifacts: ${missingArtifacts.map(quoteCode).join(", ")}.`,
    };
  }

  const normalizedChanged = sortUniquePaths(changedFiles);
  const changedArtifacts = GRAPHIFY_ARTIFACTS.filter((artifactPath) =>
    normalizedChanged.includes(artifactPath)
  );
  const nonGraphifyCodeChanges = normalizedChanged.filter(
    (filePath) =>
      !filePath.startsWith("graphify-out/") &&
      !isWorktreeMetadataPath(filePath) &&
      !isLocalGeneratedArtifactPath(filePath) &&
      isLikelyCodeOrConfig(filePath)
  );

  if (nonGraphifyCodeChanges.length === 0) {
    return {
      status: "n/a",
      detail:
        "No source/config changes detected outside Graphify artifacts and local generated paths.",
    };
  }

  if (changedArtifacts.length === GRAPHIFY_ARTIFACTS.length) {
    return {
      status: "fresh",
      detail:
        "Both Graphify artifacts are present in the changed file set alongside code/config updates.",
    };
  }

  if (changedArtifacts.length > 0) {
    return {
      status: "partial",
      detail:
        "Only part of the Graphify artifact set is included in changed files while code/config changed.",
    };
  }

  return {
    status: "stale",
    detail:
      "Code/config changes were detected without Graphify artifact updates in the changed file set.",
  };
}

async function runQuietHarnessCheck(rootDir: string) {
  const errors = await validateHarnessDocs(rootDir);
  if (errors.length === 0) {
    return;
  }

  throw new Error(errors.join("\n"));
}

function appendListSection(
  lines: string[],
  title: string,
  entries: string[],
  emptyMessage = "- None"
) {
  lines.push(title);
  if (entries.length === 0) {
    lines.push(emptyMessage);
    lines.push("");
    return;
  }

  for (const entry of entries) {
    lines.push(`- ${entry}`);
  }
  lines.push("");
}

function buildMarkdownBundle(params: {
  baseRef: string;
  changedFiles: ChangedFiles;
  allChangedFiles: string[];
  outsideTargetFiles: string[];
  coverageByTarget: TargetCoverage[];
  selectedValidations: string[];
  recommendedValidations: string[];
  blockers: string[];
  warnings: string[];
  info: string[];
  graphifyFreshness: GraphifyFreshness;
}) {
  const lines: string[] = [];
  lines.push("# Harness Self Review");
  lines.push("");

  lines.push("## Inputs");
  lines.push(`- base ref: ${quoteCode(params.baseRef)}`);
  lines.push(`- base diff files: ${params.changedFiles.baseFiles.length}`);
  lines.push(`- tracked working-tree files: ${params.changedFiles.trackedFiles.length}`);
  lines.push(`- untracked files: ${params.changedFiles.untrackedFiles.length}`);
  lines.push(`- total unique changed files: ${params.allChangedFiles.length}`);
  lines.push("");

  appendListSection(
    lines,
    `## Base diff files (${quoteCode(`${params.baseRef}...HEAD`)})`,
    params.changedFiles.baseFiles.map(quoteCode)
  );

  appendListSection(
    lines,
    "## Local tracked files",
    params.changedFiles.trackedFiles.map(quoteCode)
  );

  appendListSection(
    lines,
    "## Local untracked files",
    params.changedFiles.untrackedFiles.map(quoteCode)
  );

  lines.push("## Changed surfaces");
  if (params.coverageByTarget.length === 0) {
    lines.push("- No touched files under target app packages.");
    lines.push("");
  } else {
    for (const coverage of params.coverageByTarget) {
      lines.push(
        `### ${coverage.target.appLabel} (${quoteCode(coverage.target.packageDir)})`
      );

      if (coverage.matchedSurfaces.length === 0) {
        lines.push("- No matched validation surfaces.");
      } else {
        for (const surface of coverage.matchedSurfaces) {
          lines.push(
            `- ${quoteCode(surface.surfaceName)}: ${surface.files
              .map(quoteCode)
              .join(", ")}`
          );
        }
      }

      if (coverage.uncoveredFiles.length > 0) {
        lines.push(
          `- uncovered: ${coverage.uncoveredFiles.map(quoteCode).join(", ")}`
        );
      }

      lines.push("");
    }
  }

  appendListSection(
    lines,
    "## Outside target-app surfaces",
    params.outsideTargetFiles.map(quoteCode)
  );

  appendListSection(
    lines,
    "## Selected validations",
    params.selectedValidations.map(quoteCode)
  );

  appendListSection(
    lines,
    "## Recommended validations",
    params.recommendedValidations.map(quoteCode)
  );

  lines.push("## Graphify freshness");
  lines.push(`- status: ${params.graphifyFreshness.status}`);
  lines.push(`- detail: ${params.graphifyFreshness.detail}`);
  lines.push("");

  lines.push("## Runtime behavior scenarios");
  const touchedTargetScenarios = params.coverageByTarget
    .map((coverage) => ({
      appLabel: coverage.target.appLabel,
      scenarios: coverage.target.runtimeScenarios,
    }))
    .filter((entry) => entry.scenarios.length > 0);

  if (touchedTargetScenarios.length === 0) {
    lines.push("- No runtime behavior scenarios discovered for touched packages.");
    lines.push("");
  } else {
    for (const entry of touchedTargetScenarios) {
      lines.push(`### ${entry.appLabel}`);
      for (const scenario of entry.scenarios) {
        lines.push(`- ${scenario}`);
      }
      lines.push("");
    }
  }

  lines.push("## Harness coverage");
  lines.push("### Blockers");
  if (params.blockers.length === 0) {
    lines.push("- None");
  } else {
    for (const blocker of params.blockers) {
      lines.push(`- ${blocker}`);
    }
  }
  lines.push("");

  lines.push("### Warnings");
  if (params.warnings.length === 0) {
    lines.push("- None");
  } else {
    for (const warning of params.warnings) {
      lines.push(`- ${warning}`);
    }
  }
  lines.push("");

  lines.push("### Info");
  if (params.info.length === 0) {
    lines.push("- None");
  } else {
    for (const note of params.info) {
      lines.push(`- ${note}`);
    }
  }
  lines.push("");

  lines.push("## Verdict");
  lines.push(params.blockers.length > 0 ? "- BLOCKED" : "- READY");
  lines.push("");

  return lines.join("\n");
}

function parseCliArguments(argv: string[]) {
  let baseRef: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const currentArg = argv[index];

    if (!currentArg) {
      continue;
    }

    if (currentArg === "--base") {
      const nextValue = argv[index + 1];
      if (!nextValue || nextValue.startsWith("--")) {
        throw new Error("Missing value for --base. Example: bun run harness:self-review --base origin/main");
      }
      baseRef = nextValue;
      index += 1;
      continue;
    }

    if (currentArg.startsWith("--base=")) {
      baseRef = currentArg.slice("--base=".length);
      continue;
    }

    if (currentArg === "--help" || currentArg === "-h") {
      return {
        baseRef: "",
        help: true,
      };
    }

    throw new Error(
      `Unknown argument: ${currentArg}. Usage: bun run harness:self-review --base <ref>`
    );
  }

  if (!baseRef) {
    throw new Error(
      "Missing required --base <ref>. Usage: bun run harness:self-review --base origin/main"
    );
  }

  return {
    baseRef,
    help: false,
  };
}

export async function runHarnessSelfReview(
  rootDir: string,
  options: HarnessSelfReviewOptions
): Promise<HarnessSelfReviewResult> {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const info: string[] = [];

  const getChangedFiles = options.getChangedFiles ?? getChangedFilesFromGit;
  const runCheck = options.runHarnessCheck ?? runQuietHarnessCheck;

  let changedFiles: ChangedFiles = {
    baseFiles: [],
    trackedFiles: [],
    untrackedFiles: [],
  };

  try {
    changedFiles = await getChangedFiles(rootDir, options.baseRef);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    blockers.push(`Unable to compute changed files: ${message}`);
  }

  try {
    await runCheck(rootDir);
    info.push("harness:check passed.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    blockers.push(`harness:check failed: ${message}`);
  }

  const { loadedTargets, blockers: targetLoadBlockers } =
    await loadSelfReviewTargets(rootDir);
  blockers.push(...targetLoadBlockers);

  const allChangedFiles = sortUniquePaths([
    ...changedFiles.baseFiles,
    ...changedFiles.trackedFiles,
    ...changedFiles.untrackedFiles,
  ]);

  const { coverageByTarget, blockers: coverageBlockers, selectedValidationCommands } =
    collectCoverage(allChangedFiles, loadedTargets);
  blockers.push(...coverageBlockers);

  const outsideTargetFiles = allChangedFiles.filter(
    (filePath) =>
      !loadedTargets.some((target) =>
        matchesPathPrefix(filePath, `${target.packageDir}/`)
      )
  );

  const recommendedValidations = coverageByTarget.length
    ? ["bun run harness:audit", "bun run pr:athena"]
    : [];

  const graphifyFreshness = await evaluateGraphifyFreshness(
    rootDir,
    allChangedFiles
  );

  if (graphifyFreshness.status === "stale") {
    warnings.push(
      "Graphify appears stale relative to current changed files. Run `bun run graphify:rebuild` before handoff."
    );
  } else if (graphifyFreshness.status === "partial") {
    warnings.push(
      "Graphify artifact updates are partial. Ensure both `graphify-out/GRAPH_REPORT.md` and `graphify-out/graph.json` are refreshed together."
    );
  } else if (graphifyFreshness.status === "missing-artifacts") {
    warnings.push(
      "Required Graphify artifacts are missing in the working tree."
    );
  }

  const markdown = buildMarkdownBundle({
    baseRef: options.baseRef,
    changedFiles: {
      baseFiles: sortUniquePaths(changedFiles.baseFiles),
      trackedFiles: sortUniquePaths(changedFiles.trackedFiles),
      untrackedFiles: sortUniquePaths(changedFiles.untrackedFiles),
    },
    allChangedFiles,
    outsideTargetFiles,
    coverageByTarget,
    selectedValidations: selectedValidationCommands,
    recommendedValidations,
    blockers: sortUniquePaths(blockers),
    warnings: sortUniquePaths(warnings),
    info: sortUniquePaths(info),
    graphifyFreshness,
  });

  return {
    markdown,
    blockers: sortUniquePaths(blockers),
    warnings: sortUniquePaths(warnings),
    info: sortUniquePaths(info),
    selectedValidations: selectedValidationCommands,
    recommendedValidations,
  };
}

if (import.meta.main) {
  try {
    const parsedArgs = parseCliArguments(Bun.argv.slice(2));

    if (parsedArgs.help) {
      console.log("Usage: bun run harness:self-review --base <ref>");
      process.exit(0);
    }

    const result = await runHarnessSelfReview(process.cwd(), {
      baseRef: parsedArgs.baseRef,
    });

    console.log(result.markdown);

    if (result.blockers.length > 0) {
      throw new Error(
        `harness:self-review blocked with ${result.blockers.length} blocker(s).`
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n[harness:self-review] BLOCKED: ${message}`);
    process.exit(1);
  }
}
