import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  AGENT_SOLUTION_DISCOVERY_DOC_PATTERN,
  REQUIRED_SOLUTION_FRONTMATTER_FIELDS,
  REQUIRED_SOLUTION_SECTIONS,
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

function architectureSolutionNote(title = "Terminal Boundary") {
  return solutionNote(title)
    .replace("category: harness", "category: architecture")
    .replace("module: repo", "module: pos")
    .replace("component: compound-check", "component: terminal-health")
    .replace("resolution_type: guardrail", "resolution_type: foundational_store_schedule");
}

function nonFoundationalArchitectureSolutionNote(title = "Terminal Detail") {
  return solutionNote(title)
    .replace("category: harness", "category: architecture")
    .replace("module: repo", "module: pos")
    .replace("component: compound-check", "component: terminal-health")
    .replace("resolution_type: guardrail", "resolution_type: workflow_improvement");
}

function extractTemplateBlock(template: string, heading: string, nextHeading?: string) {
  const start = template.indexOf(heading);
  const end = nextHeading
    ? template.indexOf(nextHeading, start + heading.length)
    : -1;

  return template.slice(start, end === -1 ? undefined : end);
}

describe("extractSolutionReferences", () => {
  it("finds repo-relative solution doc references in markdown", () => {
    expect(
      extractSolutionReferences(
        "See docs/solutions/harness/compound-solution-gate-2026-05-05.md."
      )
    ).toEqual(["docs/solutions/harness/compound-solution-gate-2026-05-05.md"]);
  });

  it("resolves package-agent relative solution doc links to repo paths", () => {
    expect(
      extractSolutionReferences(
        "See [context primitives](../../../../docs/solutions/architecture/athena-intelligence-context-primitives-2026-06-21.md).",
        "packages/storefront-webapp/docs/agent/architecture.md"
      )
    ).toEqual([
      "docs/solutions/architecture/athena-intelligence-context-primitives-2026-06-21.md",
    ]);
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

describe("solution authoring affordances", () => {
  it("keeps ce-compound templates aligned with validator-required fields and sections", () => {
    const template = readFileSync(
      path.resolve(
        import.meta.dirname,
        "../.agents/skills/ce-compound/assets/resolution-template.md"
      ),
      "utf8"
    );
    const bugTemplate = extractTemplateBlock(
      template,
      "## Bug Track Template",
      "## Knowledge Track Template"
    );
    const knowledgeTemplate = extractTemplateBlock(
      template,
      "## Knowledge Track Template"
    );

    for (const templateBlock of [bugTemplate, knowledgeTemplate]) {
      for (const field of REQUIRED_SOLUTION_FRONTMATTER_FIELDS) {
        expect(templateBlock).toContain(`${field}:`);
      }

      for (const section of REQUIRED_SOLUTION_SECTIONS) {
        expect(templateBlock).toContain(`## ${section}`);
      }
    }
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

  it("fails when changed agent docs contain a relative solution link that does not resolve", () => {
    const findings = collectCompoundSolutionFindings({
      changedFiles: ["packages/athena-webapp/docs/agent/architecture.md"],
      existingFiles: new Set(["packages/athena-webapp/docs/agent/architecture.md"]),
      markdownContents: new Map([
        [
          "packages/athena-webapp/docs/agent/architecture.md",
          "See [missing](../../../../docs/solutions/architecture/missing-foundation.md).",
        ],
      ]),
      sourceLineChanges: lineChanges([]),
    });

    expect(findings).toEqual([
      {
        message:
          "packages/athena-webapp/docs/agent/architecture.md references docs/solutions/architecture/missing-foundation.md, but that solution doc does not exist.",
      },
    ]);
  });

  it("fails when existing agent docs contain a relative solution link that does not resolve", () => {
    const findings = collectCompoundSolutionFindings({
      changedFiles: ["docs/harness.md"],
      existingFiles: new Set([
        "docs/harness.md",
        "packages/athena-webapp/docs/agent/architecture.md",
      ]),
      markdownContents: new Map([["docs/harness.md", "# Harness\n"]]),
      agentDocContents: new Map([
        [
          "packages/athena-webapp/docs/agent/architecture.md",
          "See [missing](../../../../docs/solutions/architecture/missing-foundation.md).",
        ],
      ]),
      sourceLineChanges: lineChanges([]),
    });

    expect(findings).toEqual([
      {
        message:
          "packages/athena-webapp/docs/agent/architecture.md references docs/solutions/architecture/missing-foundation.md, but that solution doc does not exist.",
      },
    ]);
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

  it("identifies a changed solution note missing only the Solution section", () => {
    const findings = collectCompoundSolutionFindings({
      changedFiles: ["docs/solutions/harness/partial.md"],
      existingFiles: new Set(["docs/solutions/harness/partial.md"]),
      markdownContents: new Map([
        [
          "docs/solutions/harness/partial.md",
          solutionNote("Partial").replace(
            "\n## Solution\n\nRequire a concrete solution note before merge.\n",
            "\n"
          ),
        ],
      ]),
      sourceLineChanges: lineChanges([]),
    });

    expect(findings).toEqual([
      {
        message:
          "Changed solution note docs/solutions/harness/partial.md is missing required sections: Solution.",
      },
    ]);
  });

  it("fails changed architecture solution notes without an agent-doc discovery reference", () => {
    const findings = collectCompoundSolutionFindings({
      changedFiles: ["docs/solutions/architecture/terminal-boundary.md"],
      existingFiles: new Set([
        "docs/solutions/architecture/terminal-boundary.md",
        "packages/athena-webapp/docs/agent/architecture.md",
      ]),
      markdownContents: new Map([
        [
          "docs/solutions/architecture/terminal-boundary.md",
          architectureSolutionNote(),
        ],
      ]),
      solutionDocContents: new Map([
        [
          "docs/solutions/architecture/terminal-boundary.md",
          architectureSolutionNote(),
        ],
      ]),
      agentDocContents: new Map([
        [
          "packages/athena-webapp/docs/agent/architecture.md",
          "# Architecture\n",
        ],
      ]),
      sourceLineChanges: lineChanges([]),
    });

    expect(findings).toEqual([
      {
        message:
          "Foundational architecture solution note docs/solutions/architecture/terminal-boundary.md is missing an agent-doc discovery reference. Link it from packages/*/docs/agent/{architecture.md,code-map.md,testing.md} so future agents can find the durable concept.",
      },
    ]);
  });

  it("passes changed architecture solution notes when an agent doc references them", () => {
    const findings = collectCompoundSolutionFindings({
      changedFiles: ["docs/solutions/architecture/terminal-boundary.md"],
      existingFiles: new Set([
        "docs/solutions/architecture/terminal-boundary.md",
        "packages/athena-webapp/docs/agent/architecture.md",
      ]),
      markdownContents: new Map([
        [
          "docs/solutions/architecture/terminal-boundary.md",
          architectureSolutionNote(),
        ],
      ]),
      solutionDocContents: new Map([
        [
          "docs/solutions/architecture/terminal-boundary.md",
          architectureSolutionNote(),
        ],
      ]),
      agentDocContents: new Map([
        [
          "packages/athena-webapp/docs/agent/architecture.md",
          "See [terminal boundary](../../../../docs/solutions/architecture/terminal-boundary.md).\n",
        ],
      ]),
      sourceLineChanges: lineChanges([]),
    });

    expect(findings).toEqual([]);
  });

  it("does not accept a broken relative agent-doc link as foundational discoverability", () => {
    const findings = collectCompoundSolutionFindings({
      changedFiles: ["docs/solutions/architecture/terminal-boundary.md"],
      existingFiles: new Set([
        "docs/solutions/architecture/terminal-boundary.md",
        "packages/athena-webapp/docs/agent/architecture.md",
      ]),
      markdownContents: new Map([
        [
          "docs/solutions/architecture/terminal-boundary.md",
          architectureSolutionNote(),
        ],
      ]),
      solutionDocContents: new Map([
        [
          "docs/solutions/architecture/terminal-boundary.md",
          architectureSolutionNote(),
        ],
      ]),
      agentDocContents: new Map([
        [
          "packages/athena-webapp/docs/agent/architecture.md",
          "See [terminal boundary](../../../docs/solutions/architecture/terminal-boundary.md).\n",
        ],
      ]),
      sourceLineChanges: lineChanges([]),
    });

    expect(findings).toEqual([
      {
        message:
          "packages/athena-webapp/docs/agent/architecture.md references packages/docs/solutions/architecture/terminal-boundary.md, but that solution doc does not exist.",
      },
      {
        message:
          "Foundational architecture solution note docs/solutions/architecture/terminal-boundary.md is missing an agent-doc discovery reference. Link it from packages/*/docs/agent/{architecture.md,code-map.md,testing.md} so future agents can find the durable concept.",
      },
    ]);
  });

  it("fails existing foundational architecture notes that are not agent-discoverable", () => {
    const findings = collectCompoundSolutionFindings({
      changedFiles: ["docs/harness.md"],
      existingFiles: new Set([
        "docs/harness.md",
        "docs/solutions/architecture/store-schedule.md",
        "packages/athena-webapp/docs/agent/architecture.md",
      ]),
      markdownContents: new Map([["docs/harness.md", "# Harness\n"]]),
      solutionDocContents: new Map([
        [
          "docs/solutions/architecture/store-schedule.md",
          architectureSolutionNote("Store Schedule"),
        ],
      ]),
      agentDocContents: new Map([
        [
          "packages/athena-webapp/docs/agent/architecture.md",
          "# Architecture\n",
        ],
      ]),
      sourceLineChanges: lineChanges([]),
    });

    expect(findings).toEqual([
      {
        message:
          "Foundational architecture solution note docs/solutions/architecture/store-schedule.md is missing an agent-doc discovery reference. Link it from packages/*/docs/agent/{architecture.md,code-map.md,testing.md} so future agents can find the durable concept.",
      },
    ]);
  });

  it("keeps non-architecture solution notes out of the agent-doc reference rule", () => {
    const findings = collectCompoundSolutionFindings({
      changedFiles: ["docs/solutions/logic-errors/procurement.md"],
      existingFiles: new Set([
        "docs/solutions/logic-errors/procurement.md",
        "packages/athena-webapp/docs/agent/architecture.md",
      ]),
      markdownContents: new Map([
        ["docs/solutions/logic-errors/procurement.md", solutionNote()],
      ]),
      agentDocContents: new Map([
        [
          "packages/athena-webapp/docs/agent/architecture.md",
          "# Architecture\n",
        ],
      ]),
      sourceLineChanges: lineChanges([]),
    });

    expect(findings).toEqual([]);
  });

  it("keeps non-foundational architecture solution notes out of the agent-doc reference rule", () => {
    const findings = collectCompoundSolutionFindings({
      changedFiles: ["docs/solutions/architecture/terminal-detail.md"],
      existingFiles: new Set([
        "docs/solutions/architecture/terminal-detail.md",
        "packages/athena-webapp/docs/agent/architecture.md",
      ]),
      markdownContents: new Map([
        [
          "docs/solutions/architecture/terminal-detail.md",
          nonFoundationalArchitectureSolutionNote(),
        ],
      ]),
      solutionDocContents: new Map([
        [
          "docs/solutions/architecture/terminal-detail.md",
          nonFoundationalArchitectureSolutionNote(),
        ],
      ]),
      agentDocContents: new Map([
        [
          "packages/athena-webapp/docs/agent/architecture.md",
          "# Architecture\n",
        ],
      ]),
      sourceLineChanges: lineChanges([]),
    });

    expect(findings).toEqual([]);
  });
});

describe("agent solution discovery docs", () => {
  it.each([
    "packages/athena-webapp/docs/agent/architecture.md",
    "packages/storefront-webapp/docs/agent/code-map.md",
    "packages/valkey-proxy-server/docs/agent/testing.md",
  ])("matches expected agent discovery doc %s", (filePath) => {
    expect(AGENT_SOLUTION_DISCOVERY_DOC_PATTERN.test(filePath)).toBe(true);
  });

  it("does not treat generated agent metadata as a discovery doc", () => {
    expect(
      AGENT_SOLUTION_DISCOVERY_DOC_PATTERN.test(
        "packages/athena-webapp/docs/agent/validation-map.json"
      )
    ).toBe(false);
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

  it("points agents to the repo-local ce-compound skill when the gate fails", async () => {
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
    ).toThrow("Use the repo-local `.agents/skills/ce-compound` skill");
  });
});
