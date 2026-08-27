#!/usr/bin/env bun

/**
 * Convex Backend Dependency Guard
 *
 * Snapshots current backend dependency cycles and fails only on new violations
 * while protecting stable kernels (inventoryLedger, agentHarness).
 *
 * This is a characterization-first tool: it captures today's graph and proves
 * the guard is green before adding failure fixtures.
 *
 * Shrink-only contract:
 *  - The committed baseline freezes exact cycle memberships and exact kernel
 *    violation edges. ANY change to those sets — an addition OR a removal —
 *    fails the check until the baseline is regenerated with --update-baseline.
 *    A removed edge can therefore never pay for a new cycle elsewhere.
 *  - --update-baseline only ever contracts the baseline: it refuses to persist
 *    when the current graph introduces a cycle or a kernel violation that is
 *    not already baselined, and it refuses on an empty scan.
 *  - Regeneration is the ONLY way the baseline changes, and it is only allowed
 *    from a state where every difference from the baseline is a removal.
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_PACKAGE_DIR = path.join(REPO_ROOT, "packages/athena-webapp");
const DEFAULT_CONVEX_DIR = path.join(DEFAULT_PACKAGE_DIR, "convex");
const DEFAULT_BASELINE_PATH = path.join(
  REPO_ROOT,
  "scripts/convex-backend-dependency-baseline.json",
);

// ============================================================================
// Protected Kernel Definitions
// ============================================================================

type KernelDefinition = {
  root: string;
  /** Modules that kernel files may import (their dependencies). */
  allowedImports: string[];
  /** Product domains that kernel files must NEVER import. */
  forbiddenImports: string[];
  /** Subdirectories that are not kernel modules (agentHarness runtime/, etc.). */
  excludedPaths?: string[];
};

/**
 * Kernel modules that must remain leaf-like: they may not import product domains.
 * These are the "stable kernels" that define core transaction boundaries.
 *
 * Kernel helpers are ordinary kernel files: they only pass because their
 * imports are legal, never because they are exempted from the check.
 */
export const PROTECTED_KERNELS = {
  inventoryLedger: {
    root: "convex/inventoryLedger",
    allowedImports: [
      "convex/_generated/",
      "convex/values",
      "convex/server",
      "convex/schemas/inventoryLedger",
      // Internal inventoryLedger modules
      "convex/inventoryLedger/",
    ],
    // Product domains that must NEVER be imported by the kernel
    forbiddenImports: [
      "convex/operations/",
      "convex/reports/",
      "convex/cashControls/",
      "convex/automation/",
      "convex/stockOps/",
      "convex/inventory/", // except schema
      "convex/pos/",
      "convex/storefront/",
      "convex/serviceOps/",
      "convex/expenses/",
      "convex/staff/",
      "convex/onlineOrders/",
      "convex/procurement/",
      "convex/sharedDemo/",
      "convex/workflowTraces/",
      "convex/notifications/",
      "convex/customerMessaging/",
      "convex/storeTime/",
      "convex/llm/",
      "convex/intelligence/",
      "convex/agentHarness/",
      "convex/auth/",
      "convex/sendgrid/",
      "convex/otp/",
      "convex/constants/",
      "convex/emails/",
      "convex/cloudflare/",
      "convex/mtn/",
      "convex/http/",
      "convex/mailersend/",
      "convex/paystack/",
      "convex/remoteAssist/",
      "convex/harnessWaiver/",
      "convex/types/",
      "convex/cache/",
      "src/",
    ],
  },
  agentHarness: {
    root: "convex/agentHarness",
    allowedImports: [
      "convex/_generated/",
      "convex/values",
      "convex/server",
      "convex/schemas/agentHarness",
      "convex/schemas/intelligence",
      "convex/intelligence/",
      "convex/operationAdmission/",
      "convex/platform/operationAdmission",
      "convex/platform/readIntentCatalog",
      "convex/platform/capabilityCatalog",
      "convex/lib/",
      "shared/agentHarness/",
      "shared/intelligence/",
      // Internal agentHarness kernel modules
      "convex/agentHarness/",
    ],
    forbiddenImports: [
      "convex/operations/",
      "convex/reports/",
      "convex/cashControls/",
      "convex/automation/",
      "convex/stockOps/",
      "convex/inventory/",
      "convex/pos/",
      "convex/storefront/",
      "convex/serviceOps/",
      "convex/expenses/",
      "convex/staff/",
      "convex/onlineOrders/",
      "convex/procurement/",
      "convex/sharedDemo/",
      "convex/workflowTraces/",
      "convex/notifications/",
      "convex/customerMessaging/",
      "convex/storeTime/",
      "convex/llm/",
      "src/",
    ],
    // Excluded subdirectories (not kernel modules)
    excludedPaths: [
      "convex/agentHarness/profiles/",
      "convex/agentHarness/evals/",
      "convex/agentHarness/agentRuntime/",
      "convex/agentHarness/programRuntime/",
      "convex/agentHarness/_generated/",
    ],
  },
} as const satisfies Record<string, KernelDefinition>;

// ============================================================================
// Types
// ============================================================================

type SourceFile = { path: string; source: string };
type DependencyGraph = Map<string, Set<string>>;

interface Violation {
  file: string;
  imports: string;
  resolved: string;
  type:
    | "kernel-forbidden"
    | "kernel-not-allowed"
    | "new-cycle"
    | "cycle-not-in-baseline"
    | "baseline-drift";
  cycle?: string[];
}

interface BaselineData {
  timestamp: string;
  cycles: string[][];
  /** Grandfathered violations (format: "file|imports|resolved|type"). */
  kernelViolations: string[];
}

interface CheckResult {
  violations: Violation[];
  cycles: string[][];
  baseline: BaselineData | null;
  isClean: boolean;
  /** Set when the scan itself could not be trusted (empty scan, refused regen). */
  scanError?: string;
}

// ============================================================================
// Import Extraction (comment/string aware)
// ============================================================================

/**
 * Ranges of the source that are inside comments or string literals. Import
 * specifiers must only be collected from real code: a commented-out import or
 * prose that quotes an import must never produce a guard finding.
 */
function collectNonCodeRanges(source: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1] ?? "";
    if (ch === "/" && next === "/") {
      const start = i;
      i += 2;
      while (i < source.length && source[i] !== "\n") i += 1;
      ranges.push([start, i]);
      continue;
    }
    if (ch === "/" && next === "*") {
      const start = i;
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        i += 1;
      }
      i = Math.min(i + 2, source.length);
      ranges.push([start, i]);
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const start = i;
      const quote = ch;
      i += 1;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === "\\") i += 1;
        i += 1;
      }
      i += 1;
      ranges.push([start, Math.min(i, source.length)]);
      continue;
    }
    i += 1;
  }
  return ranges;
}

const IMPORT_PATTERN = /(?:from|import)\s*\(?\s*["']([^"']+)["']\s*\)?/g;

function extractImportSpecifiers(source: string): string[] {
  const nonCode = collectNonCodeRanges(source);
  const specifiers: string[] = [];
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const at = match.index ?? 0;
    const inNonCode = nonCode.some(
      ([start, end]) => start <= at && at < end,
    );
    if (!inNonCode) specifiers.push(match[1]);
  }
  return specifiers;
}

// ============================================================================
// File Collection
// ============================================================================

function collectSources(
  convexDir: string,
  packageDir: string,
): SourceFile[] {
  if (!existsSync(convexDir)) return [];
  const entries: SourceFile[] = [];
  for (const name of readdirSync(convexDir)) {
    const absolute = path.join(convexDir, name);
    if (statSync(absolute).isDirectory()) {
      if (name === "node_modules" || name === "_generated") continue;
      entries.push(...collectSources(absolute, packageDir));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(name)) continue;
    const relative = path.relative(packageDir, absolute).split(path.sep).join("/");
    // Test files are not runtime modules and do not participate in cycles.
    if (relative.endsWith(".test.ts") || relative.endsWith(".test.tsx")) continue;
    entries.push({ path: relative, source: readFileSync(absolute, "utf8") });
  }
  // Deterministic traversal so emitted output is stable across machines.
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

/**
 * Resolve a relative specifier to the concrete file that the runtime would
 * load. Graph nodes and violation "resolved" fields carry the file extension
 * (`.ts`/`.tsx`), matching the identifiers `collectSources` registers.
 * Returns null when no file matches the specifier.
 */
function resolveLocalImportTarget(
  packageDir: string,
  filePath: string,
  specifier: string,
): string | null {
  const fromDir = path.dirname(path.resolve(packageDir, filePath));
  const candidate = path.resolve(fromDir, specifier);
  const candidates = [
    candidate,
    `${candidate}.ts`,
    `${candidate}.tsx`,
    path.join(candidate, "index.ts"),
    path.join(candidate, "index.tsx"),
  ];
  const seen = new Set<string>();
  for (const fileCandidate of candidates) {
    if (seen.has(fileCandidate)) continue;
    seen.add(fileCandidate);
    if (existsSync(fileCandidate) && statSync(fileCandidate).isFile()) {
      return path.relative(packageDir, fileCandidate).split(path.sep).join("/");
    }
  }
  return null;
}

function importsOf(
  file: SourceFile,
  packageDir: string,
): { specifier: string; resolved: string }[] {
  const out: { specifier: string; resolved: string }[] = [];
  for (const specifier of extractImportSpecifiers(file.source)) {
    if (specifier.startsWith(".")) {
      const resolved =
        resolveLocalImportTarget(packageDir, file.path, specifier) ??
        path
          .relative(
            packageDir,
            path.resolve(
              path.dirname(path.resolve(packageDir, file.path)),
              specifier,
            ),
          )
          .split(path.sep)
          .join("/");
      out.push({ specifier, resolved });
    } else {
      // External or bare package import (e.g. "convex/values"). Not a cycle
      // participant; the specifier itself is the identity.
      out.push({ specifier, resolved: specifier });
    }
  }
  return out;
}

// ============================================================================
// Graph Building
// ============================================================================

function buildDependencyGraph(
  files: SourceFile[],
  packageDir: string,
): DependencyGraph {
  const graph = new Map<string, Set<string>>();

  for (const file of files) {
    graph.set(file.path, new Set());
  }

  for (const file of files) {
    for (const { resolved } of importsOf(file, packageDir)) {
      if (resolved.startsWith("convex/") && graph.has(resolved)) {
        graph.get(file.path)!.add(resolved);
      }
    }
  }

  return graph;
}

// ============================================================================
// Tarjan's Algorithm for Strongly Connected Components (SCCs)
// ============================================================================

function findSCCs(graph: DependencyGraph): string[][] {
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Map<string, boolean>();
  const stack: string[] = [];
  const sccs: string[][] = [];
  let idx = 0;

  function strongconnect(v: string) {
    index.set(v, idx);
    lowlink.set(v, idx);
    idx++;
    stack.push(v);
    onStack.set(v, true);

    const neighbors = graph.get(v) || new Set<string>();
    for (const w of neighbors) {
      if (!index.has(w)) {
        strongconnect(w);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
      } else if (onStack.get(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, index.get(w)!));
      }
    }

    if (lowlink.get(v) === index.get(v)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.set(w, false);
        scc.push(w);
      } while (w !== v);
      if (
        scc.length > 1 ||
        (scc.length === 1 && (graph.get(scc[0])?.has(scc[0]) ?? false))
      ) {
        sccs.push(scc);
      }
    }
  }

  for (const v of graph.keys()) {
    if (!index.has(v)) {
      strongconnect(v);
    }
  }

  // Sort SCCs for deterministic output.
  return sortCycles(sccs);
}

function sortCycles(cycles: string[][]): string[][] {
  return cycles
    .map((cycle) => cycle.slice().sort())
    .sort((a, b) => a[0].localeCompare(b[0]));
}

// ============================================================================
// Kernel Violation Detection
// ============================================================================

function isKernelModule(
  filePath: string,
  kernel: KernelDefinition,
): boolean {
  if (!filePath.startsWith(`${kernel.root}/`)) return false;
  const excluded = kernel.excludedPaths ?? [];
  for (const excludedPath of excluded) {
    if (filePath.startsWith(excludedPath)) return false;
  }
  // Test files and test support modules are not kernel modules.
  if (filePath.endsWith(".test.ts") || filePath.endsWith(".test.tsx")) return false;
  if (/\.test[A-Z][A-Za-z]*\.tsx?$/.test(filePath)) return false;
  return true;
}

function checkKernelViolations(
  files: SourceFile[],
  kernelName: keyof typeof PROTECTED_KERNELS,
  packageDir: string,
): Violation[] {
  const kernel = PROTECTED_KERNELS[kernelName];
  const violations: Violation[] = [];

  // Every kernel file is checked — including helpers. Nothing is exempted:
  // helpers pass only because their imports are legal.
  for (const file of files) {
    if (!isKernelModule(file.path, kernel)) continue;

    for (const { specifier, resolved } of importsOf(file, packageDir)) {
      if (!specifier.startsWith(".")) continue; // Only local imports are checked.

      // Forbidden prefixes take precedence over allowed entries by design: a
      // product domain named in `forbiddenImports` may never be imported by a
      // kernel, even when a narrower path also appears in `allowedImports`.
      const forbidden = kernel.forbiddenImports.some((prefix) =>
        resolved.startsWith(prefix),
      );
      if (forbidden) {
        violations.push({
          file: file.path,
          imports: specifier,
          resolved,
          type: "kernel-forbidden",
        });
        continue;
      }

      const allowed = kernel.allowedImports.some((prefix) =>
        resolved.startsWith(prefix),
      );
      if (!allowed) {
        violations.push({
          file: file.path,
          imports: specifier,
          resolved,
          type: "kernel-not-allowed",
        });
      }
    }
  }

  return violations;
}

// ============================================================================
// Baseline Management
// ============================================================================

function loadBaseline(baselinePath: string): BaselineData | null {
  if (!existsSync(baselinePath)) return null;
  try {
    return JSON.parse(readFileSync(baselinePath, "utf8")) as BaselineData;
  } catch {
    return null;
  }
}

function saveBaseline(baselinePath: string, baseline: BaselineData): void {
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
}

function violationKey(v: Violation): string {
  return `${v.file}|${v.imports}|${v.resolved}|${v.type}`;
}

const BASELINE_VIOLATION_TYPES = new Set(["kernel-forbidden", "kernel-not-allowed"]);

function parseBaselineViolation(key: string): Violation | null {
  const parts = key.split("|");
  if (parts.length !== 4) return null;
  if (!BASELINE_VIOLATION_TYPES.has(parts[3])) return null;
  return {
    file: parts[0],
    imports: parts[1],
    resolved: parts[2],
    type: parts[3] as Violation["type"],
  };
}

function findNewCycles(
  currentCycles: string[][],
  baseline: BaselineData | null,
): { newCycles: string[][]; removedCycles: string[][] } {
  if (!baseline) return { newCycles: currentCycles, removedCycles: [] };

  const currentSet = new Set(currentCycles.map((c) => c.slice().sort().join("|")));
  const baselineSet = new Set(baseline.cycles.map((c) => c.slice().sort().join("|")));

  const newCycles = currentCycles.filter((c) => !baselineSet.has(c.slice().sort().join("|")));
  const removedCycles = baseline.cycles.filter((c) => !currentSet.has(c.slice().sort().join("|")));

  return { newCycles, removedCycles };
}

function findNewKernelViolations(
  currentViolations: Violation[],
  baseline: BaselineData | null,
): Violation[] {
  if (!baseline) return currentViolations;
  const baselineKeys = new Set(baseline.kernelViolations);
  return currentViolations.filter((v) => !baselineKeys.has(violationKey(v)));
}

function findRemovedKernelViolations(
  currentViolations: Violation[],
  baseline: BaselineData | null,
): Violation[] {
  if (!baseline) return [];
  const currentKeys = new Set(currentViolations.map(violationKey));
  return baseline.kernelViolations
    .map(parseBaselineViolation)
    .filter((v): v is Violation => v !== null && !currentKeys.has(violationKey(v)));
}

// ============================================================================
// Main Check Function
// ============================================================================

export function runDependencyCheck(options: {
  updateBaseline?: boolean;
  silent?: boolean;
  convexDir?: string;
  packageDir?: string;
  baselinePath?: string;
} = {}): CheckResult {
  const { silent = false, updateBaseline = false } = options;
  const packageDir = options.packageDir ?? DEFAULT_PACKAGE_DIR;
  const convexDir = options.convexDir ?? DEFAULT_CONVEX_DIR;
  const baselinePath = options.baselinePath ?? DEFAULT_BASELINE_PATH;

  if (!silent) console.log("Scanning Convex backend files...");
  const files = collectSources(convexDir, packageDir);
  if (!silent) console.log(`Found ${files.length} source files`);

  // A guard that cannot see its protected surface must fail loudly, never pass.
  if (files.length === 0) {
    const message = `No Convex backend source files found at ${convexDir}. The dependency guard cannot evaluate an empty scan; refusing to pass.`;
    if (!silent) console.error(message);
    return {
      violations: [],
      cycles: [],
      baseline: loadBaseline(baselinePath),
      isClean: false,
      scanError: message,
    };
  }

  const graph = buildDependencyGraph(files, packageDir);
  const cycles = findSCCs(graph);
  if (!silent) {
    console.log(
      `Found ${cycles.length} dependency cycles (SCCs with >1 node or self-loops)`,
    );
  }

  const inventoryLedgerViolations = checkKernelViolations(
    files,
    "inventoryLedger",
    packageDir,
  );
  const agentHarnessViolations = checkKernelViolations(
    files,
    "agentHarness",
    packageDir,
  );
  const kernelViolations = [
    ...inventoryLedgerViolations,
    ...agentHarnessViolations,
  ];
  if (!silent) {
    console.log(
      `Kernel violations: ${inventoryLedgerViolations.length} (inventoryLedger), ${agentHarnessViolations.length} (agentHarness)`,
    );
  }

  const baseline = loadBaseline(baselinePath);
  const { newCycles, removedCycles } = findNewCycles(cycles, baseline);

  const cycleViolations: Violation[] = newCycles.map((cycle) => ({
    file: cycle[0],
    imports: cycle.slice(1).join(" -> "),
    resolved: cycle.join(" -> "),
    type: baseline ? "new-cycle" : "cycle-not-in-baseline",
    cycle,
  }));

  // Removed cycles are baseline drift: the baseline is stale until it is
  // regenerated, and must never be allowed to rot in place.
  const cycleDriftViolations: Violation[] = removedCycles.map((cycle) => ({
    file: cycle[0],
    imports: "BASELINE DRIFT",
    resolved: cycle.join(" -> "),
    type: "baseline-drift",
    cycle,
  }));

  const newKernelViolations = findNewKernelViolations(kernelViolations, baseline);
  const removedKernelViolations = findRemovedKernelViolations(
    kernelViolations,
    baseline,
  );

  // Removed kernel violations are baseline drift exactly like removed cycles:
  // fixing a grandfathered edge is a shrink that must be persisted by
  // regeneration, otherwise the same edge could be reintroduced and
  // misread as already-baselined.
  const kernelDriftViolations: Violation[] = removedKernelViolations.map((v) => ({
    file: v.file,
    imports: "BASELINE DRIFT",
    resolved: v.resolved,
    type: "baseline-drift",
  }));

  const allViolations = [
    ...newKernelViolations,
    ...cycleViolations,
    ...cycleDriftViolations,
    ...kernelDriftViolations,
  ].sort((left, right) => violationKey(left).localeCompare(violationKey(right)));
  let isClean = allViolations.length === 0;

  // --update-baseline: persist ONLY shrink-only changes. New cycles or new
  // kernel violations must never be absorbed into the baseline.
  if (updateBaseline) {
    const hasBaseline = baseline !== null;
    if (hasBaseline && (newCycles.length > 0 || newKernelViolations.length > 0)) {
      const message =
        "Refusing to update baseline: the current graph introduces new cycles or new kernel violations " +
        "that are not already baselined. The baseline is shrink-only — fix the new violations before " +
        "regenerating; --update-baseline exists only to contract existing entries.";
      if (!silent) console.error(message);
      return {
        violations: allViolations,
        cycles,
        baseline,
        isClean: false,
        scanError: message,
      };
    }

    const newBaseline: BaselineData = {
      timestamp: new Date().toISOString(),
      cycles: sortCycles(cycles),
      kernelViolations: kernelViolations
        .map((v) => `${v.file}|${v.imports}|${v.resolved}|${v.type}`)
        .sort((left, right) => left.localeCompare(right)),
    };
    saveBaseline(baselinePath, newBaseline);
    if (!silent) console.log("Baseline updated.");

    // After regeneration the current graph IS the baseline, so the contract
    // is green by definition (creation or shrink-only contraction).
    return {
      violations: [],
      cycles: sortCycles(cycles),
      baseline: newBaseline,
      isClean: true,
    };
  }

  return { violations: allViolations, cycles, baseline, isClean };
}

// ============================================================================
// CLI
// ============================================================================

const VALID_FLAGS = new Set([
  "--update-baseline",
  "--json",
  "--convex-dir",
  "--package-dir",
  "--baseline",
  "--help",
  "-h",
]);

function flagValue(
  args: string[],
  name: string,
): string | undefined {
  const at = args.indexOf(name);
  if (at === -1 || at + 1 >= args.length) return undefined;
  return args[at + 1];
}

function usage(): string {
  return [
    "Usage: bun scripts/convex-backend-dependency-check.ts [options]",
    "",
    "Options:",
    "  --update-baseline   Regenerate the baseline from the current graph. Only",
    "                      allowed for shrink-only changes; refuses to absorb new",
    "                      cycles or kernel violations, and refuses on an empty scan.",
    "  --json              Emit machine-readable JSON (silences human progress).",
    "  --convex-dir <path> Scan this convex directory instead of the default.",
    "  --package-dir <path> Package root used to compute relative module paths.",
    "  --baseline <path>   Read/write this baseline file instead of the default.",
    "  --help, -h          Show this help.",
  ].join("\n");
}

function main() {
  const args = process.argv.slice(2);

  if (args.some((arg) => arg === "--help" || arg === "-h")) {
    console.log(usage());
    process.exit(0);
  }
  for (const arg of args) {
    if (arg.startsWith("--") && !VALID_FLAGS.has(arg)) {
      console.error(`Unknown flag: ${arg}\n\n${usage()}`);
      process.exit(2);
    }
  }

  const updateBaseline = args.includes("--update-baseline");
  const jsonOutput = args.includes("--json");

  const result = runDependencyCheck({
    updateBaseline,
    silent: jsonOutput,
    convexDir: flagValue(args, "--convex-dir"),
    packageDir: flagValue(args, "--package-dir"),
    baselinePath: flagValue(args, "--baseline"),
  });

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.isClean ? 0 : 1);
  }

  console.log("\n=== Dependency Check Results ===");
  console.log(`Cycles found: ${result.cycles.length}`);
  console.log(`Violations: ${result.violations.length}`);
  console.log(`Status: ${result.isClean ? "CLEAN" : "VIOLATIONS FOUND"}`);

  for (const v of result.violations) {
    console.log(`\n${v.type.toUpperCase()}: ${v.file}`);
    console.log(`  Imports: ${v.imports}`);
    console.log(`  Resolved: ${v.resolved}`);
    if (v.cycle) {
      console.log(`  Cycle: ${v.cycle.join(" -> ")}`);
    }
  }

  if (result.cycles.length > 0 && result.violations.length === 0) {
    console.log("\n--- Current Cycles (baseline) ---");
    for (const cycle of result.cycles) {
      console.log(`  ${cycle.join(" -> ")}`);
    }
  }

  if (result.scanError) {
    console.log(`\n❌ ${result.scanError}`);
    process.exit(1);
  }

  if (!result.isClean) {
    console.log("\n❌ Dependency check FAILED");
    if (!updateBaseline && result.baseline) {
      console.log("Run with --update-baseline to regenerate baseline after intentional changes.");
    }
    process.exit(1);
  } else {
    console.log("\n✅ Dependency check PASSED");
    process.exit(0);
  }
}

if (import.meta.main) {
  main();
}