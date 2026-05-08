import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const PRE_PUSH_VALIDATION_PROOF_SCHEMA_VERSION = 2;
export const PR_ATHENA_PROOF_BASE_REF = "origin/main";
const PROOF_GIT_PATH = "codex/pre-push-pr-athena-proof.json";

type SpawnedProcess = {
  exited: Promise<number>;
  stdout?: ReadableStream | null;
  stderr?: ReadableStream | null;
};

type CommandRunner = (
  command: string[],
  options: { cwd: string; stdout: "pipe"; stderr: "pipe" }
) => SpawnedProcess;

type ProofLogger = Pick<Console, "log" | "warn">;

export type PrePushValidationProof = {
  schemaVersion: typeof PRE_PUSH_VALIDATION_PROOF_SCHEMA_VERSION;
  recordedHeadSha: string;
  validatedTreeSha: string;
  recordedStatusMode: "clean" | "staged-index";
  baseRef: typeof PR_ATHENA_PROOF_BASE_REF;
  baseSha: string;
  bunVersion: string;
  prAthenaScript: string;
  validationFingerprint: string;
};

export type PrePushValidationProofEvaluation =
  | {
      reusable: true;
      proof: PrePushValidationProof;
      proofPath: string;
    }
  | {
      reusable: false;
      reason: string;
      proofPath?: string;
    };

type ProofSnapshot = PrePushValidationProof & {
  proofPath: string;
};

type ProofRuntimeOptions = {
  spawn?: CommandRunner;
  readFile?: typeof readFile;
  readdir?: typeof readdir;
};

type ProofSnapshotMode = "evaluate" | "record";

function normalizeRepoPath(repoPath: string) {
  return repoPath.replaceAll("\\", "/").replace(/^\.\//, "");
}

function sortUniquePaths(paths: string[]) {
  return [...new Set(paths.map((entry) => normalizeRepoPath(entry)).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right)
  );
}

async function runCommand(
  rootDir: string,
  command: string[],
  spawn: CommandRunner = Bun.spawn
) {
  const proc = spawn(command, {
    cwd: rootDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(stderr.trim() || stdout.trim() || `${command.join(" ")} failed`);
  }

  return stdout.trim();
}

async function runExitCodeCommand(
  rootDir: string,
  command: string[],
  spawn: CommandRunner = Bun.spawn
) {
  const proc = spawn(command, {
    cwd: rootDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

async function collectFilesUnder(
  rootDir: string,
  relativeDir: string,
  options: ProofRuntimeOptions
) {
  const fsReaddir = options.readdir ?? readdir;
  const files: string[] = [];
  const queue = [relativeDir];

  while (queue.length > 0) {
    const current = queue.pop()!;
    let entries;
    try {
      entries = await fsReaddir(path.join(rootDir, current), {
        withFileTypes: true,
      });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const child = normalizeRepoPath(path.posix.join(current, entry.name));
      if (entry.isDirectory()) {
        queue.push(child);
        continue;
      }

      if (entry.isFile() && /\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) {
        files.push(child);
      }
    }
  }

  return files;
}

async function collectValidationFingerprintPaths(
  rootDir: string,
  options: ProofRuntimeOptions = {}
) {
  return sortUniquePaths([
    "package.json",
    "bun.lockb",
    ".github/workflows/athena-pr-tests.yml",
    ".husky/pre-push",
    ".husky/pre-commit",
    "scripts/pre-push-review.ts",
    "scripts/pre-push-validation-proof.ts",
    "scripts/harness-repo-validation.ts",
    "scripts/root-scripts-coverage.ts",
    "scripts/coverage-summary.ts",
    "scripts/coverage-toolchain-parity.ts",
    ...(await collectFilesUnder(rootDir, "scripts", options)).filter(
      (filePath) =>
        /^scripts\/(?:harness-|graphify-|pre-commit-generated-artifacts)/.test(filePath)
    ),
  ]);
}

async function hashValidationWiring(
  rootDir: string,
  options: ProofRuntimeOptions = {}
) {
  const fsReadFile = options.readFile ?? readFile;
  const hasher = createHash("sha256");

  for (const repoPath of await collectValidationFingerprintPaths(rootDir, options)) {
    hasher.update(`${repoPath}\0`);
    try {
      const contents = await fsReadFile(path.join(rootDir, repoPath));
      hasher.update(createHash("sha256").update(contents).digest("hex"));
    } catch {
      hasher.update("missing");
    }
    hasher.update("\0");
  }

  return hasher.digest("hex");
}

async function readPrAthenaScript(rootDir: string, options: ProofRuntimeOptions = {}) {
  const fsReadFile = options.readFile ?? readFile;
  const packageJson = JSON.parse(
    await fsReadFile(path.join(rootDir, "package.json"), "utf8")
  ) as { scripts?: Record<string, string> };

  const prAthenaScript = packageJson.scripts?.["pr:athena"]?.trim();
  if (!prAthenaScript) {
    throw new Error("package.json is missing the pr:athena script.");
  }

  return prAthenaScript;
}

async function collectProofSnapshot(
  rootDir: string,
  options: ProofRuntimeOptions = {},
  mode: ProofSnapshotMode = "evaluate"
): Promise<ProofSnapshot> {
  const spawn = options.spawn ?? Bun.spawn;
  const [
    proofPath,
    recordedHeadSha,
    headTreeSha,
    indexTreeSha,
    baseSha,
    status,
    untrackedFiles,
    bunVersion,
    prAthenaScript,
    validationFingerprint,
  ] = await Promise.all([
    runCommand(rootDir, ["git", "rev-parse", "--git-path", PROOF_GIT_PATH], spawn),
    runCommand(rootDir, ["git", "rev-parse", "--verify", "HEAD"], spawn),
    runCommand(rootDir, ["git", "rev-parse", "--verify", "HEAD^{tree}"], spawn),
    runCommand(rootDir, ["git", "write-tree"], spawn),
    runCommand(rootDir, ["git", "rev-parse", "--verify", PR_ATHENA_PROOF_BASE_REF], spawn),
    runCommand(
      rootDir,
      ["git", "status", "--porcelain", "--untracked-files=all"],
      spawn
    ),
    runCommand(rootDir, ["git", "ls-files", "--others", "--exclude-standard"], spawn),
    runCommand(rootDir, ["bun", "--version"], spawn),
    readPrAthenaScript(rootDir, options),
    hashValidationWiring(rootDir, options),
  ]);

  let recordedStatusMode: PrePushValidationProof["recordedStatusMode"] = "clean";
  let validatedTreeSha = headTreeSha;

  if (status.trim()) {
    if (mode !== "record") {
      throw new Error("working tree is not clean");
    }

    const unstagedDiff = await runExitCodeCommand(
      rootDir,
      ["git", "diff", "--quiet"],
      spawn
    );
    if (unstagedDiff.exitCode > 1) {
      throw new Error(
        unstagedDiff.stderr || unstagedDiff.stdout || "git diff --quiet failed"
      );
    }

    if (unstagedDiff.exitCode !== 0 || untrackedFiles.trim()) {
      throw new Error("working tree has unstaged or untracked changes");
    }

    if (indexTreeSha === headTreeSha) {
      throw new Error("working tree is not clean");
    }

    recordedStatusMode = "staged-index";
    validatedTreeSha = indexTreeSha;
  }

  return {
    proofPath: path.resolve(rootDir, proofPath),
    schemaVersion: PRE_PUSH_VALIDATION_PROOF_SCHEMA_VERSION,
    recordedHeadSha,
    validatedTreeSha,
    recordedStatusMode,
    baseRef: PR_ATHENA_PROOF_BASE_REF,
    baseSha,
    bunVersion,
    prAthenaScript,
    validationFingerprint,
  };
}

function validateProofShape(value: unknown): value is PrePushValidationProof {
  if (!value || typeof value !== "object") {
    return false;
  }

  const proof = value as Record<string, unknown>;
  return (
    proof.schemaVersion === PRE_PUSH_VALIDATION_PROOF_SCHEMA_VERSION &&
    typeof proof.recordedHeadSha === "string" &&
    typeof proof.validatedTreeSha === "string" &&
    (proof.recordedStatusMode === "clean" ||
      proof.recordedStatusMode === "staged-index") &&
    proof.baseRef === PR_ATHENA_PROOF_BASE_REF &&
    typeof proof.baseSha === "string" &&
    typeof proof.bunVersion === "string" &&
    typeof proof.prAthenaScript === "string" &&
    typeof proof.validationFingerprint === "string"
  );
}

export async function evaluatePrePushValidationProof(
  rootDir: string,
  options: ProofRuntimeOptions = {}
): Promise<PrePushValidationProofEvaluation> {
  let snapshot: ProofSnapshot;
  try {
    snapshot = await collectProofSnapshot(rootDir, options);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { reusable: false, reason };
  }

  const fsReadFile = options.readFile ?? readFile;
  let proof: unknown;
  try {
    proof = JSON.parse(await fsReadFile(snapshot.proofPath, "utf8"));
  } catch {
    return {
      reusable: false,
      reason: "no current pr:athena proof was found",
      proofPath: snapshot.proofPath,
    };
  }

  if (!validateProofShape(proof)) {
    return {
      reusable: false,
      reason: "stored pr:athena proof has an unsupported shape",
      proofPath: snapshot.proofPath,
    };
  }

  const comparisons: Array<[keyof PrePushValidationProof, string]> = [
    ["validatedTreeSha", "HEAD tree changed since pr:athena recorded its proof"],
    ["baseSha", `${PR_ATHENA_PROOF_BASE_REF} changed since pr:athena recorded its proof`],
    ["bunVersion", "Bun version changed since pr:athena recorded its proof"],
    ["prAthenaScript", "pr:athena command changed since proof recording"],
    ["validationFingerprint", "validation wiring changed since proof recording"],
  ];

  for (const [field, reason] of comparisons) {
    if (proof[field] !== snapshot[field]) {
      return {
        reusable: false,
        reason,
        proofPath: snapshot.proofPath,
      };
    }
  }

  return {
    reusable: true,
    proof,
    proofPath: snapshot.proofPath,
  };
}

export async function recordPrePushValidationProof(
  rootDir: string,
  options: ProofRuntimeOptions & { logger?: ProofLogger } = {}
) {
  const logger = options.logger ?? console;

  try {
    const snapshot = await collectProofSnapshot(rootDir, options, "record");
    const { proofPath, ...proof } = snapshot;
    await mkdir(path.dirname(proofPath), { recursive: true });
    await writeFile(proofPath, `${JSON.stringify(proof, null, 2)}\n`, "utf8");
    logger.log(`[pr:athena] Recorded current pre-push validation proof at ${proofPath}.`);
    return { recorded: true as const, proofPath, proof };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.warn(
      `[pr:athena] Did not record pre-push validation proof: ${reason}. pre-push will run normally.`
    );

    try {
      const proofPath = path.resolve(
        rootDir,
        await runCommand(
          rootDir,
          ["git", "rev-parse", "--git-path", PROOF_GIT_PATH],
          options.spawn ?? Bun.spawn
        )
      );
      await rm(proofPath, { force: true });
    } catch {
      // Best-effort stale proof cleanup only.
    }

    return { recorded: false as const, reason };
  }
}

if (import.meta.main) {
  const [command] = Bun.argv.slice(2);

  if (command !== "record-pr-athena") {
    console.error(
      "Usage: bun scripts/pre-push-validation-proof.ts record-pr-athena"
    );
    process.exit(1);
  }

  await recordPrePushValidationProof(process.cwd());
}
