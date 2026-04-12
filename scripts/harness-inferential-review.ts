import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_BASE_REF = "origin/main";
const DEFAULT_MACHINE_OUTPUT_PATH =
  "artifacts/harness-inferential-review/latest.json";

type InferentialSeverity = "high" | "medium" | "low";

type InferentialFinding = {
  id: string;
  severity: InferentialSeverity;
  title: string;
  filePath: string;
  rationale: string;
  remediation: string;
};

type InferentialError = {
  code: "INFERENTIAL_PROVIDER_FAILURE" | "INFERENTIAL_RUNTIME_FAILURE";
  message: string;
  remediation: string;
};

type InferentialStatus = "pass" | "fail" | "error" | "skipped";

type InferentialMachineOutput = {
  version: "1.0";
  generatedAt: string;
  baseRef: string;
  status: InferentialStatus;
  summary: string;
  providerName: string;
  changedFiles: string[];
  targetFiles: string[];
  findings: InferentialFinding[];
  errors: InferentialError[];
};

type InferentialProviderInput = {
  rootDir: string;
  baseRef: string;
  changedFiles: string[];
  targetFiles: string[];
};

type InferentialProviderResult = {
  providerName: string;
  findings: InferentialFinding[];
};

type InferentialReviewLogger = Pick<Console, "log" | "error">;

type InferentialReviewOptions = {
  baseRef?: string;
  getChangedFiles?: (rootDir: string, baseRef: string) => Promise<string[]>;
  runProvider?: (
    input: InferentialProviderInput
  ) => Promise<InferentialProviderResult>;
  machineOutputPath?: string;
  nowIso?: () => string;
  logger?: InferentialReviewLogger;
};

type HarnessInferentialReviewResult = {
  exitCode: 0 | 1;
  humanReport: string;
  machine: InferentialMachineOutput;
  machineOutputPath: string;
};

function normalizeRepoPath(repoPath: string) {
  return repoPath.replaceAll("\\", "/");
}

function sortUnique(entries: string[]) {
  return [
    ...new Set(entries.map((entry) => normalizeRepoPath(entry).trim()).filter(Boolean)),
  ].sort((left, right) => left.localeCompare(right));
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

type SpawnedProcess = {
  exited: Promise<number>;
  stdout?: ReadableStream | null;
  stderr?: ReadableStream | null;
};

async function runCommand(
  rootDir: string,
  command: string[],
  spawn: (
    command: string[],
    options: { cwd: string; stdout: "pipe"; stderr: "pipe" }
  ) => SpawnedProcess = Bun.spawn
) {
  const process = spawn(command, {
    cwd: rootDir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  return {
    stdout,
    stderr,
    exitCode,
  };
}

export async function getChangedFilesForInferentialReview(
  rootDir: string,
  baseRef: string
) {
  const refCheck = await runCommand(rootDir, [
    "git",
    "rev-parse",
    "--verify",
    baseRef,
  ]);

  if (refCheck.exitCode !== 0) {
    const detail = refCheck.stderr.trim() || `${baseRef} is not reachable.`;
    throw new Error(`Base ref check failed for ${baseRef}: ${detail}`);
  }

  const [baseDiff, trackedDiff, untrackedDiff] = await Promise.all([
    runCommand(rootDir, [
      "git",
      "diff",
      "--name-only",
      "--diff-filter=ACDMRTUXB",
      `${baseRef}...HEAD`,
      "--",
    ]),
    runCommand(rootDir, [
      "git",
      "diff",
      "--name-only",
      "--diff-filter=ACDMRTUXB",
      "HEAD",
      "--",
    ]),
    runCommand(rootDir, ["git", "ls-files", "--others", "--exclude-standard"]),
  ]);

  if (baseDiff.exitCode !== 0) {
    throw new Error(
      baseDiff.stderr.trim() ||
        `Unable to compute changed files against ${baseRef}.`
    );
  }

  if (trackedDiff.exitCode !== 0) {
    throw new Error(
      trackedDiff.stderr.trim() ||
        "Unable to compute tracked working-tree changes."
    );
  }

  if (untrackedDiff.exitCode !== 0) {
    throw new Error(
      untrackedDiff.stderr.trim() ||
        "Unable to compute untracked working-tree changes."
    );
  }

  return sortUnique([
    ...baseDiff.stdout.split("\n"),
    ...trackedDiff.stdout.split("\n"),
    ...untrackedDiff.stdout.split("\n"),
  ]);
}

function isHarnessCriticalFile(filePath: string) {
  const normalized = normalizeRepoPath(filePath);

  if (normalized === "package.json") {
    return true;
  }

  if (normalized === ".github/workflows/athena-pr-tests.yml") {
    return true;
  }

  if (normalized.startsWith("scripts/harness-")) {
    return true;
  }

  if (
    normalized === "packages/athena-webapp/docs/agent/testing.md" ||
    normalized === "packages/storefront-webapp/docs/agent/testing.md"
  ) {
    return true;
  }

  return false;
}

function buildFinding(
  id: string,
  severity: InferentialSeverity,
  title: string,
  filePath: string,
  rationale: string,
  remediation: string
): InferentialFinding {
  return {
    id,
    severity,
    title,
    filePath,
    rationale,
    remediation,
  };
}

function includesCaseInsensitive(haystack: string, needle: string) {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

export async function runDeterministicInferentialProvider(
  input: InferentialProviderInput
): Promise<InferentialProviderResult> {
  const findings: InferentialFinding[] = [];
  const packageJsonPath = path.join(input.rootDir, "package.json");
  const workflowPath = path.join(
    input.rootDir,
    ".github/workflows/athena-pr-tests.yml"
  );
  const athenaTestingDocPath = path.join(
    input.rootDir,
    "packages/athena-webapp/docs/agent/testing.md"
  );
  const storefrontTestingDocPath = path.join(
    input.rootDir,
    "packages/storefront-webapp/docs/agent/testing.md"
  );

  const packageJsonContents = await readUtf8OrNull(packageJsonPath);
  if (!packageJsonContents) {
    findings.push(
      buildFinding(
        "missing-package-json",
        "high",
        "Missing repo package.json",
        "package.json",
        "Inferential gate policy cannot verify pr:athena wiring without package.json.",
        "Restore package.json and ensure pr:athena includes `bun run harness:inferential-review`."
      )
    );
  } else {
    let prAthenaScript = "";

    try {
      const parsed = JSON.parse(packageJsonContents) as {
        scripts?: Record<string, string>;
      };
      prAthenaScript = parsed.scripts?.["pr:athena"] ?? "";
    } catch {
      findings.push(
        buildFinding(
          "invalid-package-json",
          "high",
          "Invalid package.json format",
          "package.json",
          "Inferential gate policy could not parse package.json to inspect pr:athena wiring.",
          "Fix package.json JSON syntax and ensure pr:athena includes `bun run harness:inferential-review`."
        )
      );
    }

    if (
      prAthenaScript &&
      !includesCaseInsensitive(prAthenaScript, "bun run harness:inferential-review")
    ) {
      findings.push(
        buildFinding(
          "missing-pr-athena-inferential-step",
          "high",
          "pr:athena omits inferential review",
          "package.json",
          "Athena preflight does not currently include the inferential review gate.",
          "Add `bun run harness:inferential-review` to the `pr:athena` script before final success output."
        )
      );
    }
  }

  const workflowContents = await readUtf8OrNull(workflowPath);
  if (!workflowContents) {
    findings.push(
      buildFinding(
        "missing-athena-pr-workflow",
        "high",
        "Missing Athena PR workflow",
        ".github/workflows/athena-pr-tests.yml",
        "Inferential gate policy cannot verify CI enforcement without the Athena PR workflow file.",
        "Restore `.github/workflows/athena-pr-tests.yml` and add `run: bun run harness:inferential-review`."
      )
    );
  } else if (
    !includesCaseInsensitive(
      workflowContents,
      "run: bun run harness:inferential-review"
    )
  ) {
    findings.push(
      buildFinding(
        "missing-ci-inferential-step",
        "high",
        "CI omits inferential review",
        ".github/workflows/athena-pr-tests.yml",
        "Athena PR workflow does not enforce inferential review as a blocking gate.",
        "Add a workflow step with `run: bun run harness:inferential-review` in the harness validation job."
      )
    );
  }

  const testingDocs = [
    {
      filePath: "packages/athena-webapp/docs/agent/testing.md",
      contents: await readUtf8OrNull(athenaTestingDocPath),
    },
    {
      filePath: "packages/storefront-webapp/docs/agent/testing.md",
      contents: await readUtf8OrNull(storefrontTestingDocPath),
    },
  ];

  for (const testingDoc of testingDocs) {
    if (!testingDoc.contents) {
      findings.push(
        buildFinding(
          `missing-testing-doc-${testingDoc.filePath.replaceAll("/", "-")}`,
          "medium",
          "Missing testing guidance",
          testingDoc.filePath,
          "Inferential gate policy cannot verify agent-facing usage guidance when testing docs are absent.",
          "Restore the testing doc and document inferential review usage plus failure remediation guidance."
        )
      );
      continue;
    }

    const hasCommand = includesCaseInsensitive(
      testingDoc.contents,
      "`bun run harness:inferential-review`"
    );
    const hasFailureGuidance =
      includesCaseInsensitive(testingDoc.contents, "non-zero") &&
      includesCaseInsensitive(testingDoc.contents, "remediation");

    if (!hasCommand || !hasFailureGuidance) {
      findings.push(
        buildFinding(
          `missing-inferential-doc-guidance-${testingDoc.filePath.replaceAll("/", "-")}`,
          "medium",
          "Inferential review docs guidance is incomplete",
          testingDoc.filePath,
          "Testing docs must show how to run inferential review and how to interpret blocking failures.",
          "Document `bun run harness:inferential-review` and state that findings fail with non-zero exit plus remediation guidance."
        )
      );
    }
  }

  return {
    providerName: "deterministic-policy-v1",
    findings: sortFindings(findings),
  };
}

function sortFindings(findings: InferentialFinding[]) {
  return [...findings].sort((left, right) => {
    if (left.severity !== right.severity) {
      const severityRank: Record<InferentialSeverity, number> = {
        high: 0,
        medium: 1,
        low: 2,
      };
      return severityRank[left.severity] - severityRank[right.severity];
    }

    if (left.filePath !== right.filePath) {
      return left.filePath.localeCompare(right.filePath);
    }

    return left.id.localeCompare(right.id);
  });
}

function formatStatusLabel(status: InferentialStatus) {
  switch (status) {
    case "pass":
      return "PASS";
    case "fail":
      return "FAIL";
    case "error":
      return "ERROR";
    case "skipped":
      return "SKIPPED";
  }
}

function buildHumanReport(output: InferentialMachineOutput) {
  const lines: string[] = [];

  lines.push("# Harness Inferential Review");
  lines.push("");
  lines.push(`Status: ${formatStatusLabel(output.status)}`);
  lines.push(`Provider: ${output.providerName}`);
  lines.push(`Base ref: ${output.baseRef}`);
  lines.push(`Changed files: ${output.changedFiles.length}`);
  lines.push(`Target files: ${output.targetFiles.length}`);
  lines.push("");
  lines.push("Summary:");
  lines.push(`- ${output.summary}`);
  lines.push("");

  if (output.findings.length === 0) {
    lines.push("Findings:");
    lines.push("- No actionable inferential findings.");
    lines.push("");
  } else {
    lines.push("Findings:");
    for (const finding of output.findings) {
      lines.push(
        `- [${finding.severity.toUpperCase()}] ${finding.title} (${finding.filePath})`
      );
      lines.push(`  Rationale: ${finding.rationale}`);
      lines.push(`  Remediation: ${finding.remediation}`);
    }
    lines.push("");
  }

  if (output.errors.length > 0) {
    lines.push("Errors:");
    for (const error of output.errors) {
      lines.push(`- ${error.code}: ${error.message}`);
      lines.push(`  Remediation: ${error.remediation}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function writeMachineOutput(
  rootDir: string,
  machineOutputPath: string,
  output: InferentialMachineOutput
) {
  const absoluteOutputPath = path.join(rootDir, machineOutputPath);
  await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
  await writeFile(`${absoluteOutputPath}`, `${JSON.stringify(output, null, 2)}\n`);
}

function createOutput(params: {
  status: InferentialStatus;
  summary: string;
  baseRef: string;
  changedFiles: string[];
  targetFiles: string[];
  findings?: InferentialFinding[];
  errors?: InferentialError[];
  providerName: string;
  generatedAt: string;
}): InferentialMachineOutput {
  return {
    version: "1.0",
    generatedAt: params.generatedAt,
    baseRef: params.baseRef,
    status: params.status,
    summary: params.summary,
    providerName: params.providerName,
    changedFiles: sortUnique(params.changedFiles),
    targetFiles: sortUnique(params.targetFiles),
    findings: sortFindings(params.findings ?? []),
    errors: params.errors ?? [],
  };
}

function createProviderFailure(
  message: string,
  baseRef: string,
  changedFiles: string[],
  targetFiles: string[],
  generatedAt: string
): InferentialMachineOutput {
  return createOutput({
    status: "error",
    summary:
      "Provider/runtime failure: inferential review could not complete before results were produced.",
    baseRef,
    changedFiles,
    targetFiles,
    providerName: "deterministic-policy-v1",
    generatedAt,
    errors: [
      {
        code: "INFERENTIAL_PROVIDER_FAILURE",
        message,
        remediation:
          "Confirm provider configuration and connectivity, then rerun `bun run harness:inferential-review`.",
      },
    ],
  });
}

function createRuntimeFailure(
  message: string,
  baseRef: string,
  changedFiles: string[],
  targetFiles: string[],
  generatedAt: string
): InferentialMachineOutput {
  return createOutput({
    status: "error",
    summary:
      "Inferential review encountered a runtime failure before completion.",
    baseRef,
    changedFiles,
    targetFiles,
    providerName: "deterministic-policy-v1",
    generatedAt,
    errors: [
      {
        code: "INFERENTIAL_RUNTIME_FAILURE",
        message,
        remediation:
          "Inspect the runtime error output, fix the failing precondition, and rerun `bun run harness:inferential-review`.",
      },
    ],
  });
}

export async function runHarnessInferentialReview(
  rootDir: string,
  options: InferentialReviewOptions = {}
): Promise<HarnessInferentialReviewResult> {
  const baseRef = options.baseRef ?? DEFAULT_BASE_REF;
  const machineOutputPath =
    options.machineOutputPath ?? DEFAULT_MACHINE_OUTPUT_PATH;
  const nowIso = options.nowIso ?? (() => new Date().toISOString());
  const logger = options.logger ?? console;

  const getChangedFiles =
    options.getChangedFiles ?? getChangedFilesForInferentialReview;
  const runProvider =
    options.runProvider ?? runDeterministicInferentialProvider;

  let changedFiles: string[] = [];
  let targetFiles: string[] = [];
  let machine: InferentialMachineOutput;

  try {
    changedFiles = sortUnique(await getChangedFiles(rootDir, baseRef));
    targetFiles = changedFiles.filter(isHarnessCriticalFile);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    machine = createRuntimeFailure(
      message,
      baseRef,
      changedFiles,
      targetFiles,
      nowIso()
    );
    const humanReport = buildHumanReport(machine);
    await writeMachineOutput(rootDir, machineOutputPath, machine);
    return {
      exitCode: 1,
      humanReport,
      machine,
      machineOutputPath,
    };
  }

  if (targetFiles.length === 0) {
    machine = createOutput({
      status: "skipped",
      summary: "No harness-critical files are in scope. Inferential review skipped.",
      baseRef,
      changedFiles,
      targetFiles,
      providerName: "deterministic-policy-v1",
      generatedAt: nowIso(),
    });
    const humanReport = buildHumanReport(machine);
    await writeMachineOutput(rootDir, machineOutputPath, machine);
    return {
      exitCode: 0,
      humanReport,
      machine,
      machineOutputPath,
    };
  }

  try {
    const providerResult = await runProvider({
      rootDir,
      baseRef,
      changedFiles,
      targetFiles,
    });
    const findings = sortFindings(providerResult.findings);
    machine = createOutput({
      status: findings.length > 0 ? "fail" : "pass",
      summary:
        findings.length > 0
          ? `Inferential review found ${findings.length} actionable finding(s).`
          : "Inferential review completed with no actionable findings.",
      baseRef,
      changedFiles,
      targetFiles,
      providerName: providerResult.providerName,
      findings,
      generatedAt: nowIso(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    machine = createProviderFailure(
      message,
      baseRef,
      changedFiles,
      targetFiles,
      nowIso()
    );
  }

  const humanReport = buildHumanReport(machine);

  try {
    await writeMachineOutput(rootDir, machineOutputPath, machine);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    machine = createRuntimeFailure(
      `Unable to write machine output: ${message}`,
      baseRef,
      changedFiles,
      targetFiles,
      nowIso()
    );
    const runtimeReport = buildHumanReport(machine);
    await writeMachineOutput(rootDir, machineOutputPath, machine);
    return {
      exitCode: 1,
      humanReport: runtimeReport,
      machine,
      machineOutputPath,
    };
  }

  if (machine.status === "fail" || machine.status === "error") {
    logger.error("[harness:inferential-review] blocking findings detected.");
    return {
      exitCode: 1,
      humanReport,
      machine,
      machineOutputPath,
    };
  }

  logger.log("[harness:inferential-review] completed without blockers.");
  return {
    exitCode: 0,
    humanReport,
    machine,
    machineOutputPath,
  };
}

type ParsedCliArgs = {
  baseRef: string;
  help: boolean;
};

function parseCliArgs(argv: string[]): ParsedCliArgs {
  let baseRef = DEFAULT_BASE_REF;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg) {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      return {
        baseRef,
        help: true,
      };
    }

    if (arg === "--base") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(
          "Missing value for --base. Usage: bun run harness:inferential-review --base origin/main"
        );
      }
      baseRef = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--base=")) {
      const value = arg.slice("--base=".length).trim();
      if (!value) {
        throw new Error(
          "Missing value for --base. Usage: bun run harness:inferential-review --base origin/main"
        );
      }
      baseRef = value;
      continue;
    }

    throw new Error(
      `Unknown argument: ${arg}. Usage: bun run harness:inferential-review [--base <ref>]`
    );
  }

  return {
    baseRef,
    help: false,
  };
}

if (import.meta.main) {
  try {
    const parsed = parseCliArgs(Bun.argv.slice(2));
    if (parsed.help) {
      console.log(
        "Usage: bun run harness:inferential-review [--base <ref>]"
      );
      process.exit(0);
    }

    const result = await runHarnessInferentialReview(process.cwd(), {
      baseRef: parsed.baseRef,
    });
    console.log(result.humanReport);
    console.log(`Machine output: ${result.machineOutputPath}`);

    if (result.exitCode !== 0) {
      process.exit(result.exitCode);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n[harness:inferential-review] BLOCKED: ${message}`);
    process.exit(1);
  }
}
