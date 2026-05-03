import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  checkCoverageToolchainParity,
  VITEST_TOOLCHAIN_VERSION,
} from "./coverage-toolchain-parity";

const tempRoots: string[] = [];

async function createFixtureRoot() {
  const rootDir = await mkdtemp(path.join(tmpdir(), "athena-toolchain-"));
  tempRoots.push(rootDir);
  return rootDir;
}

async function writeJson(rootDir: string, relativePath: string, value: unknown) {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function createPackage(rootDir: string, packageName: string, version: string) {
  await writeJson(rootDir, path.join("node_modules", packageName, "package.json"), {
    name: packageName,
    version,
  });
}

async function linkWorkspacePackage(rootDir: string, packageDir: string, packageName: string) {
  const nodeModulesDir = path.join(rootDir, packageDir, "node_modules");
  const linkPath = path.join(nodeModulesDir, packageName);
  await mkdir(path.dirname(linkPath), { recursive: true });
  await symlink(
    path.relative(path.dirname(linkPath), path.join(rootDir, "node_modules", packageName)),
    linkPath
  );
}

async function writeFixtureManifests(rootDir: string, declaredVersion = VITEST_TOOLCHAIN_VERSION) {
  await writeJson(rootDir, "package.json", {
    devDependencies: {
      vitest: declaredVersion,
    },
  });
  await writeJson(rootDir, "packages/athena-webapp/package.json", {
    devDependencies: {
      "@vitest/coverage-v8": declaredVersion,
      "@vitest/ui": declaredVersion,
      vitest: declaredVersion,
    },
  });
  await writeJson(rootDir, "packages/storefront-webapp/package.json", {
    devDependencies: {
      "@vitest/coverage-v8": declaredVersion,
      vitest: declaredVersion,
    },
  });
}

async function installFixtureToolchain(rootDir: string, installedVersion = VITEST_TOOLCHAIN_VERSION) {
  await createPackage(rootDir, "vitest", installedVersion);
  await createPackage(rootDir, "@vitest/coverage-v8", installedVersion);
  await createPackage(rootDir, "@vitest/ui", installedVersion);
  await linkWorkspacePackage(rootDir, "packages/athena-webapp", "vitest");
  await linkWorkspacePackage(rootDir, "packages/athena-webapp", "@vitest/coverage-v8");
  await linkWorkspacePackage(rootDir, "packages/athena-webapp", "@vitest/ui");
  await linkWorkspacePackage(rootDir, "packages/storefront-webapp", "vitest");
  await linkWorkspacePackage(rootDir, "packages/storefront-webapp", "@vitest/coverage-v8");
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((rootDir) =>
      rm(rootDir, { recursive: true, force: true })
    )
  );
});

describe("checkCoverageToolchainParity", () => {
  it("accepts exact, aligned Vitest coverage tooling", async () => {
    const rootDir = await createFixtureRoot();
    await writeFixtureManifests(rootDir);
    await installFixtureToolchain(rootDir);

    expect(checkCoverageToolchainParity(rootDir)).toEqual([]);
  });

  it("rejects semver ranges because CI and local can resolve different coverage tooling", async () => {
    const rootDir = await createFixtureRoot();
    await writeFixtureManifests(rootDir, "^3.2.4");
    await installFixtureToolchain(rootDir);

    expect(checkCoverageToolchainParity(rootDir)).toContain(
      "package.json declares vitest@^3.2.4; expected exact 3.2.4."
    );
  });

  it("rejects stale installed tooling even when package manifests are correct", async () => {
    const rootDir = await createFixtureRoot();
    await writeFixtureManifests(rootDir);
    await installFixtureToolchain(rootDir, "3.1.4");

    expect(checkCoverageToolchainParity(rootDir)).toContain(
      "packages/athena-webapp resolves vitest@3.1.4; run bun install so coverage uses 3.2.4."
    );
  });
});
