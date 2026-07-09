import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function normalizeRepoPath(repoPath: string) {
  return repoPath.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function sortUniquePaths(paths: string[]) {
  return [...new Set(paths.map((entry) => normalizeRepoPath(entry)).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right)
  );
}

export function isDeliverableFingerprintPath(repoPath: string) {
  const normalizedPath = normalizeRepoPath(repoPath);

  if (
    normalizedPath.startsWith("docs/reports/") ||
    normalizedPath.startsWith("docs/solutions/") ||
    normalizedPath.startsWith("graphify-out/") ||
    normalizedPath.startsWith("artifacts/") ||
    normalizedPath.startsWith("coverage/") ||
    normalizedPath.startsWith(".worktrees/") ||
    normalizedPath.includes("/_generated/") ||
    normalizedPath.endsWith("/routeTree.gen.ts")
  ) {
    return false;
  }

  return true;
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

export function collectDeliverableDiffFingerprint(
  rootDir: string,
  baseRef: string,
  changedFiles: string[]
) {
  const fingerprintFiles = sortUniquePaths(
    changedFiles.filter((filePath) => isDeliverableFingerprintPath(filePath))
  );
  const hash = createHash("sha256");
  const mergeBase = runGit(rootDir, ["merge-base", baseRef, "HEAD"], true).trim();

  hash.update(`base:${mergeBase || baseRef}\n`);

  for (const filePath of fingerprintFiles) {
    const absolutePath = path.join(rootDir, filePath);
    hash.update(`file:${filePath}\n`);

    if (!existsSync(absolutePath)) {
      hash.update("deleted\n");
      continue;
    }

    hash.update(readFileSync(absolutePath));
    hash.update("\n");
  }

  return hash.digest("hex");
}
