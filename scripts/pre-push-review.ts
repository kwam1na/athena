import { HARNESS_APP_REGISTRY } from "./harness-app-registry";
import { validateHarnessDocs } from "./harness-check";
import { writeGeneratedHarnessDocs } from "./harness-generate";
import { runGraphifyCheck } from "./graphify-check";
import { collectHarnessRepoValidationSelection } from "./harness-repo-validation";
import { runHarnessSelfReview as runStructuredHarnessSelfReview } from "./harness-self-review";
import {
  getChangedFilesForHarnessReview,
  runHarnessReview,
} from "./harness-review";

const ROOT_DIR = process.cwd();
const BASE_REF = "origin/main";
const GENERATED_HARNESS_DOC_PATHS = new Set(
  HARNESS_APP_REGISTRY.flatMap((app) => app.harnessDocs.generatedDocs)
);
const REPAIRED_DOCS_COMMIT_BLOCKER =
  "Generated harness docs were auto-repaired locally. Review and commit the repaired files, then push again.";

type SpawnedProcess = {
  exited: Promise<number>;
  stdout?: ReadableStream | null;
  stderr?: ReadableStream | null;
};

type PrePushReviewLogger = Pick<Console, "log" | "warn" | "error">;

type HarnessSelfReviewSummary = {
  blockers?: string[];
};

type PrePushReviewOptions = {
  getChangedFiles?: (rootDir: string) => Promise<string[]>;
  getChangedFilesForRepairedTree?: (
    rootDir: string,
    baseRef: string
  ) => Promise<string[]>;
  getLocalChangedFiles?: (rootDir: string) => Promise<string[]>;
  runGraphifyCheck?: (rootDir: string) => Promise<void>;
  runArchitectureCheck?: (rootDir: string) => Promise<void>;
  runHarnessInferentialReview?: (rootDir: string) => Promise<void>;
  runHarnessGenerate?: (rootDir: string) => Promise<void>;
  runHarnessImplementationTests?: (rootDir: string) => Promise<void>;
  runHarnessSelfReview?: (
    rootDir: string
  ) => Promise<HarnessSelfReviewSummary | void>;
  runHarnessReview?: (
    rootDir: string,
    options: {
      baseRef: string;
      getChangedFiles?: (rootDir: string, baseRef?: string) => Promise<string[]>;
    }
  ) => Promise<void>;
  validateHarnessDocs?: (rootDir: string) => Promise<string[]>;
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

export async function runHarnessSelfReview(
  rootDir: string
): Promise<HarnessSelfReviewSummary> {
  return runStructuredHarnessSelfReview(rootDir, { baseRef: BASE_REF });
}

export async function runHarnessGenerate(rootDir: string): Promise<void> {
  await writeGeneratedHarnessDocs(rootDir);
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

function collectRepairableHarnessDocErrors(errors: string[]) {
  const repairableErrors: string[] = [];

  for (const error of errors) {
    if (error.startsWith("Stale generated harness doc: ")) {
      repairableErrors.push(error);
      continue;
    }

    const missingFileMatch = error.match(/^Missing required harness file: (.+)$/);
    if (
      missingFileMatch?.[1] &&
      GENERATED_HARNESS_DOC_PATHS.has(missingFileMatch[1])
    ) {
      repairableErrors.push(error);
      continue;
    }

    const generatedDocMatch = error.match(
      /^(?:Broken markdown link in|Missing referenced path in) ([^:]+):/
    );
    if (
      generatedDocMatch?.[1] &&
      GENERATED_HARNESS_DOC_PATHS.has(generatedDocMatch[1])
    ) {
      repairableErrors.push(error);
    }
  }

  return repairableErrors;
}

function formatBlockerList(stepName: string, blockers: string[]) {
  return `${stepName} blocked:\n${blockers.map((blocker) => `- ${blocker}`).join("\n")}`;
}

export async function runPrePushReview(
  rootDir: string,
  options: PrePushReviewOptions = {}
) {
  const logger = options.logger ?? console;
  const getChangedFiles = options.getChangedFiles ?? getChangedFilesVsOriginMain;
  const getChangedFilesForRepairedTree =
    options.getChangedFilesForRepairedTree ??
    ((nextRootDir: string, baseRef: string) =>
      getChangedFilesForHarnessReview(nextRootDir, baseRef));
  const getLocalChangedFiles =
    options.getLocalChangedFiles ??
    ((nextRootDir: string) => getChangedFilesForHarnessReview(nextRootDir));
  const runGraphifyFreshnessCheck =
    options.runGraphifyCheck ?? runGraphifyCheck;
  const runArchitecture = options.runArchitectureCheck ?? runArchitectureCheck;
  const runHarnessGenerateStep =
    options.runHarnessGenerate ?? runHarnessGenerate;
  const runInferentialReview =
    options.runHarnessInferentialReview ?? runHarnessInferentialReview;
  const runSelfReview = options.runHarnessSelfReview ?? runHarnessSelfReview;
  const review = options.runHarnessReview ?? runHarnessReview;
  const validateHarnessDocsStep =
    options.validateHarnessDocs ?? validateHarnessDocs;
  let changedFilesPromise: Promise<string[]> | undefined;
  let repairedGeneratedHarnessDocs = false;
  let usingWorkingTreeChangedFiles = false;

  const loadChangedFiles = () => {
    changedFilesPromise ??= getChangedFiles(rootDir);
    return changedFilesPromise;
  };

  const getChangedFilesForReviewStep = async (nextRootDir: string) => {
    if (nextRootDir === rootDir) {
      return loadChangedFiles();
    }

    return getChangedFiles(nextRootDir);
  };

  const refreshChangedFilesForWorkingTree = () => {
    if (usingWorkingTreeChangedFiles) {
      return changedFilesPromise ?? Promise.resolve([]);
    }

    changedFilesPromise = (async () => {
      try {
        return await getChangedFilesForRepairedTree(rootDir, BASE_REF);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(
          `[pre-push] Warning: unable to diff repaired generated docs against ${BASE_REF}. Falling back to local working tree changes. (${message})`
        );
        return getLocalChangedFiles(rootDir);
      }
    })();
    usingWorkingTreeChangedFiles = true;
    return changedFilesPromise;
  };

  const getPendingGeneratedHarnessDocs = async () => {
    const localChangedFiles = await getLocalChangedFiles(rootDir);
    const pendingGeneratedDocs = localChangedFiles.filter((filePath) =>
      GENERATED_HARNESS_DOC_PATHS.has(filePath)
    );

    if (pendingGeneratedDocs.length > 0) {
      refreshChangedFilesForWorkingTree();
    }

    return pendingGeneratedDocs;
  };

  const maybeRepairGeneratedHarnessDocs = async (reason: string) => {
    if (repairedGeneratedHarnessDocs) {
      return false;
    }

    const repairableErrors = collectRepairableHarnessDocErrors(
      await validateHarnessDocsStep(rootDir)
    );
    if (repairableErrors.length === 0) {
      return false;
    }

    logger.log(`[pre-push] Auto-repair: harness:generate (${reason})`);
    await runHarnessGenerateStep(rootDir);
    await getPendingGeneratedHarnessDocs();
    repairedGeneratedHarnessDocs = true;
    return true;
  };

  logger.log("[pre-push] Running pre-push validation suite...\n");

  logger.log("[pre-push] Step 1/6: graphify:check");
  await runGraphifyFreshnessCheck(rootDir);

  logger.log(`[pre-push] Step 2/6: harness:self-review (vs ${BASE_REF})`);
  let selfReviewResult = await runSelfReview(rootDir);
  if ((selfReviewResult?.blockers?.length ?? 0) > 0) {
    const repaired = await maybeRepairGeneratedHarnessDocs(
      "repairable harness doc drift detected after harness:self-review"
    );
    if (repaired) {
      selfReviewResult = await runSelfReview(rootDir);
    }
  }
  if ((selfReviewResult?.blockers?.length ?? 0) > 0) {
    throw new Error(
      formatBlockerList("harness:self-review", selfReviewResult.blockers ?? [])
    );
  }

  await getPendingGeneratedHarnessDocs();

  logger.log("[pre-push] Step 3/6: architecture:check");
  await runArchitecture(rootDir);

  const changedFiles = await loadChangedFiles();
  const repoValidation = collectHarnessRepoValidationSelection(changedFiles);

  if (repoValidation.matchedFiles.length > 0) {
    logger.log(
      "[pre-push] Step 4/6: harness:test skipped (repo harness validations run inside harness:review)"
    );
  } else {
    logger.log("[pre-push] Step 4/6: harness:test skipped (no harness-owned changes)");
  }

  // runHarnessReview internally runs harness:check first, then targeted per-surface scripts
  logger.log(`[pre-push] Step 5/6: harness:review (vs ${BASE_REF})`);
  try {
    await review(rootDir, {
      baseRef: BASE_REF,
      getChangedFiles: getChangedFilesForReviewStep,
    });
  } catch (error) {
    const repaired = await maybeRepairGeneratedHarnessDocs(
      "repairable harness doc drift detected after harness:review failed"
    );
    if (!repaired) {
      throw error;
    }

    await review(rootDir, {
      baseRef: BASE_REF,
      getChangedFiles: getChangedFilesForReviewStep,
    });
  }

  const finalChangedFiles = await loadChangedFiles();
  const finalRepoValidation = collectHarnessRepoValidationSelection(finalChangedFiles);

  if (finalRepoValidation.matchedFiles.length > 0) {
    logger.log(
      "[pre-push] Step 6/6: harness:inferential-review skipped (repo harness validations already ran in harness:review)"
    );
  } else {
    logger.log("[pre-push] Step 6/6: harness:inferential-review");
    await runInferentialReview(rootDir);
  }

  const pendingGeneratedHarnessDocs = await getPendingGeneratedHarnessDocs();

  if (repairedGeneratedHarnessDocs || pendingGeneratedHarnessDocs.length > 0) {
    logger.log(
      "\n[pre-push] Generated harness docs were repaired and revalidated locally."
    );
    throw new Error(REPAIRED_DOCS_COMMIT_BLOCKER);
  }

  logger.log("\n[pre-push] All checks passed.");
}

if (import.meta.main) {
  runPrePushReview(ROOT_DIR).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n[pre-push] BLOCKED: ${message}`);
    process.exit(1);
  });
}
