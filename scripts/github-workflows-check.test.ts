import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { collectWorkflowFiles, runWorkflowCheck } from "./github-workflows-check";

const tempRoots: string[] = [];

async function createFixtureRoot() {
  const rootDir = await mkdtemp(path.join(tmpdir(), "athena-workflow-check-"));
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
    tempRoots.splice(0).map((rootDir) =>
      rm(rootDir, { recursive: true, force: true })
    )
  );
});

describe("collectWorkflowFiles", () => {
  it("collects only root GitHub workflow YAML files", async () => {
    const rootDir = await createFixtureRoot();
    await write(".github/workflows/athena-pr-tests.yml", "name: Test\n", rootDir);
    await write(".github/workflows/qa.yaml", "name: QA\n", rootDir);
    await write(".github/workflows/notes.md", "# ignored\n", rootDir);
    await write(".github/workflows/nested/ignored.yml", "name: nested\n", rootDir);

    await expect(collectWorkflowFiles(rootDir)).resolves.toEqual([
      ".github/workflows/athena-pr-tests.yml",
      ".github/workflows/qa.yaml",
    ]);
  });
});

describe("runWorkflowCheck", () => {
  it("parses workflows with Ruby YAML instead of depending on PyYAML", async () => {
    const rootDir = await createFixtureRoot();
    await write(".github/workflows/athena-pr-tests.yml", "name: Test\non: pull_request\n", rootDir);

    const spawnedCommands: string[][] = [];
    const logLines: string[] = [];

    await runWorkflowCheck(rootDir, {
      logger: { log: (line) => logLines.push(line) },
      spawn: (command) => {
        spawnedCommands.push(command);
        return { exited: Promise.resolve(0) };
      },
    });

    expect(spawnedCommands).toEqual([
      [
        "ruby",
        "-ryaml",
        "-e",
        "YAML.load_file(ARGV.fetch(0)); puts \"[workflow:check] parsed #{ARGV.fetch(0)}\"",
        ".github/workflows/athena-pr-tests.yml",
      ],
    ]);
    expect(logLines).toEqual([
      "GitHub workflow YAML check passed for 1 workflow file(s).",
    ]);
  });

  it("fails with the workflow path when YAML parsing fails", async () => {
    const rootDir = await createFixtureRoot();
    await write(".github/workflows/athena-pr-tests.yml", "name: [broken\n", rootDir);

    await expect(
      runWorkflowCheck(rootDir, {
        spawn: () => ({ exited: Promise.resolve(1) }),
      })
    ).rejects.toThrow(
      "GitHub workflow YAML check failed for .github/workflows/athena-pr-tests.yml"
    );
  });

  it("parses the current repo workflows", async () => {
    await expect(
      runWorkflowCheck(path.resolve(import.meta.dirname, ".."))
    ).resolves.toBeUndefined();
  });
});
