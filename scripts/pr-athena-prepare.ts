import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { runBunVersionCheck } from "./bun-version-check";
import { assertFrontendDependencyParity } from "./frontend-dependency-parity";
import {
  captureStableHarnessCandidate,
  type HarnessCandidate,
  type HarnessCandidateCapture,
} from "./harness-candidate";
import { runPreCommitGeneratedArtifacts } from "./pre-commit-generated-artifacts";
import { assertPrAthenaProofReady } from "./pre-push-validation-proof";

export const PR_ATHENA_PREPARATION_SCHEMA_VERSION = 1;
export const PR_ATHENA_PREPARATION_GIT_PATH =
  "codex/pr-athena-preparation-receipt.json";
export const PR_ATHENA_PREPARATION_REMEDIATION = "bun run pr:athena:prepare";

const PREPARATION_WIRING_PATHS = [
  "scripts/pr-athena-prepare.ts",
  "scripts/harness-candidate.ts",
  "scripts/bun-version-check.ts",
  "scripts/frontend-dependency-parity.ts",
  "scripts/pre-commit-generated-artifacts.ts",
  "scripts/pre-push-validation-proof.ts",
] as const;

type PrepareLogger = Pick<Console, "log">;

export type PrAthenaPreparationReceipt = {
  schemaVersion: typeof PR_ATHENA_PREPARATION_SCHEMA_VERSION;
  preparedAt: string;
  treeSha: string;
  headSha: string;
  mode: HarnessCandidate["mode"];
  baseRef: HarnessCandidate["baseRef"];
  baseTipSha: string;
  diffBaseSha: string;
  preparationFingerprint: string;
};

type PrepareOptions = {
  runBunVersionCheck?: (rootDir: string) => void | Promise<void>;
  runDependencyCheck?: (rootDir: string) => void | Promise<void>;
  runGeneratedArtifacts?: (rootDir: string) => void | Promise<void>;
  assertProofReady?: (rootDir: string) => unknown | Promise<unknown>;
  captureCandidate?: (rootDir: string) => Promise<HarnessCandidateCapture>;
  resolveReceiptPath?: (rootDir: string) => Promise<string>;
  now?: () => Date;
  logger?: PrepareLogger;
};

type ReceiptEvaluationOptions = Pick<
  PrepareOptions,
  "captureCandidate" | "resolveReceiptPath"
>;

export type PrAthenaPreparationEvaluation =
  | {
      prepared: true;
      status: "prepared";
      receipt: PrAthenaPreparationReceipt;
      receiptPath: string;
      candidate: HarnessCandidate;
    }
  | {
      prepared: false;
      status:
        | "missing"
        | "invalid"
        | "stale"
        | "base_changed"
        | "wiring_mismatch"
        | "candidate_unprepared"
        | "candidate_ambiguous";
      reason: string;
      remediation: typeof PR_ATHENA_PREPARATION_REMEDIATION;
      receiptPath?: string;
    };

async function resolvePreparationReceiptPath(rootDir: string) {
  const process = Bun.spawn(
    ["git", "rev-parse", "--git-path", PR_ATHENA_PREPARATION_GIT_PATH],
    { cwd: rootDir, stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      stderr.trim() ||
        stdout.trim() ||
        "could not resolve worktree-local preparation receipt path",
    );
  }
  return path.resolve(rootDir, stdout.trim());
}

export async function computePrAthenaPreparationFingerprint(rootDir: string) {
  const manifest = JSON.parse(
    await readFile(path.join(rootDir, "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };
  const prepareCommand = manifest.scripts?.["pr:athena:prepare"]?.trim();
  if (!prepareCommand) {
    throw new Error("package.json is missing the pr:athena:prepare script");
  }

  const hash = createHash("sha256");
  hash.update(`command\0${prepareCommand}\0`);
  for (const repoPath of PREPARATION_WIRING_PATHS) {
    hash.update(`${repoPath}\0`);
    try {
      hash.update(await readFile(path.join(rootDir, repoPath)));
    } catch {
      hash.update("missing");
    }
    hash.update("\0");
  }
  return hash.digest("hex");
}

function isReceipt(value: unknown): value is PrAthenaPreparationReceipt {
  if (!value || typeof value !== "object") return false;
  const receipt = value as Record<string, unknown>;
  return (
    receipt.schemaVersion === PR_ATHENA_PREPARATION_SCHEMA_VERSION &&
    typeof receipt.preparedAt === "string" &&
    typeof receipt.treeSha === "string" &&
    typeof receipt.headSha === "string" &&
    (receipt.mode === "clean" || receipt.mode === "staged-index") &&
    receipt.baseRef === "origin/main" &&
    typeof receipt.baseTipSha === "string" &&
    typeof receipt.diffBaseSha === "string" &&
    typeof receipt.preparationFingerprint === "string"
  );
}

async function publishReceipt(
  receiptPath: string,
  receipt: PrAthenaPreparationReceipt,
) {
  await mkdir(path.dirname(receiptPath), { recursive: true });
  const temporaryPath = `${receiptPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporaryPath, receiptPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function runPrAthenaPreparation(
  rootDir: string,
  options: PrepareOptions = {},
) {
  const logger = options.logger ?? console;
  logger.log("[pr:athena] Checking Bun version...");
  await (options.runBunVersionCheck ?? runBunVersionCheck)(rootDir);
  logger.log("[pr:athena] Checking frontend dependency parity...");
  await (
    options.runDependencyCheck ??
    ((dir) => assertFrontendDependencyParity(dir, { repair: true }))
  )(rootDir);
  logger.log("[pr:athena] Refreshing and verifying generated artifacts...");
  await (options.runGeneratedArtifacts ?? runPreCommitGeneratedArtifacts)(
    rootDir,
  );
  logger.log("[pr:athena] Confirming candidate readiness...");
  await (options.assertProofReady ?? assertPrAthenaProofReady)(rootDir);

  const capture = await (
    options.captureCandidate ?? captureStableHarnessCandidate
  )(rootDir);
  if (!capture.ok) {
    throw new Error(`${capture.status}: ${capture.reason}`);
  }

  const receiptPath = await (
    options.resolveReceiptPath ?? resolvePreparationReceiptPath
  )(rootDir);
  const receipt: PrAthenaPreparationReceipt = {
    schemaVersion: PR_ATHENA_PREPARATION_SCHEMA_VERSION,
    preparedAt: (options.now ?? (() => new Date()))().toISOString(),
    treeSha: capture.candidate.treeSha,
    headSha: capture.candidate.headSha,
    mode: capture.candidate.mode,
    baseRef: capture.candidate.baseRef,
    baseTipSha: capture.candidate.baseTipSha,
    diffBaseSha: capture.candidate.diffBaseSha,
    preparationFingerprint:
      await computePrAthenaPreparationFingerprint(rootDir),
  };
  await publishReceipt(receiptPath, receipt);
  logger.log(`[pr:athena] Published preparation receipt at ${receiptPath}.`);
  return {
    prepared: true as const,
    receipt,
    receiptPath,
    candidate: capture.candidate,
  };
}

function blocked(
  status: Exclude<PrAthenaPreparationEvaluation["status"], "prepared">,
  reason: string,
  receiptPath?: string,
): PrAthenaPreparationEvaluation {
  return {
    prepared: false,
    status,
    reason,
    remediation: PR_ATHENA_PREPARATION_REMEDIATION,
    ...(receiptPath ? { receiptPath } : {}),
  };
}

export async function evaluatePrAthenaPreparationReceipt(
  rootDir: string,
  options: ReceiptEvaluationOptions = {},
): Promise<PrAthenaPreparationEvaluation> {
  let receiptPath: string;
  try {
    receiptPath = await (
      options.resolveReceiptPath ?? resolvePreparationReceiptPath
    )(rootDir);
  } catch (error) {
    return blocked(
      "invalid",
      error instanceof Error ? error.message : String(error),
    );
  }

  let receipt: unknown;
  try {
    receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    return blocked(
      code === "ENOENT" ? "missing" : "invalid",
      code === "ENOENT"
        ? "no current pr:athena preparation receipt was found"
        : "the pr:athena preparation receipt is unreadable or corrupt",
      receiptPath,
    );
  }
  if (!isReceipt(receipt)) {
    return blocked(
      "invalid",
      "the pr:athena preparation receipt has an unsupported shape",
      receiptPath,
    );
  }

  const capture = await (
    options.captureCandidate ?? captureStableHarnessCandidate
  )(rootDir);
  if (!capture.ok) return blocked(capture.status, capture.reason, receiptPath);

  const fingerprint = await computePrAthenaPreparationFingerprint(rootDir);
  if (receipt.preparationFingerprint !== fingerprint) {
    return blocked(
      "wiring_mismatch",
      "pr:athena preparation wiring changed after the receipt was published",
      receiptPath,
    );
  }
  if (
    receipt.baseRef !== capture.candidate.baseRef ||
    receipt.baseTipSha !== capture.candidate.baseTipSha
  ) {
    return blocked(
      "base_changed",
      `${capture.candidate.baseRef} changed after preparation`,
      receiptPath,
    );
  }
  if (
    receipt.treeSha !== capture.candidate.treeSha ||
    receipt.diffBaseSha !== capture.candidate.diffBaseSha
  ) {
    return blocked(
      "stale",
      "the candidate changed after pr:athena preparation",
      receiptPath,
    );
  }

  return {
    prepared: true,
    status: "prepared",
    receipt,
    receiptPath,
    candidate: capture.candidate,
  };
}

if (import.meta.main) {
  runPrAthenaPreparation(process.cwd()).catch((error: unknown) => {
    console.error(
      `[pr:athena] Preparation blocked: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.error(`Remediation: ${PR_ATHENA_PREPARATION_REMEDIATION}`);
    process.exit(1);
  });
}
