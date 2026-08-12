import {
  computeDeliverableTreeIdentity,
  type HarnessReviewIdentityVersion,
} from "./harness-review-identity";

export const HARNESS_CANDIDATE_SCHEMA_VERSION = 1;
export const HARNESS_CANDIDATE_BASE_REF = "origin/main" as const;

type SpawnedProcess = {
  exited: Promise<number>;
  stdout?: ReadableStream | null;
  stderr?: ReadableStream | null;
};

export type CandidateCommandRunner = (
  command: string[],
  options: { cwd: string; stdout: "pipe"; stderr: "pipe" },
) => SpawnedProcess;

export type HarnessCandidate = {
  schemaVersion: typeof HARNESS_CANDIDATE_SCHEMA_VERSION;
  headSha: string;
  treeSha: string;
  /**
   * Identity of the reviewable content inside `treeSha`. Review evidence binds
   * to this rather than the raw tree so delivery narration can land without
   * invalidating an approval; see `harness-review-identity.ts`.
   */
  deliverableTreeSha: string;
  identityVersion: HarnessReviewIdentityVersion;
  mode: "clean" | "staged-index";
  baseRef: typeof HARNESS_CANDIDATE_BASE_REF;
  baseTipSha: string;
  diffBaseSha: string;
  status: string;
  untrackedFiles: string[];
};

export type HarnessCandidateCapture =
  | { ok: true; candidate: HarnessCandidate }
  | {
      ok: false;
      status: "candidate_unprepared" | "candidate_ambiguous";
      reason: string;
    };

type CandidateObservation = Omit<
  HarnessCandidate,
  | "schemaVersion"
  | "mode"
  | "treeSha"
  | "deliverableTreeSha"
  | "identityVersion"
  | "untrackedFiles"
> & {
  headTreeSha: string;
  indexTreeSha: string;
  untracked: string;
  unstagedDiffExitCode: number;
};

export type CandidateCaptureOptions = {
  spawn?: CandidateCommandRunner;
  maxAttempts?: number;
};

export type CandidatePathClassification =
  "relevant" | "test" | "generated" | "lockfile";

export type CandidateDiffEntry = {
  path: string;
  oldPath?: string;
  additions: number | null;
  deletions: number | null;
  binary?: boolean;
};

export type ReviewSensitiveScenario = {
  id: string;
  reviewSensitive: boolean;
  touchedPaths: readonly string[];
  packageDir?: string;
};

export type ReviewActivationProjection = {
  relevantLineCount: number;
  relevantPaths: string[];
  excludedPaths: string[];
  binaryPaths: string[];
  sensitiveScenarioIds: string[];
};

function normalizeRepoPath(repoPath: string) {
  return repoPath.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
}

async function runCommand(
  rootDir: string,
  command: string[],
  spawn: CandidateCommandRunner,
) {
  const process = spawn(command, {
    cwd: rootDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      stderr.trim() || stdout.trim() || `${command.join(" ")} failed`,
    );
  }
  return stdout.trim();
}

async function runExitCode(
  rootDir: string,
  command: string[],
  spawn: CandidateCommandRunner,
) {
  const process = spawn(command, {
    cwd: rootDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode > 1) {
    throw new Error(
      stderr.trim() || stdout.trim() || `${command.join(" ")} failed`,
    );
  }
  return exitCode;
}

async function observeCandidate(
  rootDir: string,
  spawn: CandidateCommandRunner,
) {
  // Keep this sequence explicit: the second complete observation is the bracket
  // around every mutable Git input, rather than a collection of independently
  // timed parallel reads.
  const headSha = await runCommand(
    rootDir,
    ["git", "rev-parse", "--verify", "HEAD"],
    spawn,
  );
  const headTreeSha = await runCommand(
    rootDir,
    ["git", "rev-parse", "--verify", "HEAD^{tree}"],
    spawn,
  );
  const indexTreeSha = await runCommand(rootDir, ["git", "write-tree"], spawn);
  const baseTipSha = await runCommand(
    rootDir,
    ["git", "rev-parse", "--verify", HARNESS_CANDIDATE_BASE_REF],
    spawn,
  );
  const diffBaseSha = await runCommand(
    rootDir,
    ["git", "merge-base", HARNESS_CANDIDATE_BASE_REF, "HEAD"],
    spawn,
  );
  const status = await runCommand(
    rootDir,
    ["git", "status", "--porcelain", "--untracked-files=all"],
    spawn,
  );
  const untracked = await runCommand(
    rootDir,
    ["git", "ls-files", "--others", "--exclude-standard"],
    spawn,
  );
  const unstagedDiffExitCode = await runExitCode(
    rootDir,
    ["git", "diff", "--quiet"],
    spawn,
  );

  return {
    headSha,
    headTreeSha,
    indexTreeSha,
    baseRef: HARNESS_CANDIDATE_BASE_REF,
    baseTipSha,
    diffBaseSha,
    status,
    untracked,
    unstagedDiffExitCode,
  } satisfies CandidateObservation;
}

function sameObservation(
  left: CandidateObservation,
  right: CandidateObservation,
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

type PendingCandidate = Omit<
  HarnessCandidate,
  "deliverableTreeSha" | "identityVersion"
>;

type PendingCandidateCapture =
  | { ok: true; candidate: PendingCandidate }
  | Extract<HarnessCandidateCapture, { ok: false }>;

function candidateFromObservation(
  observation: CandidateObservation,
): PendingCandidateCapture {
  const untrackedFiles = observation.untracked
    .split("\n")
    .map((entry) => normalizeRepoPath(entry.trim()))
    .filter(Boolean);
  if (observation.unstagedDiffExitCode !== 0 || untrackedFiles.length > 0) {
    return {
      ok: false,
      status: "candidate_unprepared",
      reason:
        "candidate has unstaged tracked or untracked content; run `bun run pr:athena:prepare` after staging intended files",
    };
  }

  const hasStatus = observation.status.trim().length > 0;
  if (hasStatus && observation.indexTreeSha === observation.headTreeSha) {
    return {
      ok: false,
      status: "candidate_unprepared",
      reason:
        "candidate status is non-clean but the staged index does not define a distinct prepared tree",
    };
  }

  return {
    ok: true,
    candidate: {
      schemaVersion: HARNESS_CANDIDATE_SCHEMA_VERSION,
      headSha: observation.headSha,
      treeSha: hasStatus ? observation.indexTreeSha : observation.headTreeSha,
      mode: hasStatus ? "staged-index" : "clean",
      baseRef: observation.baseRef,
      baseTipSha: observation.baseTipSha,
      diffBaseSha: observation.diffBaseSha,
      status: observation.status,
      untrackedFiles,
    },
  };
}

export async function captureStableHarnessCandidate(
  rootDir: string,
  options: CandidateCaptureOptions = {},
): Promise<HarnessCandidateCapture> {
  const spawn = options.spawn ?? (Bun.spawn as CandidateCommandRunner);
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  let lastError = "candidate inputs changed during capture";

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const before = await observeCandidate(rootDir, spawn);
      const after = await observeCandidate(rootDir, spawn);
      if (!sameObservation(before, after)) {
        lastError =
          "candidate HEAD, index, base, merge base, status, or untracked files changed during capture";
        continue;
      }
      const pending = candidateFromObservation(after);
      if (!pending.ok) return pending;
      // The identity is a pure function of the stable tree, so it is computed
      // after the observation bracket rather than inside it.
      const identity = await computeDeliverableTreeIdentity(
        rootDir,
        pending.candidate.treeSha,
        { spawn },
      );
      return { ok: true, candidate: { ...pending.candidate, ...identity } };
    } catch (error) {
      return {
        ok: false,
        status: "candidate_unprepared",
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return { ok: false, status: "candidate_ambiguous", reason: lastError };
}

const TEST_DIRECTORY_PATTERN =
  /(?:^|\/)(?:__tests__|__fixtures__|tests?|fixtures?|[^/]+-fixtures)(?:\/|$)/i;
const TEST_FILE_PATTERN = /(?:^|\/)[^/]+\.(?:test|spec|e2e)\.[^/]+$/i;
const TEST_SETUP_PATTERN =
  /(?:^|\/)(?:vitest|jest|test)[.-]setup\.[^/]+$|(?:^|\/)setup-tests?\.[^/]+$|(?:^|\/)\.env\.test$/i;
const LOCKFILE_PATTERN =
  /(?:^|\/)(?:bun\.lockb?|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/i;

export function classifyCandidatePath(
  repoPath: string,
): CandidatePathClassification {
  const normalized = normalizeRepoPath(repoPath);
  if (LOCKFILE_PATTERN.test(normalized)) return "lockfile";
  if (
    normalized.startsWith("graphify-out/") ||
    normalized.includes("/_generated/") ||
    normalized.endsWith("routeTree.gen.ts") ||
    normalized.endsWith("/docs/agent/validation-map.json")
  )
    return "generated";
  if (
    TEST_DIRECTORY_PATTERN.test(normalized) ||
    TEST_FILE_PATTERN.test(normalized) ||
    TEST_SETUP_PATTERN.test(normalized)
  )
    return "test";
  return "relevant";
}

function pathMatchesPrefix(repoPath: string, prefix: string) {
  const normalizedPath = normalizeRepoPath(repoPath);
  const normalizedPrefix = normalizeRepoPath(prefix);
  return (
    normalizedPath === normalizedPrefix ||
    normalizedPath.startsWith(`${normalizedPrefix}/`)
  );
}

function scenarioMatchesEntry(
  scenario: ReviewSensitiveScenario,
  entry: CandidateDiffEntry,
) {
  const paths = [entry.oldPath, entry.path].filter((value): value is string =>
    Boolean(value),
  );
  return scenario.touchedPaths.some((touchedPath) => {
    const fullPrefix = scenario.packageDir
      ? `${normalizeRepoPath(scenario.packageDir)}/${normalizeRepoPath(touchedPath)}`
      : touchedPath;
    return paths.some((repoPath) => pathMatchesPrefix(repoPath, fullPrefix));
  });
}

export function projectReviewActivation(
  entries: readonly CandidateDiffEntry[],
  scenarios: readonly ReviewSensitiveScenario[],
): ReviewActivationProjection {
  let relevantLineCount = 0;
  const relevantPaths = new Set<string>();
  const excludedPaths = new Set<string>();
  const binaryPaths = new Set<string>();

  for (const entry of entries) {
    const paths = [entry.oldPath, entry.path].filter((value): value is string =>
      Boolean(value),
    );
    const relevant = paths.some(
      (repoPath) => classifyCandidatePath(repoPath) === "relevant",
    );
    if (!relevant) {
      paths.forEach((repoPath) =>
        excludedPaths.add(normalizeRepoPath(repoPath)),
      );
      continue;
    }
    paths.forEach((repoPath) => relevantPaths.add(normalizeRepoPath(repoPath)));
    if (entry.binary || entry.additions === null || entry.deletions === null) {
      paths.forEach((repoPath) => binaryPaths.add(normalizeRepoPath(repoPath)));
      continue;
    }
    relevantLineCount += entry.additions + entry.deletions;
  }

  const sensitiveScenarioIds = scenarios
    .filter(
      (scenario) =>
        scenario.reviewSensitive &&
        entries.some((entry) => scenarioMatchesEntry(scenario, entry)),
    )
    .map((scenario) => scenario.id)
    .sort((left, right) => left.localeCompare(right));
  return {
    relevantLineCount,
    relevantPaths: [...relevantPaths].sort(),
    excludedPaths: [...excludedPaths].sort(),
    binaryPaths: [...binaryPaths].sort(),
    sensitiveScenarioIds,
  };
}

function expandRenamePath(repoPath: string) {
  const match = /^(.*)\{([^{}]+) => ([^{}]+)\}(.*)$/.exec(repoPath);
  if (match) {
    return {
      oldPath: `${match[1]}${match[2]}${match[4]}`,
      path: `${match[1]}${match[3]}${match[4]}`,
    };
  }
  const simple = /^(.+) => (.+)$/.exec(repoPath);
  return simple ? { oldPath: simple[1], path: simple[2] } : { path: repoPath };
}

export function parseCandidateNumstat(output: string): CandidateDiffEntry[] {
  return output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const [additionsText, deletionsText, ...pathParts] = line.split("\t");
      const rename = expandRenamePath(pathParts.join("\t"));
      const binary = additionsText === "-" || deletionsText === "-";
      return {
        ...rename,
        additions: binary ? null : Number(additionsText),
        deletions: binary ? null : Number(deletionsText),
        binary,
      };
    });
}

export async function evaluateCandidateReviewActivation(
  rootDir: string,
  candidate: HarnessCandidate,
  scenarios: readonly ReviewSensitiveScenario[],
  options: { spawn?: CandidateCommandRunner } = {},
) {
  const spawn = options.spawn ?? (Bun.spawn as CandidateCommandRunner);
  const output = await runCommand(
    rootDir,
    [
      "git",
      "diff",
      "--numstat",
      "--find-renames",
      candidate.diffBaseSha,
      candidate.treeSha,
    ],
    spawn,
  );
  return projectReviewActivation(parseCandidateNumstat(output), scenarios);
}
