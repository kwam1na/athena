import {
  digestCanonical,
  digestDeliverableEntries,
  type DeliverableTreeEntry,
} from "../.agent-skills/current/runtime/kernel.mjs";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import path from "node:path";

export function normalizeRepoPath(repoPath: string) {
  return repoPath.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function sortUniquePaths(paths: string[]) {
  return [
    ...new Set(paths.map((entry) => normalizeRepoPath(entry)).filter(Boolean)),
  ].sort((left, right) => left.localeCompare(right));
}

export function isDeliverableFingerprintPath(repoPath: string) {
  const normalizedPath = repoPath.replace(/^\.\//, "");

  if (
    normalizedPath.startsWith("docs/reports/") ||
    normalizedPath.startsWith("docs/solutions/") ||
    normalizedPath.startsWith("telemetry/delivery-runs/") ||
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

function runGit(rootDir: string, args: string[]) {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: rootDir,
    env: gitEnv(),
    stderr: "pipe",
    stdout: "pipe",
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${result.stderr.toString().trim()}`,
    );
  }

  return result.stdout.toString();
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
  changedFiles: string[],
) {
  // This is Athena's report projection, not its review or validation identity.
  // Git paths are exact bytes: do not trim or rewrite backslashes here.
  const fingerprintFiles = [...new Set(changedFiles)]
    .filter(isDeliverableFingerprintPath)
    .sort();
  const mergeBase = runGit(rootDir, ["merge-base", baseRef, "HEAD"]).trim();
  const entries: DeliverableTreeEntry[] = fingerprintFiles.map((filePath) => {
    const absolutePath = path.join(rootDir, filePath);
    let stat;
    try {
      stat = lstatSync(absolutePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return { path: filePath, mode: "000000", objectSha: "0".repeat(40) };
    }
    if (!stat.isFile() && !stat.isSymbolicLink()) {
      throw new Error(`Unsupported deliverable path: ${filePath}`);
    }
    const bytes = stat.isSymbolicLink()
      ? Buffer.from(readlinkSync(absolutePath))
      : readFileSync(absolutePath);
    const result = Bun.spawnSync(["git", "hash-object", "--stdin"], {
      cwd: rootDir,
      env: gitEnv(),
      stdin: bytes,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
    return {
      path: filePath,
      mode: stat.isSymbolicLink()
        ? "120000"
        : stat.mode & 0o111
          ? "100755"
          : "100644",
      objectSha: result.stdout.toString().trim(),
    };
  });
  return digestCanonical({
    version: "athena-report-diff/v2",
    base: mergeBase,
    deliverable: digestDeliverableEntries(entries, {
      identityToken: "athena-report-tree/v2",
      reviewNeutral: [],
    }),
  });
}

export function collectChangedPathsForDiff(rootDir: string, baseRef: string) {
  const gitPaths = (args: string[]) =>
    runGit(rootDir, args).split("\0").filter(Boolean);
  return [
    ...new Set([
      ...gitPaths([
        "diff",
        "--name-only",
        "-z",
        "--no-renames",
        `${baseRef}...HEAD`,
      ]),
      ...gitPaths(["diff", "--name-only", "-z", "--no-renames"]),
      ...gitPaths(["diff", "--cached", "--name-only", "-z", "--no-renames"]),
      ...gitPaths(["ls-files", "--others", "--exclude-standard", "-z"]),
    ]),
  ].sort();
}
