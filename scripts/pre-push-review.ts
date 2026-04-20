import { runHarnessReview } from "./harness-review";

const ROOT_DIR = process.cwd();
const BASE_REF = "origin/main";

type SpawnedProcess = {
  exited: Promise<number>;
  stdout?: ReadableStream | null;
  stderr?: ReadableStream | null;
};

type PrePushReviewLogger = Pick<Console, "log" | "warn" | "error">;

type PrePushReviewOptions = {
  getChangedFiles?: (rootDir: string) => Promise<string[]>;
  runArchitectureCheck?: (rootDir: string) => Promise<void>;
  runHarnessInferentialReview?: (rootDir: string) => Promise<void>;
  runHarnessImplementationTests?: (rootDir: string) => Promise<void>;
  runHarnessSelfReview?: (rootDir: string) => Promise<void>;
  runHarnessReview?: (
    rootDir: string,
    options: {
      baseRef: string;
      getChangedFiles?: (rootDir: string, baseRef?: string) => Promise<string[]>;
    }
  ) => Promise<void>;
  logger?: PrePushReviewLogger;
};

const HARNESS_IMPLEMENTATION_CHANGE_PATTERNS = [
  /^scripts\//,
  /^packages\/[^/]+\/docs\/agent\//,
  /^packages\/[^/]+\/AGENTS\.md$/,
  /^packages\/AGENTS\.md$/,
  /^README\.md$/,
  /^package\.json$/,
  /^\.github\/workflows\/athena-pr-tests\.yml$/,
  /^\.husky\/pre-push$/,
];

export async function getChangedFilesVsOriginMain(
  rootDir: string,
  spawn: (command: string[], options: { cwd: string; stdout: "pipe"; stderr: "pipe" }) => SpawnedProcess = Bun.spawn
): Promise<string[]> {
  const refCheck = spawn(["git", "rev-parse", "--verify", BASE_REF], {
    cwd: rootDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const refExitCode = await refCheck.exited;

  if (refExitCode !== 0) {
    console.warn(
      `[pre-push] Warning: ${BASE_REF} not reachable. Skipping targeted validations.`
    );
    return [];
  }

  const proc = spawn(
    ["git", "diff", "--name-only", `${BASE_REF}...HEAD`],
    { cwd: rootDir, stdout: "pipe", stderr: "pipe" }
  );

  const [output, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    console.warn(
      `[pre-push] Warning: git diff failed. Skipping targeted validations.`
    );
    return [];
  }

  return output
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);
}

export async function runArchitectureCheck(rootDir: string): Promise<void> {
  const proc = Bun.spawn(["bun", "run", "architecture:check"], {
    cwd: rootDir,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`architecture:check failed (exit ${exitCode})`);
  }
}

export async function runHarnessSelfReview(rootDir: string): Promise<void> {
  const proc = Bun.spawn(
    ["bun", "run", "harness:self-review", "--base", BASE_REF],
    {
      cwd: rootDir,
      stdout: "inherit",
      stderr: "inherit",
    }
  );
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`harness:self-review failed (exit ${exitCode})`);
  }
}

export async function runHarnessImplementationTests(rootDir: string): Promise<void> {
  const proc = Bun.spawn(["bun", "run", "harness:test"], {
    cwd: rootDir,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`harness:test failed (exit ${exitCode})`);
  }
}

export async function runHarnessInferentialReview(rootDir: string): Promise<void> {
  const proc = Bun.spawn(["bun", "run", "harness:inferential-review"], {
    cwd: rootDir,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`harness:inferential-review failed (exit ${exitCode})`);
  }
}

function shouldRunHarnessImplementationTests(changedFiles: string[]): boolean {
  return changedFiles.some((filePath) =>
    HARNESS_IMPLEMENTATION_CHANGE_PATTERNS.some((pattern) => pattern.test(filePath))
  );
}

export async function runPrePushReview(
  rootDir: string,
  options: PrePushReviewOptions = {}
) {
  const logger = options.logger ?? console;
  const getChangedFiles = options.getChangedFiles ?? getChangedFilesVsOriginMain;
  const runArchitecture = options.runArchitectureCheck ?? runArchitectureCheck;
  const runInferentialReview =
    options.runHarnessInferentialReview ?? runHarnessInferentialReview;
  const runHarnessTests =
    options.runHarnessImplementationTests ?? runHarnessImplementationTests;
  const runSelfReview = options.runHarnessSelfReview ?? runHarnessSelfReview;
  const review = options.runHarnessReview ?? runHarnessReview;
  let changedFilesPromise: Promise<string[]> | undefined;

  const loadChangedFiles = () => {
    changedFilesPromise ??= getChangedFiles(rootDir);
    return changedFilesPromise;
  };

  const getChangedFilesForHarnessReview = async (nextRootDir: string) => {
    if (nextRootDir === rootDir) {
      return loadChangedFiles();
    }

    return getChangedFiles(nextRootDir);
  };

  logger.log("[pre-push] Running pre-push validation suite...\n");

  logger.log(`[pre-push] Step 1/5: harness:self-review (vs ${BASE_REF})`);
  await runSelfReview(rootDir);

  logger.log("[pre-push] Step 2/5: architecture:check");
  await runArchitecture(rootDir);

  const changedFiles = await loadChangedFiles();

  if (shouldRunHarnessImplementationTests(changedFiles)) {
    logger.log(
      "[pre-push] Step 3/5: harness:test (harness-owned changes detected)"
    );
    await runHarnessTests(rootDir);
  } else {
    logger.log("[pre-push] Step 3/5: harness:test skipped (no harness-owned changes)");
  }

  // runHarnessReview internally runs harness:check first, then targeted per-surface scripts
  logger.log(`[pre-push] Step 4/5: harness:review (vs ${BASE_REF})`);
  await review(rootDir, {
    baseRef: BASE_REF,
    getChangedFiles: getChangedFilesForHarnessReview,
  });

  logger.log("[pre-push] Step 5/5: harness:inferential-review");
  await runInferentialReview(rootDir);

  logger.log("\n[pre-push] All checks passed.");
}

if (import.meta.main) {
  runPrePushReview(ROOT_DIR).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n[pre-push] BLOCKED: ${message}`);
    process.exit(1);
  });
}
