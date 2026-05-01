import { access, chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const tempRoots: string[] = [];

async function createFixtureRepo() {
  const rootDir = await mkdtemp(path.join(tmpdir(), "athena-worktree-manager-"));
  tempRoots.push(rootDir);

  await mkdir(path.join(rootDir, "scripts"), { recursive: true });
  await cp(
    path.join(import.meta.dirname, "worktree-manager.sh"),
    path.join(rootDir, "scripts/worktree-manager.sh")
  );
  await chmod(path.join(rootDir, "scripts/worktree-manager.sh"), 0o755);

  await mkdir(path.join(rootDir, "packages/athena-webapp"), { recursive: true });
  await writeFile(path.join(rootDir, ".gitignore"), ".env\n.env.local\n.worktrees/\n");
  await writeFile(path.join(rootDir, ".env"), "ROOT_ENV=present\n");
  await writeFile(
    path.join(rootDir, "packages/athena-webapp/.gitkeep"),
    ""
  );

  await runGit(rootDir, "init", "-b", "main");
  await runGit(rootDir, "config", "user.email", "test@example.com");
  await runGit(rootDir, "config", "user.name", "Test User");
  await runGit(rootDir, "add", ".gitignore", "scripts/worktree-manager.sh", "packages/athena-webapp/.gitkeep");
  await runGit(rootDir, "commit", "-m", "seed fixture");

  return rootDir;
}

async function runGit(cwd: string, ...args: string[]) {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    env: fixtureEnv(),
    stderr: "pipe",
    stdout: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed\n${result.stderr.toString()}\n${result.stdout.toString()}`
    );
  }
}

function runWorktreeManager(cwd: string, ...args: string[]) {
  return Bun.spawnSync(["bash", "scripts/worktree-manager.sh", ...args], {
    cwd,
    env: fixtureEnv(),
    stderr: "pipe",
    stdout: "pipe",
  });
}

function fixtureEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))
  ) as Record<string, string>;
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((rootDir) =>
      rm(rootDir, { recursive: true, force: true })
    )
  );
});

describe("worktree-manager", () => {
  it("copies Athena webapp Convex env files into new worktrees", async () => {
    const rootDir = await createFixtureRepo();
    await writeFile(
      path.join(rootDir, "packages/athena-webapp/.env"),
      "CONVEX_DEPLOYMENT=dev:fixture\nVITE_CONVEX_URL=https://fixture.convex.cloud\n"
    );
    await writeFile(
      path.join(rootDir, "packages/athena-webapp/.env.local"),
      "VITE_CONVEX_SITE_URL=https://fixture.convex.site\n"
    );

    const result = runWorktreeManager(rootDir, "create", "codex/test-env", "main");

    expect(result.exitCode).toBe(0);
    await expect(
      readFile(
        path.join(rootDir, ".worktrees/codex/test-env/packages/athena-webapp/.env"),
        "utf8"
      )
    ).resolves.toContain("VITE_CONVEX_URL=https://fixture.convex.cloud");
    await expect(
      readFile(
        path.join(
          rootDir,
          ".worktrees/codex/test-env/packages/athena-webapp/.env.local"
        ),
        "utf8"
      )
    ).resolves.toContain("VITE_CONVEX_SITE_URL=https://fixture.convex.site");
  });

  it("fails clearly when Athena webapp Convex env source files are missing", async () => {
    const rootDir = await createFixtureRepo();

    const result = runWorktreeManager(rootDir, "create", "codex/missing-env", "main");

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain(
      "Missing Athena webapp env files"
    );
    expect(result.stderr.toString()).toContain(
      "packages/athena-webapp/.env"
    );
    await expect(
      access(path.join(rootDir, ".worktrees/codex/missing-env"))
    ).rejects.toThrow();
  });

  it("keeps existing env files when setup is rerun for a worktree", async () => {
    const rootDir = await createFixtureRepo();
    await writeFile(
      path.join(rootDir, "packages/athena-webapp/.env"),
      "VITE_CONVEX_URL=https://fixture.convex.cloud\n"
    );

    const createResult = runWorktreeManager(
      rootDir,
      "create",
      "codex/idempotent-env",
      "main"
    );
    expect(createResult.exitCode).toBe(0);

    const worktreeEnv = path.join(
      rootDir,
      ".worktrees/codex/idempotent-env/packages/athena-webapp/.env"
    );
    await writeFile(worktreeEnv, "VITE_CONVEX_URL=https://local.override\n");

    const setupResult = runWorktreeManager(
      rootDir,
      "setup-env",
      ".worktrees/codex/idempotent-env"
    );

    expect(setupResult.exitCode).toBe(0);
    await expect(readFile(worktreeEnv, "utf8")).resolves.toBe(
      "VITE_CONVEX_URL=https://local.override\n"
    );
  });
});
