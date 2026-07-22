import { spawn } from "node:child_process";
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
  returnsSignature: string;
};

type ConvexReturnValidatorContractOptions = {
  baseRef?: string;
  readBaseFile?: (filePath: string) => Promise<string | null>;
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

function findValidatorExpressionEnd(contents: string, startIndex: number) {
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let quote: '"' | "'" | "`" | null = null;

  for (let index = startIndex; index < contents.length; index += 1) {
    const char = contents[index];
    const next = contents[index + 1];

    if (quote) {
      if (char === "\\" && next !== undefined) {
        index += 1;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }

    if (char === "(") parenDepth += 1;
    if (char === ")") parenDepth -= 1;
    if (char === "{") braceDepth += 1;
    if (char === "}") {
      if (braceDepth === 0 && parenDepth === 0 && bracketDepth === 0) {
        return index;
      }
      braceDepth -= 1;
    }
    if (char === "[") bracketDepth += 1;
    if (char === "]") bracketDepth -= 1;

    if (
      char === "," &&
      parenDepth === 0 &&
      braceDepth === 0 &&
      bracketDepth === 0
    ) {
      return index;
    }
  }

  return contents.length;
}

function normalizeValidatorExpression(expression: string) {
  return stripTypeScriptNonCode(expression).replace(/\s+/g, "");
}

function extractReturnsSignature(definitionBody: string) {
  const returnsMatch = /\breturns\s*:/.exec(definitionBody);
  if (!returnsMatch) {
    return null;
  }

  const validatorStart = returnsMatch.index + returnsMatch[0].length;
  const validatorEnd = findValidatorExpressionEnd(definitionBody, validatorStart);
  return normalizeValidatorExpression(
    definitionBody.slice(validatorStart, validatorEnd),
  );
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
    const returnsSignature = extractReturnsSignature(definitionBody);
    if (!returnsSignature) {
      continue;
    }

    exports.push({
      exportName: match[1],
      kind: match[2] as ConvexPublicFunctionExport["kind"],
      returnsSignature,
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

async function readGitFileAtRef(
  rootDir: string,
  baseRef: string,
  filePath: string,
) {
  const { stdout, exitCode } = await new Promise<{
    stdout: string;
    exitCode: number | null;
  }>((resolve, reject) => {
    const child = spawn(
      "git",
      ["-C", rootDir, "show", `${baseRef}:${normalizeRepoPath(filePath)}`],
      {
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    let stdout = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ stdout, exitCode });
    });
  });
  if (exitCode !== 0) {
    return null;
  }
  return stdout;
}

async function loadBasePublicFunctionMap(
  rootDir: string,
  sourcePath: string,
  options: ConvexReturnValidatorContractOptions,
) {
  if (!options.baseRef && !options.readBaseFile) {
    return null;
  }

  const baseContents = options.readBaseFile
    ? await options.readBaseFile(sourcePath)
    : await readGitFileAtRef(rootDir, options.baseRef!, sourcePath);
  if (!baseContents) {
    return new Map<string, ConvexPublicFunctionExport>();
  }

  return new Map(
    extractConvexPublicFunctionsWithReturns(baseContents).map((entry) => [
      entry.exportName,
      entry,
    ]),
  );
}

export async function collectConvexReturnValidatorContractFindings(
  rootDir: string,
  changedFiles: string[],
  options: ConvexReturnValidatorContractOptions = {},
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
    const basePublicFunctions = await loadBasePublicFunctionMap(
      rootDir,
      changedFile,
      options,
    );

    const publicFunctionsWithoutProof: ConvexPublicFunctionExport[] = [];
    for (const publicFunction of publicFunctions) {
      const basePublicFunction = basePublicFunctions?.get(
        publicFunction.exportName,
      );
      if (
        basePublicFunction &&
        basePublicFunction.kind === publicFunction.kind &&
        basePublicFunction.returnsSignature === publicFunction.returnsSignature
      ) {
        continue;
      }

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
  let baseRef: string | undefined;
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
    if (arg === "--base") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("Missing value for --base.");
      }
      baseRef = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--base=")) {
      baseRef = arg.slice("--base=".length);
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

  return { rootDir, baseRef, changedFiles, help: false };
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
      { baseRef: parsed.baseRef },
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
