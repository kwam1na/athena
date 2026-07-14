import {
  assertCompoundSolutionCheck,
} from "./compound-solution-check";
import {
  assertLandedChangeReportCheck,
} from "./landed-change-report-check";
import { collectDeliverableDiffFingerprint } from "./delivery-diff-fingerprint";

type DocumentationPolicyCheckOptions = {
  assertCompoundSolutionCheck?: (
    rootDir: string,
    options: { baseRef?: string; threshold?: number },
  ) => void;
  assertLandedChangeReportCheck?: (
    rootDir: string,
    options: { baseRef?: string; threshold?: number },
  ) => void;
  baseRef?: string;
  threshold?: number;
};

function findingsFrom(error: unknown, heading: string) {
  const message = error instanceof Error ? error.message : String(error);
  const prefix = `${heading} failed:`;

  return message.startsWith(prefix) ? message.slice(prefix.length).trim() : message;
}

export function assertDeliveryDocumentationCheck(
  rootDir: string,
  options: DocumentationPolicyCheckOptions = {},
) {
  const assertSolution =
    options.assertCompoundSolutionCheck ?? assertCompoundSolutionCheck;
  const assertReport =
    options.assertLandedChangeReportCheck ?? assertLandedChangeReportCheck;
  const findings: Array<{ label: string; message: string }> = [];

  try {
    assertSolution(rootDir, options);
  } catch (error) {
    if (!isPolicyFailure(error, "Compound solution check failed:")) throw error;
    findings.push({
      label: "Solution notes",
      message: findingsFrom(error, "Compound solution check"),
    });
  }

  try {
    assertReport(rootDir, options);
  } catch (error) {
    if (!isPolicyFailure(error, "Landed-change report check failed:")) throw error;
    findings.push({
      label: "Landed-change reports",
      message: findingsFrom(error, "Landed-change report check"),
    });
  }

  if (findings.length === 0) {
    return;
  }

  throw new Error(
    `Delivery documentation check failed:\n\n${findings
      .map(({ label, message }) => `${label}:\n${message}`)
      .join("\n\n")}`,
  );
}

function isPolicyFailure(error: unknown, prefix: string) {
  return error instanceof Error && error.message.startsWith(prefix);
}

export function parseArgs(argv: string[]) {
  let baseRef = "origin/main";
  let threshold: number | undefined;
  let printFingerprint = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--base") {
      baseRef = argv[++index] ?? "";
      if (!baseRef) throw new Error("Missing value for --base.");
      continue;
    }
    if (arg === "--threshold") {
      const value = argv[++index];
      if (!value) throw new Error("Missing value for --threshold.");
      threshold = Number(value);
      continue;
    }
    if (arg === "--print-fingerprint") {
      printFingerprint = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}.`);
  }

  return { baseRef, threshold, printFingerprint };
}

function changedFiles(rootDir: string, baseRef: string) {
  const runGit = (args: string[]) => {
    const result = Bun.spawnSync(["git", ...args], { cwd: rootDir, stdout: "pipe" });
    if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed`);
    return result.stdout.toString().split("\n").map((line) => line.trim()).filter(Boolean);
  };

  return [...new Set([
    ...runGit(["diff", "--name-only", `${baseRef}...HEAD`]),
    ...runGit(["diff", "--name-only"]),
    ...runGit(["diff", "--cached", "--name-only"]),
    ...runGit(["ls-files", "--others", "--exclude-standard"]),
  ])].sort();
}

if (import.meta.main) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.printFingerprint) {
      console.log(
        collectDeliverableDiffFingerprint(
          process.cwd(),
          options.baseRef,
          changedFiles(process.cwd(), options.baseRef),
        ),
      );
    } else {
      assertDeliveryDocumentationCheck(process.cwd(), options);
    }
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
