import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  collectDeliverableDiffFingerprint,
  isDeliverableFingerprintPath,
  normalizeRepoPath,
  sortUniquePaths,
} from "./delivery-diff-fingerprint";

type LineChange = {
  additions: number;
  deletions: number;
};

type LandedChangeReportCheckInput = {
  changedFiles: string[];
  existingFiles: Set<string>;
  reportContents: Map<string, string>;
  sourceLineChanges: Map<string, LineChange>;
  deliverableDiffFingerprint?: string;
  threshold?: number;
};

type LandedChangeReportFinding = {
  message: string;
};

const DEFAULT_SOURCE_LINE_THRESHOLD = 300;
const REPORT_MARKER = 'data-athena-landed-change-report="v1"';
const REPORT_DIFF_FINGERPRINT_ATTRIBUTE = "data-athena-report-diff-fingerprint";

const SOURCE_PATTERNS = [
  /^packages\/[^/]+\/src\/.*\.(ts|tsx|js|jsx)$/,
  /^packages\/[^/]+\/convex\/.*\.(ts|tsx)$/,
  /^packages\/[^/]+\/shared\/.*\.(ts|tsx|js|jsx)$/,
  /^scripts\/.*\.(ts|tsx|js|mjs|cjs)$/,
] as const;

const TEST_FILE_PATTERN = /(^|\/)[^/]+\.(test|spec)\.(ts|tsx|js|jsx)$/;

export { collectDeliverableDiffFingerprint, isDeliverableFingerprintPath };

export function isLandedChangeReportPath(repoPath: string) {
  return /^docs\/reports\/.+\.html$/.test(normalizeRepoPath(repoPath));
}

export function isReportableSourcePath(repoPath: string) {
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

function totalReportableSourceLineChanges(sourceLineChanges: Map<string, LineChange>) {
  let total = 0;

  for (const [filePath, change] of sourceLineChanges) {
    if (!isReportableSourcePath(filePath)) {
      continue;
    }

    total += change.additions + change.deletions;
  }

  return total;
}

function extractReportDiffFingerprint(html: string) {
  return html.match(
    new RegExp(`${REPORT_DIFF_FINGERPRINT_ATTRIBUTE}="([^"]+)"`)
  )?.[1];
}

function reportMissingSections(
  reportPath: string,
  html: string,
  expectedFingerprint?: string
) {
  const missingSections: string[] = [];
  const findings: LandedChangeReportFinding[] = [];

  if (!html.includes(REPORT_MARKER)) {
    missingSections.push(REPORT_MARKER);
  }

  if (!html.includes("Subagent Evidence")) {
    missingSections.push("Subagent Evidence");
  }

  if (!html.includes("Quiz: Pass Required")) {
    missingSections.push("Quiz: Pass Required");
  }

  if (!html.includes('id="changeQuiz"')) {
    missingSections.push('id="changeQuiz"');
  }

  if (expectedFingerprint) {
    const reportFingerprint = extractReportDiffFingerprint(html);

    if (!reportFingerprint) {
      missingSections.push(REPORT_DIFF_FINGERPRINT_ATTRIBUTE);
    } else if (reportFingerprint !== expectedFingerprint) {
      findings.push({
        message: `Landed-change report ${reportPath} is stale: embedded diff fingerprint ${reportFingerprint} does not match current deliverable diff ${expectedFingerprint}. Regenerate the report after final code and workflow changes.`,
      });
    }
  }

  if (missingSections.length === 0) {
    return findings;
  }

  return [
    {
      message: `Landed-change report ${reportPath} is missing required report markers: ${missingSections.join(
        ", "
      )}.`,
    },
    ...findings,
  ];
}

export function collectLandedChangeReportFindings({
  changedFiles,
  existingFiles,
  reportContents,
  sourceLineChanges,
  deliverableDiffFingerprint,
  threshold = DEFAULT_SOURCE_LINE_THRESHOLD,
}: LandedChangeReportCheckInput) {
  const findings: LandedChangeReportFinding[] = [];
  const normalizedChangedFiles = sortUniquePaths(changedFiles);
  const changedReportDocs = normalizedChangedFiles.filter((filePath) =>
    isLandedChangeReportPath(filePath)
  );
  const changedExistingReportDocs = changedReportDocs.filter((filePath) =>
    existingFiles.has(filePath)
  );
  const sourceLineTotal = totalReportableSourceLineChanges(sourceLineChanges);
  const reportValidationFindings = new Map(
    changedExistingReportDocs.map((reportPath) => [
      reportPath,
      reportMissingSections(
        reportPath,
        reportContents.get(reportPath) ?? "",
        deliverableDiffFingerprint
      ),
    ])
  );
  const validChangedReportDocs = changedExistingReportDocs.filter(
    (reportPath) => (reportValidationFindings.get(reportPath) ?? []).length === 0
  );

  if (sourceLineTotal >= threshold) {
    if (changedExistingReportDocs.length === 0) {
      findings.push({
        message: `Large source change detected (${sourceLineTotal} changed source lines, threshold ${threshold}) without a docs/reports/**/*.html landed-change report update.`,
      });
    } else if (validChangedReportDocs.length === 0) {
      for (const reportPath of changedExistingReportDocs) {
        findings.push(...(reportValidationFindings.get(reportPath) ?? []));
      }
    }
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
    if (!isReportableSourcePath(normalizedPath) || changes.has(normalizedPath)) {
      continue;
    }

    changes.set(normalizedPath, {
      additions: countFileLines(path.join(rootDir, normalizedPath)),
      deletions: 0,
    });
  }

  for (const filePath of changedFiles) {
    const normalizedPath = normalizeRepoPath(filePath);
    if (isReportableSourcePath(normalizedPath) && !changes.has(normalizedPath)) {
      changes.set(normalizedPath, { additions: 0, deletions: 0 });
    }
  }

  return changes;
}

function collectExistingFiles(rootDir: string) {
  return new Set(
    parseChangedFiles(runGit(rootDir, ["ls-files", "--cached", "--others", "--exclude-standard"]))
      .filter((filePath) => existsSync(path.join(rootDir, filePath)))
      .map((filePath) => normalizeRepoPath(filePath))
  );
}

function collectReportContents(rootDir: string, changedFiles: string[]) {
  const contents = new Map<string, string>();

  for (const filePath of changedFiles) {
    if (!isLandedChangeReportPath(filePath)) {
      continue;
    }

    const absolutePath = path.join(rootDir, filePath);
    if (existsSync(absolutePath)) {
      contents.set(filePath, readFileSync(absolutePath, "utf8"));
    }
  }

  return contents;
}

function parseArgs(argv: string[]) {
  let baseRef = "origin/main";
  let threshold = DEFAULT_SOURCE_LINE_THRESHOLD;
  let printFingerprint = false;

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

    if (arg === "--print-fingerprint") {
      printFingerprint = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}.`);
  }

  return { baseRef, threshold, printFingerprint };
}

export function assertLandedChangeReportCheck(
  rootDir: string,
  options: { baseRef?: string; threshold?: number } = {}
) {
  const baseRef = options.baseRef ?? "origin/main";
  const threshold = options.threshold ?? DEFAULT_SOURCE_LINE_THRESHOLD;
  const changedFiles = collectChangedFiles(rootDir, baseRef);
  const existingFiles = collectExistingFiles(rootDir);
  const deliverableDiffFingerprint = collectDeliverableDiffFingerprint(
    rootDir,
    baseRef,
    changedFiles
  );
  const findings = collectLandedChangeReportFindings({
    changedFiles,
    existingFiles,
    reportContents: collectReportContents(rootDir, changedFiles),
    sourceLineChanges: collectSourceLineChanges(rootDir, baseRef, changedFiles),
    deliverableDiffFingerprint,
    threshold,
  });

  if (findings.length > 0) {
    throw new Error(
      `Landed-change report check failed:\n${findings
        .map((finding) => `- ${finding.message}`)
        .join("\n")}\n\nUse the repo-local \`.agents/skills/ce-landed-change-report\` skill to create a digestible HTML report under \`docs/reports/\`. Large branches need a report artifact with subagent evidence and a pass-required quiz before delivery handoff.`
    );
  }
}

if (import.meta.main) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const rootDir = path.resolve(import.meta.dirname, "..");

    if (options.printFingerprint) {
      const changedFiles = collectChangedFiles(rootDir, options.baseRef);
      console.log(
        collectDeliverableDiffFingerprint(rootDir, options.baseRef, changedFiles)
      );
    } else {
      assertLandedChangeReportCheck(rootDir, options);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}
