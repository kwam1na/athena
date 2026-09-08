import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Bun test preload. `bunfig.toml` at the repo root and in each Vitest-owned
 * package points `[test] preload` here, so a raw `bun test` on a file that
 * belongs to a Vitest package stops with an explicit runner diagnostic instead
 * of unrelated jsdom/`vi` failures.
 */

export type VitestRunnerDiagnostic = {
  packageName: string;
  packageRelativePath: string;
  command: string;
  message: string;
};

type PackageManifest = {
  name?: unknown;
  scripts?: { test?: unknown };
};

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

  const manifest = readManifest(packageDir);
  if (!manifest || typeof manifest.name !== "string" || !runsVitest(manifest.scripts?.test)) {
    return null;
  }

  const packageName = manifest.name;
  const packageRelativePath = path.relative(packageDir, absolutePath);
  const command = `bun run --filter '${packageName}' test -- ${packageRelativePath}`;
  const displayPath = path.relative(cwd, absolutePath) || packageRelativePath;

  return {
    packageName,
    packageRelativePath,
    command,
    message: [
      `[athena] \`bun test\` is not the test runner for ${packageName}.`,
      `  file:   ${displayPath}`,
      `  reason: this package runs Vitest, so its tests rely on the jsdom environment and the`,
      `          \`vi\` mocking API. Under \`bun test\` they fail on unrelated errors such as`,
      `          "Can't find variable: document" or a missing \`vi.mock\`.`,
      `  run:    ${command}`,
    ].join("\n"),
  };
}

const diagnostic = resolveVitestRunnerDiagnostic(Bun.main);
if (diagnostic) {
  console.error(diagnostic.message);
  process.exit(1);
}
