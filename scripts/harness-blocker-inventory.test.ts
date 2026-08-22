import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  auditHarnessBlockerInventory,
  discoverHarnessBlockerInventory,
  HARNESS_BLOCKER_CLI_INVENTORY,
  inspectHarnessCliBoundary,
  inspectRenderNonZeroSuppression,
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
    expect(HARNESS_BLOCKER_CLI_INVENTORY).toHaveLength(22);
    expect(
      HARNESS_BLOCKER_CLI_INVENTORY.flatMap((entry) => entry.commands),
    ).toHaveLength(26);
    expect(
      new Set(HARNESS_BLOCKER_CLI_INVENTORY.map((entry) => entry.file)).size,
    ).toBe(22);
    expect(
      new Set(HARNESS_BLOCKER_CLI_INVENTORY.flatMap((entry) => entry.commands))
        .size,
    ).toBe(26);
  });
});

// The two live-gate provider CLIs and the pr:athena record-proof step were the
// last three package-reachable CLIs outside the blocker contract; these checks
// keep any of them from regressing to free-form prose and process.exit.
const MIGRATED_CONTRACT_FILES = [
  "scripts/delivery-documentation-check.ts",
  "scripts/delivery-run-telemetry.ts",
  "scripts/pre-push-validation-proof.ts",
] as const;

describe("formerly excluded harness CLIs", () => {
  it("registers each migrated CLI in the explicit inventory", () => {
    const registeredFiles = HARNESS_BLOCKER_CLI_INVENTORY.map(
      (entry) => entry.file,
    );
    for (const file of MIGRATED_CONTRACT_FILES) {
      expect(registeredFiles).toContain(file);
    }
  });

  it("holds each migrated boundary to the shared blocker contract", async () => {
    for (const file of MIGRATED_CONTRACT_FILES) {
      const source = await readFile(
        path.resolve(import.meta.dirname, "..", file),
        "utf8",
      );
      const boundaryFindings = inspectHarnessCliBoundary(file, source);
      expect(
        boundaryFindings,
        boundaryFindings.map((finding) => finding.message).join("\n"),
      ).toEqual([]);
      const shapeFindings = inspectHarnessBlockerShapes(file, source);
      expect(
        shapeFindings,
        shapeFindings.map((finding) => finding.message).join("\n"),
      ).toEqual([]);
    }
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

describe("inspectRenderNonZeroSuppression", () => {
  const suppressFallback = [
    "if (import.meta.main) {",
    '  await runHarnessCliBoundary({',
    '    source: { kind: "command", id: "harness:fixture" },',
    '    reproduce: ["bun", "scripts/harness-fixture.ts"],',
    "    run: runFixtureCli,",
    "    renderNonZero: false,",
    "  });",
    "}",
  ].join("\n");

  it("rejects a bare suppression that prints prose instead of a typed blocker", () => {
    const source = [
      suppressFallback,
      "",
      "async function runFixtureCli() {",
      '  console.error("2 findings failed");',
      "  return 1;",
      "}",
    ].join("\n");
    const findings = inspectRenderNonZeroSuppression(
      "scripts/harness-fixture.ts",
      source,
    );

    expect(findings.map((finding) => finding.code)).toEqual([
      "blocker-emission-missing",
    ]);
    expect(findings[0]?.message).toContain("renderNonZero: false");
  });

  it("accepts a suppression backed by createHarnessBlocker", () => {
    expect(
      inspectRenderNonZeroSuppression(
        "scripts/harness-fixture.ts",
        [
          suppressFallback,
          'createHarnessBlocker({ code: "fixture_failed", source: { kind: "command", id: "harness:fixture" }, summary: "fixture" });',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("accepts suppressions backed by HarnessBlockedError or formatHarnessBlockers", () => {
    expect(
      inspectRenderNonZeroSuppression(
        "scripts/harness-fixture.ts",
        [suppressFallback, 'throw new HarnessBlockedError(blockers);'].join("\n"),
      ),
    ).toEqual([]);
    expect(
      inspectRenderNonZeroSuppression(
        "scripts/harness-fixture.ts",
        [
          suppressFallback,
          "logger.error(formatHarnessBlockers(decision.blockers));",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("leaves files that keep the shared fallback alone", () => {
    const source = [
      "if (import.meta.main) {",
      '  await runHarnessCliBoundary({',
      '    source: { kind: "command", id: "harness:fixture" },',
      '    reproduce: ["bun", "scripts/harness-fixture.ts"],',
      "    run: runFixtureCli,",
      "  });",
      "}",
    ].join("\n");

    expect(
      inspectRenderNonZeroSuppression("scripts/harness-fixture.ts", source),
    ).toEqual([]);
  });
});

describe("live renderNonZero suppression sites", () => {
  it.each([
    "scripts/harness-gate-admission.ts",
    "scripts/pr-athena-delivery-run.ts",
  ])("backs each suppression in %s with a typed blocker", async (file) => {
    const source = await readFile(
      path.resolve(import.meta.dirname, "..", file),
      "utf8",
    );
    expect(source).toMatch(/renderNonZero:\s*false/);
    const findings = inspectRenderNonZeroSuppression(file, source);
    expect(
      findings,
      findings.map((finding) => finding.message).join("\n"),
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
