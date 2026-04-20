import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  GRAPHIFY_REBUILD_SNIPPET,
  normalizeGraphJsonContents,
  runGraphifyRebuild,
} from "./graphify-rebuild";

const tempRoots: string[] = [];

async function write(relativePath: string, contents: string, rootDir: string) {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

async function createFixtureRoot() {
  const rootDir = await mkdtemp(path.join(tmpdir(), "athena-graphify-rebuild-"));
  tempRoots.push(rootDir);
  return rootDir;
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((rootDir) =>
      rm(rootDir, { recursive: true, force: true })
    )
  );
});

describe("runGraphifyRebuild", () => {
  it("resets graphify cache before extraction to avoid cross-version drift", () => {
    expect(GRAPHIFY_REBUILD_SNIPPET).toContain("import shutil");
    expect(GRAPHIFY_REBUILD_SNIPPET).toContain("cache_dir = out / 'cache'");
    expect(GRAPHIFY_REBUILD_SNIPPET).toContain("shutil.rmtree(cache_dir)");
  });

  it("skips generated storybook-static outputs during graph extraction", () => {
    expect(GRAPHIFY_REBUILD_SNIPPET).toContain("'storybook-static'");
  });

  it("normalizes date-bearing report headers for stable freshness checks", () => {
    expect(GRAPHIFY_REBUILD_SNIPPET).toContain("import re");
    expect(GRAPHIFY_REBUILD_SNIPPET).toContain("report_lines[0] = re.sub(");
    expect(GRAPHIFY_REBUILD_SNIPPET).toContain(
      "normalized_report = '\\n'.join(line.rstrip() for line in report_lines)"
    );
  });

  it("uses the repo-pinned graphify python when available", async () => {
    const rootDir = await createFixtureRoot();
    await write("graphify-python", "", rootDir);
    await write(
      ".graphify_python",
      `${path.join(rootDir, "graphify-python")}\n`,
      rootDir
    );

    const commands: string[][] = [];

    await runGraphifyRebuild(rootDir, {
      spawn(command) {
        commands.push(command);
        return {
          exited: Promise.resolve(0),
          stderr: new ReadableStream(),
        };
      },
      writeGraphifyWikiPages: async () => {},
    });

    expect(commands).toEqual([
      [path.join(rootDir, "graphify-python"), "-c", GRAPHIFY_REBUILD_SNIPPET],
    ]);
  });

  it("pins PYTHONHASHSEED for deterministic graphify subprocess output", async () => {
    const rootDir = await createFixtureRoot();
    const spawnOptions: Array<{ cwd: string; env?: Record<string, string | undefined> }> = [];

    await runGraphifyRebuild(rootDir, {
      spawn(_command, options) {
        spawnOptions.push(options);
        return {
          exited: Promise.resolve(0),
          stderr: new ReadableStream(),
        };
      },
      writeGraphifyWikiPages: async () => {},
    });

    expect(spawnOptions).toEqual([
      {
        cwd: rootDir,
        env: expect.objectContaining({
          PYTHONHASHSEED: "0",
        }),
      },
    ]);
  });

  it("falls back to python3 when no pinned graphify python is configured", async () => {
    const rootDir = await createFixtureRoot();
    const commands: string[][] = [];

    await runGraphifyRebuild(rootDir, {
      spawn(command) {
        commands.push(command);
        return {
          exited: Promise.resolve(0),
          stderr: new ReadableStream(),
        };
      },
      writeGraphifyWikiPages: async () => {},
    });

    expect(commands).toEqual([["python3", "-c", GRAPHIFY_REBUILD_SNIPPET]]);
  });

  it("falls back to python3 when the pinned graphify python path does not exist", async () => {
    const rootDir = await createFixtureRoot();
    await write(".graphify_python", "/tmp/missing-graphify-python\n", rootDir);

    const commands: string[][] = [];

    await runGraphifyRebuild(rootDir, {
      spawn(command) {
        commands.push(command);
        return {
          exited: Promise.resolve(0),
          stderr: new ReadableStream(),
        };
      },
      writeGraphifyWikiPages: async () => {},
    });

    expect(commands).toEqual([["python3", "-c", GRAPHIFY_REBUILD_SNIPPET]]);
  });

  it("writes graphify wiki pages after a successful rebuild", async () => {
    const rootDir = await createFixtureRoot();
    const writes: string[] = [];

    await runGraphifyRebuild(rootDir, {
      spawn() {
        return {
          exited: Promise.resolve(0),
          stderr: new ReadableStream(),
        };
      },
      writeGraphifyWikiPages: async (receivedRootDir) => {
        writes.push(receivedRootDir);
      },
    });

    expect(writes).toEqual([rootDir]);
  });

  it("normalizes graph.json into a deterministic order after rebuild", async () => {
    const rootDir = await createFixtureRoot();
    await write(
      "graphify-out/graph.json",
      JSON.stringify(
        {
          multigraph: false,
          directed: false,
          graph: { z: 1, a: 2 },
          nodes: [
            { label: "zeta", id: "z-node" },
            { id: "a-node", label: "alpha" },
          ],
          links: [
            { target: "z-node", relation: "contains", source: "b-node" },
            { relation: "contains", source: "a-node", target: "a-node" },
          ],
          hyperedges: [{ z: 1, a: 2 }, { a: 1 }],
        },
        null,
        2
      ),
      rootDir
    );

    await runGraphifyRebuild(rootDir, {
      spawn() {
        return {
          exited: Promise.resolve(0),
          stderr: new ReadableStream(),
        };
      },
      writeGraphifyWikiPages: async () => {},
    });

    await expect(
      readFile(path.join(rootDir, "graphify-out/graph.json"), "utf8")
    ).resolves.toBe(`{
  "directed": false,
  "graph": {
    "a": 2,
    "z": 1
  },
  "hyperedges": [
    {
      "a": 1
    },
    {
      "a": 2,
      "z": 1
    }
  ],
  "links": [
    {
      "relation": "contains",
      "source": "a-node",
      "target": "a-node"
    },
    {
      "relation": "contains",
      "source": "b-node",
      "target": "z-node"
    }
  ],
  "multigraph": false,
  "nodes": [
    {
      "id": "a-node",
      "label": "alpha"
    },
    {
      "id": "z-node",
      "label": "zeta"
    }
  ]
}
`);
  });

  it("sorts graph.json keys and lists with locale-independent ordering", () => {
    expect(
      normalizeGraphJsonContents(
        JSON.stringify({
          graph: {
            a: 1,
            _: 1,
            A: 1,
          },
          nodes: [
            { id: "a-node", label: "lower" },
            { id: "_-node", label: "underscore" },
            { id: "A-node", label: "upper" },
          ],
        })
      )
    ).toBe(`{
  "graph": {
    "A": 1,
    "_": 1,
    "a": 1
  },
  "nodes": [
    {
      "id": "A-node",
      "label": "upper"
    },
    {
      "id": "_-node",
      "label": "underscore"
    },
    {
      "id": "a-node",
      "label": "lower"
    }
  ]
}
`);
  });

  it("surfaces stderr when the graphify rebuild command fails", async () => {
    const rootDir = await createFixtureRoot();
    await write(".graphify_python", "/tmp/graphify-python\n", rootDir);

    await expect(
      runGraphifyRebuild(rootDir, {
        spawn() {
          return {
            exited: Promise.resolve(1),
            stderr: new Response("graphify exploded\n").body!,
          };
        },
      })
    ).rejects.toThrow("graphify exploded");
  });
});
