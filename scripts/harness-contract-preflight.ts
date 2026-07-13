import { mkdir } from "node:fs/promises";
import path from "node:path";

import { runHarnessAudit } from "./harness-audit";
import { runHarnessSelfReview } from "./harness-self-review";

const DEFAULT_MACHINE_OUTPUT_PATH =
  "artifacts/harness-contract-preflight/latest.json";
const SIBLING_TEST_FINDING_PREFIX = "missing-harness-script-test-update-";

type HarnessContractFindingSource =
  | "validation-map"
  | "harness-audit"
  | "contract-fixtures"
  | "sibling-test-policy";

type HarnessContractFinding = {
  source: HarnessContractFindingSource;
  message: string;
};

type HarnessContractPreflightMachine = {
  version: "1.0";
  generatedAt: string;
  status: "pass" | "fail";
  findings: HarnessContractFinding[];
};

type HarnessContractPreflightOptions = {
  baseRef?: string;
  nowIso?: () => string;
  runSelfReview?: (rootDir: string) => Promise<{ blockers: string[] }>;
  runAudit?: (rootDir: string) => Promise<void>;
  runContractTests?: (rootDir: string) => Promise<void>;
  runSiblingTestPolicy?: (rootDir: string) => Promise<
    Array<{
      id: string;
      title: string;
      filePath: string;
      rationale: string;
      remediation: string;
    }>
  >;
  machineOutputPath?: string;
  writeMachineOutput?: boolean;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function runFocusedContractTests(rootDir: string) {
  const command = [
    "bun",
    "test",
    "scripts/harness-audit.test.ts",
    "scripts/harness-app-registry.test.ts",
  ];
  const process = Bun.spawn(command, {
    cwd: rootDir,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "inherit",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(
      [
        `Focused harness contract tests exited with code ${exitCode}.`,
        stdout.trim(),
        stderr.trim(),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
}

function formatHumanReport(machine: HarnessContractPreflightMachine) {
  if (machine.status === "pass") {
    return "Harness contract preflight passed.";
  }

  const lines = [
    `Harness contract preflight failed with ${machine.findings.length} finding(s).`,
    "",
  ];

  for (const finding of machine.findings) {
    lines.push(`[${finding.source}] ${finding.message}`);
  }

  lines.push(
    "",
    "Repair contract:",
    "- Source of truth: scripts/harness-app-registry.ts",
    "- Regenerate derived harness docs: bun run harness:generate",
    "- Update the registry sibling test: scripts/harness-app-registry.test.ts",
    "- Keep audit fixture paths current: scripts/harness-audit.test.ts",
    "- Focused verification: bun test scripts/harness-contract-preflight.test.ts scripts/harness-review.test.ts scripts/harness-audit.test.ts scripts/harness-app-registry.test.ts scripts/harness-inferential-review.test.ts",
  );

  return lines.join("\n");
}

export async function runHarnessContractPreflight(
  rootDir: string,
  options: HarnessContractPreflightOptions = {},
) {
  const findings: HarnessContractFinding[] = [];
  const baseRef = options.baseRef ?? "origin/main";
  const runSelfReview =
    options.runSelfReview ??
    ((nextRootDir) =>
      runHarnessSelfReview(nextRootDir, { baseRef }));
  const runAudit = options.runAudit ?? runHarnessAudit;
  const runContractTests =
    options.runContractTests ?? runFocusedContractTests;
  const runSiblingTestPolicy =
    options.runSiblingTestPolicy ??
    (async (nextRootDir) => {
      const { collectHarnessSiblingTestPolicyFindings } = await import(
        "./harness-inferential-review"
      );
      return collectHarnessSiblingTestPolicyFindings(nextRootDir, { baseRef });
    });

  const [
    selfReviewResult,
    auditResult,
    contractTestsResult,
    inferentialResult,
  ] =
    await Promise.allSettled([
      runSelfReview(rootDir),
      runAudit(rootDir),
      runContractTests(rootDir),
      runSiblingTestPolicy(rootDir),
    ]);

  if (selfReviewResult.status === "fulfilled") {
    for (const blocker of selfReviewResult.value.blockers) {
      findings.push({ source: "validation-map", message: blocker });
    }
  } else {
    findings.push({
      source: "validation-map",
      message: errorMessage(selfReviewResult.reason),
    });
  }

  if (auditResult.status === "rejected") {
    findings.push({
      source: "harness-audit",
      message: errorMessage(auditResult.reason),
    });
  }

  if (contractTestsResult.status === "rejected") {
    findings.push({
      source: "contract-fixtures",
      message: errorMessage(contractTestsResult.reason),
    });
  }

  if (inferentialResult.status === "fulfilled") {
    for (const finding of inferentialResult.value.filter((entry) =>
      entry.id.startsWith(SIBLING_TEST_FINDING_PREFIX),
    )) {
      findings.push({
        source: "sibling-test-policy",
        message: `${finding.title} (${finding.filePath}): ${finding.rationale} ${finding.remediation}`,
      });
    }
  } else {
    findings.push({
      source: "sibling-test-policy",
      message: errorMessage(inferentialResult.reason),
    });
  }

  const machine: HarnessContractPreflightMachine = {
    version: "1.0",
    generatedAt: (options.nowIso ?? (() => new Date().toISOString()))(),
    status: findings.length === 0 ? "pass" : "fail",
    findings,
  };
  const humanReport = formatHumanReport(machine);

  if (options.writeMachineOutput ?? true) {
    const outputPath = path.join(
      rootDir,
      options.machineOutputPath ?? DEFAULT_MACHINE_OUTPUT_PATH,
    );
    await mkdir(path.dirname(outputPath), { recursive: true });
    await Bun.write(outputPath, `${JSON.stringify(machine, null, 2)}\n`);
  }

  return {
    exitCode: machine.status === "pass" ? (0 as const) : (1 as const),
    humanReport,
    machine,
  };
}

if (import.meta.main) {
  const result = await runHarnessContractPreflight(process.cwd());
  const logger = result.exitCode === 0 ? console.log : console.error;
  logger(result.humanReport);
  process.exit(result.exitCode);
}
