import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { HARNESS_APP_REGISTRY } from "./harness-app-registry";
import { validateHarnessDocs } from "./harness-check";
import { runHarnessAudit } from "./harness-audit";
import { writeGeneratedHarnessDocs } from "./harness-generate";
import { runGraphifyCheck } from "./graphify-check";
import { runGraphifyRebuild } from "./graphify-rebuild";

const GRAPHIFY_ARTIFACTS = [
  "graphify-out/GRAPH_REPORT.md",
  "graphify-out/graph.json",
] as const;

const HARNESS_JANITOR_REPAIR_ARTIFACTS = HARNESS_APP_REGISTRY.flatMap(
  (app) => app.harnessDocs.generatedDocs
);

export type HarnessJanitorMode = "report-only" | "repair";

type HarnessJanitorCheckName =
  | "harness:check"
  | "harness:audit"
  | "graphify:check";

type HarnessJanitorRepairName = "harness:generate" | "graphify:rebuild";

type HarnessJanitorStatus = "passed" | "failed" | "skipped";

type HarnessJanitorRepairStatus = "applied" | "no-op" | "failed";

export type HarnessJanitorCheckResult = {
  name: HarnessJanitorCheckName;
  status: HarnessJanitorStatus;
  detail?: string;
};

export type HarnessJanitorRepairResult = {
  name: HarnessJanitorRepairName;
  status: HarnessJanitorRepairStatus;
  changedArtifacts: string[];
  detail?: string;
};

export type HarnessJanitorResult = {
  mode: HarnessJanitorMode;
  exitCode: 0 | 1;
  repairs: HarnessJanitorRepairResult[];
  checks: HarnessJanitorCheckResult[];
  changedArtifacts: string[];
  summary: string;
};

type HarnessJanitorLogger = Pick<Console, "log" | "error">;

type HarnessJanitorOptions = {
  mode?: HarnessJanitorMode;
  logger?: HarnessJanitorLogger;
  runHarnessCheck?: (rootDir: string) => Promise<void>;
  runHarnessAudit?: (rootDir: string) => Promise<void>;
  runGraphifyCheck?: (rootDir: string) => Promise<void>;
  runHarnessGenerate?: (rootDir: string) => Promise<void>;
  runGraphifyRebuild?: (rootDir: string) => Promise<void>;
};

type FileSnapshot = Map<string, string | null>;

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function sortUniquePaths(paths: string[]) {
  return [...new Set(paths.map((entry) => entry.trim()).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right)
  );
}

async function fileExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readUtf8OrNull(filePath: string) {
  if (!(await fileExists(filePath))) {
    return null;
  }

  return readFile(filePath, "utf8");
}

async function snapshotFiles(rootDir: string, relativePaths: string[]) {
  const snapshots = await Promise.all(
    sortUniquePaths(relativePaths).map(async (relativePath) => [
      relativePath,
      await readUtf8OrNull(path.join(rootDir, relativePath)),
    ])
  );

  return new Map(snapshots as Array<[string, string | null]>);
}

function compareSnapshots(before: FileSnapshot, after: FileSnapshot) {
  const changedArtifacts: string[] = [];

  for (const relativePath of sortUniquePaths([
    ...before.keys(),
    ...after.keys(),
  ])) {
    const beforeContents = before.get(relativePath) ?? null;
    const afterContents = after.get(relativePath) ?? null;
    if (beforeContents !== afterContents) {
      changedArtifacts.push(relativePath);
    }
  }

  return changedArtifacts;
}

function formatDetailLines(detail: string) {
  return detail
    .split(/\r?\n/)
    .map((line) => `  ${line}`)
    .join("\n");
}

function formatArtifactList(artifacts: string[]) {
  if (artifacts.length === 0) {
    return "  - none";
  }

  return artifacts.map((artifact) => `  - ${artifact}`).join("\n");
}

async function withCapturedConsole<T>(
  logger: HarnessJanitorLogger,
  fn: () => Promise<T>
) {
  const originalLog = console.log;
  const originalError = console.error;
  const forwardLog = logger.log.bind(logger);
  const forwardError = logger.error.bind(logger);

  console.log = ((...args: unknown[]) => {
    forwardLog(...(args as Parameters<Console["log"]>));
  }) as typeof console.log;
  console.error = ((...args: unknown[]) => {
    forwardError(...(args as Parameters<Console["error"]>));
  }) as typeof console.error;

  try {
    return await fn();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

async function runCheckStep(
  name: HarnessJanitorCheckName,
  step: () => Promise<void>
): Promise<HarnessJanitorCheckResult> {
  try {
    await step();
    return { name, status: "passed" };
  } catch (error) {
    return { name, status: "failed", detail: formatError(error) };
  }
}

async function runRepairStep(
  rootDir: string,
  name: HarnessJanitorRepairName,
  trackedArtifacts: readonly string[],
  repair: (rootDir: string) => Promise<void>
): Promise<HarnessJanitorRepairResult> {
  const before = await snapshotFiles(rootDir, [...trackedArtifacts]);

  try {
    await repair(rootDir);
  } catch (error) {
    const after = await snapshotFiles(rootDir, [...trackedArtifacts]);
    return {
      name,
      status: "failed",
      changedArtifacts: compareSnapshots(before, after),
      detail: formatError(error),
    };
  }

  const after = await snapshotFiles(rootDir, [...trackedArtifacts]);
  const changedArtifacts = compareSnapshots(before, after);
  const missingAfter = trackedArtifacts.filter((artifact) => after.get(artifact) === null);

  if (missingAfter.length > 0) {
    return {
      name,
      status: "failed",
      changedArtifacts,
      detail: `Repair step "${name}" did not produce expected artifact(s): ${missingAfter.join(", ")}.`,
    };
  }

  return {
    name,
    status: changedArtifacts.length > 0 ? "applied" : "no-op",
    changedArtifacts,
  };
}

function buildSummary(result: {
  mode: HarnessJanitorMode;
  repairs: HarnessJanitorRepairResult[];
  checks: HarnessJanitorCheckResult[];
  changedArtifacts: string[];
}) {
  const passedChecks = result.checks.filter((check) => check.status === "passed").length;
  const failedChecks = result.checks.filter((check) => check.status === "failed").length;
  const skippedChecks = result.checks.filter((check) => check.status === "skipped").length;
  const appliedRepairs = result.repairs.filter((repair) => repair.status === "applied").length;
  const noOpRepairs = result.repairs.filter((repair) => repair.status === "no-op").length;
  const failedRepairs = result.repairs.filter((repair) => repair.status === "failed").length;

  return [
    `mode=${result.mode}`,
    `repairs=${result.repairs.length}`,
    `applied=${appliedRepairs}`,
    `noOp=${noOpRepairs}`,
    `failedRepairs=${failedRepairs}`,
    `checks=${result.checks.length}`,
    `passedChecks=${passedChecks}`,
    `failedChecks=${failedChecks}`,
    `skippedChecks=${skippedChecks}`,
    `changedArtifacts=${result.changedArtifacts.length}`,
  ].join(" ");
}

function hasFailures(result: {
  repairs: HarnessJanitorRepairResult[];
  checks: HarnessJanitorCheckResult[];
}) {
  return (
    result.repairs.some((repair) => repair.status === "failed") ||
    result.checks.some((check) => check.status === "failed")
  );
}

export async function runHarnessJanitor(
  rootDir: string,
  options: HarnessJanitorOptions = {}
) {
  const mode = options.mode ?? "report-only";
  const logger = options.logger ?? console;
  const runHarnessCheck = options.runHarnessCheck ?? (async (dir: string) => {
    const errors = await validateHarnessDocs(dir);
    if (errors.length > 0) {
      throw new Error(
        ["Harness check failed.", ...errors.map((error) => `- ${error}`)].join(
          "\n"
        )
      );
    }
  });
  const runHarnessAuditStep = options.runHarnessAudit ?? runHarnessAudit;
  const runGraphifyCheckStep = options.runGraphifyCheck ?? runGraphifyCheck;
  const runHarnessGenerateStep =
    options.runHarnessGenerate ?? writeGeneratedHarnessDocs;
  const runGraphifyRebuildStep =
    options.runGraphifyRebuild ?? runGraphifyRebuild;

  return withCapturedConsole(logger, async () => {
    const repairs: HarnessJanitorRepairResult[] = [];
    const checks: HarnessJanitorCheckResult[] = [];

    if (mode === "repair") {
      repairs.push(
        await runRepairStep(
          rootDir,
          "harness:generate",
          HARNESS_JANITOR_REPAIR_ARTIFACTS,
          runHarnessGenerateStep
        )
      );
      repairs.push(
        await runRepairStep(
          rootDir,
          "graphify:rebuild",
          GRAPHIFY_ARTIFACTS,
          runGraphifyRebuildStep
        )
      );
    }

    const repairFailed = repairs.some((repair) => repair.status === "failed");
    if (mode === "repair" && repairFailed) {
      checks.push(
        { name: "harness:check", status: "skipped", detail: "Repair step failed; re-check skipped." },
        { name: "harness:audit", status: "skipped", detail: "Repair step failed; re-check skipped." },
        { name: "graphify:check", status: "skipped", detail: "Repair step failed; re-check skipped." }
      );
    } else {
      checks.push(
        await runCheckStep("harness:check", async () => {
          await runHarnessCheck(rootDir);
        }),
        await runCheckStep("harness:audit", async () => {
          await runHarnessAuditStep(rootDir);
        }),
        await runCheckStep("graphify:check", async () => {
          await runGraphifyCheckStep(rootDir);
        })
      );
    }

    const changedArtifacts = sortUniquePaths(
      repairs.flatMap((repair) => repair.changedArtifacts)
    );
    const result = {
      mode,
      repairs,
      checks,
      changedArtifacts,
      exitCode: hasFailures({ repairs, checks }) ? 1 : 0,
      summary: "",
    };

    return {
      ...result,
      summary: buildSummary(result),
    } satisfies HarnessJanitorResult;
  });
}

export type HarnessJanitorCliArgs = {
  mode: HarnessJanitorMode;
};

export function parseHarnessJanitorCliArgs(args: string[]): HarnessJanitorCliArgs {
  let requestedMode: HarnessJanitorMode | null = null;

  for (const arg of args) {
    if (arg === "--repair") {
      if (requestedMode && requestedMode !== "repair") {
        throw new Error("Cannot combine --repair with --report-only.");
      }
      requestedMode = "repair";
      continue;
    }

    if (arg === "--report-only") {
      if (requestedMode && requestedMode !== "report-only") {
        throw new Error("Cannot combine --report-only with --repair.");
      }
      requestedMode = "report-only";
      continue;
    }

    throw new Error(
      `Unknown harness janitor argument: ${arg}. Supported flags: --repair, --report-only.`
    );
  }

  return {
    mode: requestedMode ?? "report-only",
  };
}

export function formatHarnessJanitorReport(result: HarnessJanitorResult) {
  const lines = [`[harness:janitor] ${result.summary}`];

  if (result.repairs.length === 0) {
    lines.push("Repairs: not run in report-only mode.");
  } else {
    lines.push("Repairs:");
    for (const repair of result.repairs) {
      lines.push(`- ${repair.name}: ${repair.status}`);
      lines.push(formatArtifactList(repair.changedArtifacts));
      if (repair.detail) {
        lines.push(formatDetailLines(repair.detail));
      }
    }
  }

  lines.push("Checks:");
  for (const check of result.checks) {
    lines.push(`- ${check.name}: ${check.status}`);
    if (check.detail) {
      lines.push(formatDetailLines(check.detail));
    }
  }

  lines.push(`Changed artifacts: ${result.changedArtifacts.length}`);
  for (const artifact of result.changedArtifacts) {
    lines.push(`- ${artifact}`);
  }

  lines.push(`Exit code: ${result.exitCode}`);

  return lines.join("\n");
}

if (import.meta.main) {
  const args = parseHarnessJanitorCliArgs(Bun.argv.slice(2));

  runHarnessJanitor(process.cwd(), args)
    .then((result) => {
      console.log(formatHarnessJanitorReport(result));
      if (result.exitCode !== 0) {
        process.exit(1);
      }
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      process.exit(1);
    });
}
