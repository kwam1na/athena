import path from "node:path";
import { describe, expect, it } from "vitest";

import { GRAPHIFY_WIKI_ARTIFACTS } from "./graphify-wiki";
import {
  TRACKED_GRAPHIFY_ARTIFACTS,
  runPreCommitGeneratedArtifacts,
} from "./pre-commit-generated-artifacts";

describe("runPreCommitGeneratedArtifacts", () => {
  it("rebuilds graphify artifacts before staging tracked graphify outputs", async () => {
    const steps: string[] = [];

    await runPreCommitGeneratedArtifacts("/repo", {
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
      "graphify:rebuild",
      `git add -- ${TRACKED_GRAPHIFY_ARTIFACTS.join(" ")}`,
    ]);
  });

  it("stages only tracked graphify artifacts", async () => {
    const commands: string[][] = [];

    await runPreCommitGeneratedArtifacts("/repo", {
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
      ["git", "add", "--", ...TRACKED_GRAPHIFY_ARTIFACTS],
    ]);
  });

  it("fails clearly when staging repaired graphify artifacts fails", async () => {
    await expect(
      runPreCommitGeneratedArtifacts("/repo", {
        runGraphifyRebuild: async () => {},
        spawn() {
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
