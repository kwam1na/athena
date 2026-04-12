import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { GRAPHIFY_REBUILD_SNIPPET, runGraphifyRebuild } from "./graphify-rebuild";

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
    });

    expect(commands).toEqual([
      [path.join(rootDir, "graphify-python"), "-c", GRAPHIFY_REBUILD_SNIPPET],
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
    });

    expect(commands).toEqual([["python3", "-c", GRAPHIFY_REBUILD_SNIPPET]]);
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
