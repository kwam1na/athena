import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  resolveVitestRunnerDiagnostic,
  testFileFilter,
  vitestPackages,
} from "./bun-test-runner-guard";

const repoRoot = path.resolve(import.meta.dirname, "..");

// Named rather than discovered, so a row that stops covering its case fails
// instead of silently retargeting whatever sorts first.
const FRONTEND_TSX_TEST = "packages/athena-webapp/src/App.test.tsx";
const FRONTEND_TS_TEST = "packages/athena-webapp/src/routeTree.browser-boundary.test.ts";
const STOREFRONT_TEST = "src/hooks/useQueryEnabled.test.ts";
const ROOT_SCRIPT_TEST = "scripts/bun-version-check.test.ts";

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

function runBunTest(targets: string[], cwd: string) {
  const proc = Bun.spawnSync(["bun", "test", ...targets], {
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

  // The note claims any future Vitest package is covered as soon as it exists,
  // so the match must survive a wrapper in front of `vitest` and must still
  // reject a script that only mentions vitest inside another word or path.
  it.each([
    ["vitest run", true],
    ["cross-env CI=1 vitest run", true],
    ["tsc -b && vitest run --coverage", true],
    ["bun test", false],
    ["node --test app.test.js", false],
    ["bun test ./vitest-shim.ts", false],
  ])("classifies the test script %j as Vitest: %s", async (testScript, expected) => {
    const rootDir = await createFixtureRoot();
    await write(
      rootDir,
      "packages/candidate/package.json",
      JSON.stringify({ name: "@athena/candidate", scripts: { test: testScript } })
    );
    const testFile = await write(rootDir, "packages/candidate/src/unit.test.ts", "export {};\n");

    expect(resolveVitestRunnerDiagnostic(testFile, { cwd: rootDir }) !== null).toBe(expected);
  });

  it("leaves the repo's own root script tests alone", () => {
    const testFile = path.join(repoRoot, ROOT_SCRIPT_TEST);

    expect(resolveVitestRunnerDiagnostic(testFile, { cwd: repoRoot })).toBeNull();
  });

  it("returns null when there is no test file to classify", () => {
    expect(resolveVitestRunnerDiagnostic(undefined, { cwd: repoRoot })).toBeNull();
  });
});

describe("vitestPackages", () => {
  it("finds exactly the workspace packages whose own test script runs Vitest", () => {
    const found = vitestPackages(repoRoot).map((entry) => entry.name).sort();

    expect(found).toEqual(["@athena/storefront-webapp", "@athena/webapp"]);
  });

  it("matches the test files Bun executes under a package, and nothing outside it", () => {
    const filter = testFileFilter("/repo/packages/webapp");

    expect(filter.test("/repo/packages/webapp/src/App.test.tsx")).toBe(true);
    expect(filter.test("/repo/packages/webapp/convex/app.test.ts")).toBe(true);
    expect(filter.test("/repo/packages/webapp/src/route.spec.ts")).toBe(true);
    expect(filter.test("/repo/packages/webapp/src/legacy_test.ts")).toBe(true);
    expect(filter.test("/repo/packages/webapp/src/App.tsx")).toBe(false);
    expect(filter.test("/repo/scripts/bun-version-check.test.ts")).toBe(false);
    expect(filter.test("/repo/packages/webapp-extra/src/App.test.tsx")).toBe(false);
  });
});

describe("raw bun test on an Athena frontend file", () => {
  it("reports the package runner and runs nothing (root-relative)", () => {
    const { exitCode, output } = runBunTest([FRONTEND_TSX_TEST], repoRoot);

    expect(output).toContain("`bun test` is not the test runner for @athena/webapp");
    expect(output).toContain(
      "bun run --filter '@athena/webapp' test -- src/App.test.tsx"
    );
    // The guard must abort before the file executes; any test row that ran
    // means the misleading failure path is still reachable.
    expect(output).not.toContain("(pass)");
    expect(output).not.toContain("Ran ");
    expect(exitCode).not.toBe(0);
  }, 60_000);

  it("reports the package runner for a .ts frontend target too", () => {
    const { exitCode, output } = runBunTest([FRONTEND_TS_TEST], repoRoot);

    expect(output).toContain("`bun test` is not the test runner for @athena/webapp");
    expect(output).not.toContain("(pass)");
    expect(exitCode).not.toBe(0);
  }, 60_000);

  // A preload sees only one file of the run through `Bun.main`, so a selection
  // that also names a root script test must still be caught.
  it("reports the package runner for a frontend file that is not the first target", () => {
    const { exitCode, output } = runBunTest([ROOT_SCRIPT_TEST, FRONTEND_TSX_TEST], repoRoot);

    expect(output).toContain("`bun test` is not the test runner for @athena/webapp");
    expect(output).not.toContain("Cannot find package");
    expect(exitCode).not.toBe(0);
  }, 60_000);

  it.each([
    ["packages/athena-webapp", "@athena/webapp", "src/App.test.tsx"],
    ["packages/storefront-webapp", "@athena/storefront-webapp", STOREFRONT_TEST],
  ])(
    "reports the package runner from inside %s (package-relative)",
    (packageDir, packageName, target) => {
      const { exitCode, output } = runBunTest([target], path.join(repoRoot, packageDir));

      expect(output).toContain(`\`bun test\` is not the test runner for ${packageName}`);
      expect(output).toContain(`bun run --filter '${packageName}' test -- ${target}`);
      expect(output).not.toContain("(pass)");
      expect(exitCode).not.toBe(0);
    },
    60_000
  );

  it("still runs the repo's root Bun script tests", () => {
    const { exitCode, output } = runBunTest([ROOT_SCRIPT_TEST], repoRoot);

    expect(output).not.toContain("is not the test runner");
    expect(output).toContain("pass");
    expect(exitCode).toBe(0);
  }, 60_000);
});
