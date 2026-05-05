import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

type LineChange = {
  additions: number;
  deletions: number;
};

type CompoundSolutionCheckInput = {
  changedFiles: string[];
  existingFiles: Set<string>;
  markdownContents: Map<string, string>;
  sourceLineChanges: Map<string, LineChange>;
  threshold?: number;
};

type CompoundSolutionFinding = {
  message: string;
};

const DEFAULT_SOURCE_LINE_THRESHOLD = 150;

const SOURCE_PATTERNS = [
  /^packages\/[^/]+\/src\/.*\.(ts|tsx|js|jsx)$/,
  /^packages\/[^/]+\/convex\/.*\.(ts|tsx)$/,
  /^packages\/[^/]+\/shared\/.*\.(ts|tsx|js|jsx)$/,
  /^scripts\/.*\.(ts|tsx|js|mjs|cjs)$/,
] as const;

const TEST_FILE_PATTERN = /(^|\/)[^/]+\.(test|spec)\.(ts|tsx|js|jsx)$/;
const SOLUTION_REFERENCE_PATTERN =
  /(?:^|[\s('"`])((?:\.\/)?docs\/solutions\/[A-Za-z0-9._/-]+\.md)(?=$|[\s)'"`,.])/g;

function normalizeRepoPath(repoPath: string) {
  return repoPath.replaceAll("\\", "/").replace(/^\.\//, "");
}

function sortUniquePaths(paths: string[]) {
  return [...new Set(paths.map((entry) => normalizeRepoPath(entry)).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right)
  );
}

export function isSolutionDocPath(repoPath: string) {
  return /^docs\/solutions\/.+\.md$/.test(normalizeRepoPath(repoPath));
}

export function isMarkdownDocPath(repoPath: string) {
  return /^docs\/.+\.md$/.test(normalizeRepoPath(repoPath));
}

export function isConsiderableSourcePath(repoPath: string) {
  const normalizedPath = normalizeRepoPath(repoPath);

  if (
    normalizedPath.startsWith("graphify-out/") ||
    normalizedPath.includes("/_generated/") ||
    normalizedPath.endsWith("/routeTree.gen.ts") ||
    TEST_FILE_PATTERN.test(normalizedPath)
  ) {
    return false;
  }

  return SOURCE_PATTERNS.some((pattern) => pattern.test(normalizedPath));
}

export function extractSolutionReferences(markdown: string) {
  return sortUniquePaths(
    [...markdown.matchAll(SOLUTION_REFERENCE_PATTERN)].map((match) => match[1])
  );
}

function totalConsiderableSourceLineChanges(
  sourceLineChanges: Map<string, LineChange>
) {
  let total = 0;

  for (const [filePath, change] of sourceLineChanges) {
    if (!isConsiderableSourcePath(filePath)) {
      continue;
    }

    total += change.additions + change.deletions;
  }

  return total;
}

export function collectCompoundSolutionFindings({
  changedFiles,
  existingFiles,
  markdownContents,
  sourceLineChanges,
  threshold = DEFAULT_SOURCE_LINE_THRESHOLD,
}: CompoundSolutionCheckInput) {
  const findings: CompoundSolutionFinding[] = [];
  const normalizedChangedFiles = sortUniquePaths(changedFiles);
  const changedSolutionDocs = normalizedChangedFiles.filter((filePath) =>
    isSolutionDocPath(filePath)
  );

  for (const [filePath, markdown] of markdownContents) {
    const references = extractSolutionReferences(markdown);

    for (const reference of references) {
      if (!existingFiles.has(reference)) {
        findings.push({
          message: `${normalizeRepoPath(
            filePath
          )} references ${reference}, but that solution doc does not exist.`,
        });
      }
    }
  }

  const sourceLineTotal = totalConsiderableSourceLineChanges(sourceLineChanges);

  if (sourceLineTotal >= threshold && changedSolutionDocs.length === 0) {
    findings.push({
      message: `Substantial source change detected (${sourceLineTotal} changed source lines, threshold ${threshold}) without a docs/solutions/**/*.md update.`,
    });
  }

  return findings;
}

function runGit(rootDir: string, args: string[], allowFailure = false) {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: rootDir,
    env: gitEnv(),
    stderr: "pipe",
    stdout: "pipe",
  });

  if (result.exitCode !== 0 && !allowFailure) {
    throw new Error(
      `git ${args.join(" ")} failed: ${result.stderr.toString().trim()}`
    );
  }

  return result.exitCode === 0 ? result.stdout.toString() : "";
}

function gitEnv() {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  return env;
}

function parseChangedFiles(output: string) {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseNumstat(output: string) {
  const changes = new Map<string, LineChange>();

  for (const line of output.split("\n")) {
    const [additionsText, deletionsText, ...fileParts] = line.split("\t");
    const filePath = normalizeRepoPath(fileParts.join("\t"));

    if (!filePath || additionsText === "-" || deletionsText === "-") {
      continue;
    }

    const previous = changes.get(filePath) ?? { additions: 0, deletions: 0 };
    changes.set(filePath, {
      additions: previous.additions + Number(additionsText),
      deletions: previous.deletions + Number(deletionsText),
    });
  }

  return changes;
}

function mergeLineChanges(target: Map<string, LineChange>, source: Map<string, LineChange>) {
  for (const [filePath, change] of source) {
    const previous = target.get(filePath) ?? { additions: 0, deletions: 0 };
    target.set(filePath, {
      additions: previous.additions + change.additions,
      deletions: previous.deletions + change.deletions,
    });
  }
}

function countFileLines(filePath: string) {
  return readFileSync(filePath, "utf8").split("\n").length;
}

function collectChangedFiles(rootDir: string, baseRef: string) {
  return sortUniquePaths([
    ...parseChangedFiles(runGit(rootDir, ["diff", "--name-only", `${baseRef}...HEAD`])),
    ...parseChangedFiles(runGit(rootDir, ["diff", "--name-only"])),
    ...parseChangedFiles(runGit(rootDir, ["diff", "--cached", "--name-only"])),
    ...parseChangedFiles(runGit(rootDir, ["ls-files", "--others", "--exclude-standard"])),
  ]);
}

function collectSourceLineChanges(rootDir: string, baseRef: string, changedFiles: string[]) {
  const changes = new Map<string, LineChange>();

  mergeLineChanges(
    changes,
    parseNumstat(runGit(rootDir, ["diff", "--numstat", `${baseRef}...HEAD`]))
  );
  mergeLineChanges(changes, parseNumstat(runGit(rootDir, ["diff", "--numstat"])));
  mergeLineChanges(changes, parseNumstat(runGit(rootDir, ["diff", "--cached", "--numstat"])));

  const untrackedFiles = parseChangedFiles(
    runGit(rootDir, ["ls-files", "--others", "--exclude-standard"])
  );

  for (const filePath of untrackedFiles) {
    const normalizedPath = normalizeRepoPath(filePath);
    if (!isConsiderableSourcePath(normalizedPath) || changes.has(normalizedPath)) {
      continue;
    }

    changes.set(normalizedPath, {
      additions: countFileLines(path.join(rootDir, normalizedPath)),
      deletions: 0,
    });
  }

  for (const filePath of changedFiles) {
    const normalizedPath = normalizeRepoPath(filePath);
    if (isConsiderableSourcePath(normalizedPath) && !changes.has(normalizedPath)) {
      changes.set(normalizedPath, { additions: 0, deletions: 0 });
    }
  }

  return changes;
}

function collectMarkdownContents(rootDir: string, changedFiles: string[]) {
  const contents = new Map<string, string>();

  for (const filePath of changedFiles) {
    if (!isMarkdownDocPath(filePath)) {
      continue;
    }

    const absolutePath = path.join(rootDir, filePath);
    if (existsSync(absolutePath)) {
      contents.set(filePath, readFileSync(absolutePath, "utf8"));
    }
  }

  return contents;
}

function collectExistingFiles(rootDir: string) {
  return new Set(
    parseChangedFiles(runGit(rootDir, ["ls-files", "--cached", "--others", "--exclude-standard"]))
      .filter((filePath) => existsSync(path.join(rootDir, filePath)))
      .map((filePath) => normalizeRepoPath(filePath))
  );
}

function parseArgs(argv: string[]) {
  let baseRef = "origin/main";
  let threshold = DEFAULT_SOURCE_LINE_THRESHOLD;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--base") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --base.");
      }
      baseRef = value;
      index += 1;
      continue;
    }

    if (arg === "--threshold") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --threshold.");
      }
      threshold = Number(value);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}.`);
  }

  return { baseRef, threshold };
}

export function assertCompoundSolutionCheck(
  rootDir: string,
  options: { baseRef?: string; threshold?: number } = {}
) {
  const baseRef = options.baseRef ?? "origin/main";
  const threshold = options.threshold ?? DEFAULT_SOURCE_LINE_THRESHOLD;
  const changedFiles = collectChangedFiles(rootDir, baseRef);
  const findings = collectCompoundSolutionFindings({
    changedFiles,
    existingFiles: collectExistingFiles(rootDir),
    markdownContents: collectMarkdownContents(rootDir, changedFiles),
    sourceLineChanges: collectSourceLineChanges(rootDir, baseRef, changedFiles),
    threshold,
  });

  if (findings.length > 0) {
    throw new Error(
      `Compound solution check failed:\n${findings
        .map((finding) => `- ${finding.message}`)
        .join("\n")}\n\nAdd or update a docs/solutions note for reusable work, or remove stale solution references from the changed docs.`
    );
  }
}

if (import.meta.main) {
  try {
    const options = parseArgs(process.argv.slice(2));
    assertCompoundSolutionCheck(path.resolve(import.meta.dirname, ".."), options);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}
