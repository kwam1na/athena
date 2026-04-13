import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import * as prePushReview from "./pre-push-review";

const ROOT_DIR = path.resolve(import.meta.dirname, "..");

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

  it("runs self-review before architecture checks and harness review", async () => {
    const steps: string[] = [];

    await prePushReview.runPrePushReview(ROOT_DIR, {
      getChangedFiles: async () => {
        steps.push("changed-files");
        return ["packages/athena-webapp/src/main.tsx"];
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
      logger: {
        log() {},
        warn() {},
        error() {},
      },
    });

    expect(steps).toEqual([
      "harness:self-review:origin/main",
      "architecture:check",
      "harness:review:origin/main",
    ]);
  });

  it("preserves the non-blocking origin/main fallback when handing off to harness review", async () => {
    const steps: string[] = [];

    await prePushReview.runPrePushReview(ROOT_DIR, {
      getChangedFiles: async () => {
        steps.push("changed-files-fallback");
        return [];
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
      logger: {
        log() {},
        warn() {},
        error() {},
      },
    });

    expect(steps).toEqual([
      "harness:self-review:origin/main",
      "architecture:check",
      "harness:review:origin/main",
      "changed-files-fallback",
      "files:",
    ]);
  });

  it("does not pass the base ref into default-style changed-file helpers", async () => {
    const observedSpawnTypes: string[] = [];

    await prePushReview.runPrePushReview(ROOT_DIR, {
      getChangedFiles: (async (_rootDir: string, spawn = Bun.spawn) => {
        observedSpawnTypes.push(typeof spawn);
        return [];
      }) as unknown as (rootDir: string) => Promise<string[]>,
      runHarnessSelfReview: async () => {},
      runArchitectureCheck: async () => {},
      runHarnessReview: async (_rootDir, options) => {
        await options.getChangedFiles?.(ROOT_DIR, options.baseRef);
      },
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
    expect(workflow).toContain("run: python3 -m pip install graphifyy");
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

    expect(readme).toContain("bun run graphify:check");
    expect(readme).toContain("bun run graphify:rebuild");
    expect(readme).toContain(".graphify_python");
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
});
