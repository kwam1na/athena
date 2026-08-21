import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  WORKTREE_BOOTSTRAP_MARKER_PATH,
  validateWorktreeBootstrap,
} from "./worktree-bootstrap-check";
import { withoutGitRepositoryContext } from "./git-environment";

async function runGit(cwd: string, ...args: string[]) {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    env: withoutGitRepositoryContext(),
    stderr: "pipe",
    stdout: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${result.stderr.toString()}`,
    );
  }
  return result.stdout.toString().trim();
}

async function createFixtureRepo() {
  const rootDir = await mkdtemp(
    path.join(tmpdir(), "athena-worktree-bootstrap-"),
  );
  await runGit(rootDir, "init", "-b", "main");
  await runGit(rootDir, "config", "user.email", "test@example.com");
  await runGit(rootDir, "config", "user.name", "Test User");
  await writeFile(path.join(rootDir, "README.md"), "fixture\n");
  await runGit(rootDir, "add", "README.md");
  await runGit(rootDir, "commit", "-m", "seed fixture");

  const worktreeDir = path.join(rootDir, "linked-worktree");
  await runGit(rootDir, "worktree", "add", "-b", "codex/test", worktreeDir);
  return { rootDir, worktreeDir };
}

describe("validateWorktreeBootstrap", () => {
  it("allows the primary checkout without a marker", async () => {
    const { rootDir } = await createFixtureRepo();
    try {
      await expect(validateWorktreeBootstrap(rootDir)).resolves.toBeUndefined();
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("blocks a linked worktree through the runtime-neutral Git runner until the setup marker exists", async () => {
    const { rootDir, worktreeDir } = await createFixtureRepo();
    try {
      await expect(validateWorktreeBootstrap(worktreeDir)).rejects.toThrow(
        "Worktree was not bootstrapped",
      );
      await expect(validateWorktreeBootstrap(worktreeDir)).rejects.toThrow(
        "scripts/worktree-manager.sh setup-env",
      );
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("allows a linked worktree after setup records the marker", async () => {
    const { rootDir, worktreeDir } = await createFixtureRepo();
    try {
      const markerPath = await runGit(
        worktreeDir,
        "rev-parse",
        "--git-path",
        WORKTREE_BOOTSTRAP_MARKER_PATH,
      );
      await mkdir(path.dirname(markerPath), { recursive: true });
      await writeFile(markerPath, '{"version":1}\n');

      await expect(
        validateWorktreeBootstrap(worktreeDir),
      ).resolves.toBeUndefined();
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

describe("worktree bootstrap hook wiring", () => {
  it.each(["pre-commit", "pre-push"])(
    "guards %s before changing directories",
    async (hookName) => {
      const hook = await readFile(
        path.join(import.meta.dirname, "..", ".husky", hookName),
        "utf8",
      );

      expect(
        hook.indexOf("worktree-bootstrap-check.ts"),
      ).toBeGreaterThanOrEqual(0);
      expect(hook.indexOf("worktree-bootstrap-check.ts")).toBeLessThan(
        hook.indexOf('cd "$(git rev-parse --show-toplevel)"'),
      );
    },
  );
});
