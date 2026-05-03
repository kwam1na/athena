import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

type Manifest = {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

type ManifestCheck = {
  manifestPath: string;
  packageDir: string;
  packages: string[];
};

export const VITEST_TOOLCHAIN_VERSION = "3.2.4";

export const COVERAGE_TOOLCHAIN_MANIFESTS: ManifestCheck[] = [
  {
    manifestPath: "package.json",
    packageDir: ".",
    packages: ["vitest"],
  },
  {
    manifestPath: "packages/athena-webapp/package.json",
    packageDir: "packages/athena-webapp",
    packages: ["vitest", "@vitest/coverage-v8", "@vitest/ui"],
  },
  {
    manifestPath: "packages/storefront-webapp/package.json",
    packageDir: "packages/storefront-webapp",
    packages: ["vitest", "@vitest/coverage-v8"],
  },
];

function readManifest(rootDir: string, manifestPath: string): Manifest {
  return JSON.parse(readFileSync(path.join(rootDir, manifestPath), "utf8"));
}

function declaredVersion(manifest: Manifest, packageName: string) {
  return (
    manifest.devDependencies?.[packageName] ??
    manifest.dependencies?.[packageName] ??
    manifest.peerDependencies?.[packageName]
  );
}

function installedVersion(rootDir: string, packageDir: string, packageName: string) {
  let currentDir = path.resolve(rootDir, packageDir);
  const repoRoot = path.resolve(rootDir);

  while (currentDir.startsWith(repoRoot)) {
    const packageJsonPath = path.join(currentDir, "node_modules", packageName, "package.json");
    if (existsSync(packageJsonPath)) {
      return JSON.parse(readFileSync(packageJsonPath, "utf8")).version as string;
    }

    if (currentDir === repoRoot) {
      break;
    }

    currentDir = path.dirname(currentDir);
  }

  throw new Error(`Cannot find ${packageName}/package.json from ${path.join(rootDir, packageDir)}`);
}

export function checkCoverageToolchainParity(rootDir: string) {
  const failures: string[] = [];

  for (const check of COVERAGE_TOOLCHAIN_MANIFESTS) {
    const manifest = readManifest(rootDir, check.manifestPath);

    for (const packageName of check.packages) {
      const declared = declaredVersion(manifest, packageName);

      if (declared !== VITEST_TOOLCHAIN_VERSION) {
        failures.push(
          `${check.manifestPath} declares ${packageName}@${declared ?? "missing"}; expected exact ${VITEST_TOOLCHAIN_VERSION}.`
        );
        continue;
      }

      try {
        const installed = installedVersion(rootDir, check.packageDir, packageName);
        if (installed !== VITEST_TOOLCHAIN_VERSION) {
          failures.push(
            `${check.packageDir} resolves ${packageName}@${installed}; run bun install so coverage uses ${VITEST_TOOLCHAIN_VERSION}.`
          );
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(
          `${check.packageDir} cannot resolve ${packageName}; run bun install. ${message}`
        );
      }
    }
  }

  return failures;
}

export function assertCoverageToolchainParity(rootDir: string) {
  const failures = checkCoverageToolchainParity(rootDir);

  if (failures.length > 0) {
    throw new Error(`Coverage toolchain parity failed:\n${failures.join("\n")}`);
  }
}

if (import.meta.main) {
  try {
    assertCoverageToolchainParity(path.resolve(import.meta.dirname, ".."));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}
