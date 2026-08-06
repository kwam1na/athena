import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// Presentation contract (v2) for docs/reports/*.html. The full contract lives
// at .agents/skills/ce-landed-change-report/references/report-html-contract.md;
// this sensor is its enforcement. Reports are semantic content documents the
// webapp renders as themed pages — no styling or scripting of their own.

export type ReportPresentationFinding = {
  reportPath: string;
  message: string;
};

export const REPORT_CONTRACT_VERSION = "v2";
// Matched on the <article> opening tag only: a report that documents the
// contract (the gate report does) mentions the marker in code samples, and
// those must not count as roots.
const ROOT_MARKER_PATTERN =
  /<article\b[^>]*\sdata-athena-landed-change-report="([^"]*)"[^>]*>/g;

// Presentation-level requirements, enforced on every report forever. The
// fuller narrative vocabulary (summary/problem/mental-model/…) is a *content*
// requirement for newly authored reports and is enforced at delivery time by
// landed-change-report-check.ts. Historical reports predate that vocabulary,
// and inventing sections they never had would be worse than not having them.
const REQUIRED_SECTION_KEYS = ["quiz"] as const;

/** Narrative vocabulary required of newly authored/changed reports. */
export const REQUIRED_NARRATIVE_SECTION_KEYS = [
  "subagent-evidence",
  "summary",
  "problem",
  "mental-model",
  "before-after",
  "key-files",
  "changes",
  "validation",
  "guidance",
] as const;

// Presentation only needs a well-formed quiz; the 5-question floor is a
// content expectation for newly authored reports. A 2024-era revert report
// shipped three questions, and padding it after the fact would be fiction.
const MINIMUM_QUIZ_QUESTIONS = 1;
const MINIMUM_NEW_REPORT_QUIZ_QUESTIONS = 5;

// The app owns presentation and interactivity, so a report supplying its own
// is a contract violation even when it would render fine.
const FORBIDDEN_MARKUP: { pattern: RegExp; label: string }[] = [
  { pattern: /<style[\s>]/i, label: "<style> element" },
  { pattern: /<script[\s>]/i, label: "<script> element" },
  { pattern: /<link[\s>]/i, label: "<link> element" },
  { pattern: /<iframe[\s>]/i, label: "<iframe> element" },
  { pattern: /<img[\s>]/i, label: "<img> element" },
  { pattern: /<svg[\s>]/i, label: "<svg> element" },
  { pattern: /<form[\s>]/i, label: "<form> element" },
  { pattern: /<input[\s>]/i, label: "<input> element" },
  { pattern: /<button[\s>]/i, label: "<button> element" },
  { pattern: /\sstyle\s*=\s*["']/i, label: "inline style attribute" },
  { pattern: /\son[a-z]+\s*=\s*["']/i, label: "inline event handler" },
  { pattern: /javascript:/i, label: "javascript: URL" },
];

function findingsFor(reportPath: string, messages: string[]) {
  return messages.map((message) => ({ reportPath, message }));
}

function sectionBlock(html: string, key: string) {
  const match = new RegExp(
    `<section[^>]*data-report-section="${key}"[^>]*>([\\s\\S]*?)</section>`,
  ).exec(html);
  return match?.[1] ?? null;
}

function checkQuiz(
  html: string,
  messages: string[],
  requireNarrativeSections: boolean,
) {
  const quiz = sectionBlock(html, "quiz");
  if (quiz === null) return; // Reported as a missing required section already.

  const thresholdMatch =
    /<section[^>]*data-report-section="quiz"[^>]*data-quiz-pass-threshold="([^"]*)"/.exec(
      html,
    ) ??
    /data-quiz-pass-threshold="([^"]*)"[^>]*data-report-section="quiz"/.exec(
      html,
    );
  const threshold = thresholdMatch ? Number(thresholdMatch[1]) : Number.NaN;
  if (!Number.isInteger(threshold) || threshold < 1) {
    messages.push(
      'quiz section is missing a valid integer data-quiz-pass-threshold attribute',
    );
  }

  const questionChunks = quiz.split(/<li[^>]*data-quiz-question[^>]*>/).slice(1);
  const floor = requireNarrativeSections
    ? MINIMUM_NEW_REPORT_QUIZ_QUESTIONS
    : MINIMUM_QUIZ_QUESTIONS;
  if (questionChunks.length < floor) {
    messages.push(
      `quiz has ${questionChunks.length} questions; the contract requires at least ${floor}`,
    );
  }
  if (Number.isInteger(threshold) && threshold > questionChunks.length) {
    messages.push(
      `quiz pass threshold ${threshold} exceeds its ${questionChunks.length} questions`,
    );
  }

  questionChunks.forEach((chunk, index) => {
    const label = `quiz question ${index + 1}`;
    const correctCount = (chunk.match(/data-quiz-correct/g) ?? []).length;
    if (correctCount !== 1) {
      messages.push(
        `${label} marks ${correctCount} options data-quiz-correct; exactly one is required`,
      );
    }
    if (!/data-quiz-prompt/.test(chunk)) {
      messages.push(`${label} is missing a data-quiz-prompt`);
    }
    // The rendered page numbers questions itself, so a prompt carrying its own
    // number renders as "1. 1. …".
    if (/<p[^>]*data-quiz-prompt[^>]*>\s*\d{1,2}[.)]\s/.test(chunk)) {
      messages.push(
        `${label} prompt begins with its own number; the app numbers questions`,
      );
    }
    if (!/data-quiz-explanation/.test(chunk)) {
      messages.push(`${label} is missing a data-quiz-explanation`);
    }
    const optionsMatch = /<ol[^>]*data-quiz-options[^>]*>([\s\S]*?)<\/ol>/.exec(
      chunk,
    );
    const optionCount = optionsMatch
      ? (optionsMatch[1].match(/<li[\s>]/g) ?? []).length
      : 0;
    if (optionCount < 2) {
      messages.push(
        `${label} has ${optionCount} options inside data-quiz-options; at least 2 are required`,
      );
    }
  });
}

/** Section keys a report declares, in document order. */
export function collectSectionKeys(html: string) {
  return [
    ...html.matchAll(/<section[^>]*data-report-section="([^"]*)"/g),
  ].map((match) => match[1]);
}

export function collectReportPresentationFindings(
  reportPath: string,
  html: string,
  { requireNarrativeSections = false }: { requireNarrativeSections?: boolean } = {},
): ReportPresentationFinding[] {
  const messages: string[] = [];

  const markers = [...html.matchAll(ROOT_MARKER_PATTERN)];
  if (markers.length !== 1) {
    messages.push(
      `expected exactly one data-athena-landed-change-report root marker, found ${markers.length}`,
    );
  } else if (markers[0][1] !== REPORT_CONTRACT_VERSION) {
    messages.push(
      `report declares contract "${markers[0][1]}"; expected "${REPORT_CONTRACT_VERSION}"`,
    );
  }

  for (const { pattern, label } of FORBIDDEN_MARKUP) {
    if (pattern.test(html)) {
      messages.push(`forbidden markup: ${label}`);
    }
  }

  const h1Count = (html.match(/<h1[\s>]/g) ?? []).length;
  if (h1Count !== 1) {
    messages.push(`expected exactly one <h1>, found ${h1Count}`);
  }

  if (!/<header[^>]*data-report-section="header"/.test(html)) {
    messages.push('missing <header data-report-section="header">');
  }
  const pillsMatch = /<ul[^>]*data-report-pills[^>]*>([\s\S]*?)<\/ul>/.exec(html);
  if (!pillsMatch) {
    messages.push("missing <ul data-report-pills> status pills");
  } else if (!/<li[\s>]/.test(pillsMatch[1])) {
    messages.push("data-report-pills has no <li> pill entries");
  }

  const sectionKeys = collectSectionKeys(html);
  for (const key of REQUIRED_SECTION_KEYS) {
    if (!sectionKeys.includes(key)) {
      messages.push(`missing required section data-report-section="${key}"`);
    }
  }
  if (requireNarrativeSections) {
    for (const key of REQUIRED_NARRATIVE_SECTION_KEYS) {
      if (!sectionKeys.includes(key)) {
        messages.push(
          `missing narrative section data-report-section="${key}" (required for newly authored reports)`,
        );
      }
    }
  }
  for (const key of sectionKeys) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(key)) {
      messages.push(`section key "${key}" is not kebab-case`);
    }
  }
  const lastTwo = sectionKeys.slice(-2);
  if (
    sectionKeys.includes("quiz") &&
    sectionKeys.includes("subagent-evidence") &&
    (lastTwo[0] !== "quiz" || lastTwo[1] !== "subagent-evidence")
  ) {
    messages.push(
      'quiz and subagent-evidence must be the last two sections, in that order',
    );
  }

  // Every section opens with its heading so the rendered page has a stable
  // scannable rhythm.
  for (const match of html.matchAll(
    /<section[^>]*data-report-section="([^"]*)"[^>]*>\s*(<[a-z0-9]+)/g,
  )) {
    if (match[2] !== "<h2") {
      messages.push(
        `section "${match[1]}" must start with an <h2>, found ${match[2]}>`,
      );
    }
  }

  // Newly authored reports must present key files as a table; historical
  // reports that used a list keep their original shape.
  if (requireNarrativeSections) {
    const keyFiles = sectionBlock(html, "key-files");
    if (keyFiles !== null && !/<table[\s>]/.test(keyFiles)) {
      messages.push("key-files section is missing its <table>");
    }
  }

  checkQuiz(html, messages, requireNarrativeSections);

  return findingsFor(reportPath, messages);
}

export function listReportPaths(rootDir: string) {
  const reportsDir = path.join(rootDir, "docs", "reports");
  return readdirSync(reportsDir)
    .filter((file) => file.endsWith(".html"))
    .sort()
    .map((file) => path.join("docs", "reports", file));
}

export function assertReportPresentation(rootDir: string, reportPaths?: string[]) {
  const paths = reportPaths ?? listReportPaths(rootDir);
  const findings = paths.flatMap((reportPath) =>
    collectReportPresentationFindings(
      reportPath,
      readFileSync(path.join(rootDir, reportPath), "utf8"),
    ),
  );

  if (findings.length > 0) {
    const grouped = new Map<string, string[]>();
    for (const finding of findings) {
      const existing = grouped.get(finding.reportPath) ?? [];
      existing.push(finding.message);
      grouped.set(finding.reportPath, existing);
    }
    const detail = [...grouped.entries()]
      .map(
        ([reportPath, messages]) =>
          `${reportPath}\n${messages.map((message) => `  - ${message}`).join("\n")}`,
      )
      .join("\n");
    throw new Error(
      `Report presentation check failed for ${grouped.size} of ${paths.length} reports:\n${detail}\n\nSee .agents/skills/ce-landed-change-report/references/report-html-contract.md for the v2 contract.`,
    );
  }

  return paths.length;
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    const rootDir = path.resolve(import.meta.dirname, "..");
    const files: string[] = [];
    for (let index = 0; index < args.length; index += 1) {
      if (args[index] === "--file") {
        const value = args[index + 1];
        if (!value) throw new Error("Missing value for --file.");
        files.push(value.replace(/^\.\//, ""));
        index += 1;
        continue;
      }
      throw new Error(`Unknown argument: ${args[index]}.`);
    }
    const checked = assertReportPresentation(
      rootDir,
      files.length > 0 ? files : undefined,
    );
    console.log(`Report presentation check passed for ${checked} report(s).`);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
