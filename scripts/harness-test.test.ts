import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  collectHarnessTestTargets,
  parseHarnessTestCliArgs,
  runHarnessTest,
} from "./harness-test";

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
