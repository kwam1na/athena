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

type CoverageToolchainFailure = {
  kind: "declaration" | "installation";
  message: string;
};

type CoverageToolchainOptions = {
  installCommand?: string[];
  repair?: boolean;
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

function installedVersion(
  rootDir: string,
  packageDir: string,
  packageName: string
) {
  let currentDir = path.resolve(rootDir, packageDir);
  const repoRoot = path.resolve(rootDir);

  while (currentDir.startsWith(repoRoot)) {
    const packageJsonPath = path.join(
      currentDir,
      "node_modules",
      packageName,
      "package.json"
    );
    if (existsSync(packageJsonPath)) {
      return JSON.parse(readFileSync(packageJsonPath, "utf8")).version as string;
    }

    if (currentDir === repoRoot) {
      break;
    }

    currentDir = path.dirname(currentDir);
  }

  throw new Error(
    `Cannot find ${packageName}/package.json from ${path.join(
      rootDir,
      packageDir
    )}`
  );
}

function collectCoverageToolchainFailures(rootDir: string) {
  const failures: CoverageToolchainFailure[] = [];

  for (const check of COVERAGE_TOOLCHAIN_MANIFESTS) {
    const manifest = readManifest(rootDir, check.manifestPath);

    for (const packageName of check.packages) {
      const declared = declaredVersion(manifest, packageName);

      if (declared !== VITEST_TOOLCHAIN_VERSION) {
        failures.push({
          kind: "declaration",
          message: `${check.manifestPath} declares ${packageName}@${
            declared ?? "missing"
          }; expected exact ${VITEST_TOOLCHAIN_VERSION}.`,
        });
        continue;
      }

      try {
        const installed = installedVersion(
          rootDir,
          check.packageDir,
          packageName
        );
        if (installed !== VITEST_TOOLCHAIN_VERSION) {
          failures.push({
            kind: "installation",
            message: `${check.packageDir} resolves ${packageName}@${installed}; run bun install so coverage uses ${VITEST_TOOLCHAIN_VERSION}.`,
          });
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push({
          kind: "installation",
          message: `${check.packageDir} cannot resolve ${packageName}; run bun install. ${message}`,
        });
      }
    }
  }

  return failures;
}

export function checkCoverageToolchainParity(rootDir: string) {
  return collectCoverageToolchainFailures(rootDir).map(
    (failure) => failure.message
  );
}

function formatFailureMessage(failures: CoverageToolchainFailure[]) {
  return `Coverage toolchain parity failed:\n${failures
    .map((failure) => failure.message)
    .join("\n")}`;
}

function runFrozenInstall(rootDir: string, installCommand: string[]) {
  const result = Bun.spawnSync(installCommand, {
    cwd: rootDir,
    stderr: "inherit",
    stdout: "inherit",
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `Coverage toolchain repair failed: ${installCommand.join(
        " "
      )} exited with code ${result.exitCode ?? "unknown"}.`
    );
  }
}

export function assertCoverageToolchainParity(
  rootDir: string,
  options: CoverageToolchainOptions = {}
) {
  let failures = collectCoverageToolchainFailures(rootDir);

  if (
    failures.length > 0 &&
    options.repair === true &&
    failures.every((failure) => failure.kind === "installation")
  ) {
    const installCommand = options.installCommand ?? [
      "bun",
      "install",
      "--frozen-lockfile",
    ];
    console.warn(
      "Coverage toolchain parity found install drift; running frozen dependency repair..."
    );
    runFrozenInstall(rootDir, installCommand);
    failures = collectCoverageToolchainFailures(rootDir);
  }

  if (failures.length > 0) {
    throw new Error(formatFailureMessage(failures));
  }
}

if (import.meta.main) {
  try {
    assertCoverageToolchainParity(path.resolve(import.meta.dirname, ".."), {
      repair: process.argv.includes("--repair"),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}
