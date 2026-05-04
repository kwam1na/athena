import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { GRAPHIFY_WIKI_ARTIFACTS } from "./graphify-wiki";
import {
  TRACKED_CONVEX_GENERATED_ARTIFACTS,
  TRACKED_GENERATED_HARNESS_DOCS,
  TRACKED_GRAPHIFY_ARTIFACTS,
  runPreCommitGeneratedArtifacts,
} from "./pre-commit-generated-artifacts";

async function withTempRepo<T>(callback: (repoDir: string) => Promise<T>) {
  const repoDir = await mkdtemp(path.join(tmpdir(), "athena-pre-commit-"));

  try {
    return await callback(repoDir);
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
}

async function writeConvexApiFixture(
  repoDir: string,
  apiSource = 'import type * as catalog_items from "../catalog/items.js";\n'
) {
  const convexDir = path.join(
    repoDir,
    "packages",
    "athena-webapp",
    "convex"
  );
  await mkdir(path.join(convexDir, "catalog"), { recursive: true });
  await mkdir(path.join(convexDir, "_generated"), { recursive: true });
  await writeFile(path.join(convexDir, "catalog", "items.ts"), "export {};\n");
  await writeFile(
    path.join(convexDir, "catalog", "items.test.ts"),
    "export {};\n"
  );
  await writeFile(path.join(convexDir, "_generated", "api.d.ts"), apiSource);
}

describe("runPreCommitGeneratedArtifacts", () => {
  it("regenerates harness docs and graphify artifacts before staging tracked outputs", async () => {
    const steps: string[] = [];

    await runPreCommitGeneratedArtifacts("/repo", {
      runHarnessGenerate: async () => {
        steps.push("harness:generate");
      },
      hasConvexSourceChanges: async () => {
        steps.push("convex:changed?");
        return true;
      },
      refreshConvexGeneratedApi: async () => {
        steps.push("convex:refresh");
      },
      verifyConvexGeneratedApi: async () => {
        steps.push("convex:verify");
      },
      runGraphifyRebuild: async () => {
        steps.push("graphify:rebuild");
      },
      spawn(command) {
        steps.push(command.join(" "));
        return {
          exited: Promise.resolve(0),
          stderr: new Response("").body,
        };
      },
      logger: {
        log() {},
      },
    });

    expect(steps).toEqual([
      "harness:generate",
      `git add -- ${TRACKED_GENERATED_HARNESS_DOCS.join(" ")}`,
      "convex:changed?",
      "convex:refresh",
      "convex:verify",
      `git add -- ${TRACKED_CONVEX_GENERATED_ARTIFACTS.join(" ")}`,
      "graphify:rebuild",
      `git add -- ${TRACKED_GRAPHIFY_ARTIFACTS.join(" ")}`,
      "git add --update -- .",
    ]);
  });

  it("stages generated artifacts before staging the tracked working tree", async () => {
    const commands: string[][] = [];

    await runPreCommitGeneratedArtifacts("/repo", {
      runHarnessGenerate: async () => {},
      hasConvexSourceChanges: async () => false,
      verifyConvexGeneratedApi: async () => {},
      runGraphifyRebuild: async () => {},
      spawn(command) {
        commands.push(command);
        return {
          exited: Promise.resolve(0),
          stderr: new Response("").body,
        };
      },
      logger: {
        log() {},
      },
    });

    expect(commands).toEqual([
      ["git", "add", "--", ...TRACKED_GENERATED_HARNESS_DOCS],
      ["git", "add", "--", ...TRACKED_CONVEX_GENERATED_ARTIFACTS],
      ["git", "add", "--", ...TRACKED_GRAPHIFY_ARTIFACTS],
      ["git", "add", "--update", "--", "."],
    ]);
  });

  it("stages tracked source changes after generated artifacts are refreshed", async () => {
    const commands: string[][] = [];

    await runPreCommitGeneratedArtifacts("/repo", {
      runHarnessGenerate: async () => {},
      hasConvexSourceChanges: async () => false,
      verifyConvexGeneratedApi: async () => {},
      runGraphifyRebuild: async () => {},
      spawn(command) {
        commands.push(command);
        return {
          exited: Promise.resolve(0),
          stderr: new Response("").body,
        };
      },
      logger: {
        log() {},
      },
    });

    expect(commands.at(-1)).toEqual(["git", "add", "--update", "--", "."]);
  });

  it("uses tracked-only staging so untracked local files are left out", async () => {
    const commands: string[][] = [];

    await runPreCommitGeneratedArtifacts("/repo", {
      runHarnessGenerate: async () => {},
      hasConvexSourceChanges: async () => false,
      verifyConvexGeneratedApi: async () => {},
      runGraphifyRebuild: async () => {},
      spawn(command) {
        commands.push(command);
        return {
          exited: Promise.resolve(0),
          stderr: new Response("").body,
        };
      },
      logger: {
        log() {},
      },
    });

    expect(commands).not.toContainEqual(["git", "add", "--", "."]);
    expect(commands).not.toContainEqual(["git", "add", "-A", "--", "."]);
    expect(commands).toContainEqual(["git", "add", "--update", "--", "."]);
  });

  it("fails clearly when staging repaired harness docs fails", async () => {
    await expect(
      runPreCommitGeneratedArtifacts("/repo", {
        runHarnessGenerate: async () => {},
        hasConvexSourceChanges: async () => false,
        verifyConvexGeneratedApi: async () => {},
        runGraphifyRebuild: async () => {},
        spawn() {
          return {
            exited: Promise.resolve(1),
            stderr: new Response("git add harness docs failed").body,
          };
        },
        logger: {
          log() {},
        },
      })
    ).rejects.toThrow("git add harness docs failed");
  });

  it("fails clearly when Convex generated API verification fails", async () => {
    await expect(
      runPreCommitGeneratedArtifacts("/repo", {
        runHarnessGenerate: async () => {},
        hasConvexSourceChanges: async () => false,
        verifyConvexGeneratedApi: async () => {
          throw new Error("convex generated api drift");
        },
        runGraphifyRebuild: async () => {},
        spawn() {
          return {
            exited: Promise.resolve(0),
            stderr: new Response("").body,
          };
        },
        logger: {
          log() {},
        },
      })
    ).rejects.toThrow("convex generated api drift");
  });

  it("fails clearly when Convex generated API refresh fails", async () => {
    await expect(
      runPreCommitGeneratedArtifacts("/repo", {
        runHarnessGenerate: async () => {},
        hasConvexSourceChanges: async () => true,
        refreshConvexGeneratedApi: async () => {
          throw new Error("convex refresh failed");
        },
        verifyConvexGeneratedApi: async () => {},
        runGraphifyRebuild: async () => {},
        spawn() {
          return {
            exited: Promise.resolve(0),
            stderr: new Response("").body,
          };
        },
        logger: {
          log() {},
        },
      })
    ).rejects.toThrow("convex refresh failed");
  });

  it("refreshes the Convex generated API by default when source changed", async () => {
    await withTempRepo(async (repoDir) => {
      await writeConvexApiFixture(repoDir);
      const commands: Array<{ command: string[]; cwd: string; stdout: string }> = [];

      await runPreCommitGeneratedArtifacts(repoDir, {
        runHarnessGenerate: async () => {},
        runGraphifyRebuild: async () => {},
        spawn(command, options) {
          commands.push({ command, cwd: options.cwd, stdout: options.stdout });

          if (command[0] === "git" && command[1] === "status") {
            return {
              exited: Promise.resolve(0),
              stdout: new Response(
                " M packages/athena-webapp/convex/catalog/items.ts\n"
              ).body,
              stderr: new Response("").body,
            };
          }

          return {
            exited: Promise.resolve(0),
            stdout: new Response("").body,
            stderr: new Response("").body,
          };
        },
        logger: {
          log() {},
        },
      });

      expect(commands).toContainEqual({
        command: ["git", "status", "--porcelain", "--", "packages/athena-webapp/convex"],
        cwd: repoDir,
        stdout: "pipe",
      });
      expect(commands).toContainEqual({
        command: ["bunx", "convex", "dev", "--once"],
        cwd: path.join(repoDir, "packages", "athena-webapp"),
        stdout: "inherit",
      });
    });
  });

  it("does not refresh the Convex generated API for generated-only drift", async () => {
    await withTempRepo(async (repoDir) => {
      await writeConvexApiFixture(repoDir);
      const commands: string[] = [];

      await runPreCommitGeneratedArtifacts(repoDir, {
        runHarnessGenerate: async () => {},
        runGraphifyRebuild: async () => {},
        spawn(command, options) {
          commands.push(command.join(" "));

          if (command[0] === "git" && command[1] === "status") {
            return {
              exited: Promise.resolve(0),
              stdout: new Response(
                " M packages/athena-webapp/convex/_generated/api.d.ts\n"
              ).body,
              stderr: new Response("").body,
            };
          }

          return {
            exited: Promise.resolve(0),
            stdout: new Response("").body,
            stderr: new Response("").body,
          };
        },
        logger: {
          log() {},
        },
      });

      expect(commands).not.toContain("bunx convex dev --once");
    });
  });

  it("fails when default Convex generated API verification misses a source module", async () => {
    await withTempRepo(async (repoDir) => {
      await writeConvexApiFixture(repoDir, "");

      await expect(
        runPreCommitGeneratedArtifacts(repoDir, {
          runHarnessGenerate: async () => {},
          runGraphifyRebuild: async () => {},
          spawn(command) {
            if (command[0] === "git" && command[1] === "status") {
              return {
                exited: Promise.resolve(0),
                stdout: new Response("").body,
                stderr: new Response("").body,
              };
            }

            return {
              exited: Promise.resolve(0),
              stdout: new Response("").body,
              stderr: new Response("").body,
            };
          },
          logger: {
            log() {},
          },
        })
      ).rejects.toThrow(/catalog\/items[\s\S]+bunx convex dev --once/);
    });
  });

  it("fails clearly when default Convex source inspection fails", async () => {
    await withTempRepo(async (repoDir) => {
      await writeConvexApiFixture(repoDir);

      await expect(
        runPreCommitGeneratedArtifacts(repoDir, {
          runHarnessGenerate: async () => {},
          runGraphifyRebuild: async () => {},
          spawn(command) {
            if (command[0] === "git" && command[1] === "status") {
              return {
                exited: Promise.resolve(1),
                stdout: new Response("").body,
                stderr: new Response("status failed").body,
              };
            }

            return {
              exited: Promise.resolve(0),
              stdout: new Response("").body,
              stderr: new Response("").body,
            };
          },
          logger: {
            log() {},
          },
        })
      ).rejects.toThrow("status failed");
    });
  });

  it("fails clearly when staging repaired Convex generated API fails", async () => {
    let spawnCount = 0;

    await expect(
      runPreCommitGeneratedArtifacts("/repo", {
        runHarnessGenerate: async () => {},
        hasConvexSourceChanges: async () => false,
        verifyConvexGeneratedApi: async () => {},
        runGraphifyRebuild: async () => {},
        spawn() {
          spawnCount += 1;
          if (spawnCount === 1) {
            return {
              exited: Promise.resolve(0),
              stderr: new Response("").body,
            };
          }
          return {
            exited: Promise.resolve(1),
            stderr: new Response("git add convex failed").body,
          };
        },
        logger: {
          log() {},
        },
      })
    ).rejects.toThrow("git add convex failed");
  });

  it("fails clearly when staging repaired graphify artifacts fails", async () => {
    let spawnCount = 0;

    await expect(
      runPreCommitGeneratedArtifacts("/repo", {
        runHarnessGenerate: async () => {},
        hasConvexSourceChanges: async () => false,
        verifyConvexGeneratedApi: async () => {},
        runGraphifyRebuild: async () => {},
        spawn() {
          spawnCount += 1;
          if (spawnCount < 3) {
            return {
              exited: Promise.resolve(0),
              stderr: new Response("").body,
            };
          }
          return {
            exited: Promise.resolve(1),
            stderr: new Response("git add failed").body,
          };
        },
        logger: {
          log() {},
        },
      })
    ).rejects.toThrow("git add failed");
  });

  it("fails clearly when staging tracked working-tree changes fails", async () => {
    let spawnCount = 0;

    await expect(
      runPreCommitGeneratedArtifacts("/repo", {
        runHarnessGenerate: async () => {},
        hasConvexSourceChanges: async () => false,
        verifyConvexGeneratedApi: async () => {},
        runGraphifyRebuild: async () => {},
        spawn() {
          spawnCount += 1;
          if (spawnCount < 4) {
            return {
              exited: Promise.resolve(0),
              stderr: new Response("").body,
            };
          }
          return {
            exited: Promise.resolve(1),
            stderr: new Response("git add --update failed").body,
          };
        },
        logger: {
          log() {},
        },
      })
    ).rejects.toThrow("git add --update failed");
  });

  it("includes the tracked working-tree staging command when git fails without stderr", async () => {
    let spawnCount = 0;

    await expect(
      runPreCommitGeneratedArtifacts("/repo", {
        runHarnessGenerate: async () => {},
        hasConvexSourceChanges: async () => false,
        verifyConvexGeneratedApi: async () => {},
        runGraphifyRebuild: async () => {},
        spawn() {
          spawnCount += 1;
          if (spawnCount < 4) {
            return {
              exited: Promise.resolve(0),
              stderr: new Response("").body,
            };
          }
          return {
            exited: Promise.resolve(1),
            stderr: new Response("").body,
          };
        },
        logger: {
          log() {},
        },
      })
    ).rejects.toThrow(
      "Failed to stage tracked working-tree changes (exit 1): git add --update -- ."
    );
  });

  it("keeps the tracked Convex generated API list aligned with repo outputs", () => {
    expect(TRACKED_CONVEX_GENERATED_ARTIFACTS).toEqual([
      path.join("packages", "athena-webapp", "convex", "_generated", "api.d.ts"),
      path.join("packages", "athena-webapp", "convex", "_generated", "api.js"),
      path.join("packages", "athena-webapp", "convex", "_generated", "dataModel.d.ts"),
      path.join("packages", "athena-webapp", "convex", "_generated", "server.d.ts"),
      path.join("packages", "athena-webapp", "convex", "_generated", "server.js"),
    ]);
  });

  it("keeps the tracked graphify artifact list aligned with repo outputs", () => {
    expect(TRACKED_GRAPHIFY_ARTIFACTS).toEqual([
      ...GRAPHIFY_WIKI_ARTIFACTS,
      path.join("graphify-out", "GRAPH_REPORT.md"),
      path.join("graphify-out", "graph.json"),
    ]);
  });
});
