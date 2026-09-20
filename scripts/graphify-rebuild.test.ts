import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  GRAPHIFY_REBUILD_SNIPPET,
  normalizeGraphJsonContents,
  runGraphifyRebuild,
  resolveGraphifyPython,
} from "./graphify-rebuild";

const tempRoots: string[] = [];
let inheritedGraphifyPython: string | undefined;

beforeEach(() => {
  // Each fixture chooses its own mode. Private-mode cases opt in explicitly;
  // legacy interpreter tests must not inherit the native harness selection.
  inheritedGraphifyPython = process.env.ATHENA_GRAPHIFY_PYTHON;
  delete process.env.ATHENA_GRAPHIFY_PYTHON;
});

async function write(relativePath: string, contents: string, rootDir: string) {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

async function createFixtureRoot() {
  const rootDir = await mkdtemp(
    path.join(tmpdir(), "athena-graphify-rebuild-"),
  );
  tempRoots.push(rootDir);
  return rootDir;
}

afterEach(async () => {
  try {
    await Promise.all(
      tempRoots
        .splice(0)
        .map((rootDir) => rm(rootDir, { recursive: true, force: true })),
    );
  } finally {
    if (inheritedGraphifyPython === undefined) delete process.env.ATHENA_GRAPHIFY_PYTHON;
    else process.env.ATHENA_GRAPHIFY_PYTHON = inheritedGraphifyPython;
  }
});

describe("runGraphifyRebuild", () => {
  it("validates the original private interpreter but generates only in scratch space", async () => {
    const rootDir = await createFixtureRoot();
    const workspaceRoot = await createFixtureRoot();
    await write("node_modules/.bin/python3", "private wrapper", rootDir);
    const previous = process.env.ATHENA_GRAPHIFY_PYTHON;
    process.env.ATHENA_GRAPHIFY_PYTHON = "private";
    const commands: Array<{ command: string[]; cwd: string }> = [];
    const wikiRoots: string[] = [];
    try {
      await runGraphifyRebuild(workspaceRoot, {
        interpreterRootDir: rootDir,
        spawn(command, options) {
          commands.push({ command, cwd: options.cwd });
          return { exited: Promise.resolve(0) };
        },
        writeGraphifyWikiPages: async root => { wikiRoots.push(root); },
      });
      expect(commands).toEqual([{
        command: [path.join(rootDir, "node_modules/.bin/python3"), "-c", GRAPHIFY_REBUILD_SNIPPET],
        cwd: workspaceRoot,
      }]);
      expect(wikiRoots).toEqual([workspaceRoot]);
      await expect(readFile(path.join(workspaceRoot, "node_modules/.bin/python3"))).rejects.toThrow();
      expect(await readFile(path.join(rootDir, "node_modules/.bin/python3"), "utf8")).toBe("private wrapper");
    } finally {
      if (previous === undefined) delete process.env.ATHENA_GRAPHIFY_PYTHON;
      else process.env.ATHENA_GRAPHIFY_PYTHON = previous;
    }
  });

  it.each(["missing", "external symlink"])("refuses a %s private interpreter before spawning in scratch space", async kind => {
    const rootDir = await createFixtureRoot();
    const workspaceRoot = await createFixtureRoot();
    await write("author-python", "author dependency", workspaceRoot);
    await write(".graphify_python", `${path.join(workspaceRoot, "author-python")}\n`, rootDir);
    if (kind === "external symlink") {
      await mkdir(path.join(rootDir, "node_modules/.bin"), { recursive: true });
      await symlink(path.join(workspaceRoot, "author-python"), path.join(rootDir, "node_modules/.bin/python3"));
    }
    const previous = process.env.ATHENA_GRAPHIFY_PYTHON;
    process.env.ATHENA_GRAPHIFY_PYTHON = "private";
    let spawned = false;
    try {
      await expect(runGraphifyRebuild(workspaceRoot, {
        interpreterRootDir: rootDir,
        spawn() { spawned = true; return { exited: Promise.resolve(0) }; },
      })).rejects.toThrow();
      expect(spawned).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.ATHENA_GRAPHIFY_PYTHON;
      else process.env.ATHENA_GRAPHIFY_PYTHON = previous;
    }
  });

  it("resets graphify cache before extraction to avoid cross-version drift", () => {
    expect(GRAPHIFY_REBUILD_SNIPPET).toContain("import shutil");
    expect(GRAPHIFY_REBUILD_SNIPPET).toContain("cache_dir = out / 'cache'");
    expect(GRAPHIFY_REBUILD_SNIPPET).toContain("shutil.rmtree(cache_dir)");
  });

  it("skips generated storybook-static outputs during graph extraction", () => {
    expect(GRAPHIFY_REBUILD_SNIPPET).toContain("'storybook-static'");
  });

  it("skips generated validation artifacts during graph extraction", () => {
    expect(GRAPHIFY_REBUILD_SNIPPET).toContain("'artifacts'");
  });

  it("normalizes date-bearing report headers for stable freshness checks", () => {
    expect(GRAPHIFY_REBUILD_SNIPPET).toContain("import re");
    expect(GRAPHIFY_REBUILD_SNIPPET).toContain("report_lines[0] = re.sub(");
    expect(GRAPHIFY_REBUILD_SNIPPET).toContain(
      "normalized_report = '\\n'.join(line.rstrip() for line in report_lines)",
    );
  });

  it("uses the repo-pinned graphify python when available", async () => {
    const rootDir = await createFixtureRoot();
    await write("graphify-python", "", rootDir);
    await write(
      ".graphify_python",
      `${path.join(rootDir, "graphify-python")}\n`,
      rootDir,
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
    const spawnOptions: Array<{
      cwd: string;
      env?: Record<string, string | undefined>;
    }> = [];

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
        2,
      ),
      rootDir,
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
      readFile(path.join(rootDir, "graphify-out/graph.json"), "utf8"),
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
        }),
      ),
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
      }),
    ).rejects.toThrow("graphify exploded");
  });
});

it("uses only the private interpreter when native validation requests it", async () => {
  const rootDir = await createFixtureRoot();
  await write(".graphify_python", "/usr/bin/python3\n", rootDir);
  const env = { ATHENA_GRAPHIFY_PYTHON: "private" };
  await expect(resolveGraphifyPython(rootDir, env)).rejects.toThrow();
  await write("node_modules/.bin/python3", "#!/bin/sh\n", rootDir);
  expect(await resolveGraphifyPython(rootDir, env)).toBe(
    path.join(rootDir, "node_modules/.bin/python3"),
  );
  expect(await readFile(path.join(rootDir, ".graphify_python"), "utf8")).toBe(
    "/usr/bin/python3\n",
  );
  await expect(
    resolveGraphifyPython(rootDir, { ATHENA_GRAPHIFY_PYTHON: "/tmp/other" }),
  ).rejects.toThrow();
});
