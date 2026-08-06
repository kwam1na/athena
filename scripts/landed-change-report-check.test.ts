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
  const narrative = [
    "summary",
    "problem",
    "mental-model",
    "before-after",
    "key-files",
    "changes",
    "validation",
    "guidance",
  ]
    .map(
      (key) =>
        `  <section data-report-section="${key}"><h2>${key}</h2><p>Body.</p></section>`
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head><title>${title}</title></head>
<body>
<article data-athena-landed-change-report="v2" data-athena-report-diff-fingerprint="${fingerprint}">
${narrative}
  <section data-report-section="quiz" data-quiz-pass-threshold="4"><h2>Comprehension quiz</h2></section>
  <section data-report-section="subagent-evidence"><h2>Subagent evidence</h2></section>
</article>
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
          "Large source change detected (301 changed source lines, threshold 300) without a docs/reports/**/*.html landed-change report that is current for this branch. Editing an existing report does not satisfy this: the report must carry data-athena-report-diff-fingerprint=\"<current deliverable diff>\", which only a regeneration after the final code and workflow edits produces.",
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

  it("fails a newly added report artifact that does not look like a landed-change report", () => {
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

    expect(findings.map((finding) => finding.message)).toEqual([
      'Landed-change report docs/reports/procurement.html is missing required report markers: data-athena-landed-change-report="v2", data-report-section="quiz", data-quiz-pass-threshold, data-report-section="subagent-evidence", data-report-section="summary", data-report-section="problem", data-report-section="mental-model", data-report-section="before-after", data-report-section="key-files", data-report-section="changes", data-report-section="validation", data-report-section="guidance", data-athena-report-diff-fingerprint.',
      // The malformed report also leaves the branch with no current report.
      expect.stringContaining("without a docs/reports/**/*.html landed-change report that is current"),
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
      // The stale artifact predates the branch, so touching it is maintenance.
      reportsExistingAtBase: new Set(["docs/reports/old-local-artifact.html"]),
      deliverableDiffFingerprint: "current-fingerprint",
    });

    expect(findings).toEqual([]);
  });

  // The line threshold decides whether a report is *required*. It must not
  // decide whether a report that exists is valid, or a small branch could add
  // a malformed report unchecked.
  it("validates a newly added report even on a small branch", () => {
    const findings = collectLandedChangeReportFindings({
      changedFiles: ["docs/reports/new-delivery.html"],
      existingFiles: new Set(["docs/reports/new-delivery.html"]),
      reportContents: new Map([["docs/reports/new-delivery.html", "<html></html>"]]),
      sourceLineChanges: lineChanges([]),
      reportsExistingAtBase: new Set(),
      deliverableDiffFingerprint: "current-fingerprint",
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain(
      'docs/reports/new-delivery.html is missing required report markers',
    );
  });

  // A corpus migration touches every historical report; asking those to carry
  // today's narrative vocabulary and today's fingerprint would mean rewriting
  // history rather than maintaining it.
  it("exempts an edited historical report per-file, but does not let it satisfy the gate", () => {
    const findings = collectLandedChangeReportFindings({
      changedFiles: [
        "docs/reports/historical.html",
        "packages/athena-webapp/src/components/ProcurementView.tsx",
      ],
      existingFiles: new Set([
        "docs/reports/historical.html",
        "packages/athena-webapp/src/components/ProcurementView.tsx",
      ]),
      reportContents: new Map([
        [
          "docs/reports/historical.html",
          '<article data-athena-landed-change-report="v2" data-athena-report-diff-fingerprint="ancient"><section data-report-section="quiz" data-quiz-pass-threshold="2"></section></article>',
        ],
      ]),
      sourceLineChanges: lineChanges([
        ["packages/athena-webapp/src/components/ProcurementView.tsx", 301, 0],
      ]),
      reportsExistingAtBase: new Set(["docs/reports/historical.html"]),
      deliverableDiffFingerprint: "current-fingerprint",
    });

    // No per-file demand for narrative sections or today's fingerprint...
    expect(
      findings.some((finding) => finding.message.includes("historical.html")),
    ).toBe(false);
    // ...but the branch still owes a report that is current for it.
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain(
      "without a docs/reports/**/*.html landed-change report that is current",
    );
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

    // The canonical drift case: the report was written, then code kept
    // changing. It is named directly, and the branch is also told it has no
    // current report.
    expect(findings.map((finding) => finding.message)).toEqual([
      "Landed-change report docs/reports/procurement.html is stale: embedded diff fingerprint old-fingerprint does not match current deliverable diff current-fingerprint. Regenerate the report after final code and workflow changes.",
      expect.stringContaining("without a docs/reports/**/*.html landed-change report that is current"),
    ]);
  });

  // The same drift, but on a report that already existed: it is exempt from
  // the per-file demand, yet a stale fingerprint still means the branch has no
  // report describing what it actually shipped.
  it("fails a large change whose only report is a pre-existing one left un-regenerated", () => {
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
      reportsExistingAtBase: new Set(["docs/reports/procurement.html"]),
      deliverableDiffFingerprint: "current-fingerprint",
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain(
      "without a docs/reports/**/*.html landed-change report that is current",
    );
  });

  it("passes once that report is regenerated against the final diff", () => {
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
        ["docs/reports/procurement.html", validReport("Procurement", "current-fingerprint")],
      ]),
      sourceLineChanges: lineChanges([
        ["packages/athena-webapp/src/components/ProcurementView.tsx", 301, 0],
      ]),
      reportsExistingAtBase: new Set(["docs/reports/procurement.html"]),
      deliverableDiffFingerprint: "current-fingerprint",
    });

    expect(findings).toEqual([]);
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
      "Large source change detected (13 changed source lines, threshold 10) without a docs/reports/**/*.html landed-change report that is current for this branch."
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
