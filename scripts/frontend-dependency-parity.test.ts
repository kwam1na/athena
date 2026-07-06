import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertFrontendDependencyParity,
  checkFrontendDependencyParity,
} from "./frontend-dependency-parity";

const tempRoots: string[] = [];

async function createFixtureRoot() {
  const rootDir = await mkdtemp(path.join(tmpdir(), "athena-frontend-deps-"));
  tempRoots.push(rootDir);
  return rootDir;
}

async function writeJson(rootDir: string, relativePath: string, value: unknown) {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function createPackage(
  rootDir: string,
  packageName: string,
  version: string
) {
  await writeJson(
    rootDir,
    path.join("node_modules", packageName, "package.json"),
    {
      name: packageName,
      version,
    }
  );
}

async function writeFixtureManifests(
  rootDir: string,
  storefrontDayPicker = "^10.0.0"
) {
  await writeJson(rootDir, "package.json", {
    devDependencies: {
      "@testing-library/react": "^16.3.0",
      "lucide-react": "^0.525.0",
    },
  });
  await writeJson(rootDir, "packages/athena-webapp/package.json", {
    dependencies: {
      "lucide-react": "^0.525.0",
      "react-day-picker": "^10.0.0",
    },
    devDependencies: {
      "@testing-library/react": "^16.3.0",
    },
  });
  await writeJson(rootDir, "packages/storefront-webapp/package.json", {
    dependencies: {
      "lucide-react": "^0.525.0",
      "react-day-picker": storefrontDayPicker,
    },
    devDependencies: {
      "@testing-library/react": "^16.3.0",
    },
  });
}

async function installFixturePackages(
  rootDir: string,
  versions: { athenaDayPicker?: string; storefrontDayPicker?: string } = {}
) {
  await createPackage(rootDir, "@testing-library/react", "16.3.0");
  await createPackage(rootDir, "lucide-react", "0.525.0");
  await createPackage(
    rootDir,
    "react-day-picker-athena",
    versions.athenaDayPicker ?? "10.0.1"
  );
  await createPackage(
    rootDir,
    "react-day-picker-storefront",
    versions.storefrontDayPicker ?? "10.0.1"
  );

  await mkdir(
    path.join(rootDir, "packages/athena-webapp/node_modules"),
    { recursive: true }
  );
  await mkdir(
    path.join(rootDir, "packages/storefront-webapp/node_modules"),
    { recursive: true }
  );
  await symlink(
    path.relative(
      path.join(rootDir, "packages/athena-webapp/node_modules"),
      path.join(rootDir, "node_modules/react-day-picker-athena")
    ),
    path.join(rootDir, "packages/athena-webapp/node_modules/react-day-picker")
  );
  await symlink(
    path.relative(
      path.join(rootDir, "packages/storefront-webapp/node_modules"),
      path.join(rootDir, "node_modules/react-day-picker-storefront")
    ),
    path.join(rootDir, "packages/storefront-webapp/node_modules/react-day-picker")
  );
}

async function writeFixtureInstaller(rootDir: string) {
  const installerPath = path.join(rootDir, "install-fixture-frontend-deps.js");
  await writeFile(
    installerPath,
    `
const fs = require("node:fs");
const path = require("node:path");

function writeJson(relativePath, value) {
  const filePath = path.join(process.cwd(), relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\\n");
}

function createPackage(folderName, version) {
  writeJson(path.join("node_modules", folderName, "package.json"), {
    name: "react-day-picker",
    version,
  });
}

writeJson(path.join("node_modules", "@testing-library/react/package.json"), {
  name: "@testing-library/react",
  version: "16.3.0",
});
writeJson(path.join("node_modules", "lucide-react/package.json"), {
  name: "lucide-react",
  version: "0.525.0",
});

function linkWorkspacePackage(packageDir, folderName) {
  const linkPath = path.join(process.cwd(), packageDir, "node_modules", "react-day-picker");
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  try {
    fs.rmSync(linkPath, { recursive: true, force: true });
  } catch {}
  fs.symlinkSync(
    path.relative(
      path.dirname(linkPath),
      path.join(process.cwd(), "node_modules", folderName)
    ),
    linkPath
  );
}

createPackage("react-day-picker-athena", "10.0.1");
createPackage("react-day-picker-storefront", "10.0.1");
linkWorkspacePackage("packages/athena-webapp", "react-day-picker-athena");
linkWorkspacePackage("packages/storefront-webapp", "react-day-picker-storefront");
`.trimStart()
  );

  return installerPath;
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((rootDir) =>
      rm(rootDir, { recursive: true, force: true })
    )
  );
});

describe("checkFrontendDependencyParity", () => {
  it("accepts aligned frontend dependencies that satisfy package manifests", async () => {
    const rootDir = await createFixtureRoot();
    await writeFixtureManifests(rootDir);
    await installFixturePackages(rootDir);

    expect(checkFrontendDependencyParity(rootDir)).toEqual([]);
  });

  it("rejects mismatched shared dependency declarations", async () => {
    const rootDir = await createFixtureRoot();
    await writeFixtureManifests(rootDir, "^8.8.2");
    await installFixturePackages(rootDir);

    expect(checkFrontendDependencyParity(rootDir)).toContain(
      "Shared dependency declarations for react-day-picker are not aligned: packages/athena-webapp/package.json dependencies ^10.0.0; packages/storefront-webapp/package.json dependencies ^8.8.2."
    );
  });

  it("rejects stale Athena DayPicker installs even when declarations are aligned", async () => {
    const rootDir = await createFixtureRoot();
    await writeFixtureManifests(rootDir);
    await installFixturePackages(rootDir, { athenaDayPicker: "8.10.1" });

    expect(checkFrontendDependencyParity(rootDir)).toContain(
      "packages/athena-webapp resolves react-day-picker@8.10.1, which does not satisfy ^10.0.0; run bun install --frozen-lockfile before changing wrappers."
    );
  });

  it("rejects missing workspace installs", async () => {
    const rootDir = await createFixtureRoot();
    await writeFixtureManifests(rootDir);

    expect(checkFrontendDependencyParity(rootDir)).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "packages/athena-webapp cannot resolve react-day-picker; run bun install --frozen-lockfile."
        ),
      ])
    );
  });

  it("repairs install drift before pr:athena prepare continues", async () => {
    const rootDir = await createFixtureRoot();
    await writeFixtureManifests(rootDir);
    const installerPath = await writeFixtureInstaller(rootDir);

    assertFrontendDependencyParity(rootDir, {
      installCommand: [process.execPath, installerPath],
      repair: true,
    });

    expect(checkFrontendDependencyParity(rootDir)).toEqual([]);
  });
});
