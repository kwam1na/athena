import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runGraphifyCheck } from "./graphify-check";
import { GRAPHIFY_WIKI_ARTIFACTS } from "./graphify-wiki";

const tempRoots: string[] = [];

async function write(relativePath: string, contents: string, rootDir: string) {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

async function createFixtureRoot() {
  const rootDir = await mkdtemp(path.join(tmpdir(), "athena-graphify-check-"));
  tempRoots.push(rootDir);
  await write("packages/example/src/main.ts", "export const value = 1;\n", rootDir);
  return rootDir;
}

async function writeGraphifyWikiArtifacts(rootDir: string, variant: "fresh" | "stale") {
  for (const artifactPath of GRAPHIFY_WIKI_ARTIFACTS) {
    await write(
      artifactPath,
      `${variant === "fresh" ? "fresh" : "stale"} ${path.basename(artifactPath)}\n`,
      rootDir
    );
  }
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((rootDir) =>
      rm(rootDir, { recursive: true, force: true })
    )
  );
});

describe("runGraphifyCheck", () => {
  it("retains the private interpreter while rebuilding in a scratch workspace", async () => {
    const rootDir = await createFixtureRoot();
    const interpreter = path.join(rootDir, "node_modules/.bin/python3");
    await write(
      "node_modules/.bin/python3",
      '#!/bin/sh\n[ -f packages/example/src/main.ts ] || exit 24\n[ ! -e node_modules ] || exit 25\nprintf "PRIVATE_GRAPHIFY_INTERPRETER:%s\\n" "$PWD" >&2\nexit 23\n',
      rootDir,
    );
    await chmod(interpreter, 0o755);
    await write(".graphify_python", "/missing/author/python3\n", rootDir);
    const previous = process.env.ATHENA_GRAPHIFY_PYTHON;
    process.env.ATHENA_GRAPHIFY_PYTHON = "private";
    try {
      await expect(runGraphifyCheck(rootDir)).rejects.toThrow(
        "PRIVATE_GRAPHIFY_INTERPRETER:",
      );
    } finally {
      if (previous === undefined) delete process.env.ATHENA_GRAPHIFY_PYTHON;
      else process.env.ATHENA_GRAPHIFY_PYTHON = previous;
    }
  });

  it("passes when tracked graphify artifacts match a fresh rebuild", async () => {
    const rootDir = await createFixtureRoot();
    await write("graphify-out/GRAPH_REPORT.md", "fresh report\n", rootDir);
    await write("graphify-out/graph.json", '{"fresh":true}\n', rootDir);
    await writeGraphifyWikiArtifacts(rootDir, "fresh");

    await expect(
      runGraphifyCheck(rootDir, {
        runGraphifyRebuild: async (workspaceRoot) => {
          await write("graphify-out/GRAPH_REPORT.md", "fresh report\n", workspaceRoot);
          await write("graphify-out/graph.json", '{"fresh":true}\n', workspaceRoot);
          await writeGraphifyWikiArtifacts(workspaceRoot, "fresh");
        },
      })
    ).resolves.toBeUndefined();
  });

  it("fails with repair guidance when tracked graphify artifacts are stale", async () => {
    const rootDir = await createFixtureRoot();
    await write("graphify-out/GRAPH_REPORT.md", "stale report\n", rootDir);
    await write("graphify-out/graph.json", '{"stale":true}\n', rootDir);
    await writeGraphifyWikiArtifacts(rootDir, "stale");

    await expect(
      runGraphifyCheck(rootDir, {
        runGraphifyRebuild: async (workspaceRoot) => {
          await write("graphify-out/GRAPH_REPORT.md", "fresh report\n", workspaceRoot);
          await write("graphify-out/graph.json", '{"fresh":true}\n', workspaceRoot);
          await writeGraphifyWikiArtifacts(workspaceRoot, "fresh");
        },
      })
    ).rejects.toThrow("bun run graphify:rebuild");
  });

  it("fails when wiki artifacts drift even if the graph report stays fresh", async () => {
    const rootDir = await createFixtureRoot();
    await write("graphify-out/GRAPH_REPORT.md", "fresh report\n", rootDir);
    await write("graphify-out/graph.json", '{"fresh":true}\n', rootDir);
    await writeGraphifyWikiArtifacts(rootDir, "stale");

    await expect(
      runGraphifyCheck(rootDir, {
        runGraphifyRebuild: async (workspaceRoot) => {
          await write("graphify-out/GRAPH_REPORT.md", "fresh report\n", workspaceRoot);
          await write("graphify-out/graph.json", '{"fresh":true}\n', workspaceRoot);
          await writeGraphifyWikiArtifacts(workspaceRoot, "fresh");
        },
      })
    ).rejects.toThrow("graphify-out/wiki/index.md");
  });

  it("does not rewrite tracked artifacts while performing the check", async () => {
    const rootDir = await createFixtureRoot();
    await write("graphify-out/GRAPH_REPORT.md", "original report\n", rootDir);
    await write("graphify-out/graph.json", '{"original":true}\n', rootDir);

    await expect(
      runGraphifyCheck(rootDir, {
        runGraphifyRebuild: async (workspaceRoot) => {
          await write("graphify-out/GRAPH_REPORT.md", "new report\n", workspaceRoot);
          await write("graphify-out/graph.json", '{"new":true}\n', workspaceRoot);
        },
      })
    ).rejects.toThrow();

    await expect(
      readFile(path.join(rootDir, "graphify-out/GRAPH_REPORT.md"), "utf8")
    ).resolves.toBe("original report\n");
    await expect(
      readFile(path.join(rootDir, "graphify-out/graph.json"), "utf8")
    ).resolves.toBe('{"original":true}\n');
  });

  it("ignores generated storybook-static outputs when preparing graphify check inputs", async () => {
    const rootDir = await createFixtureRoot();
    await write("packages/athena-webapp/storybook-static/mock.js", "export const generated = true;\n", rootDir);
    await write("graphify-out/GRAPH_REPORT.md", "clean report\n", rootDir);
    await write("graphify-out/graph.json", '{"clean":true}\n', rootDir);
    await writeGraphifyWikiArtifacts(rootDir, "fresh");

    await expect(
      runGraphifyCheck(rootDir, {
        runGraphifyRebuild: async (workspaceRoot) => {
          const generatedPath = path.join(
            workspaceRoot,
            "packages/athena-webapp/storybook-static/mock.js"
          );

          try {
            await readFile(generatedPath, "utf8");
            await write("graphify-out/GRAPH_REPORT.md", "generated report\n", workspaceRoot);
            await write("graphify-out/graph.json", '{"generated":true}\n', workspaceRoot);
          } catch {
            await write("graphify-out/GRAPH_REPORT.md", "clean report\n", workspaceRoot);
            await write("graphify-out/graph.json", '{"clean":true}\n', workspaceRoot);
          }

          await writeGraphifyWikiArtifacts(workspaceRoot, "fresh");
        },
      })
    ).resolves.toBeUndefined();
  });

  it("ignores generated validation artifacts when preparing graphify check inputs", async () => {
    const rootDir = await createFixtureRoot();
    await write(
      "artifacts/harness-inferential-review/generated.ts",
      "export const generated = true;\n",
      rootDir
    );
    await write("graphify-out/GRAPH_REPORT.md", "clean report\n", rootDir);
    await write("graphify-out/graph.json", '{"clean":true}\n', rootDir);
    await writeGraphifyWikiArtifacts(rootDir, "fresh");

    await expect(
      runGraphifyCheck(rootDir, {
        runGraphifyRebuild: async (workspaceRoot) => {
          const generatedPath = path.join(
            workspaceRoot,
            "artifacts/harness-inferential-review/generated.ts"
          );

          try {
            await readFile(generatedPath, "utf8");
            await write("graphify-out/GRAPH_REPORT.md", "generated report\n", workspaceRoot);
            await write("graphify-out/graph.json", '{"generated":true}\n', workspaceRoot);
          } catch {
            await write("graphify-out/GRAPH_REPORT.md", "clean report\n", workspaceRoot);
            await write("graphify-out/graph.json", '{"clean":true}\n', workspaceRoot);
          }

          await writeGraphifyWikiArtifacts(workspaceRoot, "fresh");
        },
      })
    ).resolves.toBeUndefined();
  });
});
