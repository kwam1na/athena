import path from "node:path";
import { describe, expect, it } from "vitest";

import { GRAPHIFY_WIKI_ARTIFACTS } from "./graphify-wiki";
import {
  GENERATED_HARNESS_DOC_ARTIFACTS,
  TRACKED_GRAPHIFY_ARTIFACTS,
  runPreCommitGeneratedArtifacts,
} from "./pre-commit-generated-artifacts";

describe("runPreCommitGeneratedArtifacts", () => {
  it("regenerates and stages harness docs before rebuilding graphify artifacts", async () => {
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
      `git add -- ${GENERATED_HARNESS_DOC_ARTIFACTS.join(" ")}`,
      "graphify:rebuild",
      `git add -- ${TRACKED_GRAPHIFY_ARTIFACTS.join(" ")}`,
    ]);
  });

  it("stages only generated harness docs and tracked graphify artifacts", async () => {
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
      ["git", "add", "--", ...GENERATED_HARNESS_DOC_ARTIFACTS],
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
            stderr: new Response("harness git add failed").body,
          };
        },
        logger: {
          log() {},
        },
      })
    ).rejects.toThrow("harness git add failed");
  });

  it("fails clearly when staging repaired graphify artifacts fails", async () => {
    let spawnCalls = 0;

    await expect(
      runPreCommitGeneratedArtifacts("/repo", {
        runHarnessGenerate: async () => {},
        runGraphifyRebuild: async () => {},
        spawn() {
          spawnCalls += 1;
          return {
            exited: Promise.resolve(spawnCalls === 1 ? 0 : 1),
            stderr: new Response(spawnCalls === 1 ? "" : "git add failed").body,
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

  it("keeps generated harness docs aligned with registered app outputs", () => {
    expect(GENERATED_HARNESS_DOC_ARTIFACTS).toContain(
      path.join("packages", "athena-webapp", "docs", "agent", "test-index.md")
    );
    expect(GENERATED_HARNESS_DOC_ARTIFACTS).toContain(
      path.join("packages", "storefront-webapp", "docs", "agent", "test-index.md")
    );
    expect(GENERATED_HARNESS_DOC_ARTIFACTS).toContain(
      path.join("packages", "valkey-proxy-server", "docs", "agent", "entry-index.md")
    );
  });
});
