import Anthropic from "@anthropic-ai/sdk";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_BASE_REF = "origin/main";
const DEFAULT_MACHINE_OUTPUT_PATH =
  "artifacts/harness-inferential-review/latest.json";
const DEFAULT_SEMANTIC_MODE = "off";
const DEFAULT_SEMANTIC_PROVIDER_MODEL = "claude-3-5-haiku-20241022";
const DEFAULT_SEMANTIC_PROVIDER_NAME = "anthropic-shadow-v1";
const MAX_PROMPT_TARGET_FILES = 6;
const MAX_PROMPT_FILE_CHARS = 6000;

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
type InferentialReviewMode = "deterministic-only" | "semantic-shadow";
type InferentialShadowMode = "off" | "shadow";

type InferentialShadowMachineOutput = {
  generatedAt: string;
  status: InferentialStatus;
  summary: string;
  providerName: string;
  findings: InferentialFinding[];
  errors: InferentialError[];
};

type InferentialMachineOutput = {
  version: "1.0";
  generatedAt: string;
  reviewMode: InferentialReviewMode;
  baseRef: string;
  status: InferentialStatus;
  summary: string;
  providerName: string;
  changedFiles: string[];
  targetFiles: string[];
  findings: InferentialFinding[];
  errors: InferentialError[];
  shadow?: InferentialShadowMachineOutput;
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

type InferentialDeterministicAnalysisResult = {
  findings: InferentialFinding[];
};

type InferentialSemanticAnalysisResult = {
  providerName: string;
  findings: InferentialFinding[];
  summary?: string;
  status?: InferentialStatus;
  errors?: InferentialError[];
};

type InferentialReviewLogger = Pick<Console, "log" | "error">;

type InferentialReviewOptions = {
  baseRef?: string;
  getChangedFiles?: (rootDir: string, baseRef: string) => Promise<string[]>;
  runProvider?: (
    input: InferentialProviderInput
  ) => Promise<InferentialProviderResult>;
  semanticMode?: InferentialShadowMode;
  persistHistory?: boolean;
  runSemanticAnalysis?: (
    input: InferentialProviderInput
  ) => Promise<InferentialSemanticAnalysisResult>;
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

function slugifyForFindingId(value: string) {
  return normalizeRepoPath(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isHarnessScriptSourceFile(filePath: string) {
  const normalized = normalizeRepoPath(filePath);
  return normalized.startsWith("scripts/harness-") && normalized.endsWith(".ts") && !normalized.endsWith(".test.ts");
}

function toHarnessScriptTestPath(filePath: string) {
  return normalizeRepoPath(filePath).replace(/\.ts$/, ".test.ts");
}

function formatMissingSignals(snippets: string[]) {
  return snippets.map((snippet) => `\`${snippet}\``).join(", ");
}

function createReducedSignalFinding(
  filePath: string,
  title: string,
  severity: InferentialSeverity,
  missingSignals: string[],
  remediation: string
): InferentialFinding {
  return buildFinding(
    `reduced-safety-signals-${slugifyForFindingId(filePath)}`,
    severity,
    title,
    filePath,
    `This file is missing safety or wiring signal(s): ${formatMissingSignals(missingSignals)}.`,
    remediation
  );
}

async function collectHarnessScriptTestUpdateFindings(
  rootDir: string,
  changedFiles: string[]
) {
  const changedFileSet = new Set(sortUnique(changedFiles));
  const findings: InferentialFinding[] = [];

  for (const changedFile of changedFileSet) {
    if (!isHarnessScriptSourceFile(changedFile)) {
      continue;
    }

    const matchingTestFile = toHarnessScriptTestPath(changedFile);
    if (changedFileSet.has(matchingTestFile)) {
      continue;
    }

    const testFileExists = await fileExists(path.join(rootDir, matchingTestFile));
    findings.push(
      buildFinding(
        `missing-harness-script-test-update-${slugifyForFindingId(changedFile)}`,
        "medium",
        "Harness script changed without test update",
        changedFile,
        testFileExists
          ? `This harness-critical script changed, but its sibling test file ${matchingTestFile} was not part of the same change.`
          : `This harness-critical script changed, but the expected sibling test file ${matchingTestFile} is missing.`,
        testFileExists
          ? `Update ${matchingTestFile} alongside the script change so the regression coverage stays deterministic.`
          : `Create ${matchingTestFile} alongside the script change so the regression coverage stays deterministic.`
      )
    );
  }

  return findings;
}

async function collectHarnessSafetySignalFindings(
  rootDir: string,
  changedFiles: string[]
) {
  const changedFileSet = new Set(sortUnique(changedFiles));
  const findings: InferentialFinding[] = [];

  const fileRules: Array<{
    filePath: string;
    severity: InferentialSeverity;
    title: string;
    requiredSignals: string[];
    remediation: string;
  }> = [
    {
      filePath: "package.json",
      severity: "high",
      title: "PR preflight lost harness safety wiring",
      requiredSignals: [
        "bun run harness:check",
        "bun run harness:audit",
        "bun run graphify:check",
      ],
      remediation:
        "Restore the pr:athena safety chain so the harness check, audit, and graphify gates still run before merge.",
    },
    {
      filePath: ".github/workflows/athena-pr-tests.yml",
      severity: "high",
      title: "Athena PR workflow lost harness safety wiring",
      requiredSignals: [
        "run: bun run harness:check",
        "run: bun run harness:audit",
        "run: bun run graphify:check",
      ],
      remediation:
        "Restore the harness validation steps in the PR workflow so CI still exercises the safety ladder.",
    },
    {
      filePath: "packages/athena-webapp/docs/agent/testing.md",
      severity: "medium",
      title: "Athena testing guidance lost harness coverage signals",
      requiredSignals: [
        "bun run harness:check",
        "bun run harness:review",
        "bun run harness:audit",
      ],
      remediation:
        "Restore the harness check, review, and audit guidance so agents can follow the validation ladder from the testing doc.",
    },
    {
      filePath: "packages/storefront-webapp/docs/agent/testing.md",
      severity: "medium",
      title: "Storefront testing guidance lost harness coverage signals",
      requiredSignals: [
        "bun run harness:check",
        "bun run harness:review",
        "bun run harness:audit",
      ],
      remediation:
        "Restore the harness check, review, and audit guidance so agents can follow the validation ladder from the testing doc.",
    },
  ];

  for (const rule of fileRules) {
    if (!changedFileSet.has(rule.filePath)) {
      continue;
    }

    const contents = await readUtf8OrNull(path.join(rootDir, rule.filePath));
    if (!contents) {
      continue;
    }

    const missingSignals = rule.requiredSignals.filter(
      (signal) => !includesCaseInsensitive(contents, signal)
    );

    if (missingSignals.length === 0) {
      continue;
    }

    findings.push(
      createReducedSignalFinding(
        rule.filePath,
        rule.title,
        rule.severity,
        missingSignals,
        rule.remediation
      )
    );
  }

  return findings;
}

async function runDeterministicSemanticAnalysis(
  input: InferentialProviderInput
): Promise<InferentialDeterministicAnalysisResult> {
  const findings = [
    ...(await collectHarnessScriptTestUpdateFindings(
      input.rootDir,
      input.changedFiles
    )),
    ...(await collectHarnessSafetySignalFindings(
      input.rootDir,
      input.changedFiles
    )),
  ];

  return {
    findings: sortFindings(findings),
  };
}

function resolveSemanticMode(
  optionMode?: InferentialShadowMode
): InferentialShadowMode {
  const rawMode =
    optionMode ?? process.env.HARNESS_INFERENTIAL_SEMANTIC_MODE ?? DEFAULT_SEMANTIC_MODE;

  return rawMode === "shadow" ? "shadow" : "off";
}

function buildShadowSummary(findings: InferentialFinding[]) {
  return findings.length > 0
    ? `Shadow semantic review found ${findings.length} possible issue(s).`
    : "Shadow semantic review found no semantic issues.";
}

function truncateForPrompt(contents: string) {
  if (contents.length <= MAX_PROMPT_FILE_CHARS) {
    return contents;
  }

  return `${contents.slice(0, MAX_PROMPT_FILE_CHARS)}\n...[truncated]`;
}

async function buildSemanticPrompt(input: InferentialProviderInput) {
  const fileSections: string[] = [];

  for (const filePath of input.targetFiles.slice(0, MAX_PROMPT_TARGET_FILES)) {
    const contents = await readUtf8OrNull(path.join(input.rootDir, filePath));
    fileSections.push(
      [
        `FILE: ${filePath}`,
        "CONTENT:",
        contents ? truncateForPrompt(contents) : "[missing]",
      ].join("\n")
    );
  }

  return [
    "You are reviewing Athena harness-critical files in semantic shadow mode.",
    "Return JSON only with this exact shape:",
    '{"summary":"string","findings":[{"id":"string","severity":"high|medium|low","title":"string","filePath":"string","rationale":"string","remediation":"string"}]}',
    "Only report likely semantic or operational issues that a deterministic rule might miss.",
    "If there are no likely issues, return {\"summary\":\"No semantic issues detected.\",\"findings\":[]}.",
    `Base ref: ${input.baseRef}`,
    `Changed files (${input.changedFiles.length}): ${input.changedFiles.join(", ")}`,
    `Target files (${input.targetFiles.length}): ${input.targetFiles.join(", ")}`,
    "",
    fileSections.join("\n\n"),
  ].join("\n");
}

function extractTextFromAnthropicResponse(content: unknown) {
  if (!Array.isArray(content)) {
    return String(content ?? "");
  }

  return content
    .map((entry) => {
      if (typeof entry === "string") {
        return entry;
      }

      if (
        typeof entry === "object" &&
        entry !== null &&
        "type" in entry &&
        "text" in entry &&
        (entry as { type?: string }).type === "text"
      ) {
        return String((entry as { text?: string }).text ?? "");
      }

      return "";
    })
    .join("\n");
}

function extractJsonPayload(responseText: string) {
  const trimmed = responseText.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  throw new Error("Semantic provider response did not include JSON output.");
}

function normalizeSemanticFinding(
  value: unknown
): InferentialFinding | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const id =
    typeof candidate.id === "string" && candidate.id.trim()
      ? candidate.id.trim()
      : null;
  const severity =
    candidate.severity === "high" ||
    candidate.severity === "medium" ||
    candidate.severity === "low"
      ? candidate.severity
      : null;
  const title =
    typeof candidate.title === "string" && candidate.title.trim()
      ? candidate.title.trim()
      : null;
  const filePath =
    typeof candidate.filePath === "string" && candidate.filePath.trim()
      ? normalizeRepoPath(candidate.filePath)
      : null;
  const rationale =
    typeof candidate.rationale === "string" && candidate.rationale.trim()
      ? candidate.rationale.trim()
      : null;
  const remediation =
    typeof candidate.remediation === "string" && candidate.remediation.trim()
      ? candidate.remediation.trim()
      : null;

  if (!id || !severity || !title || !filePath || !rationale || !remediation) {
    return null;
  }

  return {
    id,
    severity,
    title,
    filePath,
    rationale,
    remediation,
  };
}

function parseSemanticResponse(responseText: string) {
  const parsed = JSON.parse(extractJsonPayload(responseText)) as {
    summary?: unknown;
    findings?: unknown;
  };

  const findings = Array.isArray(parsed.findings)
    ? parsed.findings
        .map((finding) => normalizeSemanticFinding(finding))
        .filter((finding): finding is InferentialFinding => finding !== null)
    : [];

  const summary =
    typeof parsed.summary === "string" && parsed.summary.trim()
      ? parsed.summary.trim()
      : buildShadowSummary(findings);

  return {
    summary,
    findings: sortFindings(findings),
  };
}

async function runAnthropicSemanticAnalysis(
  input: InferentialProviderInput
): Promise<InferentialSemanticAnalysisResult> {
  const model =
    process.env.HARNESS_INFERENTIAL_ANTHROPIC_MODEL?.trim() ||
    DEFAULT_SEMANTIC_PROVIDER_MODEL;
  const providerName = `${DEFAULT_SEMANTIC_PROVIDER_NAME}:${model}`;
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();

  if (!apiKey) {
    return {
      providerName,
      status: "skipped",
      summary:
        "Shadow semantic review skipped because ANTHROPIC_API_KEY is not configured.",
      findings: [],
    };
  }

  const prompt = await buildSemanticPrompt(input);
  const anthropic = new Anthropic({ apiKey });
  const completion = await anthropic.messages.create({
    model,
    max_tokens: 1200,
    temperature: 0,
    messages: [{ role: "user", content: prompt }],
  });

  const responseText = extractTextFromAnthropicResponse(completion.content);
  const parsed = parseSemanticResponse(responseText);

  return {
    providerName,
    status: parsed.findings.length > 0 ? "fail" : "pass",
    summary: parsed.summary,
    findings: parsed.findings,
  };
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
  lines.push(`Review mode: ${output.reviewMode}`);
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

  if (output.shadow) {
    lines.push("Shadow semantic review:");
    lines.push(`- Status: ${formatStatusLabel(output.shadow.status)}`);
    lines.push(`- Provider: ${output.shadow.providerName}`);
    lines.push(`- Summary: ${output.shadow.summary}`);

    if (output.shadow.findings.length > 0) {
      for (const finding of output.shadow.findings) {
        lines.push(
          `- [${finding.severity.toUpperCase()}] ${finding.title} (${finding.filePath})`
        );
        lines.push(`  Rationale: ${finding.rationale}`);
        lines.push(`  Remediation: ${finding.remediation}`);
      }
    }

    if (output.shadow.errors.length > 0) {
      for (const error of output.shadow.errors) {
        lines.push(`- ${error.code}: ${error.message}`);
        lines.push(`  Remediation: ${error.remediation}`);
      }
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

function toHistoryFileStamp(generatedAt: string) {
  return generatedAt.replaceAll(":", "-").replaceAll(".", "-");
}

async function writeHistorySnapshot(
  rootDir: string,
  machineOutputPath: string,
  output: InferentialMachineOutput
) {
  const absoluteHistoryPath = path.join(
    rootDir,
    path.dirname(machineOutputPath),
    "history",
    `${toHistoryFileStamp(output.generatedAt)}.json`
  );

  await mkdir(path.dirname(absoluteHistoryPath), { recursive: true });
  await writeFile(absoluteHistoryPath, `${JSON.stringify(output, null, 2)}\n`);
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
  reviewMode?: InferentialReviewMode;
  shadow?: InferentialShadowMachineOutput;
}): InferentialMachineOutput {
  return {
    version: "1.0",
    generatedAt: params.generatedAt,
    reviewMode: params.reviewMode ?? "deterministic-only",
    baseRef: params.baseRef,
    status: params.status,
    summary: params.summary,
    providerName: params.providerName,
    changedFiles: sortUnique(params.changedFiles),
    targetFiles: sortUnique(params.targetFiles),
    findings: sortFindings(params.findings ?? []),
    errors: params.errors ?? [],
    shadow: params.shadow,
  };
}

function createShadowOutput(params: {
  status: InferentialStatus;
  summary: string;
  providerName: string;
  generatedAt: string;
  findings?: InferentialFinding[];
  errors?: InferentialError[];
}): InferentialShadowMachineOutput {
  return {
    generatedAt: params.generatedAt,
    status: params.status,
    summary: params.summary,
    providerName: params.providerName,
    findings: sortFindings(params.findings ?? []),
    errors: params.errors ?? [],
  };
}

function createProviderFailure(
  message: string,
  baseRef: string,
  changedFiles: string[],
  targetFiles: string[],
  generatedAt: string,
  reviewMode: InferentialReviewMode
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
    reviewMode,
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
  generatedAt: string,
  reviewMode: InferentialReviewMode
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
    reviewMode,
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
  const semanticMode = resolveSemanticMode(options.semanticMode);
  const reviewMode: InferentialReviewMode =
    semanticMode === "shadow" ? "semantic-shadow" : "deterministic-only";
  const logger = options.logger ?? console;

  const getChangedFiles =
    options.getChangedFiles ?? getChangedFilesForInferentialReview;
  const runProvider =
    options.runProvider ?? runDeterministicInferentialProvider;
  const runSemanticAnalysis =
    options.runSemanticAnalysis ?? runAnthropicSemanticAnalysis;

  let changedFiles: string[] = [];
  let targetFiles: string[] = [];
  let machine: InferentialMachineOutput | undefined;

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
      nowIso(),
      reviewMode
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
      reviewMode,
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

  let providerResult: InferentialProviderResult | null = null;

  try {
    providerResult = await runProvider({
      rootDir,
      baseRef,
      changedFiles,
      targetFiles,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    machine = createProviderFailure(
      message,
      baseRef,
      changedFiles,
      targetFiles,
      nowIso(),
      reviewMode
    );
  }

  if (!machine) {
    if (!providerResult) {
      throw new Error("Inferential review did not produce provider output.");
    }

    try {
      const deterministicResult = await runDeterministicSemanticAnalysis({
        rootDir,
        baseRef,
        changedFiles,
        targetFiles,
      });
      const findings = sortFindings([
        ...providerResult.findings,
        ...deterministicResult.findings,
      ]);
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
        reviewMode,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      machine = createRuntimeFailure(
        `Deterministic inferential analysis failed: ${message}`,
        baseRef,
        changedFiles,
        targetFiles,
        nowIso(),
        reviewMode
      );
    }
  }

  if (!machine) {
    throw new Error("Inferential review did not produce machine output.");
  }

  if (semanticMode === "shadow" && machine.status !== "error") {
    try {
      const semanticResult = await runSemanticAnalysis({
        rootDir,
        baseRef,
        changedFiles,
        targetFiles,
      });
      const shadowFindings = sortFindings(semanticResult.findings);
      machine.shadow = createShadowOutput({
        generatedAt: nowIso(),
        providerName: semanticResult.providerName,
        status:
          semanticResult.status ??
          (shadowFindings.length > 0 ? "fail" : "pass"),
        summary: semanticResult.summary ?? buildShadowSummary(shadowFindings),
        findings: shadowFindings,
        errors: semanticResult.errors ?? [],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      machine.shadow = createShadowOutput({
        generatedAt: nowIso(),
        providerName: DEFAULT_SEMANTIC_PROVIDER_NAME,
        status: "error",
        summary:
          "Shadow semantic review failed, but deterministic inferential review remains authoritative.",
        errors: [
          {
            code: "INFERENTIAL_RUNTIME_FAILURE",
            message: `Semantic analysis failed: ${message}`,
            remediation:
              "Inspect the shadow semantic provider output or configuration, then rerun `bun run harness:inferential-review`.",
          },
        ],
      });
    }
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
      nowIso(),
      reviewMode
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

  if (options.persistHistory) {
    try {
      await writeHistorySnapshot(rootDir, machineOutputPath, machine);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      machine = createRuntimeFailure(
        `Unable to write inferential history snapshot: ${message}`,
        baseRef,
        changedFiles,
        targetFiles,
        nowIso(),
        reviewMode
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
  persistHistory: boolean;
  help: boolean;
};

export function parseHarnessInferentialReviewArgs(argv: string[]): ParsedCliArgs {
  let baseRef = DEFAULT_BASE_REF;
  let persistHistory = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg) {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      return {
        baseRef,
        persistHistory,
        help: true,
      };
    }

    if (arg === "--persist-history") {
      persistHistory = true;
      continue;
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
    persistHistory,
    help: false,
  };
}

if (import.meta.main) {
  try {
    const parsed = parseHarnessInferentialReviewArgs(Bun.argv.slice(2));
    if (parsed.help) {
      console.log(
        "Usage: bun run harness:inferential-review [--base <ref>] [--persist-history]"
      );
      process.exit(0);
    }

    const result = await runHarnessInferentialReview(process.cwd(), {
      baseRef: parsed.baseRef,
      persistHistory: parsed.persistHistory,
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
