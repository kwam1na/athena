import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Bun test preload. `bunfig.toml` at the repo root and in each Vitest-owned
 * package points `[test] preload` here, so a raw `bun test` on a file that
 * belongs to a Vitest package stops with an explicit runner diagnostic instead
 * of unrelated jsdom/`vi` failures.
 *
 * Bun evaluates a preload once per process and reports only one file of the run
 * through `Bun.main`, so the guard classifies files through an `onLoad` hook
 * instead: that fires for every test file Bun executes, so a multi-target or
 * bare `bun test` is caught whichever file `Bun.main` happens to name.
 */

export type VitestPackage = {
  name: string;
  dir: string;
};

export type VitestRunnerDiagnostic = {
  packageName: string;
  packageRelativePath: string;
  command: string;
  message: string;
};

type PackageManifest = {
  name?: unknown;
  scripts?: { test?: unknown };
  workspaces?: unknown;
};

function readManifest(packageDir: string): PackageManifest | null {
  try {
    return JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

function runsVitest(testScript: unknown) {
  return typeof testScript === "string" && /(?:^|[^\w-])vitest(?:[^\w-]|$)/.test(testScript);
}

function asVitestPackage(packageDir: string): VitestPackage | null {
  const manifest = readManifest(packageDir);
  if (!manifest || typeof manifest.name !== "string" || !runsVitest(manifest.scripts?.test)) {
    return null;
  }

  return { name: manifest.name, dir: packageDir };
}

function nearestPackageDir(startDir: string) {
  let dir = startDir;

  for (;;) {
    if (existsSync(path.join(dir, "package.json"))) {
      return dir;
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }

    dir = parent;
  }
}

function describe(
  vitestPackage: VitestPackage,
  absolutePath: string,
  cwd: string
): VitestRunnerDiagnostic {
  const packageRelativePath = path.relative(vitestPackage.dir, absolutePath);
  const command = `bun run --filter '${vitestPackage.name}' test -- ${packageRelativePath}`;
  const displayPath = path.relative(cwd, absolutePath) || packageRelativePath;

  return {
    packageName: vitestPackage.name,
    packageRelativePath,
    command,
    message: [
      `[athena] \`bun test\` is not the test runner for ${vitestPackage.name}.`,
      `  file:   ${displayPath}`,
      `  reason: this package runs Vitest, so its tests rely on the jsdom environment and the`,
      `          \`vi\` mocking API. Under \`bun test\` they fail on unrelated errors such as`,
      `          "Can't find variable: document", a missing \`vi.mock\`, or an unresolved`,
      `          Vite-only module.`,
      `  run:    ${command}`,
    ].join("\n"),
  };
}

/** Every workspace package whose own `test` script runs Vitest. */
export function vitestPackages(repoRoot: string): VitestPackage[] {
  const manifest = readManifest(repoRoot);
  const globs = Array.isArray(manifest?.workspaces) ? manifest.workspaces : [];
  const packages: VitestPackage[] = [];

  for (const glob of globs) {
    if (typeof glob !== "string" || !glob.endsWith("/*")) {
      continue;
    }

    const parentDir = path.join(repoRoot, glob.slice(0, -"/*".length));
    let entries;
    try {
      entries = readdirSync(parentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const vitestPackage = asVitestPackage(path.join(parentDir, entry.name));
      if (vitestPackage) {
        packages.push(vitestPackage);
      }
    }
  }

  return packages.sort((left, right) => left.dir.localeCompare(right.dir));
}

export function resolveVitestRunnerDiagnostic(
  testFilePath: string | null | undefined,
  options: { cwd?: string } = {}
): VitestRunnerDiagnostic | null {
  if (!testFilePath) {
    return null;
  }

  const cwd = options.cwd ?? process.cwd();
  const absolutePath = path.resolve(cwd, testFilePath);
  const packageDir = nearestPackageDir(path.dirname(absolutePath));
  if (!packageDir) {
    return null;
  }

  const vitestPackage = asVitestPackage(packageDir);

  return vitestPackage ? describe(vitestPackage, absolutePath, cwd) : null;
}

/** Matches the test files Bun executes, under one package directory. */
export function testFileFilter(packageDir: string) {
  const escapedDir = packageDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  return new RegExp(`^${escapedDir}/.*[._](?:test|spec)\\.[cm]?[jt]sx?$`);
}

for (const vitestPackage of vitestPackages(path.resolve(import.meta.dir, ".."))) {
  Bun.plugin({
    name: `athena-test-runner-guard:${vitestPackage.name}`,
    setup(build) {
      // The filter only matches files inside this Vitest package, so every
      // call here is a misuse and the hook never returns a loaded module.
      build.onLoad({ filter: testFileFilter(vitestPackage.dir) }, (args) => {
        console.error(describe(vitestPackage, args.path, process.cwd()).message);
        process.exit(1);
      });
    },
  });
}
