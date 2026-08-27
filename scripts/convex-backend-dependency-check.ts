#!/usr/bin/env bun

/**
 * Convex Backend Dependency Guard
 *
 * Snapshots current backend dependency cycles and fails only on new violations
 * while protecting stable kernels (inventoryLedger, agentHarness).
 *
 * This is a characterization-first tool: it captures today's graph and proves
 * the guard is green before adding failure fixtures.
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, "..");
const CONVEX_DIR = path.join(REPO_ROOT, "packages/athena-webapp/convex");
const PACKAGE_DIR = path.join(REPO_ROOT, "packages/athena-webapp");
const BASELINE_PATH = path.join(REPO_ROOT, "scripts/convex-backend-dependency-baseline.json");

const IMPORT_PATTERN = /(?:from|import)\s*\(?\s*["']([^"']+)["']\s*\)?/g;

// ============================================================================
// Protected Kernel Definitions
// ============================================================================

/**
 * Kernel modules that must remain leaf-like: they may not import product domains.
 * These are the "stable kernels" that define core transaction boundaries.
 */
export const PROTECTED_KERNELS = {
  inventoryLedger: {
    root: "convex/inventoryLedger",
    // Modules that are allowed to be imported BY the kernel (its dependencies)
    allowedImports: [
      "convex/_generated/",
      "convex/values",
      "convex/server",
      "convex/schemas/inventoryLedger",
      "convex/operations/inventoryMovements",
      "convex/operations/skuActivity",
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
    // Leaf helpers that the kernel may import without creating cycles
    // These are modules that only import generated types and convex/values
    leafHelpers: [
      "convex/inventoryLedger/types",
      "convex/inventoryLedger/valuation",
      "convex/inventoryLedger/positionRevisions",
      "convex/inventoryLedger/deficitResolutionWork",
      "convex/inventoryLedger/deficitLedger",
      "convex/inventoryLedger/commerceEffects",
      "convex/inventoryLedger/corrections",
      "convex/inventoryLedger/scheduleWork",
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
    // Leaf helpers (import only generated types and convex/values)
    leafHelpers: [
      "convex/agentHarness/provisionalNarrative",
      "convex/agentHarness/turnTrace",
      "convex/agentHarness/narrativeTrail",
      "convex/agentHarness/budgets",
      "convex/agentHarness/egressPolicy",
      "convex/agentHarness/scorecard",
      "convex/agentHarness/scorecardQuery",
      "convex/agentHarness/runtimeRetention",
      "convex/agentHarness/testSupport",
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
} as const;

// ============================================================================
// Types
// ============================================================================

type SourceFile = { path: string; source: string };
type DependencyGraph = Map<string, Set<string>>;

interface Violation {
  file: string;
  imports: string;
  resolved: string;
  type: "kernel-forbidden" | "kernel-not-allowed" | "new-cycle" | "cycle-not-in-baseline";
  cycle?: string[];
}

interface BaselineData {
  timestamp: string;
  cycles: string[][];
  kernelViolations: string[]; // Known violations that are grandfathered (format: "file|imports|resolved|type")
}

interface CheckResult {
  violations: Violation[];
  cycles: string[][];
  baseline: BaselineData | null;
  isClean: boolean;
}

// ============================================================================
// File Collection
// ============================================================================

/** This file carries runtime-native strings as fixtures; it is never a scan subject. */
const SELF = "scripts/convex-backend-dependency-check.ts";

function collectSources(dir: string, predicate: (relative: string) => boolean = () => true): SourceFile[] {
  if (!existsSync(dir)) return [];
  const entries: SourceFile[] = [];
  for (const name of readdirSync(dir)) {
    const absolute = path.join(dir, name);
    if (statSync(absolute).isDirectory()) {
      if (name === "node_modules" || name === "_generated") continue;
      entries.push(...collectSources(absolute, predicate));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(name)) continue;
    const relative = path.relative(PACKAGE_DIR, absolute).split(path.sep).join("/");
    if (relative === SELF || !predicate(relative)) continue;
    // Skip test files for cycle detection (they don't affect runtime)
    if (relative.endsWith(".test.ts") || relative.endsWith(".test.tsx")) continue;
    entries.push({ path: relative, source: readFileSync(absolute, "utf8") });
  }
  return entries;
}

function importsOf(file: SourceFile): { specifier: string; resolved: string }[] {
  const out: { specifier: string; resolved: string }[] = [];
  for (const match of file.source.matchAll(IMPORT_PATTERN)) {
    const specifier = match[1];
    if (specifier.startsWith(".")) {
      const resolved = path
        .relative(PACKAGE_DIR, path.resolve(path.dirname(path.join(PACKAGE_DIR, file.path)), specifier))
        .split(path.sep)
        .join("/");
      out.push({ specifier, resolved });
    } else {
      // External package imports - ignore for cycle detection
      out.push({ specifier, resolved: specifier });
    }
  }
  return out;
}

// ============================================================================
// Graph Building
// ============================================================================

function buildDependencyGraph(files: SourceFile[]): DependencyGraph {
  const graph = new Map<string, Set<string>>();

  // Initialize all files as nodes
  for (const file of files) {
    graph.set(file.path, new Set());
  }

  // Add edges for local imports
  for (const file of files) {
    for (const { resolved } of importsOf(file)) {
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

    const neighbors = graph.get(v) || new Set();
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
      if (scc.length > 1 || (scc.length === 1 && (graph.get(scc[0])?.has(scc[0]) ?? false))) {
        sccs.push(scc);
      }
    }
  }

  for (const v of graph.keys()) {
    if (!index.has(v)) {
      strongconnect(v);
    }
  }

  // Sort SCCs for deterministic output
  return sccs.map(scc => scc.sort()).sort((a, b) => a[0].localeCompare(b[0]));
}

// ============================================================================
// Kernel Violation Detection
// ============================================================================

function isKernelModule(filePath: string, kernel: typeof PROTECTED_KERNELS.inventoryLedger): boolean {
  if (!filePath.startsWith(kernel.root + "/")) return false;
  // Check excluded paths for agentHarness
  if ("excludedPaths" in kernel) {
    for (const excluded of kernel.excludedPaths!) {
      if (filePath.startsWith(excluded)) return false;
    }
  }
  // Test files are not kernel modules
  if (filePath.endsWith(".test.ts") || filePath.endsWith(".test.tsx")) return false;
  // Test support modules (e.g., x.testPorts.ts) are not kernel modules
  if (/\.test[A-Z][A-Za-z]*\.tsx?$/.test(filePath)) return false;
  return true;
}

function isLeafHelper(filePath: string, kernel: typeof PROTECTED_KERNELS.inventoryLedger): boolean {
  return kernel.leafHelpers.some(helper => filePath === helper || filePath.startsWith(helper + "/"));
}

function checkKernelViolations(files: SourceFile[], kernelName: keyof typeof PROTECTED_KERNELS): Violation[] {
  const kernel = PROTECTED_KERNELS[kernelName];
  const violations: Violation[] = [];

  for (const file of files) {
    if (!isKernelModule(file.path, kernel)) continue;
    if (isLeafHelper(file.path, kernel)) continue;

    for (const { specifier, resolved } of importsOf(file)) {
      if (!specifier.startsWith(".")) continue; // Only check local imports

      // Check if it's a forbidden import
      const forbidden = kernel.forbiddenImports.some(prefix => resolved.startsWith(prefix));
      if (forbidden) {
        violations.push({
          file: file.path,
          imports: specifier,
          resolved,
          type: "kernel-forbidden",
        });
        continue;
      }

      // Check if it's an allowed import
      const allowed = kernel.allowedImports.some(prefix => resolved.startsWith(prefix));
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

function loadBaseline(): BaselineData | null {
  if (!existsSync(BASELINE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    return null;
  }
}

function saveBaseline(baseline: BaselineData): void {
  writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2));
}

function cyclesEqual(a: string[][], b: string[][]): boolean {
  if (a.length !== b.length) return false;
  const aSorted = a.map(c => c.slice().sort()).sort((x, y) => x[0].localeCompare(y[0]));
  const bSorted = b.map(c => c.slice().sort()).sort((x, y) => x[0].localeCompare(y[0]));
  for (let i = 0; i < aSorted.length; i++) {
    if (aSorted[i].length !== bSorted[i].length) return false;
    for (let j = 0; j < aSorted[i].length; j++) {
      if (aSorted[i][j] !== bSorted[i][j]) return false;
    }
  }
  return true;
}

function violationKey(v: Violation): string {
  return `${v.file}|${v.imports}|${v.resolved}|${v.type}`;
}

function parseBaselineViolation(key: string): Violation | null {
  const parts = key.split("|");
  if (parts.length !== 4) return null;
  return { file: parts[0], imports: parts[1], resolved: parts[2], type: parts[3] as Violation["type"] };
}

function findNewCycles(currentCycles: string[][], baseline: BaselineData | null): { newCycles: string[][]; removedCycles: string[][] } {
  if (!baseline) return { newCycles: currentCycles, removedCycles: [] };

  const currentSet = new Set(currentCycles.map(c => c.slice().sort().join("|")));
  const baselineSet = new Set(baseline.cycles.map(c => c.slice().sort().join("|")));

  const newCycles = currentCycles.filter(c => !baselineSet.has(c.slice().sort().join("|")));
  const removedCycles = baseline.cycles.filter(c => !currentSet.has(c.slice().sort().join("|")));

  return { newCycles, removedCycles };
}

function findNewKernelViolations(currentViolations: Violation[], baseline: BaselineData | null): Violation[] {
  if (!baseline) return currentViolations;
  const baselineKeys = new Set(baseline.kernelViolations);
  return currentViolations.filter(v => !baselineKeys.has(violationKey(v)));
}

function findRemovedKernelViolations(currentViolations: Violation[], baseline: BaselineData | null): Violation[] {
  if (!baseline) return [];
  const currentKeys = new Set(currentViolations.map(violationKey));
  return baseline.kernelViolations
    .map(parseBaselineViolation)
    .filter((v): v is Violation => v !== null && !currentKeys.has(violationKey(v)));
}

// ============================================================================
// Main Check Function
// ============================================================================

export function runDependencyCheck(options: { updateBaseline?: boolean; silent?: boolean } = {}): CheckResult {
  const { silent = false } = options;
  if (!silent) console.log("Scanning Convex backend files...");
  const files = collectSources(CONVEX_DIR);
  if (!silent) console.log(`Found ${files.length} source files`);

  // Build graph
  const graph = buildDependencyGraph(files);

  // Find SCCs (cycles)
  const cycles = findSCCs(graph);
  if (!silent) console.log(`Found ${cycles.length} dependency cycles (SCCs with >1 node or self-loops)`);

  // Check kernel violations
  const inventoryLedgerViolations = checkKernelViolations(files, "inventoryLedger");
  const agentHarnessViolations = checkKernelViolations(files, "agentHarness");

  const kernelViolations = [...inventoryLedgerViolations, ...agentHarnessViolations];
  if (!silent) console.log(`Kernel violations: ${inventoryLedgerViolations.length} (inventoryLedger), ${agentHarnessViolations.length} (agentHarness)`);

  // Load baseline
  const baseline = loadBaseline();

  // Compare cycles with baseline
  const { newCycles, removedCycles } = findNewCycles(cycles, baseline);

  // Build violations for new cycles
  const cycleViolations: Violation[] = newCycles.map(cycle => ({
    file: cycle[0],
    imports: cycle.slice(1).join(" -> "),
    resolved: cycle.join(" -> "),
    type: baseline ? "new-cycle" : "cycle-not-in-baseline",
    cycle,
  }));

  // If baseline exists and we have removed cycles, that's a drift
  const driftViolations: Violation[] = removedCycles.map(cycle => ({
    file: cycle[0],
    imports: "BASELINE DRIFT",
    resolved: cycle.join(" -> "),
    type: "new-cycle", // Treat as violation because baseline must be regenerated
    cycle,
  }));

  // Compare kernel violations with baseline - only NEW violations fail
  const newKernelViolations = findNewKernelViolations(kernelViolations, baseline);
  const removedKernelViolations = findRemovedKernelViolations(kernelViolations, baseline);

  if (removedKernelViolations.length > 0) {
    console.log(`Fixed ${removedKernelViolations.length} previously-baselined kernel violations (baseline will shrink on next update)`);
  }

  const allViolations = [...newKernelViolations, ...cycleViolations, ...driftViolations];
  const isClean = allViolations.length === 0;

  // Update baseline if requested
  if (options.updateBaseline) {
    const newBaseline: BaselineData = {
      timestamp: new Date().toISOString(),
      cycles,
      kernelViolations: kernelViolations.map(v => `${v.file}|${v.imports}|${v.resolved}|${v.type}`),
    };
    saveBaseline(newBaseline);
    console.log("Baseline updated.");
  }

  return {
    violations: allViolations,
    cycles,
    baseline,
    isClean,
  };
}

// ============================================================================
// CLI
// ============================================================================

function main() {
  const args = process.argv.slice(2);
  const updateBaseline = args.includes("--update-baseline");
  const jsonOutput = args.includes("--json");

  const result = runDependencyCheck({ updateBaseline, silent: jsonOutput });

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.isClean ? 0 : 1);
  }

  // Human-readable output
  console.log("\n=== Dependency Check Results ===");
  console.log(`Cycles found: ${result.cycles.length}`);
  console.log(`Violations: ${result.violations.length}`);
  console.log(`Status: ${result.isClean ? "CLEAN" : "VIOLATIONS FOUND"}`);

  if (result.violations.length > 0) {
    console.log("\n--- Violations ---");
    for (const v of result.violations) {
      console.log(`\n${v.type.toUpperCase()}: ${v.file}`);
      console.log(`  Imports: ${v.imports}`);
      console.log(`  Resolved: ${v.resolved}`);
      if (v.cycle) {
        console.log(`  Cycle: ${v.cycle.join(" -> ")}`);
      }
    }
  }

  if (result.cycles.length > 0 && result.violations.length === 0) {
    console.log("\n--- Current Cycles (baseline) ---");
    for (const cycle of result.cycles) {
      console.log(`  ${cycle.join(" -> ")}`);
    }
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