import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertLandedChangeReportCheck,
  collectDeliverableDiffFingerprint,
  collectLandedChangeReportFindings,
  isLandedChangeReportPath,
  isReportableSourcePath,
} from "./landed-change-report-check";

const tempRoots: string[] = [];

async function createFixtureRepo() {
  const rootDir = await mkdtemp(path.join(tmpdir(), "athena-landed-report-check-"));
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

function validReport(title = "Procurement Change", fingerprint = "current-fingerprint") {
  return `<!doctype html>
<html lang="en" data-athena-landed-change-report="v1" data-athena-report-diff-fingerprint="${fingerprint}">
<head><title>${title}</title></head>
<body>
  <section><h2>Subagent Evidence</h2></section>
  <section><h2>Quiz: Pass Required</h2><form id="changeQuiz"></form></section>
</body>
</html>
`;
}

describe("isReportableSourcePath", () => {
  it.each([
    "packages/athena-webapp/src/components/ProcurementView.tsx",
    "packages/athena-webapp/convex/purchaseOrders.ts",
    "packages/athena-webapp/shared/procurement.ts",
    "scripts/landed-change-report-check.ts",
  ])("matches behavior-bearing source file %s", (filePath) => {
    expect(isReportableSourcePath(filePath)).toBe(true);
  });

  it.each([
    "scripts/landed-change-report-check.test.ts",
    "docs/reports/procurement.html",
    "graphify-out/GRAPH_REPORT.md",
    "packages/athena-webapp/convex/_generated/api.d.ts",
  ])("ignores non-source or generated file %s", (filePath) => {
    expect(isReportableSourcePath(filePath)).toBe(false);
  });
});

describe("isLandedChangeReportPath", () => {
  it("matches HTML report artifacts under docs/reports", () => {
    expect(isLandedChangeReportPath("docs/reports/procurement.html")).toBe(true);
  });

  it("does not match reports outside the delivery report folder", () => {
    expect(isLandedChangeReportPath("docs/solutions/harness/procurement.md")).toBe(false);
  });
});

describe("collectLandedChangeReportFindings", () => {
  it("passes docs-only changes without a report", () => {
    const findings = collectLandedChangeReportFindings({
      changedFiles: ["docs/harness.md"],
      existingFiles: new Set(["docs/harness.md"]),
      reportContents: new Map(),
      sourceLineChanges: lineChanges([]),
    });

    expect(findings).toEqual([]);
  });

  it("fails large source changes without a changed report", () => {
    const findings = collectLandedChangeReportFindings({
      changedFiles: ["packages/athena-webapp/src/components/ProcurementView.tsx"],
      existingFiles: new Set([
        "packages/athena-webapp/src/components/ProcurementView.tsx",
      ]),
      reportContents: new Map(),
      sourceLineChanges: lineChanges([
        ["packages/athena-webapp/src/components/ProcurementView.tsx", 301, 0],
      ]),
    });

    expect(findings).toEqual([
      {
        message:
          "Large source change detected (301 changed source lines, threshold 300) without a docs/reports/**/*.html landed-change report update.",
      },
    ]);
  });

  it("passes large source changes with a changed valid report", () => {
    const findings = collectLandedChangeReportFindings({
      changedFiles: [
        "docs/reports/procurement.html",
        "packages/athena-webapp/src/components/ProcurementView.tsx",
      ],
      existingFiles: new Set([
        "docs/reports/procurement.html",
        "packages/athena-webapp/src/components/ProcurementView.tsx",
      ]),
      reportContents: new Map([["docs/reports/procurement.html", validReport()]]),
      sourceLineChanges: lineChanges([
        ["packages/athena-webapp/src/components/ProcurementView.tsx", 301, 0],
      ]),
      deliverableDiffFingerprint: "current-fingerprint",
    });

    expect(findings).toEqual([]);
  });

  it("passes smaller source changes below the threshold", () => {
    const findings = collectLandedChangeReportFindings({
      changedFiles: ["packages/athena-webapp/src/components/ProcurementView.tsx"],
      existingFiles: new Set([
        "packages/athena-webapp/src/components/ProcurementView.tsx",
      ]),
      reportContents: new Map(),
      sourceLineChanges: lineChanges([
        ["packages/athena-webapp/src/components/ProcurementView.tsx", 150, 149],
      ]),
    });

    expect(findings).toEqual([]);
  });

  it("fails large source changes when changed report artifacts do not look like landed-change reports", () => {
    const findings = collectLandedChangeReportFindings({
      changedFiles: [
        "docs/reports/procurement.html",
        "packages/athena-webapp/src/components/ProcurementView.tsx",
      ],
      existingFiles: new Set([
        "docs/reports/procurement.html",
        "packages/athena-webapp/src/components/ProcurementView.tsx",
      ]),
      reportContents: new Map([["docs/reports/procurement.html", "<html></html>"]]),
      sourceLineChanges: lineChanges([
        ["packages/athena-webapp/src/components/ProcurementView.tsx", 301, 0],
      ]),
      deliverableDiffFingerprint: "current-fingerprint",
    });

    expect(findings).toEqual([
      {
        message:
          'Landed-change report docs/reports/procurement.html is missing required report markers: data-athena-landed-change-report="v1", Subagent Evidence, Quiz: Pass Required, id="changeQuiz", data-athena-report-diff-fingerprint.',
      },
    ]);
  });

  it("accepts one valid changed report even when an unrelated local report is invalid", () => {
    const findings = collectLandedChangeReportFindings({
      changedFiles: [
        "docs/reports/current-delivery.html",
        "docs/reports/old-local-artifact.html",
        "packages/athena-webapp/src/components/ProcurementView.tsx",
      ],
      existingFiles: new Set([
        "docs/reports/current-delivery.html",
        "docs/reports/old-local-artifact.html",
        "packages/athena-webapp/src/components/ProcurementView.tsx",
      ]),
      reportContents: new Map([
        ["docs/reports/current-delivery.html", validReport()],
        ["docs/reports/old-local-artifact.html", "<html></html>"],
      ]),
      sourceLineChanges: lineChanges([
        ["packages/athena-webapp/src/components/ProcurementView.tsx", 301, 0],
      ]),
      deliverableDiffFingerprint: "current-fingerprint",
    });

    expect(findings).toEqual([]);
  });

  it("fails large source changes when the report fingerprint is stale", () => {
    const findings = collectLandedChangeReportFindings({
      changedFiles: [
        "docs/reports/procurement.html",
        "packages/athena-webapp/src/components/ProcurementView.tsx",
      ],
      existingFiles: new Set([
        "docs/reports/procurement.html",
        "packages/athena-webapp/src/components/ProcurementView.tsx",
      ]),
      reportContents: new Map([
        ["docs/reports/procurement.html", validReport("Procurement", "old-fingerprint")],
      ]),
      sourceLineChanges: lineChanges([
        ["packages/athena-webapp/src/components/ProcurementView.tsx", 301, 0],
      ]),
      deliverableDiffFingerprint: "current-fingerprint",
    });

    expect(findings).toEqual([
      {
        message:
          "Landed-change report docs/reports/procurement.html is stale: embedded diff fingerprint old-fingerprint does not match current deliverable diff current-fingerprint. Regenerate the report after final code and workflow changes.",
      },
    ]);
  });
});

describe("assertLandedChangeReportCheck", () => {
  it("fails when an untracked source file crosses the report threshold", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      rootDir,
      "scripts/new-delivery-sensor.ts",
      Array.from({ length: 12 }, (_, index) => `export const value${index} = ${index};`)
        .join("\n")
        .concat("\n")
    );

    expect(() =>
      assertLandedChangeReportCheck(rootDir, {
        baseRef: "HEAD",
        threshold: 10,
      })
    ).toThrow(
      "Large source change detected (13 changed source lines, threshold 10) without a docs/reports/**/*.html landed-change report update."
    );
  });

  it("passes large source changes when a report artifact changes too", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      rootDir,
      "scripts/new-delivery-sensor.ts",
      Array.from({ length: 12 }, (_, index) => `export const value${index} = ${index};`)
        .join("\n")
        .concat("\n")
    );
    const fingerprint = collectDeliverableDiffFingerprint(rootDir, "HEAD", [
      "docs/reports/delivery-sensor.html",
      "scripts/new-delivery-sensor.ts",
    ]);
    await write(
      rootDir,
      "docs/reports/delivery-sensor.html",
      validReport("Delivery Sensor", fingerprint)
    );

    expect(() =>
      assertLandedChangeReportCheck(rootDir, {
        baseRef: "HEAD",
        threshold: 10,
      })
    ).not.toThrow();
  });

  it("fails when the report was generated before final source edits", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      rootDir,
      "scripts/new-delivery-sensor.ts",
      Array.from({ length: 12 }, (_, index) => `export const value${index} = ${index};`)
        .join("\n")
        .concat("\n")
    );
    const oldFingerprint = collectDeliverableDiffFingerprint(rootDir, "HEAD", [
      "docs/reports/delivery-sensor.html",
      "scripts/new-delivery-sensor.ts",
    ]);
    await write(
      rootDir,
      "docs/reports/delivery-sensor.html",
      validReport("Delivery Sensor", oldFingerprint)
    );
    await write(
      rootDir,
      "scripts/new-delivery-sensor.ts",
      Array.from({ length: 13 }, (_, index) => `export const value${index} = ${index};`)
        .join("\n")
        .concat("\n")
    );

    expect(() =>
      assertLandedChangeReportCheck(rootDir, {
        baseRef: "HEAD",
        threshold: 10,
      })
    ).toThrow("Regenerate the report after final code and workflow changes.");
  });

  it("points agents to the repo-local report skill when the gate fails", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      rootDir,
      "scripts/new-delivery-sensor.ts",
      Array.from({ length: 12 }, (_, index) => `export const value${index} = ${index};`)
        .join("\n")
        .concat("\n")
    );

    expect(() =>
      assertLandedChangeReportCheck(rootDir, {
        baseRef: "HEAD",
        threshold: 10,
      })
    ).toThrow("Use the repo-local `.agents/skills/ce-landed-change-report` skill");
  });
});
