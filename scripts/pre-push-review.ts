import { runHarnessReview } from "./harness-review";

const ROOT_DIR = process.cwd();
const BASE_REF = "origin/main";

async function getChangedFilesVsOriginMain(rootDir: string): Promise<string[]> {
  const refCheck = Bun.spawn(["git", "rev-parse", "--verify", BASE_REF], {
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

  const proc = Bun.spawn(
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

async function runArchitectureCheck(rootDir: string): Promise<void> {
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

async function main() {
  console.log("[pre-push] Running pre-push validation suite...\n");

  console.log("[pre-push] Step 1/2: architecture:check");
  await runArchitectureCheck(ROOT_DIR);

  // runHarnessReview internally runs harness:check first, then targeted per-surface scripts
  console.log("[pre-push] Step 2/2: harness:review (vs origin/main)");
  await runHarnessReview(ROOT_DIR, {
    getChangedFiles: getChangedFilesVsOriginMain,
  });

  console.log("\n[pre-push] All checks passed.");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n[pre-push] BLOCKED: ${message}`);
  process.exit(1);
});
