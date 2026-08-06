import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { pinnedBunVersion, runBunVersionCheck } from "./bun-version-check";

const tempRoots: string[] = [];

async function createFixtureRoot() {
  const rootDir = await mkdtemp(path.join(tmpdir(), "athena-bun-version-check-"));
  tempRoots.push(rootDir);
  return rootDir;
}

async function write(relativePath: string, contents: string, rootDir: string) {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((rootDir) => rm(rootDir, { recursive: true, force: true }))
  );
});

describe("pinnedBunVersion", () => {
  it("reads the exact version out of the packageManager pin", async () => {
    const rootDir = await createFixtureRoot();
    await write("package.json", JSON.stringify({ packageManager: "bun@1.1.29" }), rootDir);

    expect(pinnedBunVersion(rootDir)).toBe("1.1.29");
  });

  it("rejects a missing or malformed packageManager pin", async () => {
    const rootDir = await createFixtureRoot();
    await write("package.json", JSON.stringify({}), rootDir);

    expect(() => pinnedBunVersion(rootDir)).toThrow(/must pin an exact bun version/);
  });

  it("rejects a range-based pin instead of an exact version", async () => {
    const rootDir = await createFixtureRoot();
    await write("package.json", JSON.stringify({ packageManager: "bun@^1.1.29" }), rootDir);

    expect(() => pinnedBunVersion(rootDir)).toThrow(/must pin an exact bun version/);
  });
});

describe("runBunVersionCheck", () => {
  it("passes when the installed bun matches the pin", async () => {
    const rootDir = await createFixtureRoot();
    await write("package.json", JSON.stringify({ packageManager: "bun@1.1.29" }), rootDir);

    const logLines: string[] = [];

    expect(() =>
      runBunVersionCheck(rootDir, {
        installedVersion: "1.1.29",
        logger: { log: (line) => logLines.push(line) },
      })
    ).not.toThrow();
    expect(logLines).toEqual([
      "bun version check passed: installed bun 1.1.29 matches the packageManager pin.",
    ]);
  });

  it("fails with a lockfile-drift explanation when the installed bun is newer than the pin", async () => {
    const rootDir = await createFixtureRoot();
    await write("package.json", JSON.stringify({ packageManager: "bun@1.1.29" }), rootDir);

    expect(() =>
      runBunVersionCheck(rootDir, { installedVersion: "1.3.12" })
    ).toThrow(/Installed bun 1\.3\.12 does not match the packageManager pin bun@1\.1\.29/);
  });

  it("fails when the installed bun is older than the pin", async () => {
    const rootDir = await createFixtureRoot();
    await write("package.json", JSON.stringify({ packageManager: "bun@1.1.29" }), rootDir);

    expect(() =>
      runBunVersionCheck(rootDir, { installedVersion: "1.0.0" })
    ).toThrow(/Installed bun 1\.0\.0 does not match the packageManager pin bun@1\.1\.29/);
  });
});
