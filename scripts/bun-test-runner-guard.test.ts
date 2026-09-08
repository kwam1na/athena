import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveVitestRunnerDiagnostic } from "./bun-test-runner-guard";

const repoRoot = path.resolve(import.meta.dirname, "..");
const tempRoots: string[] = [];

async function createFixtureRoot() {
  const rootDir = await mkdtemp(path.join(tmpdir(), "athena-runner-guard-"));
  tempRoots.push(rootDir);
  return rootDir;
}

async function write(rootDir: string, relativePath: string, contents: string) {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
  return filePath;
}

async function firstFrontendTestFile() {
  const searchRoot = path.join(repoRoot, "packages/athena-webapp/src");
  const stack = [searchRoot];

  while (stack.length > 0) {
    const dir = stack.shift()!;
    const entries = (await readdir(dir, { withFileTypes: true })).sort((left, right) =>
      left.name.localeCompare(right.name)
    );

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".test.tsx")) {
        return path.join(dir, entry.name);
      }
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        stack.push(path.join(dir, entry.name));
      }
    }
  }

  throw new Error(`No *.test.tsx file found under ${searchRoot}`);
}

function runBunTest(target: string, cwd: string) {
  const proc = Bun.spawnSync(["bun", "test", target], {
    cwd,
    env: { ...process.env, FORCE_COLOR: "0" },
  });

  return {
    exitCode: proc.exitCode,
    output: `${proc.stdout.toString()}${proc.stderr.toString()}`,
  };
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((rootDir) => rm(rootDir, { recursive: true, force: true }))
  );
});

describe("resolveVitestRunnerDiagnostic", () => {
  it("maps a frontend test file to its package's Vitest runner command", async () => {
    const rootDir = await createFixtureRoot();
    await write(
      rootDir,
      "packages/webapp/package.json",
      JSON.stringify({ name: "@athena/webapp", scripts: { test: "vitest run --maxWorkers=4" } })
    );
    const testFile = await write(
      rootDir,
      "packages/webapp/src/contexts/AppShell.test.tsx",
      "export {};\n"
    );

    const diagnostic = resolveVitestRunnerDiagnostic(testFile, { cwd: rootDir });

    expect(diagnostic).not.toBeNull();
    expect(diagnostic?.packageName).toBe("@athena/webapp");
    expect(diagnostic?.packageRelativePath).toBe("src/contexts/AppShell.test.tsx");
    expect(diagnostic?.command).toBe(
      "bun run --filter '@athena/webapp' test -- src/contexts/AppShell.test.tsx"
    );
  });

  it("explains the misleading failure and names the intended runner", async () => {
    const rootDir = await createFixtureRoot();
    await write(
      rootDir,
      "packages/webapp/package.json",
      JSON.stringify({ name: "@athena/webapp", scripts: { test: "vitest run" } })
    );
    const testFile = await write(rootDir, "packages/webapp/src/App.test.tsx", "export {};\n");

    const diagnostic = resolveVitestRunnerDiagnostic(testFile, { cwd: rootDir });

    expect(diagnostic?.message).toContain("`bun test` is not the test runner for @athena/webapp");
    expect(diagnostic?.message).toContain("Vitest");
    expect(diagnostic?.message).toContain(
      "bun run --filter '@athena/webapp' test -- src/App.test.tsx"
    );
  });

  it("leaves a package whose test script is not Vitest alone", async () => {
    const rootDir = await createFixtureRoot();
    await write(
      rootDir,
      "packages/proxy/package.json",
      JSON.stringify({ name: "@athena/proxy", scripts: { test: "bun test" } })
    );
    const testFile = await write(rootDir, "packages/proxy/src/server.test.ts", "export {};\n");

    expect(resolveVitestRunnerDiagnostic(testFile, { cwd: rootDir })).toBeNull();
  });

  it("leaves the repo's own root script tests alone", () => {
    const testFile = path.join(repoRoot, "scripts/bun-version-check.test.ts");

    expect(resolveVitestRunnerDiagnostic(testFile, { cwd: repoRoot })).toBeNull();
  });

  it("returns null when there is no test file to classify", () => {
    expect(resolveVitestRunnerDiagnostic(undefined, { cwd: repoRoot })).toBeNull();
  });
});

describe("raw bun test on an Athena frontend file", () => {
  it("reports the package runner instead of missing browser globals (root-relative)", async () => {
    const frontendTest = await firstFrontendTestFile();
    const target = path.relative(repoRoot, frontendTest);

    const { exitCode, output } = runBunTest(target, repoRoot);

    expect(output).toContain("`bun test` is not the test runner for @athena/webapp");
    expect(output).toContain("bun run --filter '@athena/webapp' test --");
    expect(output).not.toContain("ReferenceError");
    expect(exitCode).not.toBe(0);
  }, 60_000);

  it("reports the package runner instead of missing browser globals (package-relative)", async () => {
    const packageDir = path.join(repoRoot, "packages/athena-webapp");
    const frontendTest = await firstFrontendTestFile();
    const target = path.relative(packageDir, frontendTest);

    const { exitCode, output } = runBunTest(target, packageDir);

    expect(output).toContain("`bun test` is not the test runner for @athena/webapp");
    expect(output).toContain(`bun run --filter '@athena/webapp' test -- ${target}`);
    expect(output).not.toContain("ReferenceError");
    expect(exitCode).not.toBe(0);
  }, 60_000);

  it("still runs the repo's root Bun script tests", () => {
    const { exitCode, output } = runBunTest("scripts/bun-version-check.test.ts", repoRoot);

    expect(output).not.toContain("is not the test runner");
    expect(output).toContain("pass");
    expect(exitCode).toBe(0);
  }, 60_000);
});
