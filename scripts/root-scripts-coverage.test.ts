import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { collectRootScriptTestFiles } from "./root-scripts-coverage";

const tempRoots: string[] = [];

async function createFixtureRoot() {
  const rootDir = await mkdtemp(path.join(tmpdir(), "athena-root-coverage-"));
  tempRoots.push(rootDir);
  return rootDir;
}

async function write(relativePath: string, rootDir: string) {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, "");
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((rootDir) =>
      rm(rootDir, { recursive: true, force: true })
    )
  );
});

describe("collectRootScriptTestFiles", () => {
  it("collects only first-party root script tests and ignores local worktrees", async () => {
    const rootDir = await createFixtureRoot();
    await write("scripts/alpha.test.ts", rootDir);
    await write("scripts/beta.test.ts", rootDir);
    await write("scripts/not-a-test.ts", rootDir);
    await write("worktrees/feature/scripts/alpha.test.ts", rootDir);
    await write("packages/athena-webapp/scripts/alpha.test.ts", rootDir);

    expect(collectRootScriptTestFiles(rootDir)).toEqual([
      path.join(rootDir, "scripts/alpha.test.ts"),
      path.join(rootDir, "scripts/beta.test.ts"),
    ]);
  });
});
