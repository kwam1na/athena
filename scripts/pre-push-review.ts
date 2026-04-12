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
  runHarnessReview?: (
    rootDir: string,
    options: { getChangedFiles: (rootDir: string) => Promise<string[]> }
  ) => Promise<void>;
  logger?: PrePushReviewLogger;
};

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

export async function runPrePushReview(
  rootDir: string,
  options: PrePushReviewOptions = {}
) {
  const logger = options.logger ?? console;
  const getChangedFiles = options.getChangedFiles ?? getChangedFilesVsOriginMain;
  const runArchitecture = options.runArchitectureCheck ?? runArchitectureCheck;
  const review = options.runHarnessReview ?? runHarnessReview;

  logger.log("[pre-push] Running pre-push validation suite...\n");

  logger.log("[pre-push] Step 1/2: architecture:check");
  await runArchitecture(rootDir);

  // runHarnessReview internally runs harness:check first, then targeted per-surface scripts
  logger.log("[pre-push] Step 2/2: harness:review (vs origin/main)");
  await review(rootDir, {
    getChangedFiles,
  });

  logger.log("\n[pre-push] All checks passed.");
}

if (import.meta.main) {
  runPrePushReview(ROOT_DIR).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n[pre-push] BLOCKED: ${message}`);
    process.exit(1);
  });
}
