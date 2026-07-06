import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

type Manifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

type DependencyManifest = {
  manifestPath: string;
  packageDir: string;
};

type DependencyFailure = {
  kind: "declaration" | "installation";
  message: string;
};

type FrontendDependencyParityOptions = {
  installCommand?: string[];
  repair?: boolean;
};

const DEPENDENCY_SECTIONS = ["dependencies", "devDependencies"] as const;

export const FRONTEND_DEPENDENCY_MANIFESTS: DependencyManifest[] = [
  {
    manifestPath: "package.json",
    packageDir: ".",
  },
  {
    manifestPath: "packages/athena-webapp/package.json",
    packageDir: "packages/athena-webapp",
  },
  {
    manifestPath: "packages/storefront-webapp/package.json",
    packageDir: "packages/storefront-webapp",
  },
];

function readManifest(rootDir: string, manifestPath: string): Manifest {
  return JSON.parse(readFileSync(path.join(rootDir, manifestPath), "utf8"));
}

type DependencyDeclaration = {
  manifestPath: string;
  packageDir: string;
  section: (typeof DEPENDENCY_SECTIONS)[number];
  packageName: string;
  version: string;
};

function collectDependencyDeclarations(rootDir: string) {
  const declarations: DependencyDeclaration[] = [];

  for (const dependencyManifest of FRONTEND_DEPENDENCY_MANIFESTS) {
    const manifest = readManifest(rootDir, dependencyManifest.manifestPath);

    for (const section of DEPENDENCY_SECTIONS) {
      for (const [packageName, version] of Object.entries(
        manifest[section] ?? {}
      )) {
        declarations.push({
          manifestPath: dependencyManifest.manifestPath,
          packageDir: dependencyManifest.packageDir,
          packageName,
          section,
          version,
        });
      }
    }
  }

  return declarations;
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

function satisfiesDeclaredVersion(installed: string, declared: string) {
  if (declared === "latest") {
    return true;
  }

  try {
    return Bun.semver.satisfies(installed, declared);
  } catch {
    return installed === declared;
  }
}

function collectFrontendDependencyFailures(rootDir: string) {
  const failures: DependencyFailure[] = [];
  const declarations = collectDependencyDeclarations(rootDir);
  const declarationsByPackage = new Map<string, DependencyDeclaration[]>();

  for (const declaration of declarations) {
    const packageDeclarations =
      declarationsByPackage.get(declaration.packageName) ?? [];
    packageDeclarations.push(declaration);
    declarationsByPackage.set(declaration.packageName, packageDeclarations);
  }

  for (const [packageName, packageDeclarations] of declarationsByPackage) {
    const declaredVersions = new Set(
      packageDeclarations.map((declaration) => declaration.version)
    );

    if (packageDeclarations.length > 1 && declaredVersions.size > 1) {
      failures.push({
        kind: "declaration",
        message: `Shared dependency declarations for ${packageName} are not aligned: ${packageDeclarations
          .map(
            (declaration) =>
              `${declaration.manifestPath} ${declaration.section} ${declaration.version}`
          )
          .join("; ")}.`,
      });
    }
  }

  for (const declaration of declarations) {
    try {
      const installed = installedVersion(
        rootDir,
        declaration.packageDir,
        declaration.packageName
      );

      if (!satisfiesDeclaredVersion(installed, declaration.version)) {
        failures.push({
          kind: "installation",
          message: `${declaration.packageDir} resolves ${declaration.packageName}@${installed}, which does not satisfy ${declaration.version}; run bun install --frozen-lockfile before changing wrappers.`,
        });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({
        kind: "installation",
        message: `${declaration.packageDir} cannot resolve ${declaration.packageName}; run bun install --frozen-lockfile. ${message}`,
      });
    }
  }

  return failures;
}

export function checkFrontendDependencyParity(rootDir: string) {
  return collectFrontendDependencyFailures(rootDir).map(
    (failure) => failure.message
  );
}

function formatFailureMessage(failures: DependencyFailure[]) {
  return `Frontend dependency parity failed:\n${failures
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
      `Frontend dependency repair failed: ${installCommand.join(
        " "
      )} exited with code ${result.exitCode ?? "unknown"}.`
    );
  }
}

export function assertFrontendDependencyParity(
  rootDir: string,
  options: FrontendDependencyParityOptions = {}
) {
  let failures = collectFrontendDependencyFailures(rootDir);

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
      "Frontend dependency parity found install drift; running frozen dependency repair..."
    );
    runFrozenInstall(rootDir, installCommand);
    failures = collectFrontendDependencyFailures(rootDir);
  }

  if (failures.length > 0) {
    throw new Error(formatFailureMessage(failures));
  }
}

if (import.meta.main) {
  try {
    assertFrontendDependencyParity(path.resolve(import.meta.dirname, ".."), {
      repair: process.argv.includes("--repair"),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}
