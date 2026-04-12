import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runHarnessInferentialReview } from "./harness-inferential-review";

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
            "bun run harness:check && bun run harness:inferential-review && bun run harness:audit",
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
      "      - name: Inferential harness review",
      "        run: bun run harness:inferential-review",
    ].join("\n"),
    rootDir
  );

  await write(
    "packages/athena-webapp/docs/agent/testing.md",
    [
      "# Athena Webapp Testing",
      "",
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
      "- `bun run harness:inferential-review` is the inferential harness gate.",
      "- Inferential findings are blocking and exit non-zero with remediation guidance.",
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
            "pr:athena": "bun run harness:check && bun run harness:audit",
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

  it("passes cleanly with zero actionable findings", async () => {
    const rootDir = await createFixtureRepo();

    const result = await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => [
        "package.json",
        ".github/workflows/athena-pr-tests.yml",
        "packages/athena-webapp/docs/agent/testing.md",
      ],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.exitCode).toBe(0);
    expect(result.machine.status).toBe("pass");
    expect(result.machine.findings).toEqual([]);
    expect(result.humanReport).toContain("No actionable inferential findings.");
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

  it("writes machine-readable output via the default artifact path", async () => {
    const rootDir = await createFixtureRepo();

    const result = await runHarnessInferentialReview(rootDir, {
      getChangedFiles: async () => ["README.md"],
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    const saved = JSON.parse(
      await readFile(path.join(rootDir, result.machineOutputPath), "utf8")
    ) as { status: string };
    expect(saved.status).toBe("skipped");
  });
});
