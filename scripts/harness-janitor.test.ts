import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { HARNESS_APP_REGISTRY } from "./harness-app-registry";
import {
  formatHarnessJanitorReport,
  parseHarnessJanitorCliArgs,
  runHarnessJanitor,
} from "./harness-janitor";

const tempRoots: string[] = [];

const GENERATED_DOC_PATHS = HARNESS_APP_REGISTRY.flatMap(
  (app) => app.harnessDocs.generatedDocs
);
const GRAPHIFY_ARTIFACT_PATHS = [
  "graphify-out/GRAPH_REPORT.md",
  "graphify-out/graph.json",
] as const;

async function write(relativePath: string, contents: string, rootDir: string) {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

async function createFixtureRoot() {
  const rootDir = await mkdtemp(path.join(tmpdir(), "athena-harness-janitor-"));
  tempRoots.push(rootDir);
  return rootDir;
}

async function seedArtifacts(rootDir: string, staleMarker: string) {
  await Promise.all([
    ...GENERATED_DOC_PATHS.map((relativePath) =>
      write(relativePath, `${staleMarker}\n`, rootDir)
    ),
    ...GRAPHIFY_ARTIFACT_PATHS.map((relativePath) =>
      write(relativePath, `${staleMarker}\n`, rootDir)
    ),
  ]);
}

async function overwriteFreshGeneratedDocs(rootDir: string, marker: string) {
  await Promise.all(
    GENERATED_DOC_PATHS.map((relativePath) =>
      write(relativePath, `${marker}\n`, rootDir)
    )
  );
}

async function overwriteFreshGraphifyArtifacts(rootDir: string, marker: string) {
  await Promise.all([
    write(GRAPHIFY_ARTIFACT_PATHS[0], `${marker} report\n`, rootDir),
    write(GRAPHIFY_ARTIFACT_PATHS[1], `${marker}\n`, rootDir),
  ]);
}

function sortPaths(paths: readonly string[]) {
  return [...paths].sort((left, right) => left.localeCompare(right));
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((rootDir) =>
      rm(rootDir, { recursive: true, force: true })
    )
  );
});

describe("runHarnessJanitor", () => {
  it("runs report-only checks in order and keeps the report structured", async () => {
    const rootDir = await createFixtureRoot();
    const steps: string[] = [];

    const result = await runHarnessJanitor(rootDir, {
      mode: "report-only",
      runHarnessCheck: async () => {
        steps.push("harness:check");
      },
      runHarnessAudit: async () => {
        steps.push("harness:audit");
      },
      runGraphifyCheck: async () => {
        steps.push("graphify:check");
      },
      logger: {
        log() {},
        error() {},
      },
    });

    expect(steps).toEqual([
      "harness:check",
      "harness:audit",
      "graphify:check",
    ]);
    expect(result).toMatchObject({
      mode: "report-only",
      exitCode: 0,
      repairs: [],
    });
    expect(result.checks).toEqual([
      { name: "harness:check", status: "passed" },
      { name: "harness:audit", status: "passed" },
      { name: "graphify:check", status: "passed" },
    ]);
    expect(formatHarnessJanitorReport(result)).toContain(
      "Repairs: not run in report-only mode."
    );
    expect(formatHarnessJanitorReport(result)).toContain(
      "mode=report-only repairs=0 applied=0 noOp=0 failedRepairs=0 checks=3 passedChecks=3 failedChecks=0 skippedChecks=0 changedArtifacts=0"
    );
  });

  it("keeps running report-only checks and records failures without short-circuiting", async () => {
    const rootDir = await createFixtureRoot();
    const steps: string[] = [];

    const result = await runHarnessJanitor(rootDir, {
      mode: "report-only",
      runHarnessCheck: async () => {
        steps.push("harness:check");
        throw new Error("docs drift");
      },
      runHarnessAudit: async () => {
        steps.push("harness:audit");
        throw new Error("audit drift");
      },
      runGraphifyCheck: async () => {
        steps.push("graphify:check");
      },
      logger: {
        log() {},
        error() {},
      },
    });

    expect(steps).toEqual([
      "harness:check",
      "harness:audit",
      "graphify:check",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.checks).toEqual([
      { name: "harness:check", status: "failed", detail: "docs drift" },
      { name: "harness:audit", status: "failed", detail: "audit drift" },
      { name: "graphify:check", status: "passed" },
    ]);
    expect(formatHarnessJanitorReport(result)).toContain(
      "harness:check: failed"
    );
    expect(formatHarnessJanitorReport(result)).toContain("docs drift");
  });

  it("repairs stale generated artifacts before re-running the checks", async () => {
    const rootDir = await createFixtureRoot();
    await seedArtifacts(rootDir, "stale");

    const steps: string[] = [];
    const result = await runHarnessJanitor(rootDir, {
      mode: "repair",
      runHarnessGenerate: async (dir) => {
        steps.push("harness:generate");
        await overwriteFreshGeneratedDocs(dir, "fresh");
      },
      runGraphifyRebuild: async (dir) => {
        steps.push("graphify:rebuild");
        await overwriteFreshGraphifyArtifacts(dir, "fresh");
      },
      runHarnessCheck: async () => {
        steps.push("harness:check");
      },
      runHarnessAudit: async () => {
        steps.push("harness:audit");
      },
      runGraphifyCheck: async () => {
        steps.push("graphify:check");
      },
      logger: {
        log() {},
        error() {},
      },
    });

    expect(steps).toEqual([
      "harness:generate",
      "graphify:rebuild",
      "harness:check",
      "harness:audit",
      "graphify:check",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.repairs).toEqual([
      {
        name: "harness:generate",
        status: "applied",
        changedArtifacts: sortPaths(GENERATED_DOC_PATHS),
      },
      {
        name: "graphify:rebuild",
        status: "applied",
        changedArtifacts: sortPaths(GRAPHIFY_ARTIFACT_PATHS),
      },
    ]);
    expect(result.changedArtifacts).toEqual([
      ...sortPaths([...GRAPHIFY_ARTIFACT_PATHS, ...GENERATED_DOC_PATHS]),
    ]);
    expect(formatHarnessJanitorReport(result)).toContain(
      "harness:generate: applied"
    );
    expect(formatHarnessJanitorReport(result)).toContain(
      "graphify-out/graph.json"
    );
  });

  it("skips the re-check when a repair step fails but still reports the successful repair", async () => {
    const rootDir = await createFixtureRoot();
    await seedArtifacts(rootDir, "stale");

    const steps: string[] = [];
    const result = await runHarnessJanitor(rootDir, {
      mode: "repair",
      runHarnessGenerate: async (dir) => {
        steps.push("harness:generate");
        await overwriteFreshGeneratedDocs(dir, "fresh");
      },
      runGraphifyRebuild: async () => {
        steps.push("graphify:rebuild");
        throw new Error("graphify exploded");
      },
      runHarnessCheck: async () => {
        steps.push("harness:check");
      },
      runHarnessAudit: async () => {
        steps.push("harness:audit");
      },
      runGraphifyCheck: async () => {
        steps.push("graphify:check");
      },
      logger: {
        log() {},
        error() {},
      },
    });

    expect(steps).toEqual(["harness:generate", "graphify:rebuild"]);
    expect(result.exitCode).toBe(1);
    expect(result.repairs[0]).toMatchObject({
      name: "harness:generate",
      status: "applied",
    });
    expect(result.repairs[1]).toMatchObject({
      name: "graphify:rebuild",
      status: "failed",
      detail: "graphify exploded",
    });
    expect(result.checks).toEqual([
      {
        name: "harness:check",
        status: "skipped",
        detail: "Repair step failed; re-check skipped.",
      },
      {
        name: "harness:audit",
        status: "skipped",
        detail: "Repair step failed; re-check skipped.",
      },
      {
        name: "graphify:check",
        status: "skipped",
        detail: "Repair step failed; re-check skipped.",
      },
    ]);
  });
});

describe("parseHarnessJanitorCliArgs", () => {
  it("defaults to report-only and accepts the repair flag", () => {
    expect(parseHarnessJanitorCliArgs([])).toEqual({
      mode: "report-only",
    });
    expect(parseHarnessJanitorCliArgs(["--repair"])).toEqual({
      mode: "repair",
    });
  });

  it("rejects unknown or conflicting flags", () => {
    expect(() => parseHarnessJanitorCliArgs(["--unknown"])).toThrow(
      "Unknown harness janitor argument: --unknown."
    );
    expect(() =>
      parseHarnessJanitorCliArgs(["--repair", "--report-only"])
    ).toThrow("Cannot combine --report-only with --repair.");
  });
});
