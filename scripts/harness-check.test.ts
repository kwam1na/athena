import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { validateHarnessDocs } from "./harness-check";

const REQUIRED_INDEX_LINKS = [
  "./architecture.md",
  "./testing.md",
  "./code-map.md",
];

const tempRoots: string[] = [];

async function write(relativePath: string, contents: string, rootDir: string) {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

async function createFixtureRepo() {
  const rootDir = await mkdtemp(path.join(tmpdir(), "athena-harness-check-"));
  tempRoots.push(rootDir);

  await write(
    "packages/AGENTS.md",
    [
      "# Packages Agent Router",
      "",
      "- [Athena webapp](./athena-webapp/AGENTS.md)",
      "- [Storefront webapp](./storefront-webapp/AGENTS.md)",
    ].join("\n"),
    rootDir
  );

  for (const appName of ["athena-webapp", "storefront-webapp"]) {
    await write(
      `packages/${appName}/AGENTS.md`,
      [
        `# ${appName}`,
        "",
        "- [Harness index](./docs/agent/index.md)",
        "- [Architecture](./docs/agent/architecture.md)",
        "- [Testing](./docs/agent/testing.md)",
        "- [Code map](./docs/agent/code-map.md)",
      ].join("\n"),
      rootDir
    );

    await write(
      `packages/${appName}/docs/agent/index.md`,
      [
        `# ${appName} agent docs`,
        "",
        ...REQUIRED_INDEX_LINKS.map((link) => `- [${link}](${link})`),
      ].join("\n"),
      rootDir
    );

    await write(
      `packages/${appName}/docs/agent/architecture.md`,
      "# Architecture\n\nSee [testing](./testing.md).\n",
      rootDir
    );
    await write(
      `packages/${appName}/docs/agent/testing.md`,
      "# Testing\n\nUse the package test command.\n",
      rootDir
    );
    await write(
      `packages/${appName}/docs/agent/code-map.md`,
      "# Code map\n\nStart from [architecture](./architecture.md).\n",
      rootDir
    );
  }

  return rootDir;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((rootDir) => rm(rootDir, { recursive: true, force: true })));
});

describe("validateHarnessDocs", () => {
  it("passes when every required harness file and relative link is present", async () => {
    const rootDir = await createFixtureRepo();

    await expect(validateHarnessDocs(rootDir)).resolves.toEqual([]);
  });

  it("reports missing required harness files", async () => {
    const rootDir = await createFixtureRepo();
    await rm(
      path.join(rootDir, "packages/storefront-webapp/docs/agent/testing.md")
    );

    await expect(validateHarnessDocs(rootDir)).resolves.toContain(
      "Missing required harness file: packages/storefront-webapp/docs/agent/testing.md"
    );
  });

  it("reports broken relative markdown links in harness docs", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/athena-webapp/AGENTS.md",
      "# athena-webapp\n\n- [Broken](./docs/agent/missing.md)\n",
      rootDir
    );

    await expect(validateHarnessDocs(rootDir)).resolves.toContain(
      "Broken markdown link in packages/athena-webapp/AGENTS.md: ./docs/agent/missing.md"
    );
  });

  it("reports missing required core-doc links from an app index", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/storefront-webapp/docs/agent/index.md",
      [
        "# storefront-webapp agent docs",
        "",
        "- [architecture](./architecture.md)",
        "- [code-map](./code-map.md)",
      ].join("\n"),
      rootDir
    );

    await expect(validateHarnessDocs(rootDir)).resolves.toContain(
      "Missing required index link in packages/storefront-webapp/docs/agent/index.md: ./testing.md"
    );
  });
});
