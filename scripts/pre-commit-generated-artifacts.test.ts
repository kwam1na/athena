import path from "node:path";
import { describe, expect, it } from "vitest";

import { GRAPHIFY_WIKI_ARTIFACTS } from "./graphify-wiki";
import {
  TRACKED_GENERATED_HARNESS_DOCS,
  TRACKED_GRAPHIFY_ARTIFACTS,
  runPreCommitGeneratedArtifacts,
} from "./pre-commit-generated-artifacts";

describe("runPreCommitGeneratedArtifacts", () => {
  it("regenerates harness docs and graphify artifacts before staging tracked outputs", async () => {
    const steps: string[] = [];

    await runPreCommitGeneratedArtifacts("/repo", {
      runHarnessGenerate: async () => {
        steps.push("harness:generate");
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
      "graphify:rebuild",
      `git add -- ${TRACKED_GRAPHIFY_ARTIFACTS.join(" ")}`,
    ]);
  });

  it("stages only tracked generated artifacts", async () => {
    const commands: string[][] = [];

    await runPreCommitGeneratedArtifacts("/repo", {
      runHarnessGenerate: async () => {},
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
      ["git", "add", "--", ...TRACKED_GRAPHIFY_ARTIFACTS],
    ]);
  });

  it("fails clearly when staging repaired harness docs fails", async () => {
    await expect(
      runPreCommitGeneratedArtifacts("/repo", {
        runHarnessGenerate: async () => {},
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

  it("fails clearly when staging repaired graphify artifacts fails", async () => {
    let spawnCount = 0;

    await expect(
      runPreCommitGeneratedArtifacts("/repo", {
        runHarnessGenerate: async () => {},
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
            stderr: new Response("git add failed").body,
          };
        },
        logger: {
          log() {},
        },
      })
    ).rejects.toThrow("git add failed");
  });

  it("keeps the tracked graphify artifact list aligned with repo outputs", () => {
    expect(TRACKED_GRAPHIFY_ARTIFACTS).toEqual([
      ...GRAPHIFY_WIKI_ARTIFACTS,
      path.join("graphify-out", "GRAPH_REPORT.md"),
      path.join("graphify-out", "graph.json"),
    ]);
  });
});
