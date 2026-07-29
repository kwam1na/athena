import { access, realpath } from "node:fs/promises";
import path from "node:path";

export const WORKTREE_BOOTSTRAP_MARKER_PATH = "codex/worktree-bootstrap.json";

async function runGit(rootDir: string, ...args: string[]) {
  const proc = Bun.spawn(["git", ...args], {
    cwd: rootDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  if (exitCode !== 0) {
    throw new Error(
      stderr.trim() || `git ${args.join(" ")} failed (exit ${exitCode})`,
    );
  }

  return stdout.trim();
}

function resolveGitPath(rootDir: string, gitPath: string) {
  return path.resolve(rootDir, gitPath);
}

export async function validateWorktreeBootstrap(rootDir: string) {
  const [gitDir, commonDir] = await Promise.all([
    runGit(rootDir, "rev-parse", "--git-dir"),
    runGit(rootDir, "rev-parse", "--git-common-dir"),
  ]);

  if (
    (await realpath(resolveGitPath(rootDir, gitDir))) ===
    (await realpath(resolveGitPath(rootDir, commonDir)))
  ) {
    return;
  }

  const markerPath = resolveGitPath(
    rootDir,
    await runGit(
      rootDir,
      "rev-parse",
      "--git-path",
      WORKTREE_BOOTSTRAP_MARKER_PATH,
    ),
  );

  try {
    await access(markerPath);
  } catch {
    throw new Error(
      [
        "Worktree was not bootstrapped by the repository worktree manager.",
        `Run \`bash scripts/worktree-manager.sh setup-env ${rootDir}\` and retry.`,
      ].join("\n"),
    );
  }
}

if (import.meta.main) {
  validateWorktreeBootstrap(process.cwd()).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[worktree-bootstrap] BLOCKED: ${message}`);
    process.exit(1);
  });
}
