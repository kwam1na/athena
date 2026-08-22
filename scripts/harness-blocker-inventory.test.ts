import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  auditHarnessBlockerInventory,
  discoverHarnessBlockerInventory,
  HARNESS_BLOCKER_CLI_INVENTORY,
  inspectHarnessCliBoundary,
  collectRemediationLiterals,
  inspectHarnessBlockerShapes,
} from "./harness-blocker-inventory";

const tempRoots: string[] = [];

async function createFixtureRoot() {
  const rootDir = await mkdtemp(
    path.join(tmpdir(), "athena-harness-blocker-inventory-"),
  );
  tempRoots.push(rootDir);
  await mkdir(path.join(rootDir, "scripts"), { recursive: true });
  return rootDir;
}

async function write(rootDir: string, relativePath: string, contents: string) {
  const target = path.join(rootDir, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, contents);
}

afterEach(async () => {
  await Promise.all(
    tempRoots
      .splice(0)
      .map((rootDir) => rm(rootDir, { recursive: true, force: true })),
  );
});

describe("HARNESS_BLOCKER_CLI_INVENTORY", () => {
  it("keeps every direct harness boundary in the explicit inventory", () => {
    expect(HARNESS_BLOCKER_CLI_INVENTORY).toHaveLength(19);
    expect(
      HARNESS_BLOCKER_CLI_INVENTORY.flatMap((entry) => entry.commands),
    ).toHaveLength(22);
    expect(
      new Set(HARNESS_BLOCKER_CLI_INVENTORY.map((entry) => entry.file)).size,
    ).toBe(19);
    expect(
      new Set(HARNESS_BLOCKER_CLI_INVENTORY.flatMap((entry) => entry.commands))
        .size,
    ).toBe(22);
  });
});

describe("discoverHarnessBlockerInventory", () => {
  it("discovers harness main modules, direct commands, and recursively reachable aliases", async () => {
    const rootDir = await createFixtureRoot();
    await write(
      rootDir,
      "package.json",
      JSON.stringify({
        scripts: {
          "harness:leaf": "bun scripts/harness-leaf.ts --json",
          "harness:nested": "bun run harness:leaf",
          "harness:all":
            "bun run harness:nested && bun scripts/harness-other.ts",
        },
      }),
    );
    await write(
      rootDir,
      "scripts/harness-leaf.ts",
      "if (import.meta.main) { runHarnessCliBoundary({}); }\n",
    );
    await write(
      rootDir,
      "scripts/harness-other.ts",
      "export const library = true;\n",
    );
    await write(
      rootDir,
      "scripts/harness-library.ts",
      "export const library = true;\n",
    );

    const result = await discoverHarnessBlockerInventory(rootDir);

    expect(result.harnessMainFiles).toEqual(["scripts/harness-leaf.ts"]);
    expect(result.directCommands.get("harness:leaf")).toEqual([
      "scripts/harness-leaf.ts",
    ]);
    expect(result.reachableFilesByCommand.get("harness:nested")).toEqual([
      "scripts/harness-leaf.ts",
    ]);
    expect(result.reachableFilesByCommand.get("harness:all")).toEqual([
      "scripts/harness-leaf.ts",
      "scripts/harness-other.ts",
    ]);
  });
});

describe("inspectHarnessCliBoundary", () => {
  it("accepts a shared boundary runner without policing library implementation", () => {
    expect(
      inspectHarnessCliBoundary(
        "scripts/harness-example.ts",
        `
      export function parse() { throw new Error("library validation"); }
      if (import.meta.main) {
        await runHarnessCliBoundary({ command: "harness:example", run: () => parse() });
      }
    `,
      ),
    ).toEqual([]);
  });

  it("rejects unstructured output, raw exits, and throws in the command boundary", () => {
    expect(
      inspectHarnessCliBoundary(
        "scripts/harness-example.ts",
        `
      if (import.meta.main) {
        console.warn("blocked");
        console.error("blocked");
        process.exit(1);
        throw new Error("blocked");
      }
    `,
      ).map((finding) => finding.code),
    ).toEqual([
      "boundary-runner-missing",
      "boundary-console-output",
      "boundary-process-exit",
      "boundary-throw",
    ]);
  });
});

describe("inspectHarnessBlockerShapes", () => {
  it("rejects an empty remediation tuple and a free-form blocker source", () => {
    const findings = inspectHarnessBlockerShapes(
      "scripts/harness-fixture.ts",
      [
        'createHarnessBlocker({',
        '  code: "fixture_empty",',
        '  source: { kind: "command", id: "harness:check" },',
        '  summary: "fixture",',
        "  remediations: [],",
        "});",
        'createHarnessBlocker({',
        '  code: "fixture_freeform",',
        '  source: { kind: "obligation", id: "review.invented" },',
        '  summary: "fixture",',
        "});",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.code)).toEqual([
      "blocker-remediation-missing",
      "blocker-source-freeform",
    ]);
    expect(findings[1]?.message).toContain("obligation:review.invented");
  });

  it("accepts registry-owned sources and a populated remediation tuple", () => {
    expect(
      inspectHarnessBlockerShapes(
        "scripts/harness-fixture.ts",
        [
          'createHarnessBlocker({',
          '  code: "fixture_ok",',
          '  source: { kind: "obligation", id: "review.green" },',
          '  summary: "fixture",',
          '  remediations: [{ id: "retry-fixture", kind: "retry", summary: "Retry." }],',
          "});",
        ].join("\n"),
      ),
    ).toEqual([]);
  });
});

describe("auditHarnessBlockerInventory", () => {
  it("keeps the checked-in Athena command surface aligned and structured", async () => {
    const findings = await auditHarnessBlockerInventory(
      path.resolve(import.meta.dirname, ".."),
    );
    expect(
      findings,
      findings.map((finding) => finding.message).join("\n"),
    ).toEqual([]);
  });
});

describe("collectRemediationLiterals", () => {
  it("reads literal remediation id and summary pairs", () => {
    const literals = collectRemediationLiterals(
      [
        '{ id: "prepare-current-candidate", kind: "command", command: ["bun"], summary: "Prepare again." }',
        '{ id: "inspect-diff", kind: "manual_action", summary: "Inspect the diff." }',
      ].join("\n"),
    );

    expect(literals).toEqual([
      { id: "prepare-current-candidate", summary: "Prepare again." },
      { id: "inspect-diff", summary: "Inspect the diff." },
    ]);
  });

  it("keeps same-id duplicates so intra-file divergence stays visible", () => {
    // A Map keyed by id would collapse these to the last one, and two sites in
    // one file is exactly the shape the divergence rule exists to catch.
    const literals = collectRemediationLiterals(
      [
        '{ id: "prepare-current-candidate", kind: "command", command: ["bun"], summary: "Prepare A." }',
        '{ id: "prepare-current-candidate", kind: "command", command: ["bun"], summary: "Prepare B." }',
      ].join("\n"),
    );

    expect(literals).toHaveLength(2);
    expect(literals.map((entry) => entry.summary)).toEqual([
      "Prepare A.",
      "Prepare B.",
    ]);
  });
});
