import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertCompoundSolutionCheck,
  collectCompoundSolutionFindings,
  extractSolutionReferences,
  isConsiderableSourcePath,
} from "./compound-solution-check";

const tempRoots: string[] = [];

async function createFixtureRepo() {
  const rootDir = await mkdtemp(path.join(tmpdir(), "athena-compound-check-"));
  tempRoots.push(rootDir);

  runGit(rootDir, ["init"]);
  runGit(rootDir, ["config", "user.email", "test@example.com"]);
  runGit(rootDir, ["config", "user.name", "Test User"]);
  await write(rootDir, "README.md", "# Fixture\n");
  runGit(rootDir, ["add", "."]);
  runGit(rootDir, ["commit", "-m", "initial fixture"]);

  return rootDir;
}

async function write(rootDir: string, relativePath: string, contents: string) {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

function runGit(rootDir: string, args: string[]) {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: rootDir,
    env: gitEnv(),
    stderr: "pipe",
    stdout: "pipe",
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${result.stderr.toString().trim()}`
    );
  }
}

function gitEnv() {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  return env;
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((rootDir) =>
      rm(rootDir, { recursive: true, force: true })
    )
  );
});

function lineChanges(entries: Array<[string, number, number]>) {
  return new Map(
    entries.map(([filePath, additions, deletions]) => [
      filePath,
      { additions, deletions },
    ])
  );
}

function solutionNote(title = "Procurement") {
  return `---
title: ${title}
date: 2026-05-06
category: harness
module: repo
problem_type: missing_guardrail
component: compound-check
resolution_type: guardrail
severity: medium
tags:
  - compound
---

# ${title}

## Problem

Substantial work needs durable delivery context.

## Solution

Require a concrete solution note before merge.

## Prevention

Run the compound check before handoff.
`;
}

describe("extractSolutionReferences", () => {
  it("finds repo-relative solution doc references in markdown", () => {
    expect(
      extractSolutionReferences(
        "See docs/solutions/harness/compound-solution-gate-2026-05-05.md."
      )
    ).toEqual(["docs/solutions/harness/compound-solution-gate-2026-05-05.md"]);
  });
});

describe("isConsiderableSourcePath", () => {
  it.each([
    "packages/athena-webapp/src/components/ProcurementView.tsx",
    "packages/athena-webapp/convex/purchaseOrders.ts",
    "packages/athena-webapp/shared/procurement.ts",
    "scripts/compound-solution-check.ts",
  ])("matches behavior-bearing source file %s", (filePath) => {
    expect(isConsiderableSourcePath(filePath)).toBe(true);
  });

  it.each([
    "scripts/compound-solution-check.test.ts",
    "docs/solutions/harness/compound-solution-gate-2026-05-05.md",
    "graphify-out/GRAPH_REPORT.md",
    "packages/athena-webapp/convex/_generated/api.d.ts",
  ])("ignores non-source or generated file %s", (filePath) => {
    expect(isConsiderableSourcePath(filePath)).toBe(false);
  });
});

describe("collectCompoundSolutionFindings", () => {
  it("passes docs-only changes without a solution doc", () => {
    const findings = collectCompoundSolutionFindings({
      changedFiles: ["docs/harness.md"],
      existingFiles: new Set(["docs/harness.md"]),
      markdownContents: new Map([["docs/harness.md", "# Harness\n"]]),
      sourceLineChanges: lineChanges([]),
    });

    expect(findings).toEqual([]);
  });

  it("fails when changed docs reference a missing solution doc", () => {
    const findings = collectCompoundSolutionFindings({
      changedFiles: ["docs/plans/procurement.md"],
      existingFiles: new Set(["docs/plans/procurement.md"]),
      markdownContents: new Map([
        [
          "docs/plans/procurement.md",
          "Compound in docs/solutions/logic-errors/procurement.md.",
        ],
      ]),
      sourceLineChanges: lineChanges([]),
    });

    expect(findings).toEqual([
      {
        message:
          "docs/plans/procurement.md references docs/solutions/logic-errors/procurement.md, but that solution doc does not exist.",
      },
    ]);
  });

  it("passes when changed docs reference an existing solution doc", () => {
    const findings = collectCompoundSolutionFindings({
      changedFiles: ["docs/plans/procurement.md"],
      existingFiles: new Set([
        "docs/plans/procurement.md",
        "docs/solutions/logic-errors/procurement.md",
      ]),
      markdownContents: new Map([
        [
          "docs/plans/procurement.md",
          "Compound in docs/solutions/logic-errors/procurement.md.",
        ],
      ]),
      sourceLineChanges: lineChanges([]),
    });

    expect(findings).toEqual([]);
  });

  it("fails substantial source changes without a changed solution doc", () => {
    const findings = collectCompoundSolutionFindings({
      changedFiles: ["packages/athena-webapp/src/components/ProcurementView.tsx"],
      existingFiles: new Set([
        "packages/athena-webapp/src/components/ProcurementView.tsx",
      ]),
      markdownContents: new Map(),
      sourceLineChanges: lineChanges([
        ["packages/athena-webapp/src/components/ProcurementView.tsx", 151, 0],
      ]),
    });

    expect(findings).toEqual([
      {
        message:
          "Substantial source change detected (151 changed source lines, threshold 150) without a docs/solutions/**/*.md update.",
      },
    ]);
  });

  it("passes substantial source changes with a changed solution doc", () => {
    const findings = collectCompoundSolutionFindings({
      changedFiles: [
        "docs/solutions/logic-errors/procurement.md",
        "packages/athena-webapp/src/components/ProcurementView.tsx",
      ],
      existingFiles: new Set([
        "docs/solutions/logic-errors/procurement.md",
        "packages/athena-webapp/src/components/ProcurementView.tsx",
      ]),
      markdownContents: new Map([
        ["docs/solutions/logic-errors/procurement.md", solutionNote()],
      ]),
      sourceLineChanges: lineChanges([
        ["packages/athena-webapp/src/components/ProcurementView.tsx", 151, 0],
      ]),
    });

    expect(findings).toEqual([]);
  });

  it("passes small source changes below the threshold", () => {
    const findings = collectCompoundSolutionFindings({
      changedFiles: ["packages/athena-webapp/src/components/ProcurementView.tsx"],
      existingFiles: new Set([
        "packages/athena-webapp/src/components/ProcurementView.tsx",
      ]),
      markdownContents: new Map(),
      sourceLineChanges: lineChanges([
        ["packages/athena-webapp/src/components/ProcurementView.tsx", 75, 20],
      ]),
    });

    expect(findings).toEqual([]);
  });

  it("passes workflow test-only changes without a solution doc", () => {
    const findings = collectCompoundSolutionFindings({
      changedFiles: ["scripts/compound-solution-check.test.ts"],
      existingFiles: new Set(["scripts/compound-solution-check.test.ts"]),
      markdownContents: new Map(),
      sourceLineChanges: lineChanges([
        ["scripts/compound-solution-check.test.ts", 30, 2],
      ]),
    });

    expect(findings).toEqual([]);
  });

  it("fails sensitive workflow changes below the line threshold without a solution doc", () => {
    const findings = collectCompoundSolutionFindings({
      changedFiles: ["scripts/compound-solution-check.ts"],
      existingFiles: new Set(["scripts/compound-solution-check.ts"]),
      markdownContents: new Map(),
      sourceLineChanges: lineChanges([["scripts/compound-solution-check.ts", 5, 1]]),
    });

    expect(findings).toEqual([
      {
        message:
          "Compound-sensitive workflow changes detected in scripts/compound-solution-check.ts without a docs/solutions/**/*.md update.",
      },
    ]);
  });

  it("fails changed solution notes that are placeholders", () => {
    const findings = collectCompoundSolutionFindings({
      changedFiles: [
        "docs/solutions/harness/placeholder.md",
        "packages/athena-webapp/src/components/ProcurementView.tsx",
      ],
      existingFiles: new Set([
        "docs/solutions/harness/placeholder.md",
        "packages/athena-webapp/src/components/ProcurementView.tsx",
      ]),
      markdownContents: new Map([
        ["docs/solutions/harness/placeholder.md", "# Placeholder\n"],
      ]),
      sourceLineChanges: lineChanges([
        ["packages/athena-webapp/src/components/ProcurementView.tsx", 151, 0],
      ]),
    });

    expect(findings).toEqual([
      {
        message:
          "Changed solution note docs/solutions/harness/placeholder.md is missing required frontmatter fields: title, date, category, module, problem_type, component, resolution_type, severity, tags.",
      },
      {
        message:
          "Changed solution note docs/solutions/harness/placeholder.md is missing required sections: Problem, Solution, Prevention.",
      },
    ]);
  });
});

describe("assertCompoundSolutionCheck", () => {
  it("fails when changed markdown points at a missing solution note", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      rootDir,
      "docs/plans/procurement.md",
      "Compound in docs/solutions/logic-errors/procurement.md.\n"
    );

    expect(() =>
      assertCompoundSolutionCheck(rootDir, {
        baseRef: "HEAD",
      })
    ).toThrow(
      "docs/plans/procurement.md references docs/solutions/logic-errors/procurement.md, but that solution doc does not exist."
    );
  });

  it("fails when an untracked source file crosses the compound threshold", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      rootDir,
      "scripts/new-harness-sensor.ts",
      Array.from({ length: 12 }, (_, index) => `export const value${index} = ${index};`)
        .join("\n")
        .concat("\n")
    );

    expect(() =>
      assertCompoundSolutionCheck(rootDir, {
        baseRef: "HEAD",
        threshold: 10,
      })
    ).toThrow(
      "Substantial source change detected (13 changed source lines, threshold 10) without a docs/solutions/**/*.md update."
    );
  });

  it("passes substantial source changes when a solution note changes too", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      rootDir,
      "scripts/new-harness-sensor.ts",
      Array.from({ length: 12 }, (_, index) => `export const value${index} = ${index};`)
        .join("\n")
        .concat("\n")
    );
    await write(
      rootDir,
      "docs/solutions/harness/compound-solution-gate.md",
      solutionNote("Compound Solution Gate")
    );

    expect(() =>
      assertCompoundSolutionCheck(rootDir, {
        baseRef: "HEAD",
        threshold: 10,
      })
    ).not.toThrow();
  });
});
