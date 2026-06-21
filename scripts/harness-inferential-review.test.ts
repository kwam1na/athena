import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  parseHarnessInferentialReviewArgs,
  runHarnessInferentialReview,
} from "./harness-inferential-review";

const tempRoots: string[] = [];

async function write(relativePath: string, contents: string, rootDir: string) {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

async function runFixtureCommand(rootDir: string, command: string[]) {
  const process = Bun.spawn(command, {
    cwd: rootDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(
      `Fixture command failed: ${command.join(" ")}\n${stdout}\n${stderr}`,
    );
  }
}

async function createFixtureRepo() {
  const rootDir = await mkdtemp(
    path.join(tmpdir(), "athena-harness-inferential-review-"),
  );
  tempRoots.push(rootDir);

  await write(
    "package.json",
    JSON.stringify(
      {
        scripts: {
          "pr:athena":
            "bun run harness:check && bun run harness:review --base origin/main && bun run harness:inferential-review && bun run harness:audit && bun run graphify:check",
        },
      },
      null,
      2,
    ),
    rootDir,
  );

  await write(
    ".github/workflows/athena-pr-tests.yml",
    [
      "name: Athena PR Tests",
      "jobs:",
      "  harness-validation:",
      "    steps:",
      "      - name: Harness check",
      "        run: bun run harness:check",
      "      - name: Targeted harness review",
      "        run: bun run harness:review --base origin/main",
      "      - name: Inferential harness review",
      "        env:",
      "          HARNESS_INFERENTIAL_SEMANTIC_MODE: shadow",
      "        run: bun run harness:inferential-review",
      "      - name: Harness audit",
      "        run: bun run harness:audit",
      "      - name: Graphify check",
      "        run: bun run graphify:check",
    ].join("\n"),
    rootDir,
  );

  await write(
    "packages/athena-webapp/docs/agent/testing.md",
    [
      "# Athena Webapp Testing",
      "",
      "- `bun run harness:check` keeps the repo safety ladder intact.",
      "- `bun run harness:review` covers mapped validation surfaces.",
      "- `bun run harness:audit` keeps the validation map and docs in sync.",
      "- `bun run harness:inferential-review` is the inferential harness gate.",
      "- Inferential findings are blocking and exit non-zero with remediation guidance.",
    ].join("\n"),
    rootDir,
  );

  await write(
    "packages/storefront-webapp/docs/agent/testing.md",
    [
      "# Storefront Webapp Testing",
      "",
      "- `bun run harness:check` keeps the repo safety ladder intact.",
      "- `bun run harness:review` covers mapped validation surfaces.",
      "- `bun run harness:audit` keeps the validation map and docs in sync.",
      "- `bun run harness:inferential-review` is the inferential harness gate.",
      "- Inferential findings are blocking and exit non-zero with remediation guidance.",
    ].join("\n"),
    rootDir,
  );

  await write(
    "scripts/harness-inferential-review.ts",
    [
      "export const harnessInferentialReviewStub = true;",
      "",
      "export function runHarnessInferentialReviewStub() {",
      "  return harnessInferentialReviewStub;",
      "}",
    ].join("\n"),
    rootDir,
  );

  await write(
    "scripts/harness-inferential-review.test.ts",
    [
      'import { describe, expect, it } from "vitest";',
      "",
      'import { runHarnessInferentialReviewStub } from "./harness-inferential-review";',
      "",
      'describe("runHarnessInferentialReviewStub", () => {',
      '  it("returns the stubbed value", () => {',
      "    expect(runHarnessInferentialReviewStub()).toBe(true);",
      "  });",
      "});",
    ].join("\n"),
    rootDir,
  );

  return rootDir;
}

async function commitFixtureRepo(rootDir: string) {
  await runFixtureCommand(rootDir, ["git", "init"]);
  await runFixtureCommand(rootDir, [
    "git",
    "config",
    "user.email",
    "codex@example.com",
  ]);
  await runFixtureCommand(rootDir, [
    "git",
    "config",
    "user.name",
    "Codex Test",
  ]);
  await runFixtureCommand(rootDir, ["git", "add", "."]);
  await runFixtureCommand(rootDir, [
    "git",
    "commit",
    "-m",
    "baseline fixture",
  ]);
}

afterEach(async () => {
  await Promise.all(
    tempRoots
      .splice(0)
      .map((rootDir) => rm(rootDir, { recursive: true, force: true })),
  );
});

describe("runHarnessInferentialReview", () => {
  it("fails with structured findings when a seeded regression is detected", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "package.json",
      JSON.stringify(
        {
          scripts: {
            "pr:athena":
              "bun run harness:check && bun run harness:review --base origin/main && bun run harness:audit && bun run graphify:check",
          },
        },
        null,
        2,
      ),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => ["package.json"],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(1);
    expect(result.machine.status).toBe("fail");
    expect(result.machine.findings).toHaveLength(1);
    expect(result.machine.findings[0]).toMatchObject({
      id: "missing-pr-athena-inferential-step",
      severity: "high",
      filePath: "package.json",
    });
    expect(result.humanReport).toContain("Remediation:");
  });

  it("fails when pr:athena omits harness review", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "package.json",
      JSON.stringify(
        {
          scripts: {
            "pr:athena":
              "bun run harness:check && bun run harness:inferential-review && bun run harness:audit && bun run graphify:check",
          },
        },
        null,
        2,
      ),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => ["package.json"],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(1);
    expect(result.machine.status).toBe("fail");
    expect(result.machine.findings).toContainEqual(
      expect.objectContaining({
        id: "missing-pr-athena-review-step",
        severity: "high",
        filePath: "package.json",
      }),
    );
  });

  it("fails when pr:athena is blank", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "package.json",
      JSON.stringify(
        {
          scripts: {
            "pr:athena": "",
          },
        },
        null,
        2,
      ),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => ["package.json"],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(1);
    expect(result.machine.status).toBe("fail");
    expect(result.machine.findings).toContainEqual(
      expect.objectContaining({
        id: "missing-pr-athena-review-step",
        severity: "high",
        filePath: "package.json",
      }),
    );
    expect(result.machine.findings).toContainEqual(
      expect.objectContaining({
        id: "missing-pr-athena-inferential-step",
        severity: "high",
        filePath: "package.json",
      }),
    );
  });

  it("accepts the equals-form harness review flag in pr:athena", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "package.json",
      JSON.stringify(
        {
          scripts: {
            "pr:athena":
              "bun run harness:check && bun run harness:review --base=origin/main && bun run harness:inferential-review && bun run harness:audit && bun run graphify:check",
          },
        },
        null,
        2,
      ),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => ["package.json"],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(0);
    expect(result.machine.status).toBe("pass");
    expect(result.machine.findings).toEqual([]);
  });

  it("accepts the pr:athena parent provider flag on harness review", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "package.json",
      JSON.stringify(
        {
          scripts: {
            "pr:athena":
              "bun run harness:check && bun run harness:review --base origin/main --repo-validation-provided-by pr:athena && bun run harness:inferential-review && bun run harness:audit && bun run graphify:check",
          },
        },
        null,
        2,
      ),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => ["package.json"],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(0);
    expect(result.machine.status).toBe("pass");
    expect(result.machine.findings).toEqual([]);
  });

  it("accepts harness review as the owner of harness check in pr:athena", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "package.json",
      JSON.stringify(
        {
          scripts: {
            "pr:athena":
              "bun run harness:review --base origin/main --repo-validation-provided-by pr:athena && bun run harness:inferential-review && bun run harness:audit && bun run graphify:check",
          },
        },
        null,
        2,
      ),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => ["package.json"],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(0);
    expect(result.machine.status).toBe("pass");
    expect(result.machine.findings).toEqual([]);
  });

  it("accepts harness review and inferential review through pr:athena subcommands", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "package.json",
      JSON.stringify(
        {
          scripts: {
            "pr:athena":
              "bun run pr:athena:prepare && bun run pr:athena:validate && bun run pr:athena:record-proof",
            "pr:athena:prepare": "bun run pre-commit:generated-artifacts",
            "pr:athena:validate":
              "bun run harness:check && bun run harness:review --base origin/main --repo-validation-provided-by pr:athena && bun run harness:inferential-review && bun run harness:audit && bun run graphify:check",
            "pr:athena:record-proof":
              "bun scripts/pre-push-validation-proof.ts record-pr-athena",
          },
        },
        null,
        2,
      ),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => ["package.json"],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(0);
    expect(result.machine.status).toBe("pass");
    expect(result.machine.findings).toEqual([]);
  });

  it("accepts harness review and inferential review through the delivery-run wrapper", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "package.json",
      JSON.stringify(
        {
          scripts: {
            "pr:athena": "bun run pr:athena:delivery-run",
            "pr:athena:delivery-run": "bun scripts/pr-athena-delivery-run.ts",
            "pr:athena:prepare": "bun run pre-commit:generated-artifacts",
            "pr:athena:validate":
              "bun run pr:athena:validate-provider && bun scripts/pr-athena-delivery-run.ts write-provider-evidence && bun run pr:athena:validate-review",
            "pr:athena:validate-provider": "bun run test:coverage",
            "pr:athena:validate-review":
              "bun run harness:review --base origin/main --repo-validation-provided-by pr:athena --provider-evidence artifacts/harness-delivery-runs/provider-evidence.json && bun run harness:inferential-review && bun run harness:audit && bun run graphify:check",
            "pr:athena:record-proof":
              "bun scripts/pre-push-validation-proof.ts record-pr-athena",
            "pr:athena:scorecard": "bun run harness:scorecard",
          },
        },
        null,
        2,
      ),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => ["package.json"],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(0);
    expect(result.machine.status).toBe("pass");
    expect(result.machine.findings).toEqual([]);
  });

  it("does not treat echoed harness review text as a real pr:athena gate", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "package.json",
      JSON.stringify(
        {
          scripts: {
            "pr:athena":
              "echo bun run harness:review --base origin/main && bun run harness:inferential-review && bun run harness:audit && bun run graphify:check",
          },
        },
        null,
        2,
      ),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => ["package.json"],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(1);
    expect(result.machine.status).toBe("fail");
    expect(result.machine.findings).toContainEqual(
      expect.objectContaining({
        id: "missing-pr-athena-review-step",
        severity: "high",
        filePath: "package.json",
      }),
    );
  });

  it("fails when a harness-critical script changes without its test update", async () => {
    const rootDir = await createFixtureRepo();

    const result = await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => ["scripts/harness-inferential-review.ts"],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(1);
    expect(result.machine.status).toBe("fail");
    expect(result.machine.findings).toHaveLength(1);
    expect(result.machine.findings[0]).toMatchObject({
      id: "missing-harness-script-test-update-scripts-harness-inferential-review-ts",
      severity: "medium",
      filePath: "scripts/harness-inferential-review.ts",
    });
    expect(result.humanReport).toContain(
      "Harness script changed without test update",
    );
  });

  it("fails when scripts/harness-app-registry.ts changes without scripts/harness-app-registry.test.ts", async () => {
    const rootDir = await createFixtureRepo();

    const result = await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => ["scripts/harness-app-registry.ts"],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(1);
    expect(result.machine.status).toBe("fail");
    expect(result.machine.findings).toContainEqual(
      expect.objectContaining({
        id: "missing-harness-script-test-update-scripts-harness-app-registry-ts",
        severity: "medium",
        filePath: "scripts/harness-app-registry.ts",
      }),
    );
    expect(result.humanReport).toContain(
      "scripts/harness-app-registry.test.ts",
    );
  });

  it("fails when the PR workflow omits semantic shadow mode on inferential review", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      ".github/workflows/athena-pr-tests.yml",
      [
        "name: Athena PR Tests",
        "jobs:",
        "  harness-validation:",
        "    steps:",
        "      - name: Harness check",
        "        run: bun run harness:check",
        "      - name: Targeted harness review",
        "        run: bun run harness:review --base origin/main",
        "      - name: Inferential harness review",
        "        run: bun run harness:inferential-review",
        "      - name: Harness audit",
        "        run: bun run harness:audit",
        "      - name: Graphify check",
        "        run: bun run graphify:check",
      ].join("\n"),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => [".github/workflows/athena-pr-tests.yml"],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(1);
    expect(result.machine.status).toBe("fail");
    expect(result.machine.findings).toContainEqual(
      expect.objectContaining({
        id: "missing-ci-shadow-semantic-mode",
        severity: "high",
        filePath: ".github/workflows/athena-pr-tests.yml",
      }),
    );
  });

  it("fails when the PR workflow omits harness review", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      ".github/workflows/athena-pr-tests.yml",
      [
        "name: Athena PR Tests",
        "jobs:",
        "  harness-validation:",
        "    steps:",
        "      - name: Harness check",
        "        run: bun run harness:check",
        "      - name: Inferential harness review",
        "        env:",
        "          HARNESS_INFERENTIAL_SEMANTIC_MODE: shadow",
        "        run: bun run harness:inferential-review",
        "      - name: Harness audit",
        "        run: bun run harness:audit",
        "      - name: Graphify check",
        "        run: bun run graphify:check",
      ].join("\n"),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => [".github/workflows/athena-pr-tests.yml"],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(1);
    expect(result.machine.status).toBe("fail");
    expect(result.machine.findings).toContainEqual(
      expect.objectContaining({
        id: "missing-ci-review-step",
        severity: "high",
        filePath: ".github/workflows/athena-pr-tests.yml",
      }),
    );
  });

  it("accepts the equals-form harness review flag in the PR workflow", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      ".github/workflows/athena-pr-tests.yml",
      [
        "name: Athena PR Tests",
        "jobs:",
        "  harness-validation:",
        "    steps:",
        "      - name: Harness check",
        "        run: bun run harness:check",
        "      - name: Targeted harness review",
        "        run: bun run harness:review --base=origin/main",
        "      - name: Inferential harness review",
        "        env:",
        "          HARNESS_INFERENTIAL_SEMANTIC_MODE: shadow",
        "        run: bun run harness:inferential-review",
        "      - name: Harness audit",
        "        run: bun run harness:audit",
        "      - name: Graphify check",
        "        run: bun run graphify:check",
      ].join("\n"),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => [".github/workflows/athena-pr-tests.yml"],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(0);
    expect(result.machine.status).toBe("pass");
    expect(result.machine.findings).toEqual([]);
  });

  it("accepts the athena-pr-tests validation provider flag in the PR workflow", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      ".github/workflows/athena-pr-tests.yml",
      [
        "name: Athena PR Tests",
        "jobs:",
        "  harness-validation:",
        "    steps:",
        "      - name: Harness check",
        "        run: bun run harness:check",
        "      - name: Targeted harness review",
        "        run: bun run harness:review --base origin/main --validation-provided-by athena-pr-tests",
        "      - name: Inferential harness review",
        "        env:",
        "          HARNESS_INFERENTIAL_SEMANTIC_MODE: shadow",
        "        run: bun run harness:inferential-review",
        "      - name: Harness audit",
        "        run: bun run harness:audit",
        "      - name: Graphify check",
        "        run: bun run graphify:check",
      ].join("\n"),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => [".github/workflows/athena-pr-tests.yml"],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(0);
    expect(result.machine.status).toBe("pass");
    expect(result.machine.findings).toEqual([]);
  });

  it("does not treat commented harness review text as a real workflow gate", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      ".github/workflows/athena-pr-tests.yml",
      [
        "name: Athena PR Tests",
        "jobs:",
        "  harness-validation:",
        "    steps:",
        "      - name: Harness check",
        "        run: bun run harness:check",
        "      # run: bun run harness:review --base origin/main",
        "      - name: Inferential harness review",
        "        env:",
        "          HARNESS_INFERENTIAL_SEMANTIC_MODE: shadow",
        "        run: bun run harness:inferential-review",
        "      - name: Harness audit",
        "        run: bun run harness:audit",
        "      - name: Graphify check",
        "        run: bun run graphify:check",
      ].join("\n"),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => [".github/workflows/athena-pr-tests.yml"],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(1);
    expect(result.machine.status).toBe("fail");
    expect(result.machine.findings).toContainEqual(
      expect.objectContaining({
        id: "missing-ci-review-step",
        severity: "high",
        filePath: ".github/workflows/athena-pr-tests.yml",
      }),
    );
  });

  it("does not treat harness review in another job as the PR validation gate", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      ".github/workflows/athena-pr-tests.yml",
      [
        "name: Athena PR Tests",
        "jobs:",
        "  janitor:",
        "    steps:",
        "      - name: Scheduled harness review",
        "        run: bun run harness:review --base origin/main",
        "  harness-validation:",
        "    steps:",
        "      - name: Harness check",
        "        run: bun run harness:check",
        "      - name: Inferential harness review",
        "        env:",
        "          HARNESS_INFERENTIAL_SEMANTIC_MODE: shadow",
        "        run: bun run harness:inferential-review",
        "      - name: Harness audit",
        "        run: bun run harness:audit",
        "      - name: Graphify check",
        "        run: bun run graphify:check",
      ].join("\n"),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => [".github/workflows/athena-pr-tests.yml"],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(1);
    expect(result.machine.status).toBe("fail");
    expect(result.machine.findings).toContainEqual(
      expect.objectContaining({
        id: "missing-ci-review-step",
        severity: "high",
        filePath: ".github/workflows/athena-pr-tests.yml",
      }),
    );
  });

  it("passes cleanly with zero actionable findings", async () => {
    const rootDir = await createFixtureRepo();

    const result = await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => [
        "package.json",
        ".github/workflows/athena-pr-tests.yml",
        "packages/athena-webapp/docs/agent/testing.md",
        "scripts/harness-inferential-review.ts",
        "scripts/harness-inferential-review.test.ts",
      ],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(0);
    expect(result.machine.status).toBe("pass");
    expect(result.machine.reviewMode).toBe("deterministic-only");
    expect(result.machine.findings).toEqual([]);
    expect(result.humanReport).toContain("No actionable inferential findings.");
  });

  it("records semantic shadow findings without changing the blocking result", async () => {
    const rootDir = await createFixtureRepo();

    const result = await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => ["package.json"],
      runSemanticAnalysis: async () => ({
        providerName: "semantic-shadow-stub",
        findings: [
          {
            id: "semantic-doc-gap",
            severity: "low",
            title: "Semantic doc gap",
            filePath: "package.json",
            rationale: "The semantic reviewer found a likely docs mismatch.",
            remediation: "Document the new wiring in the testing guide.",
          },
        ],
      }),
      semanticMode: "shadow",
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(0);
    expect(result.machine.status).toBe("pass");
    expect(result.machine.reviewMode).toBe("semantic-shadow");
    expect(result.machine.findings).toEqual([]);
    expect(result.machine.errors).toEqual([]);
    expect(result.machine.shadow).toMatchObject({
      status: "fail",
      providerName: "semantic-shadow-stub",
      findings: [
        {
          id: "semantic-doc-gap",
          severity: "low",
          filePath: "package.json",
        },
      ],
    });
  });

  it("returns deterministic actionable runtime/provider failure output", async () => {
    const rootDir = await createFixtureRepo();

    const result = await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => ["package.json"],
      runProvider: async () => {
        throw new Error("provider timeout");
      },
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(1);
    expect(result.machine.status).toBe("error");
    expect(result.machine.errors).toMatchObject([
      {
        code: "INFERENTIAL_PROVIDER_FAILURE",
      },
    ]);
    expect(result.humanReport).toContain("Provider/runtime failure");
    expect(result.humanReport).toContain(
      "Confirm provider configuration and connectivity",
    );
  });

  it("records semantic shadow errors without making the command blocking", async () => {
    const rootDir = await createFixtureRepo();

    const result = await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => ["package.json"],
      runSemanticAnalysis: async () => {
        throw new Error("semantic parse failure");
      },
      semanticMode: "shadow",
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(0);
    expect(result.machine.status).toBe("pass");
    expect(result.machine.errors).toEqual([]);
    expect(result.machine.shadow?.errors).toMatchObject([
      {
        code: "INFERENTIAL_RUNTIME_FAILURE",
      },
    ]);
    expect(result.machine.shadow?.status).toBe("error");
    expect(result.humanReport).toContain("Shadow semantic review");
    expect(result.humanReport).toContain("semantic parse failure");
  });

  it("is explicit and clean when no harness-critical files are in scope", async () => {
    const rootDir = await createFixtureRepo();

    const result = await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => ["README.md"],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(0);
    expect(result.machine.status).toBe("skipped");
    expect(result.machine.summary).toContain("No harness-critical files");
    expect(result.humanReport).toContain(
      "No harness-critical files are in scope.",
    );
  });

  it("fails when a changed public Convex function with returns has no executable return contract proof", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/athena-webapp/convex/pos/public/example.ts",
      [
        'import { query } from "../../../_generated/server";',
        'import { v } from "convex/values";',
        "",
        "export const listExample = query({",
        "  args: { storeId: v.id(\"store\") },",
        "  returns: v.object({ status: v.string() }),",
        "  handler: async () => ({ status: \"ok\" }),",
        "});",
      ].join("\n"),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => [
        "packages/athena-webapp/convex/pos/public/example.ts",
      ],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(1);
    expect(result.machine.status).toBe("fail");
    expect(result.machine.findings).toContainEqual(
      expect.objectContaining({
        id: "missing-convex-return-validator-contract-proof-packages-athena-webapp-convex-pos-public-example-ts",
        severity: "high",
        title:
          "Public Convex return validator changed without executable contract proof",
        filePath: "packages/athena-webapp/convex/pos/public/example.ts",
      }),
    );
    expect(result.humanReport).toContain(
      "assertConformsToExportedReturns",
    );
  });

  it("accepts a changed public Convex function when a sibling test uses the return contract helper", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/athena-webapp/convex/pos/public/example.ts",
      [
        'import { query } from "../../../_generated/server";',
        'import { v } from "convex/values";',
        "",
        "export const listExample = query({",
        "  args: { storeId: v.id(\"store\") },",
        "  returns: v.object({ status: v.string() }),",
        "  handler: async () => ({ status: \"ok\" }),",
        "});",
      ].join("\n"),
      rootDir,
    );
    await write(
      "packages/athena-webapp/convex/pos/public/example.test.ts",
      [
        'import { listExample } from "./example";',
        'import { assertConformsToExportedReturns } from "../../lib/returnValidatorContract";',
        "",
        "assertConformsToExportedReturns(listExample, { status: \"ok\" });",
      ].join("\n"),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => [
        "packages/athena-webapp/convex/pos/public/example.ts",
        "packages/athena-webapp/convex/pos/public/example.test.ts",
      ],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(0);
    expect(result.machine.status).toBe("pass");
    expect(result.machine.findings).toEqual([]);
  });

  it("does not accept loose exportReturns string checks as Convex return contract proof", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/athena-webapp/convex/pos/public/example.ts",
      [
        'import { query } from "../../../_generated/server";',
        'import { v } from "convex/values";',
        "",
        "export const listExample = query({",
        "  args: { storeId: v.id(\"store\") },",
        "  returns: v.object({ status: v.string() }),",
        "  handler: async () => ({ status: \"ok\" }),",
        "});",
      ].join("\n"),
      rootDir,
    );
    await write(
      "packages/athena-webapp/convex/pos/public/example.test.ts",
      [
        'import { expect, it } from "vitest";',
        'import { listExample } from "./example";',
        "",
        'it("exports status", () => {',
        "  expect((listExample as any).exportReturns()).toContain(\"status\");",
        "});",
      ].join("\n"),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => [
        "packages/athena-webapp/convex/pos/public/example.ts",
        "packages/athena-webapp/convex/pos/public/example.test.ts",
      ],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(1);
    expect(result.machine.status).toBe("fail");
    expect(result.machine.findings).toContainEqual(
      expect.objectContaining({
        id: "missing-convex-return-validator-contract-proof-packages-athena-webapp-convex-pos-public-example-ts",
      }),
    );
  });

  it("does not accept marker comments as Convex return contract proof", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/athena-webapp/convex/pos/public/example.ts",
      [
        'import { query } from "../../../_generated/server";',
        'import { v } from "convex/values";',
        "",
        "export const listExample = query({",
        "  args: {},",
        "  returns: v.object({ status: v.string() }),",
        "  handler: async () => ({ status: \"ok\" }),",
        "});",
      ].join("\n"),
      rootDir,
    );
    await write(
      "packages/athena-webapp/convex/pos/public/example.test.ts",
      [
        'import { it } from "vitest";',
        "",
        'it("has a note", () => {',
        "  // @convex-return-validator-contract-proof",
        "});",
      ].join("\n"),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => [
        "packages/athena-webapp/convex/pos/public/example.ts",
        "packages/athena-webapp/convex/pos/public/example.test.ts",
      ],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(1);
    expect(result.machine.status).toBe("fail");
    expect(result.machine.findings).toContainEqual(
      expect.objectContaining({
        id: "missing-convex-return-validator-contract-proof-packages-athena-webapp-convex-pos-public-example-ts",
      }),
    );
  });

  it("does not accept commented-out helper calls as Convex return contract proof", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/athena-webapp/convex/pos/public/example.ts",
      [
        'import { query } from "../../../_generated/server";',
        'import { v } from "convex/values";',
        "",
        "export const listExample = query({",
        "  args: {},",
        "  returns: v.object({ status: v.string() }),",
        "  handler: async () => ({ status: \"ok\" }),",
        "});",
      ].join("\n"),
      rootDir,
    );
    await write(
      "packages/athena-webapp/convex/pos/public/example.test.ts",
      [
        'import { listExample } from "./example";',
        'import { assertConformsToExportedReturns } from "../../lib/returnValidatorContract";',
        "",
        "// assertConformsToExportedReturns(listExample, { status: \"ok\" });",
      ].join("\n"),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => [
        "packages/athena-webapp/convex/pos/public/example.ts",
        "packages/athena-webapp/convex/pos/public/example.test.ts",
      ],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(1);
    expect(result.machine.status).toBe("fail");
    expect(result.machine.findings).toContainEqual(
      expect.objectContaining({
        id: "missing-convex-return-validator-contract-proof-packages-athena-webapp-convex-pos-public-example-ts",
      }),
    );
  });

  it("does not accept helper-shaped string literals as Convex return contract proof", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/athena-webapp/convex/pos/public/example.ts",
      [
        'import { query } from "../../../_generated/server";',
        'import { v } from "convex/values";',
        "",
        "export const listExample = query({",
        "  args: {},",
        "  returns: v.object({ status: v.string() }),",
        "  handler: async () => ({ status: \"ok\" }),",
        "});",
      ].join("\n"),
      rootDir,
    );
    await write(
      "packages/athena-webapp/convex/pos/public/example.test.ts",
      [
        'import { listExample } from "./example";',
        'import { assertConformsToExportedReturns } from "../../lib/returnValidatorContract";',
        "",
        "const note = \"assertConformsToExportedReturns(listExample, { status: 'ok' })\";",
      ].join("\n"),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => [
        "packages/athena-webapp/convex/pos/public/example.ts",
        "packages/athena-webapp/convex/pos/public/example.test.ts",
      ],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(1);
    expect(result.machine.status).toBe("fail");
    expect(result.machine.findings).toContainEqual(
      expect.objectContaining({
        id: "missing-convex-return-validator-contract-proof-packages-athena-webapp-convex-pos-public-example-ts",
      }),
    );
  });

  it("requires return contract proof for every changed public Convex export with returns", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/athena-webapp/convex/pos/public/example.ts",
      [
        'import { query } from "../../../_generated/server";',
        'import { v } from "convex/values";',
        "",
        "export const listExample = query({",
        "  args: {},",
        "  returns: v.object({ status: v.string() }),",
        "  handler: async () => ({ status: \"ok\" }),",
        "});",
        "",
        "export const getExample = query({",
        "  args: {},",
        "  returns: v.object({ detail: v.string() }),",
        "  handler: async () => ({ detail: \"ok\" }),",
        "});",
      ].join("\n"),
      rootDir,
    );
    await write(
      "packages/athena-webapp/convex/pos/public/example.test.ts",
      [
        'import { listExample } from "./example";',
        'import { assertConformsToExportedReturns } from "../../lib/returnValidatorContract";',
        "",
        "assertConformsToExportedReturns(listExample, { status: \"ok\" });",
      ].join("\n"),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => [
        "packages/athena-webapp/convex/pos/public/example.ts",
        "packages/athena-webapp/convex/pos/public/example.test.ts",
      ],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(1);
    expect(result.machine.status).toBe("fail");
    expect(result.machine.findings).toContainEqual(
      expect.objectContaining({
        id: "missing-convex-return-validator-contract-proof-packages-athena-webapp-convex-pos-public-example-ts",
        rationale: expect.stringContaining("query getExample"),
      }),
    );
    expect(result.machine.findings[0]?.rationale).not.toContain(
      "query listExample",
    );
  });

  it("fails when a changed Convex query directly calls mutation-only db APIs", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/athena-webapp/convex/pos/public/queryWrites.ts",
      [
        'import { query } from "../../../_generated/server";',
        "",
        "export const listCommands = query({",
        "  args: {},",
        "  handler: async (ctx) => {",
        "    await ctx.db.patch(\"command-id\" as never, { status: \"expired\" });",
        "    return [];",
        "  },",
        "});",
      ].join("\n"),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => [
        "packages/athena-webapp/convex/pos/public/queryWrites.ts",
      ],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(1);
    expect(result.machine.status).toBe("fail");
    expect(result.machine.findings).toContainEqual(
      expect.objectContaining({
        id: "convex-query-mutation-db-write-packages-athena-webapp-convex-pos-public-querywrites-ts",
        severity: "high",
        filePath: "packages/athena-webapp/convex/pos/public/queryWrites.ts",
      }),
    );
    expect(result.humanReport).toContain("MutationCtx");
  });

  it("fails when a changed Convex query adds a write through an existing renamed handler ctx", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/athena-webapp/convex/pos/public/queryRenamedCtxWrites.ts",
      [
        'import { query } from "../../../_generated/server";',
        "",
        "export const listCommands = query({",
        "  args: {},",
        "  handler: async (queryCtx) => {",
        "    return [];",
        "  },",
        "});",
      ].join("\n"),
      rootDir,
    );
    await commitFixtureRepo(rootDir);
    await write(
      "packages/athena-webapp/convex/pos/public/queryRenamedCtxWrites.ts",
      [
        'import { query } from "../../../_generated/server";',
        "",
        "export const listCommands = query({",
        "  args: {},",
        "  handler: async (queryCtx) => {",
        "    await queryCtx.db.patch(\"command-id\" as never, { status: \"expired\" });",
        "    return [];",
        "  },",
        "});",
      ].join("\n"),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      baseRef: "HEAD",
      getChangedFiles: async () => [
        "packages/athena-webapp/convex/pos/public/queryRenamedCtxWrites.ts",
      ],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(1);
    expect(result.machine.findings).toContainEqual(
      expect.objectContaining({
        id: "convex-query-mutation-db-write-packages-athena-webapp-convex-pos-public-queryrenamedctxwrites-ts",
        severity: "high",
      }),
    );
  });

  it("fails when a changed Convex query writes through a destructured db alias", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/athena-webapp/convex/pos/public/queryDestructuredDbWrites.ts",
      [
        'import { query } from "../../../_generated/server";',
        "",
        "export const listCommands = query({",
        "  args: {},",
        "  handler: async (ctx) => {",
        "    return [];",
        "  },",
        "});",
      ].join("\n"),
      rootDir,
    );
    await commitFixtureRepo(rootDir);
    await write(
      "packages/athena-webapp/convex/pos/public/queryDestructuredDbWrites.ts",
      [
        'import { query } from "../../../_generated/server";',
        "",
        "export const listCommands = query({",
        "  args: {},",
        "  handler: async (ctx) => {",
        "    const { db, auth }: { db: any; auth: unknown } = ctx as any;",
        "    await db.patch(\"command-id\" as never, { status: \"expired\" });",
        "    return [];",
        "  },",
        "});",
      ].join("\n"),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      baseRef: "HEAD",
      getChangedFiles: async () => [
        "packages/athena-webapp/convex/pos/public/queryDestructuredDbWrites.ts",
      ],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(1);
    expect(result.machine.findings).toContainEqual(
      expect.objectContaining({
        id: "convex-query-mutation-db-write-packages-athena-webapp-convex-pos-public-querydestructureddbwrites-ts",
        severity: "high",
      }),
    );
  });

	it("fails when a changed Convex query adds a write through an existing simple db alias", async () => {
		const rootDir = await createFixtureRepo();
		await write(
			"packages/athena-webapp/convex/pos/public/queryExistingSimpleAliasWrites.ts",
      [
        'import { query } from "../../../_generated/server";',
        "",
        "export const listCommands = query({",
        "  args: {},",
        "  handler: async (ctx) => {",
        "    const db = ctx.db as any;",
        "    await db.query(\"posTerminalRecoveryCommand\").collect();",
        "    return [];",
        "  },",
        "});",
      ].join("\n"),
      rootDir,
    );
    await commitFixtureRepo(rootDir);
    await write(
      "packages/athena-webapp/convex/pos/public/queryExistingSimpleAliasWrites.ts",
      [
        'import { query } from "../../../_generated/server";',
        "",
        "export const listCommands = query({",
        "  args: {},",
        "  handler: async (ctx) => {",
        "    const db = ctx.db as any;",
        "    await db.query(\"posTerminalRecoveryCommand\").collect();",
        "    await db.patch(\"command-id\" as never, { status: \"expired\" });",
        "    return [];",
        "  },",
        "});",
      ].join("\n"),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      baseRef: "HEAD",
      getChangedFiles: async () => [
        "packages/athena-webapp/convex/pos/public/queryExistingSimpleAliasWrites.ts",
      ],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(1);
    expect(result.machine.findings).toContainEqual(
      expect.objectContaining({
        id: "convex-query-mutation-db-write-packages-athena-webapp-convex-pos-public-queryexistingsimplealiaswrites-ts",
        severity: "high",
      }),
		);
	});

	it("fails when a changed Convex query adds a write through an existing multi-declarator db alias", async () => {
		const rootDir = await createFixtureRepo();
		await write(
			"packages/athena-webapp/convex/pos/public/queryExistingMultiDeclaratorAliasWrites.ts",
			[
				'import { query } from "../../../_generated/server";',
				"",
				"export const listCommands = query({",
				"  args: {},",
				"  handler: async (ctx) => {",
				"    const ready = true, db = ctx.db as any;",
				"    await db.query(\"posTerminalRecoveryCommand\").collect();",
				"    return [];",
				"  },",
				"});",
			].join("\n"),
			rootDir,
		);
		await commitFixtureRepo(rootDir);
		await write(
			"packages/athena-webapp/convex/pos/public/queryExistingMultiDeclaratorAliasWrites.ts",
			[
				'import { query } from "../../../_generated/server";',
				"",
				"export const listCommands = query({",
				"  args: {},",
				"  handler: async (ctx) => {",
				"    const ready = true, db = ctx.db as any;",
				"    await db.query(\"posTerminalRecoveryCommand\").collect();",
				"    await db.patch(\"command-id\" as never, { status: \"expired\" });",
				"    return [];",
				"  },",
				"});",
			].join("\n"),
			rootDir,
		);

		const result = await runHarnessInferentialReview(rootDir, {
			baseRef: "HEAD",
			getChangedFiles: async () => [
				"packages/athena-webapp/convex/pos/public/queryExistingMultiDeclaratorAliasWrites.ts",
			],
			nowIso: () => "2026-04-12T05:00:00.000Z",
		});

		expect(result.exitCode).toBe(1);
		expect(result.machine.findings).toContainEqual(
			expect.objectContaining({
				id: "convex-query-mutation-db-write-packages-athena-webapp-convex-pos-public-queryexistingmultideclaratoraliaswrites-ts",
				severity: "high",
			}),
		);
	});

	it("fails when a changed Convex query adds a write through an existing typed db alias", async () => {
		const rootDir = await createFixtureRepo();
		await write(
			"packages/athena-webapp/convex/pos/public/queryExistingTypedAliasWrites.ts",
			[
				'import { query } from "../../../_generated/server";',
				"",
				"export const listCommands = query({",
				"  args: {},",
				"  handler: async (ctx) => {",
				"    const db: any = ctx.db;",
				"    await db.query(\"posTerminalRecoveryCommand\").collect();",
				"    return [];",
				"  },",
				"});",
			].join("\n"),
			rootDir,
		);
		await commitFixtureRepo(rootDir);
		await write(
			"packages/athena-webapp/convex/pos/public/queryExistingTypedAliasWrites.ts",
			[
				'import { query } from "../../../_generated/server";',
				"",
				"export const listCommands = query({",
				"  args: {},",
				"  handler: async (ctx) => {",
				"    const db: any = ctx.db;",
				"    await db.query(\"posTerminalRecoveryCommand\").collect();",
				"    await db.patch(\"command-id\" as never, { status: \"expired\" });",
				"    return [];",
				"  },",
				"});",
			].join("\n"),
			rootDir,
		);

		const result = await runHarnessInferentialReview(rootDir, {
			baseRef: "HEAD",
			getChangedFiles: async () => [
				"packages/athena-webapp/convex/pos/public/queryExistingTypedAliasWrites.ts",
			],
			nowIso: () => "2026-04-12T05:00:00.000Z",
		});

		expect(result.exitCode).toBe(1);
		expect(result.machine.findings).toContainEqual(
			expect.objectContaining({
				id: "convex-query-mutation-db-write-packages-athena-webapp-convex-pos-public-queryexistingtypedaliaswrites-ts",
				severity: "high",
			}),
		);
	});

	it("fails when a changed Convex query adds a write through an existing bracket db alias", async () => {
		const rootDir = await createFixtureRepo();
		await write(
			"packages/athena-webapp/convex/pos/public/queryExistingBracketAliasWrites.ts",
			[
				'import { query } from "../../../_generated/server";',
				"",
				"export const listCommands = query({",
				"  args: {},",
				"  handler: async (ctx) => {",
				"    const db = ctx[\"db\"] as any;",
				"    await db.query(\"posTerminalRecoveryCommand\").collect();",
				"    return [];",
				"  },",
				"});",
			].join("\n"),
			rootDir,
		);
		await commitFixtureRepo(rootDir);
		await write(
			"packages/athena-webapp/convex/pos/public/queryExistingBracketAliasWrites.ts",
			[
				'import { query } from "../../../_generated/server";',
				"",
				"export const listCommands = query({",
				"  args: {},",
				"  handler: async (ctx) => {",
				"    const db = ctx[\"db\"] as any;",
				"    await db.query(\"posTerminalRecoveryCommand\").collect();",
				"    await db.patch(\"command-id\" as never, { status: \"expired\" });",
				"    return [];",
				"  },",
				"});",
			].join("\n"),
			rootDir,
		);

		const result = await runHarnessInferentialReview(rootDir, {
			baseRef: "HEAD",
			getChangedFiles: async () => [
				"packages/athena-webapp/convex/pos/public/queryExistingBracketAliasWrites.ts",
			],
			nowIso: () => "2026-04-12T05:00:00.000Z",
		});

		expect(result.exitCode).toBe(1);
		expect(result.machine.findings).toContainEqual(
			expect.objectContaining({
				id: "convex-query-mutation-db-write-packages-athena-webapp-convex-pos-public-queryexistingbracketaliaswrites-ts",
				severity: "high",
			}),
		);
	});

	it("fails when a changed Convex query adds a write through an existing parenthesized db alias", async () => {
		const rootDir = await createFixtureRepo();
		await write(
			"packages/athena-webapp/convex/pos/public/queryExistingParenthesizedAliasWrites.ts",
			[
				'import { query } from "../../../_generated/server";',
				"",
				"export const listCommands = query({",
				"  args: {},",
				"  handler: async (ctx) => {",
				"    const db = (ctx).db as any;",
				"    await db.query(\"posTerminalRecoveryCommand\").collect();",
				"    return [];",
				"  },",
				"});",
			].join("\n"),
			rootDir,
		);
		await commitFixtureRepo(rootDir);
		await write(
			"packages/athena-webapp/convex/pos/public/queryExistingParenthesizedAliasWrites.ts",
			[
				'import { query } from "../../../_generated/server";',
				"",
				"export const listCommands = query({",
				"  args: {},",
				"  handler: async (ctx) => {",
				"    const db = (ctx).db as any;",
				"    await db.query(\"posTerminalRecoveryCommand\").collect();",
				"    await db.patch(\"command-id\" as never, { status: \"expired\" });",
				"    return [];",
				"  },",
				"});",
			].join("\n"),
			rootDir,
		);

		const result = await runHarnessInferentialReview(rootDir, {
			baseRef: "HEAD",
			getChangedFiles: async () => [
				"packages/athena-webapp/convex/pos/public/queryExistingParenthesizedAliasWrites.ts",
			],
			nowIso: () => "2026-04-12T05:00:00.000Z",
		});

		expect(result.exitCode).toBe(1);
		expect(result.machine.findings).toContainEqual(
			expect.objectContaining({
				id: "convex-query-mutation-db-write-packages-athena-webapp-convex-pos-public-queryexistingparenthesizedaliaswrites-ts",
				severity: "high",
			}),
		);
	});

	it("fails when a changed Convex query adds a non-null asserted write through an existing db alias", async () => {
		const rootDir = await createFixtureRepo();
		await write(
			"packages/athena-webapp/convex/pos/public/queryExistingNonNullAliasWrites.ts",
			[
				'import { query } from "../../../_generated/server";',
				"",
				"export const listCommands = query({",
				"  args: {},",
				"  handler: async (ctx) => {",
				"    const db = ctx.db as any;",
				"    await db.query(\"posTerminalRecoveryCommand\").collect();",
				"    return [];",
				"  },",
				"});",
			].join("\n"),
			rootDir,
		);
		await commitFixtureRepo(rootDir);
		await write(
			"packages/athena-webapp/convex/pos/public/queryExistingNonNullAliasWrites.ts",
			[
				'import { query } from "../../../_generated/server";',
				"",
				"export const listCommands = query({",
				"  args: {},",
				"  handler: async (ctx) => {",
				"    const db = ctx.db as any;",
				"    await db.query(\"posTerminalRecoveryCommand\").collect();",
				"    await db!.patch(\"command-id\" as never, { status: \"expired\" });",
				"    return [];",
				"  },",
				"});",
			].join("\n"),
			rootDir,
		);

		const result = await runHarnessInferentialReview(rootDir, {
			baseRef: "HEAD",
			getChangedFiles: async () => [
				"packages/athena-webapp/convex/pos/public/queryExistingNonNullAliasWrites.ts",
			],
			nowIso: () => "2026-04-12T05:00:00.000Z",
		});

		expect(result.exitCode).toBe(1);
		expect(result.machine.findings).toContainEqual(
			expect.objectContaining({
				id: "convex-query-mutation-db-write-packages-athena-webapp-convex-pos-public-queryexistingnonnullaliaswrites-ts",
				severity: "high",
			}),
		);
	});

	it("fails when a changed Convex query adds a bracket method write through an existing db alias", async () => {
		const rootDir = await createFixtureRepo();
		await write(
			"packages/athena-webapp/convex/pos/public/queryExistingBracketMethodAliasWrites.ts",
			[
				'import { query } from "../../../_generated/server";',
				"",
				"export const listCommands = query({",
				"  args: {},",
				"  handler: async (ctx) => {",
				"    const db = ctx.db as any;",
				"    await db.query(\"posTerminalRecoveryCommand\").collect();",
				"    return [];",
				"  },",
				"});",
			].join("\n"),
			rootDir,
		);
		await commitFixtureRepo(rootDir);
		await write(
			"packages/athena-webapp/convex/pos/public/queryExistingBracketMethodAliasWrites.ts",
			[
				'import { query } from "../../../_generated/server";',
				"",
				"export const listCommands = query({",
				"  args: {},",
				"  handler: async (ctx) => {",
				"    const db = ctx.db as any;",
				"    await db.query(\"posTerminalRecoveryCommand\").collect();",
				"    await db[\"patch\"](\"command-id\" as never, { status: \"expired\" });",
				"    return [];",
				"  },",
				"});",
			].join("\n"),
			rootDir,
		);

		const result = await runHarnessInferentialReview(rootDir, {
			baseRef: "HEAD",
			getChangedFiles: async () => [
				"packages/athena-webapp/convex/pos/public/queryExistingBracketMethodAliasWrites.ts",
			],
			nowIso: () => "2026-04-12T05:00:00.000Z",
		});

		expect(result.exitCode).toBe(1);
		expect(result.machine.findings).toContainEqual(
			expect.objectContaining({
				id: "convex-query-mutation-db-write-packages-athena-webapp-convex-pos-public-queryexistingbracketmethodaliaswrites-ts",
				severity: "high",
			}),
		);
	});

	it("fails when a changed Convex query adds an optional bracket method write through an existing db alias", async () => {
		const rootDir = await createFixtureRepo();
		await write(
			"packages/athena-webapp/convex/pos/public/queryExistingOptionalBracketMethodAliasWrites.ts",
			[
				'import { query } from "../../../_generated/server";',
				"",
				"export const listCommands = query({",
				"  args: {},",
				"  handler: async (ctx) => {",
				"    const db = ctx.db as any;",
				"    await db.query(\"posTerminalRecoveryCommand\").collect();",
				"    return [];",
				"  },",
				"});",
			].join("\n"),
			rootDir,
		);
		await commitFixtureRepo(rootDir);
		await write(
			"packages/athena-webapp/convex/pos/public/queryExistingOptionalBracketMethodAliasWrites.ts",
			[
				'import { query } from "../../../_generated/server";',
				"",
				"export const listCommands = query({",
				"  args: {},",
				"  handler: async (ctx) => {",
				"    const db = ctx.db as any;",
				"    await db.query(\"posTerminalRecoveryCommand\").collect();",
				"    await db?.[\"patch\"](\"command-id\" as never, { status: \"expired\" });",
				"    return [];",
				"  },",
				"});",
			].join("\n"),
			rootDir,
		);

		const result = await runHarnessInferentialReview(rootDir, {
			baseRef: "HEAD",
			getChangedFiles: async () => [
				"packages/athena-webapp/convex/pos/public/queryExistingOptionalBracketMethodAliasWrites.ts",
			],
			nowIso: () => "2026-04-12T05:00:00.000Z",
		});

		expect(result.exitCode).toBe(1);
		expect(result.machine.findings).toContainEqual(
			expect.objectContaining({
				id: "convex-query-mutation-db-write-packages-athena-webapp-convex-pos-public-queryexistingoptionalbracketmethodaliaswrites-ts",
				severity: "high",
			}),
		);
	});

	it("fails when a changed Convex query adds a parenthesized write through an existing db alias", async () => {
		const rootDir = await createFixtureRepo();
		await write(
			"packages/athena-webapp/convex/pos/public/queryExistingParenthesizedReceiverAliasWrites.ts",
			[
				'import { query } from "../../../_generated/server";',
				"",
				"export const listCommands = query({",
				"  args: {},",
				"  handler: async (ctx) => {",
				"    const db = ctx.db as any;",
				"    await db.query(\"posTerminalRecoveryCommand\").collect();",
				"    return [];",
				"  },",
				"});",
			].join("\n"),
			rootDir,
		);
		await commitFixtureRepo(rootDir);
		await write(
			"packages/athena-webapp/convex/pos/public/queryExistingParenthesizedReceiverAliasWrites.ts",
			[
				'import { query } from "../../../_generated/server";',
				"",
				"export const listCommands = query({",
				"  args: {},",
				"  handler: async (ctx) => {",
				"    const db = ctx.db as any;",
				"    await db.query(\"posTerminalRecoveryCommand\").collect();",
				"    await (db).patch(\"command-id\" as never, { status: \"expired\" });",
				"    return [];",
				"  },",
				"});",
			].join("\n"),
			rootDir,
		);

		const result = await runHarnessInferentialReview(rootDir, {
			baseRef: "HEAD",
			getChangedFiles: async () => [
				"packages/athena-webapp/convex/pos/public/queryExistingParenthesizedReceiverAliasWrites.ts",
			],
			nowIso: () => "2026-04-12T05:00:00.000Z",
		});

		expect(result.exitCode).toBe(1);
		expect(result.machine.findings).toContainEqual(
			expect.objectContaining({
				id: "convex-query-mutation-db-write-packages-athena-webapp-convex-pos-public-queryexistingparenthesizedreceiveraliaswrites-ts",
				severity: "high",
			}),
		);
	});

	it("fails when a changed Convex query adds a casted receiver write through an existing db alias", async () => {
		const rootDir = await createFixtureRepo();
		await write(
			"packages/athena-webapp/convex/pos/public/queryExistingCastedReceiverAliasWrites.ts",
			[
				'import { query } from "../../../_generated/server";',
				"",
				"export const listCommands = query({",
				"  args: {},",
				"  handler: async (ctx) => {",
				"    const db = ctx.db as any;",
				"    await db.query(\"posTerminalRecoveryCommand\").collect();",
				"    return [];",
				"  },",
				"});",
			].join("\n"),
			rootDir,
		);
		await commitFixtureRepo(rootDir);
		await write(
			"packages/athena-webapp/convex/pos/public/queryExistingCastedReceiverAliasWrites.ts",
			[
				'import { query } from "../../../_generated/server";',
				"",
				"export const listCommands = query({",
				"  args: {},",
				"  handler: async (ctx) => {",
				"    const db = ctx.db as any;",
				"    await db.query(\"posTerminalRecoveryCommand\").collect();",
				"    await (db as any).patch(\"command-id\" as never, { status: \"expired\" });",
				"    return [];",
				"  },",
				"});",
			].join("\n"),
			rootDir,
		);

		const result = await runHarnessInferentialReview(rootDir, {
			baseRef: "HEAD",
			getChangedFiles: async () => [
				"packages/athena-webapp/convex/pos/public/queryExistingCastedReceiverAliasWrites.ts",
			],
			nowIso: () => "2026-04-12T05:00:00.000Z",
		});

		expect(result.exitCode).toBe(1);
		expect(result.machine.findings).toContainEqual(
			expect.objectContaining({
				id: "convex-query-mutation-db-write-packages-athena-webapp-convex-pos-public-queryexistingcastedreceiveraliaswrites-ts",
				severity: "high",
			}),
		);
	});

	it("fails when a changed Convex query adds a satisfies receiver write through an existing db alias", async () => {
		const rootDir = await createFixtureRepo();
		await write(
			"packages/athena-webapp/convex/pos/public/queryExistingSatisfiesReceiverAliasWrites.ts",
			[
				'import { query } from "../../../_generated/server";',
				"",
				"export const listCommands = query({",
				"  args: {},",
				"  handler: async (ctx) => {",
				"    const db = ctx.db as any;",
				"    await db.query(\"posTerminalRecoveryCommand\").collect();",
				"    return [];",
				"  },",
				"});",
			].join("\n"),
			rootDir,
		);
		await commitFixtureRepo(rootDir);
		await write(
			"packages/athena-webapp/convex/pos/public/queryExistingSatisfiesReceiverAliasWrites.ts",
			[
				'import { query } from "../../../_generated/server";',
				"",
				"export const listCommands = query({",
				"  args: {},",
				"  handler: async (ctx) => {",
				"    const db = ctx.db as any;",
				"    await db.query(\"posTerminalRecoveryCommand\").collect();",
				"    await (db satisfies any).patch(\"command-id\" as never, { status: \"expired\" });",
				"    return [];",
				"  },",
				"});",
			].join("\n"),
			rootDir,
		);

		const result = await runHarnessInferentialReview(rootDir, {
			baseRef: "HEAD",
			getChangedFiles: async () => [
				"packages/athena-webapp/convex/pos/public/queryExistingSatisfiesReceiverAliasWrites.ts",
			],
			nowIso: () => "2026-04-12T05:00:00.000Z",
		});

		expect(result.exitCode).toBe(1);
		expect(result.machine.findings).toContainEqual(
			expect.objectContaining({
				id: "convex-query-mutation-db-write-packages-athena-webapp-convex-pos-public-queryexistingsatisfiesreceiveraliaswrites-ts",
				severity: "high",
			}),
		);
	});

	it("fails when a changed Convex query calls an existing bound db write method", async () => {
		const rootDir = await createFixtureRepo();
		await write(
			"packages/athena-webapp/convex/pos/public/queryExistingBoundMethodWrites.ts",
			[
				'import { query } from "../../../_generated/server";',
				"",
				"export const listCommands = query({",
				"  args: {},",
				"  handler: async (ctx) => {",
				"    const db = ctx.db as any;",
				"    const patch = db.patch.bind(db);",
				"    await db.query(\"posTerminalRecoveryCommand\").collect();",
				"    return [];",
				"  },",
				"});",
			].join("\n"),
			rootDir,
		);
		await commitFixtureRepo(rootDir);
		await write(
			"packages/athena-webapp/convex/pos/public/queryExistingBoundMethodWrites.ts",
			[
				'import { query } from "../../../_generated/server";',
				"",
				"export const listCommands = query({",
				"  args: {},",
				"  handler: async (ctx) => {",
				"    const db = ctx.db as any;",
				"    const patch = db.patch.bind(db);",
				"    await db.query(\"posTerminalRecoveryCommand\").collect();",
				"    await patch(\"command-id\" as never, { status: \"expired\" });",
				"    return [];",
				"  },",
				"});",
			].join("\n"),
			rootDir,
		);

		const result = await runHarnessInferentialReview(rootDir, {
			baseRef: "HEAD",
			getChangedFiles: async () => [
				"packages/athena-webapp/convex/pos/public/queryExistingBoundMethodWrites.ts",
			],
			nowIso: () => "2026-04-12T05:00:00.000Z",
		});

		expect(result.exitCode).toBe(1);
		expect(result.machine.findings).toContainEqual(
			expect.objectContaining({
				id: "convex-query-mutation-db-write-packages-athena-webapp-convex-pos-public-queryexistingboundmethodwrites-ts",
				severity: "high",
			}),
		);
	});

	it("fails when a changed Convex query calls an existing assigned db write method", async () => {
		const rootDir = await createFixtureRepo();
		await write(
			"packages/athena-webapp/convex/pos/public/queryExistingAssignedMethodWrites.ts",
			[
				'import { query } from "../../../_generated/server";',
				"",
				"export const listCommands = query({",
				"  args: {},",
				"  handler: async (ctx) => {",
				"    const db = ctx.db as any;",
				"    const patch = db.patch;",
				"    await db.query(\"posTerminalRecoveryCommand\").collect();",
				"    return [];",
				"  },",
				"});",
			].join("\n"),
			rootDir,
		);
		await commitFixtureRepo(rootDir);
		await write(
			"packages/athena-webapp/convex/pos/public/queryExistingAssignedMethodWrites.ts",
			[
				'import { query } from "../../../_generated/server";',
				"",
				"export const listCommands = query({",
				"  args: {},",
				"  handler: async (ctx) => {",
				"    const db = ctx.db as any;",
				"    const patch = db.patch;",
				"    await db.query(\"posTerminalRecoveryCommand\").collect();",
				"    await patch(\"command-id\" as never, { status: \"expired\" });",
				"    return [];",
				"  },",
				"});",
			].join("\n"),
			rootDir,
		);

		const result = await runHarnessInferentialReview(rootDir, {
			baseRef: "HEAD",
			getChangedFiles: async () => [
				"packages/athena-webapp/convex/pos/public/queryExistingAssignedMethodWrites.ts",
			],
			nowIso: () => "2026-04-12T05:00:00.000Z",
		});

		expect(result.exitCode).toBe(1);
		expect(result.machine.findings).toContainEqual(
			expect.objectContaining({
				id: "convex-query-mutation-db-write-packages-athena-webapp-convex-pos-public-queryexistingassignedmethodwrites-ts",
				severity: "high",
			}),
		);
	});

	it("fails when a changed Convex query calls an existing renamed assigned db write method", async () => {
		const rootDir = await createFixtureRepo();
		await write(
			"packages/athena-webapp/convex/pos/public/queryExistingRenamedAssignedMethodWrites.ts",
			[
				'import { query } from "../../../_generated/server";',
				"",
				"export const listCommands = query({",
				"  args: {},",
				"  handler: async (ctx) => {",
				"    const db = ctx.db as any;",
				"    const patchCommand = db.patch;",
				"    await db.query(\"posTerminalRecoveryCommand\").collect();",
				"    return [];",
				"  },",
				"});",
			].join("\n"),
			rootDir,
		);
		await commitFixtureRepo(rootDir);
		await write(
			"packages/athena-webapp/convex/pos/public/queryExistingRenamedAssignedMethodWrites.ts",
			[
				'import { query } from "../../../_generated/server";',
				"",
				"export const listCommands = query({",
				"  args: {},",
				"  handler: async (ctx) => {",
				"    const db = ctx.db as any;",
				"    const patchCommand = db.patch;",
				"    await db.query(\"posTerminalRecoveryCommand\").collect();",
				"    await patchCommand(\"command-id\" as never, { status: \"expired\" });",
				"    return [];",
				"  },",
				"});",
			].join("\n"),
			rootDir,
		);

		const result = await runHarnessInferentialReview(rootDir, {
			baseRef: "HEAD",
			getChangedFiles: async () => [
				"packages/athena-webapp/convex/pos/public/queryExistingRenamedAssignedMethodWrites.ts",
			],
			nowIso: () => "2026-04-12T05:00:00.000Z",
		});

		expect(result.exitCode).toBe(1);
		expect(result.machine.findings).toContainEqual(
			expect.objectContaining({
				id: "convex-query-mutation-db-write-packages-athena-webapp-convex-pos-public-queryexistingrenamedassignedmethodwrites-ts",
				severity: "high",
			}),
		);
	});

	it("fails when a changed Convex query calls an existing typed assigned db write method", async () => {
		const rootDir = await createFixtureRepo();
		await write(
			"packages/athena-webapp/convex/pos/public/queryExistingTypedAssignedMethodWrites.ts",
			[
				'import { query } from "../../../_generated/server";',
				"",
				"export const listCommands = query({",
				"  args: {},",
				"  handler: async (ctx) => {",
				"    const db = ctx.db as any;",
				"    const patch: any = db.patch;",
				"    await db.query(\"posTerminalRecoveryCommand\").collect();",
				"    return [];",
				"  },",
				"});",
			].join("\n"),
			rootDir,
		);
		await commitFixtureRepo(rootDir);
		await write(
			"packages/athena-webapp/convex/pos/public/queryExistingTypedAssignedMethodWrites.ts",
			[
				'import { query } from "../../../_generated/server";',
				"",
				"export const listCommands = query({",
				"  args: {},",
				"  handler: async (ctx) => {",
				"    const db = ctx.db as any;",
				"    const patch: any = db.patch;",
				"    await db.query(\"posTerminalRecoveryCommand\").collect();",
				"    await patch(\"command-id\" as never, { status: \"expired\" });",
				"    return [];",
				"  },",
				"});",
			].join("\n"),
			rootDir,
		);

		const result = await runHarnessInferentialReview(rootDir, {
			baseRef: "HEAD",
			getChangedFiles: async () => [
				"packages/athena-webapp/convex/pos/public/queryExistingTypedAssignedMethodWrites.ts",
			],
			nowIso: () => "2026-04-12T05:00:00.000Z",
		});

		expect(result.exitCode).toBe(1);
		expect(result.machine.findings).toContainEqual(
			expect.objectContaining({
				id: "convex-query-mutation-db-write-packages-athena-webapp-convex-pos-public-queryexistingtypedassignedmethodwrites-ts",
				severity: "high",
			}),
		);
	});

	it("fails when a changed Convex query calls an existing multi-declarator assigned db write method", async () => {
		const rootDir = await createFixtureRepo();
		await write(
			"packages/athena-webapp/convex/pos/public/queryExistingMultiDeclaratorAssignedMethodWrites.ts",
			[
				'import { query } from "../../../_generated/server";',
				"",
				"export const listCommands = query({",
				"  args: {},",
				"  handler: async (ctx) => {",
				"    const db = ctx.db as any;",
				"    const ready = true, patch = db.patch;",
				"    await db.query(\"posTerminalRecoveryCommand\").collect();",
				"    return [];",
				"  },",
				"});",
			].join("\n"),
			rootDir,
		);
		await commitFixtureRepo(rootDir);
		await write(
			"packages/athena-webapp/convex/pos/public/queryExistingMultiDeclaratorAssignedMethodWrites.ts",
			[
				'import { query } from "../../../_generated/server";',
				"",
				"export const listCommands = query({",
				"  args: {},",
				"  handler: async (ctx) => {",
				"    const db = ctx.db as any;",
				"    const ready = true, patch = db.patch;",
				"    await db.query(\"posTerminalRecoveryCommand\").collect();",
				"    await patch(\"command-id\" as never, { status: \"expired\" });",
				"    return [];",
				"  },",
				"});",
			].join("\n"),
			rootDir,
		);

		const result = await runHarnessInferentialReview(rootDir, {
			baseRef: "HEAD",
			getChangedFiles: async () => [
				"packages/athena-webapp/convex/pos/public/queryExistingMultiDeclaratorAssignedMethodWrites.ts",
			],
			nowIso: () => "2026-04-12T05:00:00.000Z",
		});

		expect(result.exitCode).toBe(1);
		expect(result.machine.findings).toContainEqual(
			expect.objectContaining({
				id: "convex-query-mutation-db-write-packages-athena-webapp-convex-pos-public-queryexistingmultideclaratorassignedmethodwrites-ts",
				severity: "high",
			}),
		);
	});

	it("fails when a changed Convex query calls an existing destructured db write method", async () => {
		const rootDir = await createFixtureRepo();
		await write(
			"packages/athena-webapp/convex/pos/public/queryExistingDestructuredMethodWrites.ts",
			[
				'import { query } from "../../../_generated/server";',
				"",
				"export const listCommands = query({",
				"  args: {},",
				"  handler: async (ctx) => {",
				"    const db = ctx.db as any;",
				"    const { patch } = db;",
				"    await db.query(\"posTerminalRecoveryCommand\").collect();",
				"    return [];",
				"  },",
				"});",
			].join("\n"),
			rootDir,
		);
		await commitFixtureRepo(rootDir);
		await write(
			"packages/athena-webapp/convex/pos/public/queryExistingDestructuredMethodWrites.ts",
			[
				'import { query } from "../../../_generated/server";',
				"",
				"export const listCommands = query({",
				"  args: {},",
				"  handler: async (ctx) => {",
				"    const db = ctx.db as any;",
				"    const { patch } = db;",
				"    await db.query(\"posTerminalRecoveryCommand\").collect();",
				"    await patch(\"command-id\" as never, { status: \"expired\" });",
				"    return [];",
				"  },",
				"});",
			].join("\n"),
			rootDir,
		);

		const result = await runHarnessInferentialReview(rootDir, {
			baseRef: "HEAD",
			getChangedFiles: async () => [
				"packages/athena-webapp/convex/pos/public/queryExistingDestructuredMethodWrites.ts",
			],
			nowIso: () => "2026-04-12T05:00:00.000Z",
		});

		expect(result.exitCode).toBe(1);
		expect(result.machine.findings).toContainEqual(
			expect.objectContaining({
				id: "convex-query-mutation-db-write-packages-athena-webapp-convex-pos-public-queryexistingdestructuredmethodwrites-ts",
				severity: "high",
			}),
		);
	});

	it("fails when a changed Convex query calls an existing typed destructured db write method", async () => {
		const rootDir = await createFixtureRepo();
		await write(
			"packages/athena-webapp/convex/pos/public/queryExistingTypedDestructuredMethodWrites.ts",
			[
				'import { query } from "../../../_generated/server";',
				"",
				"export const listCommands = query({",
				"  args: {},",
				"  handler: async (ctx) => {",
				"    const db = ctx.db as any;",
				"    const { patch }: { patch: (...args: any[]) => Promise<void> } = db;",
				"    await db.query(\"posTerminalRecoveryCommand\").collect();",
				"    return [];",
				"  },",
				"});",
			].join("\n"),
			rootDir,
		);
		await commitFixtureRepo(rootDir);
		await write(
			"packages/athena-webapp/convex/pos/public/queryExistingTypedDestructuredMethodWrites.ts",
			[
				'import { query } from "../../../_generated/server";',
				"",
				"export const listCommands = query({",
				"  args: {},",
				"  handler: async (ctx) => {",
				"    const db = ctx.db as any;",
				"    const { patch }: { patch: (...args: any[]) => Promise<void> } = db;",
				"    await db.query(\"posTerminalRecoveryCommand\").collect();",
				"    await patch(\"command-id\" as never, { status: \"expired\" });",
				"    return [];",
				"  },",
				"});",
			].join("\n"),
			rootDir,
		);

		const result = await runHarnessInferentialReview(rootDir, {
			baseRef: "HEAD",
			getChangedFiles: async () => [
				"packages/athena-webapp/convex/pos/public/queryExistingTypedDestructuredMethodWrites.ts",
			],
			nowIso: () => "2026-04-12T05:00:00.000Z",
		});

		expect(result.exitCode).toBe(1);
		expect(result.machine.findings).toContainEqual(
			expect.objectContaining({
				id: "convex-query-mutation-db-write-packages-athena-webapp-convex-pos-public-queryexistingtypeddestructuredmethodwrites-ts",
				severity: "high",
			}),
		);
	});

	it("fails when a changed Convex query calls an existing multi-declarator destructured db write method", async () => {
		const rootDir = await createFixtureRepo();
		await write(
			"packages/athena-webapp/convex/pos/public/queryExistingMultiDeclaratorDestructuredMethodWrites.ts",
			[
				'import { query } from "../../../_generated/server";',
				"",
				"export const listCommands = query({",
				"  args: {},",
				"  handler: async (ctx) => {",
				"    const db = ctx.db as any;",
				"    const ready = true, { patch } = db;",
				"    await db.query(\"posTerminalRecoveryCommand\").collect();",
				"    return [];",
				"  },",
				"});",
			].join("\n"),
			rootDir,
		);
		await commitFixtureRepo(rootDir);
		await write(
			"packages/athena-webapp/convex/pos/public/queryExistingMultiDeclaratorDestructuredMethodWrites.ts",
			[
				'import { query } from "../../../_generated/server";',
				"",
				"export const listCommands = query({",
				"  args: {},",
				"  handler: async (ctx) => {",
				"    const db = ctx.db as any;",
				"    const ready = true, { patch } = db;",
				"    await db.query(\"posTerminalRecoveryCommand\").collect();",
				"    await patch(\"command-id\" as never, { status: \"expired\" });",
				"    return [];",
				"  },",
				"});",
			].join("\n"),
			rootDir,
		);

		const result = await runHarnessInferentialReview(rootDir, {
			baseRef: "HEAD",
			getChangedFiles: async () => [
				"packages/athena-webapp/convex/pos/public/queryExistingMultiDeclaratorDestructuredMethodWrites.ts",
			],
			nowIso: () => "2026-04-12T05:00:00.000Z",
		});

		expect(result.exitCode).toBe(1);
		expect(result.machine.findings).toContainEqual(
			expect.objectContaining({
				id: "convex-query-mutation-db-write-packages-athena-webapp-convex-pos-public-queryexistingmultideclaratordestructuredmethodwrites-ts",
				severity: "high",
			}),
		);
	});

	it("fails when a changed Convex query adds a write through an existing destructured db alias", async () => {
		const rootDir = await createFixtureRepo();
		await write(
			"packages/athena-webapp/convex/pos/public/queryExistingDestructuredAliasWrites.ts",
      [
        'import { query } from "../../../_generated/server";',
        "",
        "export const listCommands = query({",
        "  args: {},",
        "  handler: async (ctx) => {",
        "    const { db, auth }: { db: any; auth: unknown } = ctx as any;",
        "    await db.query(\"posTerminalRecoveryCommand\").collect();",
        "    return [];",
        "  },",
        "});",
      ].join("\n"),
      rootDir,
    );
    await commitFixtureRepo(rootDir);
    await write(
      "packages/athena-webapp/convex/pos/public/queryExistingDestructuredAliasWrites.ts",
      [
        'import { query } from "../../../_generated/server";',
        "",
        "export const listCommands = query({",
        "  args: {},",
        "  handler: async (ctx) => {",
        "    const { db, auth }: { db: any; auth: unknown } = ctx as any;",
        "    await db.query(\"posTerminalRecoveryCommand\").collect();",
        "    await db.patch(\"command-id\" as never, { status: \"expired\" });",
        "    return [];",
        "  },",
        "});",
      ].join("\n"),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      baseRef: "HEAD",
      getChangedFiles: async () => [
        "packages/athena-webapp/convex/pos/public/queryExistingDestructuredAliasWrites.ts",
      ],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(1);
    expect(result.machine.findings).toContainEqual(
      expect.objectContaining({
        id: "convex-query-mutation-db-write-packages-athena-webapp-convex-pos-public-queryexistingdestructuredaliaswrites-ts",
        severity: "high",
      }),
    );
  });

  it("fails when a changed Convex query writes through a destructured handler db parameter", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/athena-webapp/convex/pos/public/queryDestructuredHandlerWrites.ts",
      [
        'import { query } from "../../../_generated/server";',
        "",
        "export const listCommands = query({",
        "  args: {},",
        "  handler: async () => {",
        "    return [];",
        "  },",
        "});",
      ].join("\n"),
      rootDir,
    );
    await commitFixtureRepo(rootDir);
    await write(
      "packages/athena-webapp/convex/pos/public/queryDestructuredHandlerWrites.ts",
      [
        'import { query } from "../../../_generated/server";',
        "",
        "export const listCommands = query({",
        "  args: {},",
        "  handler: async ({ db }: any) => {",
        "    await db.patch(\"command-id\" as never, { status: \"expired\" });",
        "    return [];",
        "  },",
        "});",
      ].join("\n"),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      baseRef: "HEAD",
      getChangedFiles: async () => [
        "packages/athena-webapp/convex/pos/public/queryDestructuredHandlerWrites.ts",
      ],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(1);
    expect(result.machine.findings).toContainEqual(
      expect.objectContaining({
        id: "convex-query-mutation-db-write-packages-athena-webapp-convex-pos-public-querydestructuredhandlerwrites-ts",
        severity: "high",
      }),
    );
  });

  it("fails when a changed Convex query writes through a casted db alias", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/athena-webapp/convex/pos/public/queryWritesAlias.ts",
      [
        'import { query, type MutationCtx } from "../../../_generated/server";',
        "",
        "export const listCommands = query({",
        "  args: {},",
        "  handler: async (ctx) => {",
        "    const db = (ctx as unknown as MutationCtx).db;",
        "    await db.patch(\"command-id\" as never, { status: \"expired\" });",
        "    return [];",
        "  },",
        "});",
      ].join("\n"),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => [
        "packages/athena-webapp/convex/pos/public/queryWritesAlias.ts",
      ],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(1);
    expect(result.machine.findings).toContainEqual(
      expect.objectContaining({
        id: "convex-query-mutation-db-write-packages-athena-webapp-convex-pos-public-querywritesalias-ts",
        severity: "high",
      }),
    );
  });

  it("fails when a changed Convex query writes through an any db alias", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/athena-webapp/convex/pos/public/queryWritesAnyAlias.ts",
      [
        'import { query } from "../../../_generated/server";',
        "",
        "export const listCommands = query({",
        "  args: {},",
        "  handler: async (ctx) => {",
        "    const db = ctx.db as any;",
        "    await db.patch(\"command-id\" as never, { status: \"expired\" });",
        "    return [];",
        "  },",
        "});",
      ].join("\n"),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => [
        "packages/athena-webapp/convex/pos/public/queryWritesAnyAlias.ts",
      ],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(1);
    expect(result.machine.findings).toContainEqual(
      expect.objectContaining({
        id: "convex-query-mutation-db-write-packages-athena-webapp-convex-pos-public-querywritesanyalias-ts",
        severity: "high",
      }),
    );
  });

  it("fails when a changed Convex query creates a write-capable repository", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/athena-webapp/convex/pos/public/queryFactoryWrites.ts",
      [
        'import { query } from "../../../_generated/server";',
        'import { createTerminalRecoveryCommandRepository } from "../infrastructure/repositories/terminalRecoveryRepository";',
        'import { listClaimableTerminalRecoveryCommands } from "../application/terminalRecovery/terminalCommandService";',
        "",
        "export const listCommands = query({",
        "  args: {},",
        "  handler: async (ctx) => {",
        "    const repository = createTerminalRecoveryCommandRepository(ctx);",
        "    return await listClaimableTerminalRecoveryCommands(repository, new Date());",
        "  },",
        "});",
      ].join("\n"),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => [
        "packages/athena-webapp/convex/pos/public/queryFactoryWrites.ts",
      ],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(1);
    expect(result.machine.findings).toContainEqual(
      expect.objectContaining({
        id: "convex-query-mutation-db-write-packages-athena-webapp-convex-pos-public-queryfactorywrites-ts",
        severity: "high",
      }),
    );
  });

  it("fails when a changed Convex query creates a write-capable repository from a renamed ctx parameter", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/athena-webapp/convex/pos/public/queryFactoryRenamedCtx.ts",
      [
        'import { query } from "../../../_generated/server";',
        'import { createTerminalRecoveryCommandRepository } from "../infrastructure/repositories/terminalRecoveryRepository";',
        "",
        "export const listCommands = query({",
        "  args: {},",
        "  handler: async (queryCtx) => {",
        "    const repository = createTerminalRecoveryCommandRepository(queryCtx as never);",
        "    await repository.patchCommand(\"command-id\" as never, { status: \"expired\" });",
        "    return [];",
        "  },",
        "});",
      ].join("\n"),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => [
        "packages/athena-webapp/convex/pos/public/queryFactoryRenamedCtx.ts",
      ],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(1);
    expect(result.machine.findings).toContainEqual(
      expect.objectContaining({
        id: "convex-query-mutation-db-write-packages-athena-webapp-convex-pos-public-queryfactoryrenamedctx-ts",
        severity: "high",
      }),
    );
  });

  it("fails when a changed Convex query passes ctx to a MutationCtx write helper", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/athena-webapp/convex/pos/public/queryHelperWrites.ts",
      [
        'import { query, type MutationCtx } from "../../../_generated/server";',
        "",
        "const expireCommands = async (ctx: MutationCtx): Promise<{ ok: boolean }> => {",
        "  await ctx.db.patch(\"command-id\" as never, { status: \"expired\" });",
        "  return { ok: true };",
        "};",
        "",
        "export const listCommands = query({",
        "  args: {},",
        "  handler: async (ctx) => {",
        "    await expireCommands(ctx as never);",
        "    return [];",
        "  },",
        "});",
      ].join("\n"),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => [
        "packages/athena-webapp/convex/pos/public/queryHelperWrites.ts",
      ],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(1);
    expect(result.machine.findings).toContainEqual(
      expect.objectContaining({
        id: "convex-query-mutation-db-write-packages-athena-webapp-convex-pos-public-queryhelperwrites-ts",
        severity: "high",
      }),
    );
  });

  it("fails when a changed Convex query imports an unchanged MutationCtx write helper", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/athena-webapp/convex/pos/application/writeHelpers.ts",
      [
        'import type { MutationCtx } from "../../../_generated/server";',
        "",
        "export const expireCommands = async (ctx: MutationCtx): Promise<void> => {",
        "  await ctx.db.patch(\"command-id\" as never, { status: \"expired\" });",
        "};",
      ].join("\n"),
      rootDir,
    );
    await commitFixtureRepo(rootDir);
    await write(
      "packages/athena-webapp/convex/pos/public/queryImportedExistingHelperWrites.ts",
      [
        'import { query } from "../../../_generated/server";',
        'import { expireCommands } from "../application/writeHelpers";',
        "",
        "export const listCommands = query({",
        "  args: {},",
        "  handler: async (ctx) => {",
        "    await expireCommands(ctx as never);",
        "    return [];",
        "  },",
        "});",
      ].join("\n"),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      baseRef: "HEAD",
      getChangedFiles: async () => [
        "packages/athena-webapp/convex/pos/public/queryImportedExistingHelperWrites.ts",
      ],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(1);
    expect(result.machine.findings).toContainEqual(
      expect.objectContaining({
        id: "convex-query-mutation-db-write-packages-athena-webapp-convex-pos-public-queryimportedexistinghelperwrites-ts",
        severity: "high",
      }),
    );
  });

  it("fails when a changed Convex query aliases an unchanged MutationCtx write helper import", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/athena-webapp/convex/pos/application/writeHelpers.ts",
      [
        'import type { MutationCtx } from "../../../_generated/server";',
        "",
        "export async function expireCommands(ctx: MutationCtx): Promise<void> {",
        "  await ctx.db.patch(\"command-id\" as never, { status: \"expired\" });",
        "}",
      ].join("\n"),
      rootDir,
    );
    await commitFixtureRepo(rootDir);
    await write(
      "packages/athena-webapp/convex/pos/public/queryImportedAliasHelperWrites.ts",
      [
        'import { query } from "../../../_generated/server";',
        'import { expireCommands as expireTerminalCommands } from "../application/writeHelpers";',
        "",
        "export const listCommands = query({",
        "  args: {},",
        "  handler: async (ctx) => {",
        "    await expireTerminalCommands(ctx as never);",
        "    return [];",
        "  },",
        "});",
      ].join("\n"),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      baseRef: "HEAD",
      getChangedFiles: async () => [
        "packages/athena-webapp/convex/pos/public/queryImportedAliasHelperWrites.ts",
      ],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(1);
    expect(result.machine.findings).toContainEqual(
      expect.objectContaining({
        id: "convex-query-mutation-db-write-packages-athena-webapp-convex-pos-public-queryimportedaliashelperwrites-ts",
        severity: "high",
      }),
    );
  });

  it("fails when a changed Convex query adds a call to a pre-existing write-helper import alias", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/athena-webapp/convex/pos/application/writeHelpers.ts",
      [
        'import type { MutationCtx } from "../../../_generated/server";',
        "",
        "export async function expireCommands(ctx: MutationCtx): Promise<void> {",
        "  await ctx.db.patch(\"command-id\" as never, { status: \"expired\" });",
        "}",
      ].join("\n"),
      rootDir,
    );
    await write(
      "packages/athena-webapp/convex/pos/public/queryImportedAliasHelperWrites.ts",
      [
        'import { query } from "../../../_generated/server";',
        'import { expireCommands as expireTerminalCommands } from "../application/writeHelpers";',
        "",
        "export const listCommands = query({",
        "  args: {},",
        "  handler: async () => {",
        "    return [];",
        "  },",
        "});",
      ].join("\n"),
      rootDir,
    );
    await commitFixtureRepo(rootDir);
    await write(
      "packages/athena-webapp/convex/pos/public/queryImportedAliasHelperWrites.ts",
      [
        'import { query } from "../../../_generated/server";',
        'import { expireCommands as expireTerminalCommands } from "../application/writeHelpers";',
        "",
        "export const listCommands = query({",
        "  args: {},",
        "  handler: async (ctx) => {",
        "    await expireTerminalCommands(ctx as never);",
        "    return [];",
        "  },",
        "});",
      ].join("\n"),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      baseRef: "HEAD",
      getChangedFiles: async () => [
        "packages/athena-webapp/convex/pos/public/queryImportedAliasHelperWrites.ts",
      ],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(1);
    expect(result.machine.findings).toContainEqual(
      expect.objectContaining({
        id: "convex-query-mutation-db-write-packages-athena-webapp-convex-pos-public-queryimportedaliashelperwrites-ts",
        severity: "high",
      }),
    );
  });

  it("fails when a changed Convex query imports a changed MutationCtx write helper", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/athena-webapp/convex/pos/application/writeHelpers.ts",
      [
        'import type { MutationCtx } from "../../../_generated/server";',
        "",
        "export async function expireCommands(ctx: MutationCtx): Promise<void> {",
        "  await ctx.db.patch(\"command-id\" as never, { status: \"expired\" });",
        "}",
      ].join("\n"),
      rootDir,
    );
    await write(
      "packages/athena-webapp/convex/pos/public/queryImportedHelperWrites.ts",
      [
        'import { query } from "../../../_generated/server";',
        'import { expireCommands } from "../application/writeHelpers";',
        "",
        "export const listCommands = query({",
        "  args: {},",
        "  handler: async (ctx) => {",
        "    await expireCommands(ctx as never);",
        "    return [];",
        "  },",
        "});",
      ].join("\n"),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => [
        "packages/athena-webapp/convex/pos/application/writeHelpers.ts",
        "packages/athena-webapp/convex/pos/public/queryImportedHelperWrites.ts",
      ],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(1);
    expect(result.machine.findings).toContainEqual(
      expect.objectContaining({
        id: "convex-query-mutation-db-write-packages-athena-webapp-convex-pos-public-queryimportedhelperwrites-ts",
        severity: "high",
      }),
    );
  });

  it("fails when a changed MutationCtx write helper has an unchanged aliased Convex query caller", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/athena-webapp/convex/pos/application/writeHelpers.ts",
      [
        'import type { QueryCtx } from "../../../_generated/server";',
        "",
        "export async function expireCommands(ctx: QueryCtx): Promise<void> {",
        "  await ctx.db.get(\"command-id\" as never);",
        "}",
      ].join("\n"),
      rootDir,
    );
    await write(
      "packages/athena-webapp/convex/pos/public/queryImportedAliasHelperWrites.ts",
      [
        'import { query } from "../../../_generated/server";',
        'import { expireCommands as expireTerminalCommands } from "../application/writeHelpers";',
        "",
        "export const listCommands = query({",
        "  args: {},",
        "  handler: async (ctx) => {",
        "    await expireTerminalCommands(ctx as never);",
        "    return [];",
        "  },",
        "});",
      ].join("\n"),
      rootDir,
    );
    await commitFixtureRepo(rootDir);
    await write(
      "packages/athena-webapp/convex/pos/application/writeHelpers.ts",
      [
        'import type { MutationCtx } from "../../../_generated/server";',
        "",
        "export async function expireCommands(ctx: MutationCtx): Promise<void> {",
        "  await ctx.db.patch(\"command-id\" as never, { status: \"expired\" });",
        "}",
      ].join("\n"),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      baseRef: "HEAD",
      getChangedFiles: async () => [
        "packages/athena-webapp/convex/pos/application/writeHelpers.ts",
      ],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(1);
    expect(result.machine.findings).toContainEqual(
      expect.objectContaining({
        id: "convex-query-mutation-db-write-packages-athena-webapp-convex-pos-public-queryimportedaliashelperwrites-ts",
        severity: "high",
      }),
    );
  });

  it("fails when a changed MutationCtx write helper has an unchanged Convex query caller", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/athena-webapp/convex/pos/application/writeHelpers.ts",
      [
        'import type { QueryCtx } from "../../../_generated/server";',
        "",
        "export const expireCommands = async (ctx: QueryCtx): Promise<void> => {",
        "  await ctx.db.get(\"command-id\" as never);",
        "};",
      ].join("\n"),
      rootDir,
    );
    await write(
      "packages/athena-webapp/convex/pos/public/queryImportedHelperWrites.ts",
      [
        'import { query } from "../../../_generated/server";',
        'import { expireCommands } from "../application/writeHelpers";',
        "",
        "export const listCommands = query({",
        "  args: {},",
        "  handler: async (ctx) => {",
        "    await expireCommands(ctx as never);",
        "    return [];",
        "  },",
        "});",
      ].join("\n"),
      rootDir,
    );
    await commitFixtureRepo(rootDir);
    await write(
      "packages/athena-webapp/convex/pos/application/writeHelpers.ts",
      [
        'import type { MutationCtx } from "../../../_generated/server";',
        "",
        "export const expireCommands = async (ctx: MutationCtx): Promise<void> => {",
        "  await ctx.db.patch(\"command-id\" as never, { status: \"expired\" });",
        "};",
      ].join("\n"),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      baseRef: "HEAD",
      getChangedFiles: async () => [
        "packages/athena-webapp/convex/pos/application/writeHelpers.ts",
      ],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(1);
    expect(result.machine.findings).toContainEqual(
      expect.objectContaining({
        id: "convex-query-mutation-db-write-packages-athena-webapp-convex-pos-public-queryimportedhelperwrites-ts",
        severity: "high",
      }),
    );
  });

  it("accepts a changed Convex query with a local read-only helper shadowing an unrelated write helper name", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/athena-webapp/convex/pos/application/writeHelpers.ts",
      [
        'import type { MutationCtx } from "../../../_generated/server";',
        "",
        "export async function createOffer(ctx: MutationCtx): Promise<void> {",
        "  await ctx.db.patch(\"offer-id\" as never, { status: \"expired\" });",
        "}",
      ].join("\n"),
      rootDir,
    );
    await commitFixtureRepo(rootDir);
    await write(
      "packages/athena-webapp/convex/pos/public/queryLocalReadHelper.ts",
      [
        'import { query } from "../../../_generated/server";',
        "",
        "async function createOffer(ctx: unknown): Promise<unknown> {",
        "  return await Promise.resolve(ctx);",
        "}",
        "",
        "export const listCommands = query({",
        "  args: {},",
        "  handler: async (ctx) => {",
        "    await createOffer(ctx);",
        "    return [];",
        "  },",
        "});",
      ].join("\n"),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      baseRef: "HEAD",
      getChangedFiles: async () => [
        "packages/athena-webapp/convex/pos/public/queryLocalReadHelper.ts",
      ],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(0);
  });

  it("accepts a changed Convex query that creates a read-only repository", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/athena-webapp/convex/pos/public/queryReadFactory.ts",
      [
        'import { query } from "../../../_generated/server";',
        'import { createTerminalRecoveryCommandReadRepository } from "../infrastructure/repositories/terminalRecoveryRepository";',
        'import { listClaimableTerminalRecoveryCommands } from "../application/terminalRecovery/terminalCommandService";',
        "",
        "export const listCommands = query({",
        "  args: {},",
        "  handler: async (ctx) => {",
        "    const repository = createTerminalRecoveryCommandReadRepository(ctx);",
        "    return await listClaimableTerminalRecoveryCommands(repository, new Date());",
        "  },",
        "});",
      ].join("\n"),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => [
        "packages/athena-webapp/convex/pos/public/queryReadFactory.ts",
      ],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(0);
    expect(result.machine.status).toBe("pass");
    expect(result.machine.findings).toEqual([]);
  });

  it("fails when a staged-only tracked Convex query writes", async () => {
    const rootDir = await createFixtureRepo();
    const queryPath =
      "packages/athena-webapp/convex/pos/public/stagedQueryWrites.ts";
    await write(
      queryPath,
      [
        'import { query } from "../../../_generated/server";',
        "",
        "export const listCommands = query({",
        "  args: {},",
        "  handler: async () => {",
        "    return [];",
        "  },",
        "});",
      ].join("\n"),
      rootDir,
    );
    await runFixtureCommand(rootDir, ["git", "init"]);
    await runFixtureCommand(rootDir, ["git", "config", "user.email", "fixture@example.com"]);
    await runFixtureCommand(rootDir, ["git", "config", "user.name", "Fixture"]);
    await runFixtureCommand(rootDir, ["git", "add", "."]);
    await runFixtureCommand(rootDir, ["git", "commit", "-m", "baseline"]);
    await write(
      queryPath,
      [
        'import { query } from "../../../_generated/server";',
        "",
        "export const listCommands = query({",
        "  args: {},",
        "  handler: async (ctx) => {",
        "    await ctx.db.patch(\"command-id\" as never, { status: \"expired\" });",
        "    return [];",
        "  },",
        "});",
      ].join("\n"),
      rootDir,
    );
    await runFixtureCommand(rootDir, ["git", "add", queryPath]);

    const result = await runHarnessInferentialReview(rootDir, {
      baseRef: "HEAD",
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(1);
    expect(result.machine.changedFiles).toContain(queryPath);
    expect(result.machine.findings).toContainEqual(
      expect.objectContaining({
        id: "convex-query-mutation-db-write-packages-athena-webapp-convex-pos-public-stagedquerywrites-ts",
        severity: "high",
      }),
    );
  });

  it("fails when a changed internal query casts ctx to MutationCtx before writing", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/athena-webapp/convex/pos/internal/queryWrites.ts",
      [
        'import { internalQuery, type MutationCtx } from "../../_generated/server";',
        "",
        "export const listCommands = internalQuery({",
        "  args: {},",
        "  handler: async (ctx) => {",
        "    await (ctx as unknown as MutationCtx).db.delete(\"command-id\" as never);",
        "    return [];",
        "  },",
        "});",
      ].join("\n"),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => [
        "packages/athena-webapp/convex/pos/internal/queryWrites.ts",
      ],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(1);
    expect(result.machine.findings).toContainEqual(
      expect.objectContaining({
        id: "convex-query-mutation-db-write-packages-athena-webapp-convex-pos-internal-querywrites-ts",
        severity: "high",
      }),
    );
  });

  it("fails when a changed mixed QueryCtx alias repository casts to MutationCtx and writes", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/athena-webapp/convex/pos/infrastructure/repositories/mixedRepository.ts",
      [
        'import type { MutationCtx, QueryCtx } from "../../../_generated/server";',
        "",
        "type MixedCtx = QueryCtx | MutationCtx;",
        "",
        "export function createMixedRepository(ctx: MixedCtx) {",
        "  return {",
        "    async listCommands() {",
        "      return await ctx.db.query(\"posTerminalRecoveryCommand\").collect();",
        "    },",
        "    async patchCommand(id: string, patch: Record<string, unknown>) {",
        "      await (ctx as MutationCtx).db.patch(id as never, patch);",
        "    },",
        "  };",
        "}",
      ].join("\n"),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => [
        "packages/athena-webapp/convex/pos/infrastructure/repositories/mixedRepository.ts",
      ],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(1);
    expect(result.machine.findings).toContainEqual(
      expect.objectContaining({
        id: "convex-query-compatible-write-surface-packages-athena-webapp-convex-pos-infrastructure-repositories-mixedrepository-ts",
        severity: "high",
      }),
    );
  });

  it("fails when a changed arrow mixed QueryCtx repository writes", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/athena-webapp/convex/pos/infrastructure/repositories/arrowMixedRepository.ts",
      [
        'import type { MutationCtx, QueryCtx } from "../../../_generated/server";',
        "",
        "type MixedCtx = QueryCtx | MutationCtx;",
        "",
        "export const createMixedRepository = (ctx: MixedCtx) => ({",
        "  async listCommands() {",
        "    return await ctx.db.query(\"posTerminalRecoveryCommand\").collect();",
        "  },",
        "  async patchCommand(id: string, patch: Record<string, unknown>) {",
        "    await (ctx as MutationCtx).db.patch(id as never, patch);",
        "  },",
        "});",
      ].join("\n"),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => [
        "packages/athena-webapp/convex/pos/infrastructure/repositories/arrowMixedRepository.ts",
      ],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(1);
    expect(result.machine.findings).toContainEqual(
      expect.objectContaining({
        id: "convex-query-compatible-write-surface-packages-athena-webapp-convex-pos-infrastructure-repositories-arrowmixedrepository-ts",
        severity: "high",
      }),
    );
  });

  it("fails when a changed repository only widens MutationCtx to QueryCtx while retaining writes", async () => {
    const rootDir = await createFixtureRepo();
    const repositoryPath =
      "packages/athena-webapp/convex/pos/infrastructure/repositories/widenedRepository.ts";
    await write(
      repositoryPath,
      [
        'import type { MutationCtx, QueryCtx } from "../../../_generated/server";',
        "",
        "export function createWidenedRepository(ctx: MutationCtx) {",
        "  return {",
        "    async patchCommand(id: string, patch: Record<string, unknown>) {",
        "      await ctx.db.patch(id as never, patch);",
        "    },",
        "  };",
        "}",
      ].join("\n"),
      rootDir,
    );
    await runFixtureCommand(rootDir, ["git", "init"]);
    await runFixtureCommand(rootDir, ["git", "config", "user.email", "fixture@example.com"]);
    await runFixtureCommand(rootDir, ["git", "config", "user.name", "Fixture"]);
    await runFixtureCommand(rootDir, ["git", "add", "."]);
    await runFixtureCommand(rootDir, ["git", "commit", "-m", "baseline"]);
    await write(
      repositoryPath,
      [
        'import type { MutationCtx, QueryCtx } from "../../../_generated/server";',
        "",
        "export function createWidenedRepository(ctx: QueryCtx | MutationCtx) {",
        "  return {",
        "    async patchCommand(id: string, patch: Record<string, unknown>) {",
        "      await ctx.db.patch(id as never, patch);",
        "    },",
        "  };",
        "}",
      ].join("\n"),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      baseRef: "HEAD",
      getChangedFiles: async () => [repositoryPath],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(1);
    expect(result.machine.findings).toContainEqual(
      expect.objectContaining({
        id: "convex-query-compatible-write-surface-packages-athena-webapp-convex-pos-infrastructure-repositories-widenedrepository-ts",
        severity: "high",
      }),
    );
  });

  it("fails for Pick<QueryCtx | MutationCtx, db> style mixed ctx shapes that write", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/athena-webapp/convex/pos/infrastructure/repositories/pickRepository.ts",
      [
        'import type { MutationCtx, QueryCtx } from "../../../_generated/server";',
        "",
        "type DbCtx = Pick<QueryCtx | MutationCtx, \"db\">;",
        "",
        "export async function replaceCommand(ctx: DbCtx, id: string) {",
        "  await (ctx as unknown as MutationCtx).db.replace(id as never, {});",
        "}",
      ].join("\n"),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => [
        "packages/athena-webapp/convex/pos/infrastructure/repositories/pickRepository.ts",
      ],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(1);
    expect(result.machine.findings).toContainEqual(
      expect.objectContaining({
        id: "convex-query-compatible-write-surface-packages-athena-webapp-convex-pos-infrastructure-repositories-pickrepository-ts",
        severity: "high",
      }),
    );
  });

  it("fails when a changed query-facing service calls a write repository method", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/athena-webapp/convex/pos/application/terminalRecovery/queryFacingService.ts",
      [
        "type CommandRepository = {",
        "  listCommands(): Promise<unknown[]>;",
        "  patchCommand(id: string, patch: Record<string, unknown>): Promise<void>;",
        "};",
        "",
        "export async function listClaimableCommands(repository: CommandRepository) {",
        "  await repository.patchCommand(\"command-id\", { status: \"expired\" });",
        "  return await repository.listCommands();",
        "}",
      ].join("\n"),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => [
        "packages/athena-webapp/convex/pos/application/terminalRecovery/queryFacingService.ts",
      ],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(1);
    expect(result.machine.findings).toContainEqual(
      expect.objectContaining({
        id: "convex-query-facing-write-repository-packages-athena-webapp-convex-pos-application-terminalrecovery-queryfacingservice-ts",
        severity: "high",
      }),
    );
  });

  it("accepts changed mutations that use write repositories", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/athena-webapp/convex/pos/public/mutationWrites.ts",
      [
        'import { mutation } from "../../../_generated/server";',
        "",
        "export const expireCommand = mutation({",
        "  args: {},",
        "  handler: async (_ctx) => {",
        "    const repository = {",
        "      async patchCommand() {",
        "        return undefined;",
        "      },",
        "    };",
        "    await repository.patchCommand();",
        "    return null;",
        "  },",
        "});",
      ].join("\n"),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => [
        "packages/athena-webapp/convex/pos/public/mutationWrites.ts",
      ],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(0);
    expect(result.machine.status).toBe("pass");
    expect(result.machine.findings).toEqual([]);
  });

  it("accepts read-only helpers that accept QueryCtx or MutationCtx", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/athena-webapp/convex/pos/infrastructure/repositories/readRepository.ts",
      [
        'import type { MutationCtx, QueryCtx } from "../../../_generated/server";',
        "",
        "type MixedCtx = QueryCtx | MutationCtx;",
        "",
        "export async function listCommands(ctx: MixedCtx) {",
        "  return await ctx.db.query(\"posTerminalRecoveryCommand\").collect();",
        "}",
      ].join("\n"),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => [
        "packages/athena-webapp/convex/pos/infrastructure/repositories/readRepository.ts",
      ],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(0);
    expect(result.machine.status).toBe("pass");
    expect(result.machine.findings).toEqual([]);
  });

  it("accepts read-only edits to an existing mixed repository with historical writes", async () => {
    const rootDir = await createFixtureRepo();
    const repositoryPath =
      "packages/athena-webapp/convex/pos/infrastructure/repositories/existingMixedRepository.ts";
    await write(
      repositoryPath,
      [
        'import type { MutationCtx, QueryCtx } from "../../../_generated/server";',
        "",
        "type MixedCtx = QueryCtx | MutationCtx;",
        "",
        "export function createExistingRepository(ctx: MixedCtx) {",
        "  return {",
        "    async listCommands() {",
        "      return await ctx.db.query(\"posTerminalRecoveryCommand\").collect();",
        "    },",
        "    async patchCommand(id: string, patch: Record<string, unknown>) {",
        "      await (ctx as MutationCtx).db.patch(id as never, patch);",
        "    },",
        "  };",
        "}",
      ].join("\n"),
      rootDir,
    );
    await runFixtureCommand(rootDir, ["git", "init"]);
    await runFixtureCommand(rootDir, ["git", "config", "user.email", "fixture@example.com"]);
    await runFixtureCommand(rootDir, ["git", "config", "user.name", "Fixture"]);
    await runFixtureCommand(rootDir, ["git", "add", "."]);
    await runFixtureCommand(rootDir, ["git", "commit", "-m", "baseline"]);
    await write(
      repositoryPath,
      [
        'import type { MutationCtx, QueryCtx } from "../../../_generated/server";',
        "",
        "type MixedCtx = QueryCtx | MutationCtx;",
        "",
        "export function createExistingRepository(ctx: MixedCtx) {",
        "  return {",
        "    async listCommands() {",
        "      const query = ctx.db.query(\"posTerminalRecoveryCommand\");",
        "      return await query.collect();",
        "    },",
        "    async patchCommand(id: string, patch: Record<string, unknown>) {",
        "      await (ctx as MutationCtx).db.patch(id as never, patch);",
        "    },",
        "  };",
        "}",
      ].join("\n"),
      rootDir,
    );

    const result = await runHarnessInferentialReview(rootDir, {
      baseRef: "HEAD",
      getChangedFiles: async () => [repositoryPath],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(0);
    expect(result.machine.status).toBe("pass");
    expect(result.machine.findings).toEqual([]);
  });

  it("writes machine-readable output with additive shadow data via the default artifact path", async () => {
    const rootDir = await createFixtureRepo();

    const result = await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => ["package.json"],
      semanticMode: "shadow",
      runSemanticAnalysis: async () => ({
        providerName: "semantic-shadow-stub",
        findings: [
          {
            id: "semantic-doc-gap",
            severity: "low",
            title: "Semantic doc gap",
            filePath: "package.json",
            rationale: "The semantic reviewer found a likely docs mismatch.",
            remediation: "Document the new wiring in the testing guide.",
          },
        ],
      }),
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    const saved = JSON.parse(
      await readFile(path.join(rootDir, result.machineOutputPath), "utf8"),
    ) as {
      status: string;
      providerName: string;
      reviewMode?: string;
      shadow?: { providerName: string; status: string };
    };
    expect(saved.status).toBe("pass");
    expect(saved.providerName).toBe("deterministic-policy-v1");
    expect(saved.reviewMode).toBe("semantic-shadow");
    expect(saved.shadow).toMatchObject({
      providerName: "semantic-shadow-stub",
      status: "fail",
    });
  });

  it("writes a timestamped inferential history snapshot when persistence is enabled", async () => {
    const rootDir = await createFixtureRepo();

    await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => ["package.json"],
      semanticMode: "shadow",
      persistHistory: true,
      runSemanticAnalysis: async () => ({
        providerName: "semantic-shadow-stub",
        findings: [],
      }),
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    const historySnapshot = JSON.parse(
      await readFile(
        path.join(
          rootDir,
          "artifacts/harness-inferential-review/history/2026-04-12T05-00-00-000Z.json",
        ),
        "utf8",
      ),
    ) as {
      status: string;
      reviewMode?: string;
      shadow?: { providerName: string; status: string };
    };

    expect(historySnapshot.status).toBe("pass");
    expect(historySnapshot.reviewMode).toBe("semantic-shadow");
    expect(historySnapshot.shadow).toMatchObject({
      providerName: "semantic-shadow-stub",
      status: "pass",
    });
  });
});

describe("parseHarnessInferentialReviewArgs", () => {
  it("accepts --persist-history", () => {
    expect(
      parseHarnessInferentialReviewArgs([
        "--base",
        "origin/main",
        "--persist-history",
      ]),
    ).toMatchObject({
      baseRef: "origin/main",
      persistHistory: true,
      help: false,
    });
  });
});
