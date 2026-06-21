import { access, readFile } from "node:fs/promises";
import path from "node:path";

type Severity = "high" | "medium" | "low";

export type ConvexReturnValidatorContractFinding = {
  id: string;
  severity: Severity;
  title: string;
  filePath: string;
  rationale: string;
  remediation: string;
};

type ConvexPublicFunctionExport = {
  exportName: string;
  kind: "action" | "mutation" | "query";
};

function normalizeRepoPath(repoPath: string) {
  return repoPath.replaceAll("\\", "/");
}

function sortUnique(entries: string[]) {
  return [
    ...new Set(
      entries.map((entry) => normalizeRepoPath(entry).trim()).filter(Boolean),
    ),
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

function slugifyForFindingId(value: string) {
  return normalizeRepoPath(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isConvexReturnContractSourcePath(filePath: string) {
  const normalized = normalizeRepoPath(filePath);
  return (
    normalized.startsWith("packages/athena-webapp/convex/") &&
    normalized.endsWith(".ts") &&
    !normalized.endsWith(".test.ts") &&
    !normalized.endsWith(".d.ts") &&
    !normalized.startsWith("packages/athena-webapp/convex/_generated/")
  );
}

function findMatchingDefinitionEnd(contents: string, startIndex: number) {
  const nextExport = contents.indexOf("\nexport const ", startIndex + 1);
  if (nextExport !== -1) {
    return nextExport;
  }

  return contents.length;
}

function extractConvexPublicFunctionsWithReturns(contents: string) {
  const exports: ConvexPublicFunctionExport[] = [];
  const functionPattern =
    /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(query|mutation|action)\s*\(\s*\{/g;

  for (const match of contents.matchAll(functionPattern)) {
    const bodyStart = match.index === undefined ? -1 : match.index;
    if (bodyStart < 0) {
      continue;
    }

    const bodyEnd = findMatchingDefinitionEnd(contents, bodyStart);
    const definitionBody =
      bodyEnd === -1
        ? contents.slice(bodyStart)
        : contents.slice(bodyStart, bodyEnd);
    if (!/\breturns\s*:/.test(definitionBody)) {
      continue;
    }

    exports.push({
      exportName: match[1],
      kind: match[2] as ConvexPublicFunctionExport["kind"],
    });
  }

  return exports;
}

function isRelevantConvexContractProofPath(
  proofPath: string,
  sourcePath: string,
) {
  const normalizedProof = normalizeRepoPath(proofPath);
  if (
    !normalizedProof.startsWith("packages/athena-webapp/convex/") ||
    !normalizedProof.endsWith(".test.ts")
  ) {
    return false;
  }

  const sourceDirectory = path.posix.dirname(normalizeRepoPath(sourcePath));
  const proofDirectory = path.posix.dirname(normalizedProof);
  return proofDirectory === sourceDirectory;
}

function stripTypeScriptNonCode(contents: string) {
  let output = "";
  let index = 0;
  let quote: '"' | "'" | "`" | null = null;

  while (index < contents.length) {
    const char = contents[index];
    const next = contents[index + 1];

    if (quote) {
      output += char === "\n" ? "\n" : " ";
      if (char === "\\" && next !== undefined) {
        output += next === "\n" ? "\n" : " ";
        index += 2;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      index += 1;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      output += " ";
      index += 1;
      continue;
    }

    if (char === "/" && next === "/") {
      while (index < contents.length && contents[index] !== "\n") {
        index += 1;
      }
      continue;
    }

    if (char === "/" && next === "*") {
      index += 2;
      while (
        index < contents.length &&
        !(contents[index] === "*" && contents[index + 1] === "/")
      ) {
        if (contents[index] === "\n") {
          output += "\n";
        }
        index += 1;
      }
      index += 2;
      continue;
    }

    output += char;
    index += 1;
  }

  return output;
}

function hasConvexReturnContractProofForExport(
  contents: string,
  exportName: string,
) {
  const executableContents = stripTypeScriptNonCode(contents);
  return new RegExp(
    `\\bassertConformsToExportedReturns\\s*\\(\\s*${escapeRegExp(exportName)}\\b`,
  ).test(executableContents);
}

export async function collectConvexReturnValidatorContractFindings(
  rootDir: string,
  changedFiles: string[],
) {
  const changedFileSet = new Set(sortUnique(changedFiles));
  const findings: ConvexReturnValidatorContractFinding[] = [];
  const proofCache = new Map<string, string | null>();

  async function readChangedProofFile(filePath: string) {
    if (!proofCache.has(filePath)) {
      proofCache.set(
        filePath,
        await readUtf8OrNull(path.join(rootDir, filePath)),
      );
    }
    return proofCache.get(filePath);
  }

  async function hasChangedProofForPublicFunction(
    sourcePath: string,
    publicFunction: ConvexPublicFunctionExport,
  ) {
    for (const candidate of changedFileSet) {
      if (!isRelevantConvexContractProofPath(candidate, sourcePath)) {
        continue;
      }

      const proofContents = await readChangedProofFile(candidate);
      if (
        proofContents &&
        hasConvexReturnContractProofForExport(
          proofContents,
          publicFunction.exportName,
        )
      ) {
        return true;
      }
    }

    return false;
  }

  for (const changedFile of changedFileSet) {
    if (!isConvexReturnContractSourcePath(changedFile)) {
      continue;
    }

    const contents = await readUtf8OrNull(path.join(rootDir, changedFile));
    if (!contents) {
      continue;
    }

    const publicFunctions = extractConvexPublicFunctionsWithReturns(contents);
    if (publicFunctions.length === 0) {
      continue;
    }

    const publicFunctionsWithoutProof: ConvexPublicFunctionExport[] = [];
    for (const publicFunction of publicFunctions) {
      if (!(await hasChangedProofForPublicFunction(changedFile, publicFunction))) {
        publicFunctionsWithoutProof.push(publicFunction);
      }
    }

    if (publicFunctionsWithoutProof.length === 0) {
      continue;
    }

    findings.push({
      id: `missing-convex-return-validator-contract-proof-${slugifyForFindingId(changedFile)}`,
      severity: "high",
      title:
        "Public Convex return validator changed without executable contract proof",
      filePath: changedFile,
      rationale: `This changed Convex public module exports ${publicFunctionsWithoutProof
        .map((entry) => `${entry.kind} ${entry.exportName}`)
        .join(", ")} with explicit return validators, but no changed sibling test validates representative returned values against the exported Convex returns validator.`,
      remediation:
        "Add or update a nearby Convex test that calls `assertConformsToExportedReturns(changedExport, representativeValue)` from `convex/lib/returnValidatorContract` with representative handler or presenter return values. Loose `exportReturns()` string checks and marker comments are not sufficient proof.",
    });
  }

  return findings;
}

function parseCliArgs(argv: string[]) {
  let rootDir = process.cwd();
  const changedFiles: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("Missing value for --root.");
      }
      rootDir = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--root=")) {
      rootDir = arg.slice("--root=".length);
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      return { rootDir, changedFiles, help: true };
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    changedFiles.push(arg);
  }

  return { rootDir, changedFiles, help: false };
}

function formatFindings(findings: ConvexReturnValidatorContractFinding[]) {
  return findings
    .map(
      (finding) =>
        [
          `${finding.title}: ${finding.filePath}`,
          `  ${finding.rationale}`,
          `  Remediation: ${finding.remediation}`,
        ].join("\n"),
    )
    .join("\n\n");
}

if (import.meta.main) {
  try {
    const parsed = parseCliArgs(Bun.argv.slice(2));
    if (parsed.help) {
      console.log(
        "Usage: bun scripts/convex-return-validator-contract-check.ts [--root <repo-root>] <changed-file>...",
      );
      process.exit(0);
    }

    const findings = await collectConvexReturnValidatorContractFindings(
      parsed.rootDir,
      parsed.changedFiles,
    );
    if (findings.length > 0) {
      console.error(formatFindings(findings));
      process.exit(1);
    }
    console.log("Convex return validator contract check passed.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Convex return validator contract check failed: ${message}`);
    process.exit(1);
  }
}
