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

describe("pre-push review wiring", () => {
  it("exports testable helpers for pre-push orchestration", () => {
    expect(typeof prePushReview.getChangedFilesVsOriginMain).toBe("function");
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
            "packages/athena-webapp/src/main.tsx\npackages/storefront-webapp/src/router.tsx\n"
          ).body,
          stderr: new Response("").body,
        };
      }
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

  it("falls back cleanly when origin/main is not reachable", async () => {
    const files = await prePushReview.getChangedFilesVsOriginMain(
      ROOT_DIR,
      () => ({
        exited: Promise.resolve(1),
        stdout: new Response("").body,
        stderr: new Response("missing ref").body,
      })
    );

    expect(files).toEqual([]);
  });

  it("runs graphify check before self-review, architecture checks, harness review, and inferential review", async () => {
    const steps: string[] = [];

    await prePushReview.runPrePushReview(ROOT_DIR, {
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
      "harness:self-review:origin/main",
      "architecture:check",
      "changed-files",
      "harness:review:origin/main",
      "harness:inferential-review",
    ]);
  });

  it("lets harness review cover repo harness validations when harness-owned files change", async () => {
    const steps: string[] = [];

    await prePushReview.runPrePushReview(ROOT_DIR, {
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
        const files = await options.getChangedFiles?.(ROOT_DIR, options.baseRef);
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
        const files = await options.getChangedFiles?.(ROOT_DIR, options.baseRef);
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

  it("preserves the non-blocking origin/main fallback when handing off to harness review", async () => {
    const steps: string[] = [];

    await prePushReview.runPrePushReview(ROOT_DIR, {
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
        const files = await options.getChangedFiles?.(ROOT_DIR, options.baseRef);
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
              ].join("\n")
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
      } as any)
    ).rejects.toThrow(
      "Tracked graphify artifacts were auto-repaired locally. Review and commit the repaired files, then push again."
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
      } as any)
    ).rejects.toThrow(
      "Tracked graphify artifacts were auto-repaired locally. Review and commit the repaired files, then push again."
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
          getChangedFiles: async () => {
            steps.push("changed-files:base");
            return ["packages/athena-webapp/src/main.tsx"];
          },
          getChangedFilesForRepairedTree: async () => {
            steps.push("changed-files:repaired");
            return [
              "packages/athena-webapp/src/main.tsx",
              generatedDocPath,
            ];
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
              (await options.getChangedFiles?.(rootDir, options.baseRef)) ?? []
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
        } as any)
      ).rejects.toThrow(
        "Generated harness docs were auto-repaired locally. Review and commit the repaired files, then push again."
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
    }
  );

  it("blocks when harness:self-review reports non-repairable blockers", async () => {
    const steps: string[] = [];

    await expect(
      prePushReview.runPrePushReview(ROOT_DIR, {
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
            blockers: ["Harness review coverage gap: packages/athena-webapp/src/unmapped.ts"],
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
      } as any)
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
            (await options.getChangedFiles?.(rootDir, options.baseRef)) ?? []
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
      } as any)
    ).rejects.toThrow(
      "Generated harness docs were auto-repaired locally. Review and commit the repaired files, then push again."
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
            (await options.getChangedFiles?.(rootDir, options.baseRef)) ?? []
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
      } as any)
    ).rejects.toThrow(
      "Generated harness docs were auto-repaired locally. Review and commit the repaired files, then push again."
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
              (await options.getChangedFiles?.(rootDir, options.baseRef)) ?? []
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
        } as any)
      ).rejects.toThrow(
        "Generated harness docs were auto-repaired locally. Review and commit the repaired files, then push again."
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
    expect(warnings[0]).toContain(
      "Falling back to local working tree changes"
    );
  });

  it("does not pass the base ref into default-style changed-file helpers", async () => {
    const observedSpawnTypes: string[] = [];

    await prePushReview.runPrePushReview(ROOT_DIR, {
      getChangedFiles: (async (_rootDir: string, spawn = Bun.spawn) => {
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
      "utf8"
    );

    expect(hookContents).toContain("bun run pre-push:review");
  });

  it("keeps the husky pre-commit hook pointed at the generated-artifact repair script", async () => {
    const hookContents = await readFile(
      path.join(ROOT_DIR, ".husky/pre-commit"),
      "utf8"
    );

    expect(hookContents).toContain("bun run pre-commit:generated-artifacts");
  });
});

describe("repo harness ergonomics", () => {
  it("schedules a recurring harness drift check in GitHub Actions", async () => {
    const workflow = await readFile(
      path.join(ROOT_DIR, ".github/workflows/athena-pr-tests.yml"),
      "utf8"
    );

    expect(workflow).toContain("schedule:");
    expect(workflow).toContain("- cron:");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("harness-implementation-tests:");
    expect(workflow).toContain("fetch-depth: 0");
    expect(workflow).toContain("run: bun run harness:self-review --base origin/main");
    expect(workflow).toContain("run: bun run harness:review --base origin/main");
    expect(workflow).toContain("run: bun run harness:test");
    expect(workflow).toContain(
      "run: python3 -m pip install -r .graphify-requirements.txt"
    );
    expect(workflow).toContain(
      "run: bunx playwright install --with-deps chromium"
    );
    expect(workflow).toContain("run: bun run harness:audit");
    expect(workflow).toContain("HARNESS_INFERENTIAL_SEMANTIC_MODE: shadow");
    expect(workflow).toContain("run: bun run harness:inferential-review");
    expect(workflow).toContain("run: bun run harness:inferential-review --persist-history");
    expect(workflow).toContain("bun run harness:runtime-trends --persist-history");
    expect(workflow).toContain("runtime_behavior_report_lines:");
    expect(workflow).toContain("actions/upload-artifact@v4");
    expect(workflow).toContain("run: bun run graphify:check");
  });

  it("includes harness implementation, audit, and graphify checks in the local pr:athena command", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(ROOT_DIR, "package.json"), "utf8")
    ) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["pr:athena"]).toContain("bun run harness:test");
    expect(packageJson.scripts?.["pr:athena"]).toContain(
      "bun run harness:review --base origin/main"
    );
    expect(packageJson.scripts?.["pr:athena"]).toContain("bun run harness:audit");
    expect(packageJson.scripts?.["pr:athena"]).toContain(
      "bun run harness:inferential-review"
    );
    expect(packageJson.scripts?.["pr:athena"]).toContain("bun run graphify:check");
  });

  it("documents harness implementation tests as a repo-level command", async () => {
    const readme = await readFile(path.join(ROOT_DIR, "README.md"), "utf8");

    expect(readme).toContain("bun run harness:test");
    expect(readme).toContain("bun run harness:inferential-review");
    expect(readme).toContain("HARNESS_INFERENTIAL_SEMANTIC_MODE=shadow");
    expect(readme).toContain("--persist-history");
    expect(readme).toContain("bun run harness:self-review --base origin/main");
  });

  it("documents graphify setup and tracked artifact policy in the README", async () => {
    const readme = await readFile(path.join(ROOT_DIR, "README.md"), "utf8");

    expect(readme).toContain(
      "`pre-commit:generated-artifacts` automatically runs `bun run harness:generate`"
    );
    expect(readme).toContain("stages generated harness docs");
    expect(readme).toContain(
      "If `harness:self-review` or `harness:review` gets blocked by stale generated harness docs"
    );
    expect(readme).toContain(
      "Blocks so you can review, commit, and push the repaired generated docs instead of sending a stale ref to CI."
    );
    expect(readme).toContain("`pre-push:review` starts with `bun run graphify:check`");
    expect(readme).toContain(
      "runs `bun run graphify:rebuild` once, reruns `bun run graphify:check`, and then stops"
    );
    expect(readme).toContain("bun run graphify:check");
    expect(readme).toContain("bun run graphify:rebuild");
    expect(readme).toContain(".graphify_python");
    expect(readme).toContain(".graphify-requirements.txt");
    expect(readme).toContain("graphify-out/GRAPH_REPORT.md");
    expect(readme).toContain("graphify-out/graph.json");
    expect(readme).toContain("graphify-out/cache");
    expect(readme).toContain("artifacts/harness-inferential-review/history/");
    expect(readme).toContain("artifacts/harness-behavior/trends/history/");
  });

  it("ignores the generated graphify cache directory", async () => {
    const gitignore = await readFile(path.join(ROOT_DIR, ".gitignore"), "utf8");

    expect(gitignore).toContain("graphify-out/cache/");
  });

  it("wires a repo-level pre-commit generated-artifact repair command", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(ROOT_DIR, "package.json"), "utf8")
    ) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["pre-commit:generated-artifacts"]).toBe(
      "bun scripts/pre-commit-generated-artifacts.ts"
    );
  });

  it("pins Bun in package.json and keeps GitHub Actions aligned with that repo version", async () => {
    const [packageJsonText, workflow] = await Promise.all([
      readFile(path.join(ROOT_DIR, "package.json"), "utf8"),
      readFile(path.join(ROOT_DIR, ".github/workflows/athena-pr-tests.yml"), "utf8"),
    ]);

    expect(JSON.parse(packageJsonText)).toMatchObject({
      packageManager: "bun@1.1.29",
    });
    expect(workflow).toContain("bun-version-file: package.json");
    expect(workflow).not.toContain("bun-version: latest");
  });
});
