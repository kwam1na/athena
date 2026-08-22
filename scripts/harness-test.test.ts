import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// CLI boundary coverage is centralized in harness-blocker-inventory.test.ts.

import {
  collectHarnessTestTargets,
  parseHarnessTestCliArgs,
  runHarnessTest,
} from "./harness-test";
import { withoutGitRepositoryContext } from "./git-environment";
import { collectRootScriptTestFiles } from "./root-scripts-coverage";
import { harnessTestsFailedBlocker } from "./harness-test";

const tempRoots: string[] = [];

async function write(relativePath: string, contents: string, rootDir: string) {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

async function createFixtureRoot() {
  const rootDir = await mkdtemp(path.join(tmpdir(), "athena-harness-test-"));
  tempRoots.push(rootDir);
  return rootDir;
}

function runGit(rootDir: string, ...args: string[]) {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: rootDir,
    env: withoutGitRepositoryContext(),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString().trim());
  }
  return result.stdout.toString().trim();
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((rootDir) =>
      rm(rootDir, { recursive: true, force: true })
    )
  );
});

describe("collectHarnessTestTargets", () => {
  it("collects repo-root scripts/*.test.ts files as absolute paths", async () => {
    const rootDir = await createFixtureRoot();
    await write("scripts/harness-audit.test.ts", "test('a', () => {});\n", rootDir);
    await write("scripts/pre-push-review.test.ts", "test('b', () => {});\n", rootDir);
    await write("scripts/harness-review.ts", "export {};\n", rootDir);
    await write("scripts/nested/ignored.test.ts", "test('c', () => {});\n", rootDir);

    await expect(collectHarnessTestTargets(rootDir)).resolves.toEqual([
      path.join(rootDir, "scripts", "harness-audit.test.ts"),
      path.join(rootDir, "scripts", "pre-push-review.test.ts"),
    ]);
  });

  it("matches the root script coverage target set", async () => {
    const rootDir = await createFixtureRoot();
    await write("scripts/alpha.test.ts", "test('a', () => {});\n", rootDir);
    await write("scripts/beta.test.ts", "test('b', () => {});\n", rootDir);
    await write("scripts/not-a-test.ts", "export {};\n", rootDir);

    await expect(collectHarnessTestTargets(rootDir)).resolves.toEqual(
      collectRootScriptTestFiles(rootDir)
    );
  });

  it("ignores test files in cloned worktree trees", async () => {
    const rootDir = await createFixtureRoot();
    await write("scripts/harness-audit.test.ts", "test('root', () => {});\n", rootDir);
    await write(
      ".worktrees/clone-a/scripts/harness-audit.test.ts",
      "test('clone-a', () => {});\n",
      rootDir
    );
    await write(
      "worktrees/clone-b/scripts/harness-audit.test.ts",
      "test('clone-b', () => {});\n",
      rootDir
    );
    await write(
      "packages/.claude/worktrees/clone-c/scripts/harness-audit.test.ts",
      "test('clone-c', () => {});\n",
      rootDir
    );

    await expect(collectHarnessTestTargets(rootDir)).resolves.toEqual([
      path.join(rootDir, "scripts", "harness-audit.test.ts"),
    ]);
  });
});

describe("runHarnessTest", () => {
  it("keeps parent Git state unchanged while real fixture tests run under hook context", async () => {
    const parentRoot = await createFixtureRoot();
    runGit(parentRoot, "init", "--initial-branch=main");
    runGit(parentRoot, "config", "user.email", "parent@example.com");
    runGit(parentRoot, "config", "user.name", "Parent Fixture");
    runGit(parentRoot, "config", "core.bare", "false");
    runGit(parentRoot, "config", "extensions.worktreeConfig", "true");
    await write("seed.txt", "parent seed\n", parentRoot);
    runGit(parentRoot, "add", "seed.txt");
    runGit(parentRoot, "commit", "-m", "parent seed");

    const testRoot = await createFixtureRoot();
    await write(
      "scripts/real-repository.test.ts",
      `
        import { mkdir, writeFile } from "node:fs/promises";
        import path from "node:path";
        import { expect, test } from "bun:test";

        test("nested Git commands stay inside the fixture", async () => {
          expect(Object.keys(process.env).filter((key) => key.startsWith("GIT_"))).toEqual([]);
          const fixtureRoot = path.join(import.meta.dirname, "nested-repo");
          await mkdir(fixtureRoot, { recursive: true });
          const git = (...args: string[]) => {
            const result = Bun.spawnSync(["git", ...args], {
              cwd: fixtureRoot,
              stdout: "pipe",
              stderr: "pipe",
            });
            expect(result.exitCode, result.stderr.toString()).toBe(0);
          };
          git("init", "--initial-branch=fixture");
          git("config", "user.email", "nested@example.com");
          git("config", "user.name", "Nested Fixture");
          git("config", "core.bare", "true");
          await writeFile(path.join(fixtureRoot, "marker.txt"), "fixture only\\n");
          expect(await Bun.file(path.join(fixtureRoot, ".git", "config")).text()).toContain("bare = true");
        });
      `,
      testRoot,
    );

    const gitDir = path.join(parentRoot, ".git");
    const indexPath = path.join(gitDir, "index");
    const configPath = path.join(gitDir, "config");
    const configBefore = await readFile(configPath);
    const indexBefore = await readFile(indexPath);
    const refsBefore = runGit(parentRoot, "show-ref");
    const hookEnvironment = {
      GIT_DIR: gitDir,
      GIT_WORK_TREE: parentRoot,
      GIT_INDEX_FILE: indexPath,
      GIT_PREFIX: "scripts/",
      GIT_OBJECT_DIRECTORY: path.join(gitDir, "objects"),
    };
    const originals = Object.fromEntries(
      Object.keys(hookEnvironment).map((key) => [key, process.env[key]]),
    );

    try {
      Object.assign(process.env, hookEnvironment);
      await runHarnessTest(testRoot);
    } finally {
      for (const [key, value] of Object.entries(originals)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }

    expect(await readFile(configPath)).toEqual(configBefore);
    expect(await readFile(indexPath)).toEqual(indexBefore);
    expect(runGit(parentRoot, "show-ref")).toBe(refsBefore);
    expect(runGit(parentRoot, "config", "--get", "core.bare")).toBe("false");
    expect(
      runGit(parentRoot, "config", "--get", "extensions.worktreeConfig"),
    ).toBe("true");
    expect(
      await readFile(
        path.join(testRoot, "scripts", "nested-repo", ".git", "config"),
        "utf8",
      ),
    ).toContain("bare = true");
  });

  it("removes inherited Git repository context from the bun test process", async () => {
    const rootDir = await createFixtureRoot();
    await write("scripts/harness-audit.test.ts", "test('root', () => {});\n", rootDir);

    const originalGitDir = process.env.GIT_DIR;
    const originalGitWorkTree = process.env.GIT_WORK_TREE;
    const originalGitIndexFile = process.env.GIT_INDEX_FILE;
    process.env.GIT_DIR = "/parent/repo/.git";
    process.env.GIT_WORK_TREE = "/parent/repo";
    process.env.GIT_INDEX_FILE = "/parent/repo/.git/index.locked";

    let spawnedEnv: Record<string, string | undefined> | undefined;
    try {
      await runHarnessTest(rootDir, {
        spawn: (_command, options) => {
          spawnedEnv = options.env;
          return { exited: Promise.resolve(0) };
        },
      });
    } finally {
      if (originalGitDir === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = originalGitDir;
      if (originalGitWorkTree === undefined) delete process.env.GIT_WORK_TREE;
      else process.env.GIT_WORK_TREE = originalGitWorkTree;
      if (originalGitIndexFile === undefined) delete process.env.GIT_INDEX_FILE;
      else process.env.GIT_INDEX_FILE = originalGitIndexFile;
    }

    expect(spawnedEnv).toBeDefined();
    expect(spawnedEnv?.PATH).toBe(process.env.PATH);
    expect(spawnedEnv?.GIT_DIR).toBeUndefined();
    expect(spawnedEnv?.GIT_WORK_TREE).toBeUndefined();
    expect(spawnedEnv?.GIT_INDEX_FILE).toBeUndefined();
    expect(process.env.GIT_DIR).toBe(originalGitDir);
    expect(process.env.GIT_WORK_TREE).toBe(originalGitWorkTree);
    expect(process.env.GIT_INDEX_FILE).toBe(originalGitIndexFile);
  });

  it("supports --dry-run selection checks without invoking bun test", async () => {
    const rootDir = await createFixtureRoot();
    await write("scripts/harness-audit.test.ts", "test('root', () => {});\n", rootDir);
    await write(
      ".worktrees/clone-a/scripts/harness-audit.test.ts",
      "test('clone', () => {});\n",
      rootDir
    );

    const logLines: string[] = [];
    let spawned = false;

    await expect(
      runHarnessTest(rootDir, {
        dryRun: true,
        logger: { log: (line) => logLines.push(line) },
        spawn: () => {
          spawned = true;
          return {
            exited: Promise.resolve(0),
          };
        },
      })
    ).resolves.toBeUndefined();

    expect(spawned).toBe(false);
    expect(logLines).toContain("[harness:test] Selected repo-root script tests:");
    expect(logLines).toContain(path.join(rootDir, "scripts", "harness-audit.test.ts"));
    expect(logLines.join("\n")).not.toContain(`${path.sep}.worktrees${path.sep}`);
  });
});

describe("parseHarnessTestCliArgs", () => {
  it("peels off --dry-run and preserves passthrough bun test args", () => {
    expect(
      parseHarnessTestCliArgs(["--dry-run", "--reporter", "dot", "--timeout", "5000"])
    ).toEqual({
      dryRun: true,
      passthroughArgs: ["--reporter", "dot", "--timeout", "5000"],
    });
  });
});

describe("harnessTestsFailedBlocker", () => {
  it("reports a failing suite as an expected block, not an internal error", () => {
    const blocker = harnessTestsFailedBlocker(1);

    expect(blocker.code).toBe("harness_tests_failed");
    expect(blocker.source).toEqual({ kind: "command", id: "harness:test" });
    expect(blocker.remediations.map((item) => item.id)).toEqual([
      "fix-failing-harness-tests",
      "rerun-harness-tests",
    ]);
  });
});
