import { HARNESS_APP_REGISTRY } from "./harness-app-registry";
import { validateHarnessDocs } from "./harness-check";
import { TRACKED_GRAPHIFY_ARTIFACTS, runGraphifyCheck } from "./graphify-check";
import { writeGeneratedHarnessDocs } from "./harness-generate";
import { runGraphifyRebuild } from "./graphify-rebuild";
import { collectHarnessRepoValidationSelection } from "./harness-repo-validation";
import { runHarnessSelfReview as runStructuredHarnessSelfReview } from "./harness-self-review";
import {
  getChangedFilesForHarnessReview,
  runHarnessReview,
} from "./harness-review";
import {
  evaluatePrePushValidationProof,
  type PrePushValidationProofEvaluation,
} from "./pre-push-validation-proof";

const ROOT_DIR = process.cwd();
const BASE_REF = "origin/main";
const GENERATED_HARNESS_DOC_PATHS = new Set(
  HARNESS_APP_REGISTRY.flatMap((app) => app.harnessDocs.generatedDocs),
);
const TRACKED_GRAPHIFY_ARTIFACT_PATHS = new Set(TRACKED_GRAPHIFY_ARTIFACTS);
const REPAIRED_DOCS_COMMIT_BLOCKER =
  "Generated harness docs were auto-repaired locally. Review and commit the repaired files, then push again.";
const REPAIRED_GRAPHIFY_COMMIT_BLOCKER =
  "Tracked graphify artifacts were auto-repaired locally. Review and commit the repaired files, then push again.";

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
    baseRef: string,
  ) => Promise<string[]>;
  getLocalChangedFiles?: (rootDir: string) => Promise<string[]>;
  runDocumentationCheck?: (rootDir: string) => Promise<void>;
  runGraphifyCheck?: (rootDir: string) => Promise<void>;
  runGraphifyRebuild?: (rootDir: string) => Promise<void>;
  runArchitectureCheck?: (rootDir: string) => Promise<void>;
  runHarnessInferentialReview?: (rootDir: string) => Promise<void>;
  runHarnessGenerate?: (rootDir: string) => Promise<void>;
  runHarnessImplementationTests?: (rootDir: string) => Promise<void>;
  runHarnessSelfReview?: (
    rootDir: string,
  ) => Promise<HarnessSelfReviewSummary | void>;
  runHarnessReview?: (
    rootDir: string,
    options: {
      baseRef: string;
      getChangedFiles?: (
        rootDir: string,
        baseRef?: string,
      ) => Promise<string[]>;
    },
  ) => Promise<void>;
  evaluatePrePushValidationProof?: (
    rootDir: string,
  ) => Promise<PrePushValidationProofEvaluation>;
  validateHarnessDocs?: (rootDir: string) => Promise<string[]>;
  logger?: PrePushReviewLogger;
};

function normalizeRepoPath(repoPath: string) {
  return repoPath.replaceAll("\\", "/");
}

export async function getChangedFilesVsOriginMain(
  rootDir: string,
  spawn: (
    command: string[],
    options: { cwd: string; stdout: "pipe"; stderr: "pipe" },
  ) => SpawnedProcess = Bun.spawn,
): Promise<string[]> {
  const refCheck = spawn(["git", "rev-parse", "--verify", BASE_REF], {
    cwd: rootDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const refExitCode = await refCheck.exited;

  if (refExitCode !== 0) {
    const stderr = await new Response(refCheck.stderr).text();
    throw new Error(
      [
        `[pre-push] ${BASE_REF} is not reachable; cannot select targeted pre-push validations.`,
        stderr.trim() || `git rev-parse --verify ${BASE_REF} failed`,
        `Run \`git fetch origin ${BASE_REF.replace("origin/", "")}\` and retry.`,
      ].join("\n"),
    );
  }

  const proc = spawn(["git", "diff", "--name-only", `${BASE_REF}...HEAD`], {
    cwd: rootDir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [output, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(
      [
        `[pre-push] git diff against ${BASE_REF} failed; cannot select targeted pre-push validations.`,
        stderr.trim() ||
          output.trim() ||
          `git diff --name-only ${BASE_REF}...HEAD failed`,
      ].join("\n"),
    );
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
  rootDir: string,
): Promise<HarnessSelfReviewSummary> {
  return runStructuredHarnessSelfReview(rootDir, { baseRef: BASE_REF });
}

export async function runHarnessGenerate(rootDir: string): Promise<void> {
  await writeGeneratedHarnessDocs(rootDir);
}

export async function runHarnessImplementationTests(
  rootDir: string,
): Promise<void> {
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

export async function runDocumentationCheck(rootDir: string): Promise<void> {
  const proc = Bun.spawn(["bun", "run", "delivery:documentation-check"], {
    cwd: rootDir,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`delivery:documentation-check failed (exit ${exitCode})`);
  }
}

export async function runHarnessInferentialReview(
  rootDir: string,
): Promise<void> {
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

    const missingFileMatch = error.match(
      /^Missing required harness file: (.+)$/,
    );
    if (
      missingFileMatch?.[1] &&
      GENERATED_HARNESS_DOC_PATHS.has(missingFileMatch[1])
    ) {
      repairableErrors.push(error);
      continue;
    }

    const generatedDocMatch = error.match(
      /^(?:Broken markdown link in|Missing referenced path in) ([^:]+):/,
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

function isRepairableGraphifyDrift(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("[graphify check] Graphify artifacts are stale:") ||
    message.includes("Run `bun run graphify:rebuild`")
  );
}

export async function runPrePushReview(
  rootDir: string,
  options: PrePushReviewOptions = {},
) {
  const logger = options.logger ?? console;
  const getChangedFiles =
    options.getChangedFiles ?? getChangedFilesVsOriginMain;
  const getChangedFilesForRepairedTree =
    options.getChangedFilesForRepairedTree ??
    ((nextRootDir: string, baseRef: string) =>
      getChangedFilesForHarnessReview(nextRootDir, baseRef));
  const getLocalChangedFiles =
    options.getLocalChangedFiles ??
    ((nextRootDir: string) => getChangedFilesForHarnessReview(nextRootDir));
  const runGraphifyFreshnessCheck =
    options.runGraphifyCheck ?? runGraphifyCheck;
  const runDocumentationPolicyCheck =
    options.runDocumentationCheck ?? runDocumentationCheck;
  const runGraphifyRebuildStep =
    options.runGraphifyRebuild ?? runGraphifyRebuild;
  const runArchitecture = options.runArchitectureCheck ?? runArchitectureCheck;
  const runHarnessGenerateStep =
    options.runHarnessGenerate ?? runHarnessGenerate;
  const runInferentialReview =
    options.runHarnessInferentialReview ?? runHarnessInferentialReview;
  const runSelfReview = options.runHarnessSelfReview ?? runHarnessSelfReview;
  const review = options.runHarnessReview ?? runHarnessReview;
  const evaluateValidationProof =
    options.evaluatePrePushValidationProof ?? evaluatePrePushValidationProof;
  const validateHarnessDocsStep =
    options.validateHarnessDocs ?? validateHarnessDocs;
  let changedFilesPromise: Promise<string[]> | undefined;
  let repairedGraphifyArtifacts = false;
  let repairedGeneratedHarnessDocs = false;
  let usingWorkingTreeChangedFiles = false;

  const logHandoffSummary = (validation: "passed" | "skipped") => {
    logger.log(
      `[pre-push] Handoff: validation=${validation}; proof=${proofEvaluation.status}; proofReason=${proofEvaluation.reusable ? "reusable current pr:athena proof" : proofEvaluation.reason}.`,
    );
  };

  const proofEvaluation = await evaluateValidationProof(rootDir);
  if (proofEvaluation.reusable) {
    logger.log(
      `[pre-push] Reusing current pr:athena validation proof for tree ${proofEvaluation.proof.validatedTreeSha}.`,
    );
    logHandoffSummary("skipped");
    logger.log("[pre-push] All checks passed.");
    return;
  }

  logger.log(
    `[pre-push] pr:athena proof not reusable (${proofEvaluation.status}): ${proofEvaluation.reason}. Running validation suite.`,
  );

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
          `[pre-push] Warning: unable to diff repaired generated docs against ${BASE_REF}. Falling back to local working tree changes. (${message})`,
        );
        return getLocalChangedFiles(rootDir);
      }
    })();
    usingWorkingTreeChangedFiles = true;
    return changedFilesPromise;
  };

  const getPendingGeneratedHarnessDocs = async () => {
    const localChangedFiles = await getLocalChangedFiles(rootDir);
    const normalizedLocalChangedFiles =
      localChangedFiles.map(normalizeRepoPath);
    const pendingGeneratedDocs = normalizedLocalChangedFiles.filter(
      (filePath) => GENERATED_HARNESS_DOC_PATHS.has(filePath),
    );

    if (pendingGeneratedDocs.length > 0) {
      refreshChangedFilesForWorkingTree();
    }

    return pendingGeneratedDocs;
  };

  const getPendingGraphifyArtifacts = async () => {
    const localChangedFiles = await getLocalChangedFiles(rootDir);
    return localChangedFiles
      .map(normalizeRepoPath)
      .filter((filePath) => TRACKED_GRAPHIFY_ARTIFACT_PATHS.has(filePath));
  };

  const maybeRepairGeneratedHarnessDocs = async (reason: string) => {
    if (repairedGeneratedHarnessDocs) {
      return false;
    }

    const repairableErrors = collectRepairableHarnessDocErrors(
      await validateHarnessDocsStep(rootDir),
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

  const maybeRepairGraphifyArtifacts = async (
    reason: string,
    error: unknown,
  ) => {
    if (repairedGraphifyArtifacts || !isRepairableGraphifyDrift(error)) {
      return false;
    }

    logger.log(`[pre-push] Auto-repair: graphify:rebuild (${reason})`);
    await runGraphifyRebuildStep(rootDir);
    repairedGraphifyArtifacts = true;
    return true;
  };

  logger.log("[pre-push] Running pre-push validation suite...\n");

  logger.log("[pre-push] Step 1/7: graphify:check");
  try {
    await runGraphifyFreshnessCheck(rootDir);
  } catch (error) {
    const repaired = await maybeRepairGraphifyArtifacts(
      "repairable graphify drift detected after graphify:check failed",
      error,
    );
    if (!repaired) {
      throw error;
    }

    await runGraphifyFreshnessCheck(rootDir);
  }

  logger.log("[pre-push] Step 2/7: delivery:documentation-check");
  await runDocumentationPolicyCheck(rootDir);

  logger.log(`[pre-push] Step 3/7: harness:self-review (vs ${BASE_REF})`);
  let selfReviewResult = await runSelfReview(rootDir);
  if ((selfReviewResult?.blockers?.length ?? 0) > 0) {
    const repaired = await maybeRepairGeneratedHarnessDocs(
      "repairable harness doc drift detected after harness:self-review",
    );
    if (repaired) {
      selfReviewResult = await runSelfReview(rootDir);
    }
  }
  if ((selfReviewResult?.blockers?.length ?? 0) > 0) {
    throw new Error(
      formatBlockerList("harness:self-review", selfReviewResult.blockers ?? []),
    );
  }

  await getPendingGeneratedHarnessDocs();

  logger.log("[pre-push] Step 4/7: architecture:check");
  await runArchitecture(rootDir);

  const changedFiles = await loadChangedFiles();
  const repoValidation = collectHarnessRepoValidationSelection(changedFiles);

  if (repoValidation.matchedFiles.length > 0) {
    logger.log(
      "[pre-push] Step 5/7: harness:test skipped (repo harness validations run inside harness:review)",
    );
  } else {
    logger.log(
      "[pre-push] Step 5/7: harness:test skipped (no harness-owned changes)",
    );
  }

  // runHarnessReview internally runs harness:check first, then targeted per-surface scripts
  logger.log(`[pre-push] Step 6/7: harness:review (vs ${BASE_REF})`);
  try {
    await review(rootDir, {
      baseRef: BASE_REF,
      getChangedFiles: getChangedFilesForReviewStep,
    });
  } catch (error) {
    const repaired = await maybeRepairGeneratedHarnessDocs(
      "repairable harness doc drift detected after harness:review failed",
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
  const finalRepoValidation =
    collectHarnessRepoValidationSelection(finalChangedFiles);

  if (finalRepoValidation.matchedFiles.length > 0) {
    logger.log(
      "[pre-push] Step 7/7: harness:inferential-review skipped (repo harness validations already ran in harness:review)",
    );
  } else {
    logger.log("[pre-push] Step 7/7: harness:inferential-review");
    await runInferentialReview(rootDir);
  }

  const pendingGeneratedHarnessDocs = await getPendingGeneratedHarnessDocs();

  if (pendingGeneratedHarnessDocs.length > 0) {
    logger.log(
      "[pre-push] Handoff: validation=passed; proof=generated_repaired; proofReason=generated harness docs were repaired locally.",
    );
    logger.log(
      "\n[pre-push] Generated harness docs were repaired and revalidated locally.",
    );
    throw new Error(REPAIRED_DOCS_COMMIT_BLOCKER);
  }

  const pendingGraphifyArtifacts = await getPendingGraphifyArtifacts();

  if (repairedGraphifyArtifacts || pendingGraphifyArtifacts.length > 0) {
    logger.log(
      "[pre-push] Handoff: validation=passed; proof=generated_repaired; proofReason=tracked graphify artifacts were repaired locally.",
    );
    logger.log(
      "\n[pre-push] Tracked graphify artifacts were repaired and revalidated locally.",
    );
    throw new Error(REPAIRED_GRAPHIFY_COMMIT_BLOCKER);
  }

  logHandoffSummary("passed");
  logger.log("\n[pre-push] All checks passed.");
}

if (import.meta.main) {
  runPrePushReview(ROOT_DIR).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n[pre-push] BLOCKED: ${message}`);
    process.exit(1);
  });
}
