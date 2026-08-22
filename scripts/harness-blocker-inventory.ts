import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  HARNESS_CANDIDATE_SOURCE_IDS,
  HARNESS_COMMAND_IDS,
  HARNESS_PREPARATION_SOURCE_IDS,
} from "./harness-blockers";
import {
  ATHENA_PR_VALIDATION_GATE_ID,
  HARNESS_GATE_REGISTRY,
} from "./harness-gate-registry";

export type HarnessBlockerCliInventoryEntry = {
  file: `scripts/${string}.ts`;
  commands: readonly string[];
};

/**
 * The public harness command boundaries covered by the blocker contract.
 *
 * Keep this list explicit. Discovery below is deliberately a sensor for drift,
 * not a mechanism that silently admits a new command without an owner deciding
 * that it belongs to the contract.
 */
export const HARNESS_BLOCKER_CLI_INVENTORY = [
  { file: "scripts/harness-audit.ts", commands: ["harness:audit"] },
  { file: "scripts/harness-behavior.ts", commands: ["harness:behavior"] },
  { file: "scripts/harness-check.ts", commands: ["harness:check"] },
  {
    file: "scripts/harness-contract-preflight.ts",
    commands: ["pr:athena:preflight"],
  },
  {
    file: "scripts/harness-gate-admission.ts",
    commands: ["pr:athena:validate-provider"],
  },
  { file: "scripts/harness-generate.ts", commands: ["harness:generate"] },
  {
    file: "scripts/harness-inferential-review.ts",
    commands: ["harness:inferential-review"],
  },
  { file: "scripts/harness-janitor.ts", commands: ["harness:janitor"] },
  {
    file: "scripts/harness-mechanical-check.ts",
    commands: ["pr:athena:mechanical"],
  },
  {
    file: "scripts/harness-review-evidence.ts",
    commands: ["harness:review-context", "harness:review-evidence"],
  },
  { file: "scripts/harness-review.ts", commands: ["harness:review"] },
  {
    file: "scripts/harness-runtime-trends.ts",
    commands: ["harness:runtime-trends"],
  },
  { file: "scripts/harness-scorecard.ts", commands: ["harness:scorecard"] },
  {
    file: "scripts/harness-self-review.ts",
    commands: ["harness:self-review"],
  },
  { file: "scripts/harness-test.ts", commands: ["harness:test"] },
  { file: "scripts/pre-push-review.ts", commands: ["pre-push:review"] },
  {
    file: "scripts/delivery-documentation-check.ts",
    commands: ["delivery:documentation-check"],
  },
  {
    file: "scripts/delivery-run-telemetry.ts",
    commands: ["delivery:telemetry-check", "delivery:telemetry-record"],
  },
  {
    file: "scripts/pre-push-validation-proof.ts",
    commands: ["pr:athena:record-proof"],
  },
  {
    file: "scripts/pr-athena-delivery-run.ts",
    // `pr:athena:validate` also targets this file directly, for the
    // write-provider-evidence subcommand.
    commands: ["pr:athena", "pr:athena:delivery-run", "pr:athena:validate"],
  },
  { file: "scripts/pr-athena-prepare.ts", commands: ["pr:athena:prepare"] },
  {
    file: "scripts/documentation-waiver-command.ts",
    commands: ["harness:waive-documentation"],
  },
] as const satisfies readonly HarnessBlockerCliInventoryEntry[];

export type HarnessBlockerInventoryDiscovery = {
  harnessMainFiles: string[];
  directCommands: Map<string, string[]>;
  reachableFilesByCommand: Map<string, string[]>;
};

export type HarnessBlockerInventoryFinding = {
  code:
    | "inventory-file-missing"
    | "inventory-command-missing"
    | "inventory-command-target-mismatch"
    | "unregistered-harness-command"
    | "unregistered-harness-cli"
    | "boundary-runner-missing"
    | "boundary-console-output"
    | "boundary-process-exit"
    | "boundary-throw"
    | "blocker-remediation-missing"
    | "blocker-source-freeform"
    | "blocker-remediation-divergent";
  file?: string;
  command?: string;
  message: string;
};

const SCRIPT_TARGET_PATTERN =
  /\bbun\s+(?:--\S+\s+)*((?:\.\/)?scripts\/[\w./-]+\.ts)\b/g;
const SCRIPT_ALIAS_PATTERN = /\bbun\s+run\s+(?:--\S+\s+)*([\w:-]+)\b/g;
const MAIN_BOUNDARY_PATTERN = /if\s*\(\s*import\.meta\.main\s*\)\s*{/;

function normalizeScriptTarget(target: string) {
  return target.replace(/^\.\//, "");
}

function collectMatches(pattern: RegExp, value: string) {
  const matches: string[] = [];
  pattern.lastIndex = 0;
  for (const match of value.matchAll(pattern)) {
    if (match[1]) matches.push(match[1]);
  }
  return matches;
}

export async function discoverHarnessBlockerInventory(
  rootDir: string,
): Promise<HarnessBlockerInventoryDiscovery> {
  const packageJson = JSON.parse(
    await readFile(path.join(rootDir, "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };
  const packageScripts = packageJson.scripts ?? {};
  const scriptsDir = path.join(rootDir, "scripts");
  const entries = await readdir(scriptsDir, { withFileTypes: true });
  const mainBoundaryFiles: string[] = [];

  for (const entry of entries) {
    if (
      !entry.isFile() ||
      !entry.name.endsWith(".ts") ||
      entry.name.endsWith(".test.ts")
    ) {
      continue;
    }
    const relativeFile = path.posix.join("scripts", entry.name);
    const source = await readFile(path.join(rootDir, relativeFile), "utf8");
    if (MAIN_BOUNDARY_PATTERN.test(source)) mainBoundaryFiles.push(relativeFile);
  }
  mainBoundaryFiles.sort((left, right) => left.localeCompare(right));

  const directCommands = new Map<string, string[]>();
  const aliasesByCommand = new Map<string, string[]>();
  for (const [command, script] of Object.entries(packageScripts)) {
    directCommands.set(
      command,
      [
        ...new Set(
          collectMatches(SCRIPT_TARGET_PATTERN, script).map(
            normalizeScriptTarget,
          ),
        ),
      ].sort(),
    );
    aliasesByCommand.set(
      command,
      [
        ...new Set(
          collectMatches(SCRIPT_ALIAS_PATTERN, script).filter(
            (alias) => alias !== command,
          ),
        ),
      ].sort(),
    );
  }

  const reachableFilesByCommand = new Map<string, string[]>();
  const resolveReachableFiles = (
    command: string,
    visiting: Set<string>,
  ): string[] => {
    const cached = reachableFilesByCommand.get(command);
    if (cached) return cached;
    if (visiting.has(command)) return [];
    const nextVisiting = new Set(visiting).add(command);
    const files = new Set(directCommands.get(command) ?? []);
    for (const alias of aliasesByCommand.get(command) ?? []) {
      for (const file of resolveReachableFiles(alias, nextVisiting)) {
        files.add(file);
      }
    }
    const resolved = [...files].sort((left, right) =>
      left.localeCompare(right),
    );
    reachableFilesByCommand.set(command, resolved);
    return resolved;
  };
  for (const command of Object.keys(packageScripts)) {
    resolveReachableFiles(command, new Set());
  }

  // A harness CLI is one the contract owns, not one whose filename happens to
  // start with `harness-`. Keying discovery on that prefix alone let
  // `scripts/pr-athena-delivery-run.ts` - the delivery spine itself - sit
  // outside the contract while its own sensor reported no findings, so the
  // explicit allowlist counts too and its boundary is inspected like any other.
  //
  // Reachability is deliberately *not* used to widen this set: composite
  // aliases such as `pr:athena:validate` chain out to `graphify:rebuild` and
  // other tools that are not harness blocker boundaries.
  //
  // The residual limit, stated rather than papered over: a new CLI that is
  // neither `harness-`-prefixed nor registered here is invisible to this
  // sensor, and is caught only by the runtime source guard in
  // `createHarnessBlocker`. Registration is the mechanism; discovery is the
  // drift alarm on top of it.
  const inventoryFiles = new Set<string>(
    HARNESS_BLOCKER_CLI_INVENTORY.map((entry) => entry.file),
  );
  const harnessMainFiles = mainBoundaryFiles.filter(
    (file) =>
      path.posix.basename(file).startsWith("harness-") ||
      inventoryFiles.has(file as HarnessBlockerCliInventoryEntry["file"]),
  );

  return { harnessMainFiles, directCommands, reachableFilesByCommand };
}

function boundarySource(source: string) {
  const match = MAIN_BOUNDARY_PATTERN.exec(source);
  return match ? source.slice(match.index) : undefined;
}

export function inspectHarnessCliBoundary(
  file: string,
  source: string,
): HarnessBlockerInventoryFinding[] {
  const boundary = boundarySource(source);
  if (!boundary) {
    return [
      {
        code: "inventory-file-missing",
        file,
        message: `${file} has no import.meta.main command boundary.`,
      },
    ];
  }

  const findings: HarnessBlockerInventoryFinding[] = [];
  if (!/\brunHarnessCliBoundary\s*\(/.test(boundary)) {
    findings.push({
      code: "boundary-runner-missing",
      file,
      message: `${file} must delegate its import.meta.main boundary to runHarnessCliBoundary.`,
    });
  }
  if (/\bconsole\s*\.\s*(?:error|warn)\s*\(/.test(boundary)) {
    findings.push({
      code: "boundary-console-output",
      file,
      message: `${file} writes console.error/console.warn directly at its command boundary.`,
    });
  }
  if (/\bprocess\s*\.\s*exit\s*\(/.test(boundary)) {
    findings.push({
      code: "boundary-process-exit",
      file,
      message: `${file} calls process.exit directly at its command boundary.`,
    });
  }
  if (/\bthrow\b/.test(boundary)) {
    findings.push({
      code: "boundary-throw",
      file,
      message: `${file} throws directly at its command boundary.`,
    });
  }
  return findings;
}

const EMPTY_REMEDIATION_PATTERN = /remediations:\s*\[\s*\]/g;
const LITERAL_SOURCE_PATTERN =
  /source:\s*{\s*kind:\s*"([a-z_]+)"\s*,\s*id:\s*"([^"]+)"\s*}/g;

function isRegistryOwnedSource(kind: string, id: string) {
  switch (kind) {
    case "gate":
      return id === ATHENA_PR_VALIDATION_GATE_ID;
    case "obligation":
      return Object.hasOwn(HARNESS_GATE_REGISTRY.obligations, id);
    case "provider":
      return Object.hasOwn(HARNESS_GATE_REGISTRY.providers, id);
    case "preparation":
      return (HARNESS_PREPARATION_SOURCE_IDS as readonly string[]).includes(id);
    case "candidate":
      return (HARNESS_CANDIDATE_SOURCE_IDS as readonly string[]).includes(id);
    case "command":
      return (HARNESS_COMMAND_IDS as readonly string[]).includes(id);
    default:
      return false;
  }
}

/**
 * A static second net under the runtime guard in `createHarnessBlocker`.
 *
 * It reads literal blocker shapes only: a source built from a variable, or a
 * remediation tuple assembled at runtime, is invisible here and is caught at
 * construction instead. That limit is deliberate - a heuristic that tried to
 * follow indirection would report drift it could not prove.
 */
export function inspectHarnessBlockerShapes(
  file: string,
  source: string,
): HarnessBlockerInventoryFinding[] {
  const findings: HarnessBlockerInventoryFinding[] = [];
  EMPTY_REMEDIATION_PATTERN.lastIndex = 0;
  if (EMPTY_REMEDIATION_PATTERN.test(source)) {
    findings.push({
      code: "blocker-remediation-missing",
      file,
      message: `${file} declares a blocker with an empty remediation tuple.`,
    });
  }
  LITERAL_SOURCE_PATTERN.lastIndex = 0;
  for (const match of source.matchAll(LITERAL_SOURCE_PATTERN)) {
    const [, kind, id] = match;
    if (!kind || !id || isRegistryOwnedSource(kind, id)) continue;
    findings.push({
      code: "blocker-source-freeform",
      file,
      message: `${file} names blocker source ${kind}:${id}, which no harness registry owns.`,
    });
  }
  return findings;
}

const REMEDIATION_LITERAL_PATTERN =
  /id:\s*"([a-z0-9]+(?:-[a-z0-9]+)*)"\s*,\s*kind:\s*"(command|manual_action|code_change|retry)"\s*,(?:[^}]*?)summary:\s*"((?:[^"\\]|\\.)*)"/g;

/**
 * One remediation id is a claim that two blockers need the *same* repair. When
 * guidance diverges under one id, the id stops meaning anything to an operator
 * scanning the list - two entries appear with the same handle and different
 * instructions, and there is no way to tell which belongs to which blocker.
 *
 * Rendering cannot enforce this: it runs inside the CLI boundary's catch
 * handler, where throwing would destroy the very output the operator needs. So
 * the invariant lives here, where failing loudly costs nothing.
 *
 * Literal declarations only, for the same reason the other shape rules are:
 * a summary built from a template literal or assembled at runtime is invisible
 * to a static reader, and a heuristic that guessed at them would report drift
 * it could not prove.
 */
export function collectRemediationLiterals(source: string) {
  const literals: Array<{ id: string; summary: string }> = [];
  REMEDIATION_LITERAL_PATTERN.lastIndex = 0;
  for (const match of source.matchAll(REMEDIATION_LITERAL_PATTERN)) {
    const [, id, , summary] = match;
    if (id && summary !== undefined) literals.push({ id, summary });
  }
  return literals;
}

export async function auditHarnessBlockerInventory(
  rootDir: string,
): Promise<HarnessBlockerInventoryFinding[]> {
  const discovery = await discoverHarnessBlockerInventory(rootDir);
  const findings: HarnessBlockerInventoryFinding[] = [];
  const inventoryFiles = new Set<string>(
    HARNESS_BLOCKER_CLI_INVENTORY.map((entry) => entry.file),
  );
  const registeredCommands = new Set<string>(
    HARNESS_BLOCKER_CLI_INVENTORY.flatMap((entry) => entry.commands),
  );

  for (const file of discovery.harnessMainFiles) {
    if (!inventoryFiles.has(file as HarnessBlockerCliInventoryEntry["file"])) {
      findings.push({
        code: "unregistered-harness-cli",
        file,
        message: `${file} is an import.meta.main harness CLI but is absent from HARNESS_BLOCKER_CLI_INVENTORY.`,
      });
    }
  }

  // Direct targets only: a composite alias like `pr:athena:validate` chains
  // several registered commands and is not itself a CLI boundary, so requiring
  // it to be registered would describe the wrong thing.
  for (const [command, targets] of discovery.directCommands) {
    const targetsHarnessBoundary = targets.some(
      (target) =>
        inventoryFiles.has(target as HarnessBlockerCliInventoryEntry["file"]) ||
        discovery.harnessMainFiles.includes(target),
    );
    if (targetsHarnessBoundary && !registeredCommands.has(command)) {
      findings.push({
        code: "unregistered-harness-command",
        command,
        message: `${command} invokes a harness CLI directly but is absent from HARNESS_BLOCKER_CLI_INVENTORY.`,
      });
    }
  }

  for (const entry of HARNESS_BLOCKER_CLI_INVENTORY) {
    let source: string;
    try {
      source = await readFile(path.join(rootDir, entry.file), "utf8");
    } catch {
      findings.push({
        code: "inventory-file-missing",
        file: entry.file,
        message: `${entry.file} is registered but does not exist.`,
      });
      continue;
    }

    findings.push(...inspectHarnessCliBoundary(entry.file, source));
    findings.push(...inspectHarnessBlockerShapes(entry.file, source));
    for (const command of entry.commands) {
      // Reachable rather than direct: `pr:athena` is an alias for
      // `pr:athena:delivery-run`, and an alias-only command is still a command
      // an operator runs.
      const targets = discovery.reachableFilesByCommand.get(command);
      if (!targets || targets.length === 0) {
        findings.push({
          code: "inventory-command-missing",
          file: entry.file,
          command,
          message: `${command} is registered for ${entry.file} but is absent from root package.json.`,
        });
      } else if (!targets.includes(entry.file)) {
        findings.push({
          code: "inventory-command-target-mismatch",
          file: entry.file,
          command,
          message: `${command} must invoke ${entry.file} directly; found ${targets.join(", ") || "no script target"}.`,
        });
      }
    }
  }

  // One id must mean one repair, within a file as well as across the contract.
  // Keying a map by id would have collapsed same-file duplicates silently -
  // and two sites in one file is exactly the shape this rule was added for.
  const remediationSummaries = new Map<string, { file: string; summary: string }>();
  const reportedDivergentIds = new Set<string>();
  for (const entry of HARNESS_BLOCKER_CLI_INVENTORY) {
    let source: string;
    try {
      source = await readFile(path.join(rootDir, entry.file), "utf8");
    } catch {
      continue;
    }
    for (const { id, summary } of collectRemediationLiterals(source)) {
      const previous = remediationSummaries.get(id);
      if (previous && previous.summary !== summary) {
        if (!reportedDivergentIds.has(id)) {
          reportedDivergentIds.add(id);
          findings.push({
            code: "blocker-remediation-divergent",
            file: entry.file,
            message:
              previous.file === entry.file
                ? `Remediation ${id} carries different guidance twice within ${entry.file}; one id must mean one repair.`
                : `Remediation ${id} carries different guidance in ${entry.file} and ${previous.file}; one id must mean one repair.`,
          });
        }
        continue;
      }
      remediationSummaries.set(id, { file: entry.file, summary });
    }
  }

  return findings.sort((left, right) =>
    `${left.file ?? ""}\0${left.command ?? ""}\0${left.code}`.localeCompare(
      `${right.file ?? ""}\0${right.command ?? ""}\0${right.code}`,
    ),
  );
}
