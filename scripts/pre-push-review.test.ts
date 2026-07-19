import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import * as prePushReview from "./pre-push-review";

const ROOT_DIR = path.resolve(import.meta.dirname, "..");
const ATHENA_GENERATED_DOC_PATHS = [
  "packages/athena-webapp/docs/agent/route-index.md",
  "packages/athena-webapp/docs/agent/test-index.md",
  "packages/athena-webapp/docs/agent/key-folder-index.md",
] as const;
const EXPIRED_PROOF_OPTIONS = {
  evaluatePrePushValidationProof: async () => ({
    reusable: false as const,
    status: "stale" as const,
    reason: "test proof disabled",
  }),
  runDocumentationCheck: async () => {},
};

describe("pre-push review wiring", () => {
  it("exports testable helpers for pre-push orchestration", () => {
    expect(typeof prePushReview.getChangedFilesVsOriginMain).toBe("function");
    expect(typeof prePushReview.runDocumentationCheck).toBe("function");
    expect(typeof prePushReview.runPrePushReview).toBe("function");
  });

  it("returns changed files from origin/main diff output", async () => {
    const commands: string[][] = [];

    const files = await prePushReview.getChangedFilesVsOriginMain(
      ROOT_DIR,
      (command) => {
        commands.push(command);

        if (command[1] === "rev-parse") {
          return {
            exited: Promise.resolve(0),
            stdout: new Response("").body,
            stderr: new Response("").body,
          };
        }

        return {
          exited: Promise.resolve(0),
          stdout: new Response(
            "packages/athena-webapp/src/main.tsx\npackages/storefront-webapp/src/router.tsx\n",
          ).body,
          stderr: new Response("").body,
        };
      },
    );

    expect(files).toEqual([
      "packages/athena-webapp/src/main.tsx",
      "packages/storefront-webapp/src/router.tsx",
    ]);
    expect(commands).toEqual([
      ["git", "rev-parse", "--verify", "origin/main"],
      ["git", "diff", "--name-only", "origin/main...HEAD"],
    ]);
  });

  it("fails closed when origin/main is not reachable", async () => {
    await expect(
      prePushReview.getChangedFilesVsOriginMain(ROOT_DIR, () => ({
        exited: Promise.resolve(1),
        stdout: new Response("").body,
        stderr: new Response("missing ref").body,
      })),
    ).rejects.toThrow(
      "origin/main is not reachable; cannot select targeted pre-push validations",
    );
  });

  it("fails closed when origin/main diff cannot be computed", async () => {
    const commands: string[][] = [];

    await expect(
      prePushReview.getChangedFilesVsOriginMain(ROOT_DIR, (command) => {
        commands.push(command);

        if (command[1] === "rev-parse") {
          return {
            exited: Promise.resolve(0),
            stdout: new Response("").body,
            stderr: new Response("").body,
          };
        }

        return {
          exited: Promise.resolve(1),
          stdout: new Response("").body,
          stderr: new Response("bad revision").body,
        };
      }),
    ).rejects.toThrow(
      "git diff against origin/main failed; cannot select targeted pre-push validations",
    );

    expect(commands).toEqual([
      ["git", "rev-parse", "--verify", "origin/main"],
      ["git", "diff", "--name-only", "origin/main...HEAD"],
    ]);
  });

  it("runs the combined documentation check before self-review, architecture checks, harness review, and inferential review", async () => {
    const steps: string[] = [];

    await prePushReview.runPrePushReview(ROOT_DIR, {
      ...EXPIRED_PROOF_OPTIONS,
      getChangedFiles: async () => {
        steps.push("changed-files");
        return ["packages/athena-webapp/src/main.tsx"];
      },
      runGraphifyCheck: async () => {
        steps.push("graphify:check");
      },
      runDocumentationCheck: async () => {
        steps.push("delivery:documentation-check");
      },
      runHarnessSelfReview: async () => {
        steps.push("harness:self-review:origin/main");
      },
      runArchitectureCheck: async () => {
        steps.push("architecture:check");
      },
      runHarnessReview: async (_rootDir, options) => {
        steps.push(`harness:review:${options.baseRef}`);
      },
      runHarnessInferentialReview: async () => {
        steps.push("harness:inferential-review");
      },
      getLocalChangedFiles: async () => [],
      logger: {
        log() {},
        warn() {},
        error() {},
      },
    } as any);

    expect(steps).toEqual([
      "graphify:check",
      "delivery:documentation-check",
      "harness:self-review:origin/main",
      "architecture:check",
      "changed-files",
      "harness:review:origin/main",
      "harness:inferential-review",
    ]);
  });

  it("reuses a current pr:athena proof before running expensive pre-push checks", async () => {
    const steps: string[] = [];
    const logs: string[] = [];

    await prePushReview.runPrePushReview(ROOT_DIR, {
      evaluatePrePushValidationProof: async () => ({
        reusable: true,
        status: "reusable",
        proofPath: "/tmp/proof.json",
        proof: {
          schemaVersion: 2,
          recordedHeadSha: "head-sha",
          validatedTreeSha: "tree-sha",
          recordedStatusMode: "clean",
          baseRef: "origin/main",
          baseSha: "base-sha",
          bunVersion: "1.1.29",
          prAthenaScript: "bun run pr:athena",
          validationFingerprint: "fingerprint",
        },
      }),
      runGraphifyCheck: async () => {
        steps.push("graphify:check");
      },
      runHarnessSelfReview: async () => {
        steps.push("harness:self-review");
      },
      runArchitectureCheck: async () => {
        steps.push("architecture:check");
      },
      runHarnessReview: async () => {
        steps.push("harness:review");
      },
      runHarnessInferentialReview: async () => {
        steps.push("harness:inferential-review");
      },
      logger: {
        log(message: string) {
          logs.push(message);
        },
        warn() {},
        error() {},
      },
    } as any);

    expect(steps).toEqual([]);
    expect(logs).toContain(
      "[pre-push] Reusing current pr:athena validation proof for tree tree-sha.",
    );
    expect(logs).toContain(
      "[pre-push] Handoff: validation=skipped; proof=reusable; proofReason=reusable current pr:athena proof.",
    );
  });

  it("reports validation success separately from stale proof status", async () => {
    const logs: string[] = [];

    await prePushReview.runPrePushReview(ROOT_DIR, {
      ...EXPIRED_PROOF_OPTIONS,
      getChangedFiles: async () => ["packages/athena-webapp/src/main.tsx"],
      runGraphifyCheck: async () => {},
      runHarnessSelfReview: async () => {},
      runArchitectureCheck: async () => {},
      runHarnessReview: async () => {},
      runHarnessInferentialReview: async () => {},
      getLocalChangedFiles: async () => [],
      logger: {
        log(message: string) {
          logs.push(message);
        },
        warn() {},
        error() {},
      },
    } as any);

    expect(logs).toContain(
      "[pre-push] pr:athena proof not reusable (stale): test proof disabled. Running validation suite.",
    );
    expect(logs).toContain(
      "[pre-push] Handoff: validation=passed; proof=stale; proofReason=test proof disabled.",
    );
  });

  it("lets harness review cover repo harness validations when harness-owned files change", async () => {
    const steps: string[] = [];

    await prePushReview.runPrePushReview(ROOT_DIR, {
      ...EXPIRED_PROOF_OPTIONS,
      getChangedFiles: async () => {
        steps.push("changed-files");
        return ["scripts/harness-check.test.ts"];
      },
      runGraphifyCheck: async () => {
        steps.push("graphify:check");
      },
      runHarnessSelfReview: async () => {
        steps.push("harness:self-review:origin/main");
      },
      runArchitectureCheck: async () => {
        steps.push("architecture:check");
      },
      runHarnessImplementationTests: async () => {
        steps.push("harness:test");
      },
      runHarnessReview: async (_rootDir, options) => {
        steps.push(`harness:review:${options.baseRef}`);
        const files = await options.getChangedFiles?.(
          ROOT_DIR,
          options.baseRef,
        );
        steps.push(`files:${files?.join(",") ?? ""}`);
      },
      runHarnessInferentialReview: async () => {
        steps.push("harness:inferential-review");
      },
      getLocalChangedFiles: async () => [],
      logger: {
        log() {},
        warn() {},
        error() {},
      },
    } as any);

    expect(steps).toEqual([
      "graphify:check",
      "harness:self-review:origin/main",
      "architecture:check",
      "changed-files",
      "harness:review:origin/main",
      "files:scripts/harness-check.test.ts",
    ]);
  });

  it("skips harness implementation tests when harness-owned files are untouched", async () => {
    const steps: string[] = [];

    await prePushReview.runPrePushReview(ROOT_DIR, {
      ...EXPIRED_PROOF_OPTIONS,
      getChangedFiles: async () => {
        steps.push("changed-files");
        return ["packages/athena-webapp/src/main.tsx"];
      },
      runGraphifyCheck: async () => {
        steps.push("graphify:check");
      },
      runHarnessSelfReview: async () => {
        steps.push("harness:self-review:origin/main");
      },
      runArchitectureCheck: async () => {
        steps.push("architecture:check");
      },
      runHarnessImplementationTests: async () => {
        steps.push("harness:test");
      },
      runHarnessReview: async (_rootDir, options) => {
        steps.push(`harness:review:${options.baseRef}`);
        const files = await options.getChangedFiles?.(
          ROOT_DIR,
          options.baseRef,
        );
        steps.push(`files:${files?.join(",") ?? ""}`);
      },
      runHarnessInferentialReview: async () => {
        steps.push("harness:inferential-review");
      },
      getLocalChangedFiles: async () => [],
      logger: {
        log() {},
        warn() {},
        error() {},
      },
    } as any);

    expect(steps).toEqual([
      "graphify:check",
      "harness:self-review:origin/main",
      "architecture:check",
      "changed-files",
      "harness:review:origin/main",
      "files:packages/athena-webapp/src/main.tsx",
      "harness:inferential-review",
    ]);
  });

  it("preserves an injected empty changed-file set when handing off to harness review", async () => {
    const steps: string[] = [];

    await prePushReview.runPrePushReview(ROOT_DIR, {
      ...EXPIRED_PROOF_OPTIONS,
      getChangedFiles: async () => {
        steps.push("changed-files-fallback");
        return [];
      },
      runGraphifyCheck: async () => {
        steps.push("graphify:check");
      },
      runHarnessSelfReview: async () => {
        steps.push("harness:self-review:origin/main");
      },
      runArchitectureCheck: async () => {
        steps.push("architecture:check");
      },
      runHarnessReview: async (_rootDir, options) => {
        steps.push(`harness:review:${options.baseRef}`);
        const files = await options.getChangedFiles?.(
          ROOT_DIR,
          options.baseRef,
        );
        steps.push(`files:${files?.join(",") ?? ""}`);
      },
      runHarnessInferentialReview: async () => {
        steps.push("harness:inferential-review");
      },
      getLocalChangedFiles: async () => [],
      logger: {
        log() {},
        warn() {},
        error() {},
      },
    } as any);

    expect(steps).toEqual([
      "graphify:check",
      "harness:self-review:origin/main",
      "architecture:check",
      "changed-files-fallback",
      "harness:review:origin/main",
      "files:",
      "harness:inferential-review",
    ]);
  });

  it("blocks after auto-repairing stale graphify artifacts during graphify:check until they are committed", async () => {
    const steps: string[] = [];
    let graphifyCheckRuns = 0;
    let graphifyArtifactsPending = false;

    await expect(
      prePushReview.runPrePushReview(ROOT_DIR, {
        ...EXPIRED_PROOF_OPTIONS,
        getChangedFiles: async () => {
          steps.push("changed-files");
          return ["packages/athena-webapp/src/main.tsx"];
        },
        getLocalChangedFiles: async () =>
          graphifyArtifactsPending ? ["graphify-out/GRAPH_REPORT.md"] : [],
        runGraphifyCheck: async () => {
          graphifyCheckRuns += 1;
          steps.push(`graphify:check:${graphifyCheckRuns}`);
          if (graphifyCheckRuns === 1) {
            throw new Error(
              [
                "[graphify check] Graphify artifacts are stale:",
                "- graphify-out/GRAPH_REPORT.md",
                "Run `bun run graphify:rebuild` from repo root to refresh tracked graphify artifacts.",
              ].join("\n"),
            );
          }
        },
        runGraphifyRebuild: async () => {
          graphifyArtifactsPending = true;
          steps.push("graphify:rebuild");
        },
        runHarnessSelfReview: async () => {
          steps.push("harness:self-review");
          return { blockers: [] };
        },
        runArchitectureCheck: async () => {
          steps.push("architecture:check");
        },
        runHarnessReview: async (_rootDir, options) => {
          steps.push(`harness:review:${options.baseRef}`);
        },
        runHarnessInferentialReview: async () => {
          steps.push("harness:inferential-review");
        },
        logger: {
          log() {},
          warn() {},
          error() {},
        },
      } as any),
    ).rejects.toThrow(
      "Tracked graphify artifacts were auto-repaired locally. Review and commit the repaired files, then push again.",
    );

    expect(steps).toEqual([
      "graphify:check:1",
      "graphify:rebuild",
      "graphify:check:2",
      "harness:self-review",
      "architecture:check",
      "changed-files",
      "harness:review:origin/main",
      "harness:inferential-review",
    ]);
  });

  it("blocks when graphify artifacts are already locally modified from a prior repair run", async () => {
    const steps: string[] = [];

    await expect(
      prePushReview.runPrePushReview(ROOT_DIR, {
        ...EXPIRED_PROOF_OPTIONS,
        getChangedFiles: async () => {
          steps.push("changed-files");
          return ["packages/athena-webapp/src/main.tsx"];
        },
        getLocalChangedFiles: async () => ["graphify-out/GRAPH_REPORT.md"],
        runGraphifyCheck: async () => {
          steps.push("graphify:check");
        },
        runHarnessSelfReview: async () => {
          steps.push("harness:self-review");
          return { blockers: [] };
        },
        runArchitectureCheck: async () => {
          steps.push("architecture:check");
        },
        runHarnessReview: async (_rootDir, options) => {
          steps.push(`harness:review:${options.baseRef}`);
        },
        runHarnessInferentialReview: async () => {
          steps.push("harness:inferential-review");
        },
        logger: {
          log() {},
          warn() {},
          error() {},
        },
      } as any),
    ).rejects.toThrow(
      "Tracked graphify artifacts were auto-repaired locally. Review and commit the repaired files, then push again.",
    );

    expect(steps).toEqual([
      "graphify:check",
      "harness:self-review",
      "architecture:check",
      "changed-files",
      "harness:review:origin/main",
      "harness:inferential-review",
    ]);
  });

  it.each(ATHENA_GENERATED_DOC_PATHS)(
    "blocks after repairing stale Athena generated docs (%s) during harness:self-review",
    async (generatedDocPath) => {
      const steps: string[] = [];
      let selfReviewRuns = 0;
      let generatedDocsPending = false;
      const reviewChangedFiles: string[][] = [];

      await expect(
        prePushReview.runPrePushReview(ROOT_DIR, {
          ...EXPIRED_PROOF_OPTIONS,
          getChangedFiles: async () => {
            steps.push("changed-files:base");
            return ["packages/athena-webapp/src/main.tsx"];
          },
          getChangedFilesForRepairedTree: async () => {
            steps.push("changed-files:repaired");
            return ["packages/athena-webapp/src/main.tsx", generatedDocPath];
          },
          getLocalChangedFiles: async () =>
            generatedDocsPending ? [generatedDocPath] : [],
          runGraphifyCheck: async () => {
            steps.push("graphify:check");
          },
          runHarnessSelfReview: async () => {
            selfReviewRuns += 1;
            steps.push(`harness:self-review:${selfReviewRuns}`);
            return {
              blockers:
                selfReviewRuns === 1
                  ? ["harness:check failed: generated docs drift"]
                  : [],
            };
          },
          validateHarnessDocs: async () => [
            `Stale generated harness doc: ${generatedDocPath}`,
          ],
          runHarnessGenerate: async () => {
            generatedDocsPending = true;
            steps.push("harness:generate");
          },
          runArchitectureCheck: async () => {
            steps.push("architecture:check");
          },
          runHarnessReview: async (rootDir, options) => {
            reviewChangedFiles.push(
              (await options.getChangedFiles?.(rootDir, options.baseRef)) ?? [],
            );
            steps.push(`harness:review:${options.baseRef}`);
          },
          runHarnessInferentialReview: async () => {
            steps.push("harness:inferential-review");
          },
          logger: {
            log() {},
            warn() {},
            error() {},
          },
        } as any),
      ).rejects.toThrow(
        "Generated harness docs were auto-repaired locally. Review and commit the repaired files, then push again.",
      );

      expect(steps).toEqual([
        "graphify:check",
        "harness:self-review:1",
        "harness:generate",
        "changed-files:repaired",
        "harness:self-review:2",
        "architecture:check",
        "harness:review:origin/main",
      ]);
      expect(reviewChangedFiles).toEqual([
        ["packages/athena-webapp/src/main.tsx", generatedDocPath],
      ]);
    },
  );

  it("blocks when harness:self-review reports non-repairable blockers", async () => {
    const steps: string[] = [];

    await expect(
      prePushReview.runPrePushReview(ROOT_DIR, {
        ...EXPIRED_PROOF_OPTIONS,
        getChangedFiles: async () => {
          steps.push("changed-files");
          return [];
        },
        runGraphifyCheck: async () => {
          steps.push("graphify:check");
        },
        runHarnessSelfReview: async () => {
          steps.push("harness:self-review");
          return {
            blockers: [
              "Harness review coverage gap: packages/athena-webapp/src/unmapped.ts",
            ],
          };
        },
        validateHarnessDocs: async () => [],
        runHarnessGenerate: async () => {
          steps.push("harness:generate");
        },
        runArchitectureCheck: async () => {
          steps.push("architecture:check");
        },
        runHarnessReview: async () => {
          steps.push("harness:review");
        },
        runHarnessInferentialReview: async () => {
          steps.push("harness:inferential-review");
        },
        logger: {
          log() {},
          warn() {},
          error() {},
        },
      } as any),
    ).rejects.toThrow("harness:self-review blocked");

    expect(steps).toEqual(["graphify:check", "harness:self-review"]);
  });

  it("blocks after repairing stale generated docs during harness:review", async () => {
    const steps: string[] = [];
    let reviewRuns = 0;
    let generatedDocsPending = false;
    const reviewChangedFiles: string[][] = [];

    await expect(
      prePushReview.runPrePushReview(ROOT_DIR, {
        ...EXPIRED_PROOF_OPTIONS,
        getChangedFiles: async () => {
          steps.push("changed-files:base");
          return ["packages/athena-webapp/src/main.tsx"];
        },
        getChangedFilesForRepairedTree: async () => {
          steps.push("changed-files:repaired");
          return [
            "packages/athena-webapp/src/main.tsx",
            "packages/athena-webapp/docs/agent/validation-map.json",
          ];
        },
        getLocalChangedFiles: async () =>
          generatedDocsPending
            ? ["packages/athena-webapp/docs/agent/validation-map.json"]
            : [],
        runGraphifyCheck: async () => {
          steps.push("graphify:check");
        },
        runHarnessSelfReview: async () => {
          steps.push("harness:self-review");
          return { blockers: [] };
        },
        runArchitectureCheck: async () => {
          steps.push("architecture:check");
        },
        runHarnessReview: async (rootDir, options) => {
          reviewRuns += 1;
          reviewChangedFiles.push(
            (await options.getChangedFiles?.(rootDir, options.baseRef)) ?? [],
          );
          steps.push(`harness:review:${options.baseRef}:${reviewRuns}`);
          if (reviewRuns === 1) {
            throw new Error("harness review drift");
          }
        },
        validateHarnessDocs: async () => [
          "Missing required harness file: packages/athena-webapp/docs/agent/validation-map.json",
        ],
        runHarnessGenerate: async () => {
          generatedDocsPending = true;
          steps.push("harness:generate");
        },
        runHarnessInferentialReview: async () => {
          steps.push("harness:inferential-review");
        },
        logger: {
          log() {},
          warn() {},
          error() {},
        },
      } as any),
    ).rejects.toThrow(
      "Generated harness docs were auto-repaired locally. Review and commit the repaired files, then push again.",
    );

    expect(steps).toEqual([
      "graphify:check",
      "harness:self-review",
      "architecture:check",
      "changed-files:base",
      "harness:review:origin/main:1",
      "harness:generate",
      "changed-files:repaired",
      "harness:review:origin/main:2",
    ]);
    expect(reviewChangedFiles).toEqual([
      ["packages/athena-webapp/src/main.tsx"],
      [
        "packages/athena-webapp/src/main.tsx",
        "packages/athena-webapp/docs/agent/validation-map.json",
      ],
    ]);
  });

  it("blocks when generated harness docs are already locally modified from a prior repair run", async () => {
    const steps: string[] = [];
    const reviewChangedFiles: string[][] = [];

    await expect(
      prePushReview.runPrePushReview(ROOT_DIR, {
        ...EXPIRED_PROOF_OPTIONS,
        getChangedFiles: async () => {
          steps.push("changed-files:base");
          return ["packages/athena-webapp/src/main.tsx"];
        },
        getChangedFilesForRepairedTree: async () => {
          steps.push("changed-files:repaired");
          return [
            "packages/athena-webapp/src/main.tsx",
            "packages/athena-webapp/docs/agent/test-index.md",
          ];
        },
        getLocalChangedFiles: async () => [
          "packages/athena-webapp/docs/agent/test-index.md",
        ],
        runGraphifyCheck: async () => {
          steps.push("graphify:check");
        },
        runHarnessSelfReview: async () => {
          steps.push("harness:self-review");
          return { blockers: [] };
        },
        runArchitectureCheck: async () => {
          steps.push("architecture:check");
        },
        runHarnessReview: async (rootDir, options) => {
          reviewChangedFiles.push(
            (await options.getChangedFiles?.(rootDir, options.baseRef)) ?? [],
          );
          steps.push(`harness:review:${options.baseRef}`);
        },
        runHarnessInferentialReview: async () => {
          steps.push("harness:inferential-review");
        },
        logger: {
          log() {},
          warn() {},
          error() {},
        },
      } as any),
    ).rejects.toThrow(
      "Generated harness docs were auto-repaired locally. Review and commit the repaired files, then push again.",
    );

    expect(steps).toEqual([
      "graphify:check",
      "harness:self-review",
      "changed-files:repaired",
      "architecture:check",
      "harness:review:origin/main",
    ]);
    expect(reviewChangedFiles).toEqual([
      [
        "packages/athena-webapp/src/main.tsx",
        "packages/athena-webapp/docs/agent/test-index.md",
      ],
    ]);
  });

  it("falls back to working-tree baseline diffing when repaired-doc base-tree diffing fails", async () => {
    const steps: string[] = [];
    const warnings: string[] = [];
    const reviewChangedFiles: string[][] = [];

    await expect(
      prePushReview.runPrePushReview(ROOT_DIR, {
        ...EXPIRED_PROOF_OPTIONS,
        getChangedFilesForRepairedTree: async () => {
          throw new Error("Base ref check failed for origin/main: missing ref");
        },
        getLocalChangedFiles: async () => {
          steps.push("changed-files:local");
          return ["packages/athena-webapp/docs/agent/test-index.md"];
        },
        runGraphifyCheck: async () => {
          steps.push("graphify:check");
        },
        runHarnessSelfReview: async () => {
          steps.push("harness:self-review");
          return { blockers: [] };
        },
        runArchitectureCheck: async () => {
          steps.push("architecture:check");
        },
        runHarnessReview: async (rootDir, options) => {
          reviewChangedFiles.push(
            (await options.getChangedFiles?.(rootDir, options.baseRef)) ?? [],
          );
          steps.push(`harness:review:${options.baseRef}`);
        },
        runHarnessInferentialReview: async () => {
          steps.push("harness:inferential-review");
        },
        logger: {
          log() {},
          warn(message: string) {
            warnings.push(message);
          },
          error() {},
        },
      } as any),
    ).rejects.toThrow(
      "Generated harness docs were auto-repaired locally. Review and commit the repaired files, then push again.",
    );

    expect(steps).toEqual([
      "graphify:check",
      "harness:self-review",
      "changed-files:local",
      "changed-files:local",
      "architecture:check",
      "harness:review:origin/main",
      "changed-files:local",
    ]);
    expect(reviewChangedFiles).toEqual([
      ["packages/athena-webapp/docs/agent/test-index.md"],
    ]);
    expect(warnings[0]).toContain("Falling back to local working tree changes");
  });

  it("does not pass the base ref into default-style changed-file helpers", async () => {
    const observedSpawnTypes: string[] = [];

    await prePushReview.runPrePushReview(ROOT_DIR, {
      ...EXPIRED_PROOF_OPTIONS,
      getChangedFiles: (async (_rootDir: string, spawn = () => undefined) => {
        observedSpawnTypes.push(typeof spawn);
        return [];
      }) as unknown as (rootDir: string) => Promise<string[]>,
      runGraphifyCheck: async () => {},
      runHarnessSelfReview: async () => {},
      runArchitectureCheck: async () => {},
      runHarnessInferentialReview: async () => {},
      runHarnessReview: async (_rootDir, options) => {
        await options.getChangedFiles?.(ROOT_DIR, options.baseRef);
      },
      getLocalChangedFiles: async () => [],
      logger: {
        log() {},
        warn() {},
        error() {},
      },
    });

    expect(observedSpawnTypes).toEqual(["function"]);
  });

  it("keeps the husky pre-push hook pointed at the repo review script", async () => {
    const hookContents = await readFile(
      path.join(ROOT_DIR, ".husky/pre-push"),
      "utf8",
    );

    expect(hookContents).toContain("bun run pre-push:review");
  });

  it("keeps the husky pre-commit hook pointed at the generated-artifact repair script", async () => {
    const hookContents = await readFile(
      path.join(ROOT_DIR, ".husky/pre-commit"),
      "utf8",
    );

    expect(hookContents).toContain("bun run pre-commit:generated-artifacts");
  });
});

describe("repo harness ergonomics", () => {
  it("schedules a recurring harness drift check in GitHub Actions", async () => {
    const workflow = await readFile(
      path.join(ROOT_DIR, ".github/workflows/athena-pr-tests.yml"),
      "utf8",
    );

    expect(workflow).toContain("schedule:");
    expect(workflow).toContain("- cron:");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("harness-implementation-tests:");
    expect(workflow).toContain("fetch-depth: 0");
    expect(workflow).toContain("run: bun run workflow:check");
    expect(workflow).toContain("run: bun run delivery:documentation-check");
    expect(workflow).toContain(
      "run: bun run harness:self-review --base origin/main",
    );
    expect(workflow).toContain(
      "run: bun run harness:review --base origin/main --validation-provided-by athena-pr-tests",
    );
    expect(workflow).toContain("run: bun run harness:test");
    expect(workflow).toContain("name: Athena and Storefront Webapp Validation");
    expect(workflow).toContain("name: Storefront Webapp Validation Context");
    expect(workflow).toContain("athena-webapp-validation:");
    expect(workflow).toContain("storefront-webapp-validation-context:");
    expect(workflow).toContain("needs: athena-webapp-validation");
    expect(workflow).toContain(
      "Confirm consolidated storefront validation coverage",
    );
    expect(workflow).toContain("run: bun run test:coverage");
    expect(workflow).toContain("run: bun run --filter '@athena/webapp' build");
    expect(workflow).toContain(
      "run: bun run --filter '@athena/storefront-webapp' build",
    );
    expect(workflow).toContain(
      "run: bun run --filter '@athena/webapp' lint:frontend:changed",
    );
    expect(workflow).not.toContain(
      "run: bun run --filter '@athena/webapp' test",
    );
    expect(workflow).not.toContain("test-storefront-webapp:");
    expect(workflow).not.toContain("cargo install ripgrep");
    expect(workflow).toContain(
      "run: python3 -m pip install -r .graphify-requirements.txt",
    );
    expect(workflow).toContain("run: bunx playwright install chromium");
    expect(workflow).toContain("run: bun run harness:audit");
    expect(workflow).toContain("HARNESS_INFERENTIAL_SEMANTIC_MODE: shadow");
    expect(workflow).toContain("run: bun run harness:inferential-review");
    expect(workflow).toContain(
      "run: bun run harness:inferential-review --persist-history",
    );
    expect(workflow).toContain(
      "bun run harness:runtime-trends --persist-history",
    );
    expect(workflow).toContain("runtime_behavior_report_lines:");
    expect(workflow).toContain("actions/upload-artifact@v4");
    expect(workflow).toContain("run: bun run graphify:check");
  });

  it("runs the local pr:athena gate through the delivery-run wrapper", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(ROOT_DIR, "package.json"), "utf8"),
    ) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["pr:athena"]).toBe(
      "bun run pr:athena:delivery-run",
    );
    expect(packageJson.scripts?.["pr:athena:delivery-run"]).toBe(
      "bun scripts/pr-athena-delivery-run.ts",
    );
    expect(packageJson.scripts?.["pr:athena:prepare"]).toContain(
      "bun run pre-commit:generated-artifacts",
    );
    expect(packageJson.scripts?.["pr:athena:prepare"]).toContain(
      "bun scripts/pre-push-validation-proof.ts prepare-pr-athena",
    );
    expect(packageJson.scripts?.["pr:athena:preflight"]).toBe(
      "bun scripts/harness-contract-preflight.ts",
    );
    expect(packageJson.scripts?.["pr:athena:validate"]).toContain(
      "bun run pr:athena:validate-provider && bun scripts/pr-athena-delivery-run.ts write-provider-evidence && bun run pr:athena:validate-review",
    );
    expect(packageJson.scripts?.["delivery:documentation-check"]).toBe(
      "bun scripts/delivery-documentation-check.ts",
    );
    expect(packageJson.scripts?.["pr:athena:validate-provider"]).toContain(
      "bun run delivery:documentation-check",
    );
    expect(packageJson.scripts?.["pr:athena:validate-provider"]).toContain(
      "bun run workflow:check",
    );
    expect(packageJson.scripts?.["harness:test"]).toBe(
      "bun scripts/harness-test.ts",
    );
    expect(packageJson.scripts?.["pr:athena:validate-provider"]).toContain(
      "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
    );
    expect(packageJson.scripts?.["pr:athena:validate-provider"]).toContain(
      "bun run test:coverage",
    );
    expect(
      packageJson.scripts?.["pr:athena:validate-provider"]?.indexOf(
        "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
      ),
    ).toBeLessThan(
      packageJson.scripts?.["pr:athena:validate-provider"]?.indexOf(
        "bun run test:coverage",
      ) ?? 0,
    );
    expect(packageJson.scripts?.["pr:athena:validate-provider"]).not.toContain(
      "bun run harness:test",
    );
    expect(packageJson.scripts?.["pr:athena:validate-provider"]).not.toContain(
      "bun run harness:check",
    );
    expect(packageJson.scripts?.["pr:athena:validate-review"]).toContain(
      "bun run harness:review --base origin/main --repo-validation-provided-by pr:athena",
    );
    expect(packageJson.scripts?.["pr:athena:validate-review"]).toContain(
      "--provider-evidence artifacts/harness-delivery-runs/provider-evidence.json",
    );
    expect(packageJson.scripts?.["pr:athena:record-proof"]).toBe(
      "bun scripts/pre-push-validation-proof.ts record-pr-athena",
    );
    expect(packageJson.scripts?.["pr:athena:scorecard"]).toBe(
      "bun run harness:scorecard",
    );
    expect(packageJson.scripts?.["pr:athena:validate-provider"]).toContain(
      "bun run --filter '@athena/webapp' lint:frontend:changed",
    );
    expect(packageJson.scripts?.["pr:athena:validate-review"]).toContain(
      "bun run harness:audit",
    );
    expect(packageJson.scripts?.["pr:athena:validate-review"]).toContain(
      "bun run harness:inferential-review",
    );
    expect(packageJson.scripts?.["pr:athena:validate-review"]).toContain(
      "bun run graphify:check",
    );
    expect(packageJson.scripts?.["pr:athena:validate-review"]).not.toContain(
      "bun run harness:scorecard",
    );
  });

  // These docs contracts assert on docs/harness.md and docs/graphify.md rather
  // than README.md. The README is a short overview that links out; the harness
  // and graphify docs are the canonical references. They also assert on command
  // and artifact tokens rather than whole sentences, so the docs can be reworded
  // without a test edit while the delivery contract stays documented.
  it("documents the harness delivery commands in the harness doc", async () => {
    const harnessDoc = await readFile(
      path.join(ROOT_DIR, "docs/harness.md"),
      "utf8",
    );

    expect(harnessDoc).toContain("bun run harness:test");
    expect(harnessDoc).toContain("bun run harness:inferential-review");
    expect(harnessDoc).toContain("HARNESS_INFERENTIAL_SEMANTIC_MODE=shadow");
    expect(harnessDoc).toContain("--persist-history");
    expect(harnessDoc).toContain(
      "bun run harness:self-review --base origin/main",
    );
  });

  it("keeps the README pointing at the focused docs", async () => {
    const readme = await readFile(path.join(ROOT_DIR, "README.md"), "utf8");

    expect(readme).toContain("./docs/harness.md");
    expect(readme).toContain("./docs/graphify.md");
    expect(readme).toContain("./docs/deployment/vps-production.md");
    expect(readme).toContain("./packages/AGENTS.md");
    expect(readme).toContain("./graphify-out/wiki/index.md");
  });

  it("documents the generated-artifact repair flow in the harness doc", async () => {
    const harnessDoc = await readFile(
      path.join(ROOT_DIR, "docs/harness.md"),
      "utf8",
    );

    // The delivery ladder phases and the fail-closed repair path.
    expect(harnessDoc).toContain("pre-commit:generated-artifacts");
    expect(harnessDoc).toContain("pr:athena:prepare");
    expect(harnessDoc).toContain("pr:athena:validate");
    expect(harnessDoc).toContain("pr:athena:record-proof");
    expect(harnessDoc).toContain("bun run harness:generate");
    expect(harnessDoc).toContain("bun run graphify:check");
    expect(harnessDoc).toContain("delivery:documentation-check");

    // Evidence artifact paths that agents need in order to find run output.
    expect(harnessDoc).toContain("artifacts/harness-inferential-review/history/");
    expect(harnessDoc).toContain("artifacts/harness-behavior/trends/history/");

    // Token presence alone would pass on a doc that described the opposite
    // behavior, so also assert the two concepts a reader must come away with:
    // repair is fail-closed, and a stale ref must not reach CI.
    expect(harnessDoc).toMatch(/fail-closed repair/i);
    expect(harnessDoc).toMatch(/blocks?[^.]*\breview(ed)?\b[^.]*commit/i);
  });

  it("documents graphify setup and tracked artifact policy in the graphify doc", async () => {
    const graphifyDoc = await readFile(
      path.join(ROOT_DIR, "docs/graphify.md"),
      "utf8",
    );

    expect(graphifyDoc).toContain("bun run graphify:check");
    expect(graphifyDoc).toContain("bun run graphify:rebuild");
    expect(graphifyDoc).toContain(".graphify_python");
    expect(graphifyDoc).toContain(".graphify-requirements.txt");
    expect(graphifyDoc).toContain("graphify-out/GRAPH_REPORT.md");
    expect(graphifyDoc).toContain("graphify-out/graph.json");
    expect(graphifyDoc).toContain("graphify-out/cache");
  });

  it("ignores the generated graphify cache directory", async () => {
    const gitignore = await readFile(path.join(ROOT_DIR, ".gitignore"), "utf8");

    expect(gitignore).toContain("graphify-out/cache/");
  });

  it("wires a repo-level pre-commit generated-artifact repair command", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(ROOT_DIR, "package.json"), "utf8"),
    ) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["pre-commit:generated-artifacts"]).toBe(
      "bun scripts/pre-commit-generated-artifacts.ts",
    );
  });

  it("configures Git to use the tracked .husky hooks directory", async () => {
    const [packageJson, configureHooksScript] = await Promise.all([
      readFile(path.join(ROOT_DIR, "package.json"), "utf8"),
      readFile(path.join(ROOT_DIR, "scripts/configure-git-hooks.sh"), "utf8"),
    ]);

    expect(JSON.parse(packageJson).scripts?.prepare).toBe(
      "sh scripts/configure-git-hooks.sh",
    );
    expect(configureHooksScript).toContain("git config core.hooksPath .husky");
  });

  it("pins Bun in package.json and keeps GitHub Actions aligned with that repo version", async () => {
    const [packageJsonText, workflow] = await Promise.all([
      readFile(path.join(ROOT_DIR, "package.json"), "utf8"),
      readFile(
        path.join(ROOT_DIR, ".github/workflows/athena-pr-tests.yml"),
        "utf8",
      ),
    ]);

    expect(JSON.parse(packageJsonText)).toMatchObject({
      packageManager: "bun@1.1.29",
    });
    expect(workflow).toContain("bun-version-file: package.json");
    expect(workflow).toContain("bun install --frozen-lockfile");
    expect(workflow).not.toContain("run: bun install\n");
    expect(workflow).not.toContain("bun-version: latest");
  });
});
