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

async function createFixtureRepo() {
  const rootDir = await mkdtemp(
    path.join(tmpdir(), "athena-harness-inferential-review-")
  );
  tempRoots.push(rootDir);

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
      2
    ),
    rootDir
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
      "      - name: Inferential harness review",
      "        env:",
      "          HARNESS_INFERENTIAL_SEMANTIC_MODE: shadow",
      "        run: bun run harness:inferential-review",
      "      - name: Harness audit",
      "        run: bun run harness:audit",
      "      - name: Graphify check",
      "        run: bun run graphify:check",
    ].join("\n"),
    rootDir
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
    rootDir
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
    rootDir
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
    rootDir
  );

  await write(
    "scripts/harness-inferential-review.test.ts",
    [
      "import { describe, expect, it } from \"vitest\";",
      "",
      "import { runHarnessInferentialReviewStub } from \"./harness-inferential-review\";",
      "",
      "describe(\"runHarnessInferentialReviewStub\", () => {",
      "  it(\"returns the stubbed value\", () => {",
      "    expect(runHarnessInferentialReviewStub()).toBe(true);",
      "  });",
      "});",
    ].join("\n"),
    rootDir
  );

  return rootDir;
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((rootDir) =>
      rm(rootDir, { recursive: true, force: true })
    )
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
              "bun run harness:check && bun run harness:audit && bun run graphify:check",
          },
        },
        null,
        2
      ),
      rootDir
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
    expect(result.humanReport).toContain("Harness script changed without test update");
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
        "      - name: Inferential harness review",
        "        run: bun run harness:inferential-review",
        "      - name: Harness audit",
        "        run: bun run harness:audit",
        "      - name: Graphify check",
        "        run: bun run graphify:check",
      ].join("\n"),
      rootDir
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
      })
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
    expect(result.humanReport).toContain("Confirm provider configuration and connectivity");
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
    expect(result.humanReport).toContain("No harness-critical files are in scope.");
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
      await readFile(path.join(rootDir, result.machineOutputPath), "utf8")
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
          "artifacts/harness-inferential-review/history/2026-04-12T05-00-00-000Z.json"
        ),
        "utf8"
      )
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
      parseHarnessInferentialReviewArgs(["--base", "origin/main", "--persist-history"])
    ).toMatchObject({
      baseRef: "origin/main",
      persistHistory: true,
      help: false,
    });
  });
});
