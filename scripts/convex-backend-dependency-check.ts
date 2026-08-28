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
 * Scan coverage:
 *  - Only the exact top-level `convex/_generated` directory (the Convex runtime
 *    facade) is excluded from the scan. A nested directory named `_generated`
 *    under a kernel subtree is a hard failure unless a protected kernel
 *    declares it (prefix) in its `excludedPaths` — a kernel subtree must never
 *    silently hide its own generated code.
 *  - Import extraction is comment/string/regex-literal aware, anchored at
 *    statement boundaries (`data.from("x")` is not an import), and also reads
 *    backtick (template-literal) specifiers unless they contain `${`
 *    interpolation (not statically resolvable).
 *  - Kernel checks classify every import that addresses the Convex backend:
 *    `.`-relative specifiers, bare `convex/...` specifiers, and tsconfig-path
 *    aliases that expand into `convex/...`, `src/...`, or `shared/...` (the
 *    package-local dependency surfaces a kernel may legitimately address).
 *    External packages are never kernel-surface.
 *
 * Shrink-only contract:
 *  - The committed baseline freezes exact cycle memberships and exact kernel
 *    violation edges. ANY change to those sets — an addition OR a removal —
 *    fails the check until the baseline is regenerated with --update-baseline.
 *    A removed edge can therefore never pay for a new cycle elsewhere.
 *  - --update-baseline only ever contracts the baseline: it refuses to persist
 *    when the current graph introduces a cycle or a kernel violation that is
 *    not already baselined (a cycle that is an exact member or a strict subset
 *    of a baselined cycle is a contraction, not a new cycle), and it refuses on
 *    an empty scan or a corrupt baseline.
 *  - Regeneration is the ONLY way the baseline changes, and it is only allowed
 *    from a state where every difference from the baseline is a removal (or a
 *    strict contraction of a baselined cycle). The normal check types the
 *    surviving subset of a baselined cycle as `cycle-contraction` (safe to
 *    regenerate) rather than `new-cycle` (blocked), so an agent can tell drift
 *    from growth purely from the JSON.
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
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
 * Product domains forbidden to BOTH protected kernels. Kept in one place so
 * the two kernels cannot drift apart, and spelled with both `storefront`
 * casings because the real directory is `convex/storeFront/` (git-canonical)
 * while macOS is case-insensitive: either spelling in source must be caught.
 */
const SHARED_FORBIDDEN_PRODUCT_DOMAINS = [
  "convex/operations/",
  "convex/reports/",
  "convex/cashControls/",
  "convex/automation/",
  "convex/stockOps/",
  "convex/inventory/", // except schema
  "convex/pos/",
  "convex/storefront/",
  "convex/storeFront/",
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
];

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
    forbiddenImports: [
      ...SHARED_FORBIDDEN_PRODUCT_DOMAINS,
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
    forbiddenImports: [...SHARED_FORBIDDEN_PRODUCT_DOMAINS],
    // Excluded subdirectories (not kernel modules). These subtrees still
    // participate in the graph: their cycles are detected and baselined, and
    // their nested `_generated/` directory (generated capability registry) is
    // deliberately declared here so the scan treats it as expected output
    // rather than an undeclared bypass.
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
/** Alias prefix -> expanded target (relative to packageDir), both with `*` resolved. */
type AliasMap = Map<string, string>;

interface Violation {
  file: string;
  /**
   * Depending on `type`: the import specifier (kernel types), the member list
   * joined by " -> " (cycle types), or describes the drift on a removed edge.
   * Consumers that need the exact edge rely on `resolved` + `cycle` instead.
   */
  imports: string;
  resolved: string;
  type:
    | "kernel-forbidden"
    | "kernel-not-allowed"
    | "new-cycle"
    | "cycle-contraction"
    | "cycle-not-in-baseline"
    | "baseline-drift";
  cycle?: string[];
  /** 1-based source line of the import statement (kernel violations only). */
  line?: number;
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
  /** Actionable next step emitted whenever the check is not clean. */
  repairHint?: string;
  /** Set to true when --update-baseline persisted a new baseline. */
  baselineUpdated?: boolean;
}

/**
 * Locale-independent byte comparison so emitted output is identical on every
 * machine regardless of ICU collation data.
 */
function compareByBytes(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

// ============================================================================
// Import Extraction (comment/string/regex aware)
// ============================================================================

/**
 * Ranges of the source that are inside comments, string literals, or regex
 * literals. Import specifiers must only be collected from real code: a
 * commented-out import, prose that quotes an import, or a regex literal that
 * happens to contain `from "..."` must never produce a guard finding.
 *
 * This is a heuristic, not a parser: a `/` only starts a regex in an expression
 * position (previous significant token is an operator/symbol or a
 * control-flow keyword), which is the standard tradeoff that keeps
 * `(a + b) / 2` (division after a value) out of the regex branch. Constructed
 * counterexamples on either side (e.g. a division chain that reaches an
 * operator boundary, or a regex after a closer such as `)`) are therefore not
 * discriminated — the practical impact is bounded because a phantom specifier
 * either fails to resolve to a real module (dropped at the graph/kernel-gate
 * step) or resolves to a kernel-internal path that the gate still classifies.
 */
function collectNonCodeRanges(source: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  // Control-flow keywords that legitimately precede a regex literal even when
  // the previous token is a word (e.g. `return /from "..\/x"/.test(s);`).
  const regexPrecedingKeywords = new Set([
    "return",
    "typeof",
    "instanceof",
    "in",
    "of",
    "new",
    "delete",
    "void",
    "case",
    "do",
    "else",
    "yield",
    "await",
    "throw",
  ]);
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
    if (ch === "/" && next !== "/" && next !== "*") {
      // Candidate regex literal vs division. A `/` starts a regex only in an
      // expression position (previous significant token is an operator/symbol
      // or a control keyword); after a value it is division, which we leave
      // for the normal scan.
      let j = i - 1;
      while (j >= 0 && /\s/.test(source[j])) j -= 1;
      let isRegexStart = false;
      if (j < 0) {
        isRegexStart = true;
      } else if (/[A-Za-z0-9_$]/.test(source[j])) {
        let k = j;
        while (k >= 0 && /[A-Za-z0-9_$]/.test(source[k])) k -= 1;
        isRegexStart = regexPrecedingKeywords.has(source.slice(k + 1, j + 1));
      } else {
        isRegexStart = "=({[,!:;&|?+-*%<>^~".includes(source[j]);
      }
      if (isRegexStart) {
        let k = i + 1;
        let escaped = false;
        while (k < source.length) {
          const c = source[k];
          if (c === "\\" && !escaped) {
            escaped = true;
            k += 1;
            continue;
          }
          if (c === "\n") break; // regex literals (in practice) do not span lines
          if (c === "/" && !escaped) break;
          escaped = false;
          k += 1;
        }
        if (k < source.length && source[k] === "/") {
          let end = k + 1;
          while (end < source.length && /[a-z]/i.test(source[end])) end += 1;
          ranges.push([i, end]);
          i = end;
          continue;
        }
      }
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

/**
 * `from "spec"` / `import "spec"` / `import("spec")` matches. The negative
 * lookbehind anchors the keyword at a statement boundary so member calls like
 * `data.from("x")` or `selection.import("x")` are never mistaken for imports.
 * Backtick specifiers are supported (template-literal imports); `${...}`
 * interpolated ones are filtered in the extractor.
 */
const IMPORT_PATTERN = /(?<![A-Za-z0-9_$.])(?:from|import)\s*\(?\s*["'\x60]([^"'\x60]+)["'\x60]\s*\)?/g;

function lineAt(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i += 1) {
    if (source[i] === "\n") line += 1;
  }
  return line;
}

function extractImportSpecifiers(
  source: string,
): { specifier: string; line: number }[] {
  const nonCode = collectNonCodeRanges(source);
  const specifiers: { specifier: string; line: number }[] = [];
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const at = match.index ?? 0;
    const inNonCode = nonCode.some(
      ([start, end]) => start <= at && at < end,
    );
    if (inNonCode) continue;
    const specifier = match[1];
    // A template-literal import with interpolation is not statically
    // resolvable by this guard; skipping it is honest, not coverage loss.
    if (specifier.includes("${")) continue;
    specifiers.push({ specifier, line: lineAt(source, at) });
  }
  return specifiers;
}

// ============================================================================
// File Collection
// ============================================================================

type SourceCollector = {
  files: SourceFile[];
  /** `_generated` directories that are NOT the exact top-level convex one. */
  nestedGeneratedDirs: string[];
};

function walkCollect(
  dir: string,
  convexRoot: string,
  packageDir: string,
  collector: SourceCollector,
): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const absolute = path.join(dir, name);
    let stat;
    try {
      stat = statSync(absolute);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      if (name === "node_modules") continue;
      if (name === "_generated") {
        if (absolute === path.join(convexRoot, "_generated")) {
          // The exact top-level Convex runtime facade is the only generated
          // directory excluded from the scan.
          continue;
        }
        collector.nestedGeneratedDirs.push(
          path.relative(convexRoot, absolute).split(path.sep).join("/"),
        );
        continue;
      }
      walkCollect(absolute, convexRoot, packageDir, collector);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(name)) continue;
    const relative = path.relative(packageDir, absolute).split(path.sep).join("/");
    // Test files are not runtime modules and do not participate in cycles.
    if (/\.test\.(ts|tsx)$/.test(relative)) continue;
    let source: string;
    try {
      source = readFileSync(absolute, "utf8");
    } catch {
      // Unreadable or deleted mid-scan: skip rather than fail the whole check.
      continue;
    }
    collector.files.push({ path: relative, source });
  }
}

function collectSources(
  convexDir: string,
  packageDir: string,
): SourceCollector {
  const collector: SourceCollector = { files: [], nestedGeneratedDirs: [] };
  walkCollect(convexDir, convexDir, packageDir, collector);
  // Deterministic traversal so emitted output is stable across machines.
  collector.files.sort((left, right) => compareByBytes(left.path, right.path));
  return collector;
}

/**
 * A nested `_generated` directory under the Convex tree is only acceptable
 * when a protected kernel declares it (or a prefix of it) in `excludedPaths`.
 * Anything else means code is hiding inside a directory that the scan would
 * otherwise skip — the caller must turn that into a loud failure.
 */
function undeclaredNestedGeneratedDirs(nested: string[]): string[] {
  const declared: string[] = [];
  for (const kernel of Object.values(PROTECTED_KERNELS)) {
    for (const excludedPath of kernel.excludedPaths ?? []) {
      declared.push(excludedPath.endsWith("/") ? excludedPath : `${excludedPath}/`);
    }
  }
  return nested.filter((dir) => {
    const candidate = `convex/${dir}`;
    const normalized = candidate.endsWith("/") ? candidate : `${candidate}/`;
    return !declared.some(
      (declaredPath) =>
        normalized.startsWith(declaredPath) || declaredPath.startsWith(normalized),
    );
  });
}

/**
 * True when `fileCandidate` exists and is a regular file, returned as the
 * package-relative slash path. Wrapped in try/catch so a race between scanning
 * and probing (file deleted mid-run) resynthesizes to "not found" instead of
 * crashing the whole check.
 */
function probeCandidateFile(packageDir: string, fileCandidate: string): string | null {
  try {
    if (statSync(fileCandidate).isFile()) {
      return path.relative(packageDir, fileCandidate).split(path.sep).join("/");
    }
  } catch {
    // File vanished between readdir and probe: treat as not found.
  }
  return null;
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
    const resolved = probeCandidateFile(packageDir, fileCandidate);
    if (resolved !== null) return resolved;
  }
  return null;
}

/** Resolve a bare `convex/...` or alias-expanded convex target to a file path. */
function resolveConvexModule(packageDir: string, convexRel: string): string | null {
  const base = path.join(packageDir, convexRel);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];
  for (const fileCandidate of candidates) {
    const resolved = probeCandidateFile(packageDir, fileCandidate);
    if (resolved !== null) return resolved;
  }
  return null;
}

/** Read tsconfig `compilerOptions.paths` as an alias prefix -> target map. */
function loadTsconfigAliases(packageDir: string): AliasMap {
  const aliases: AliasMap = new Map();
  const tsconfigPath = path.join(packageDir, "tsconfig.json");
  if (!existsSync(tsconfigPath)) return aliases;
  try {
    // Real tsconfigs are JSONC (JSON with // and /* */ comments, trailing
    // commas). Straight JSON.parse rejects the whole file, which would silently
    // disable alias coverage on the real tree. Strip comments string-aware so
    // a `//` inside a string value is never mistaken for a comment.
    const raw = stripJsoncComments(readFileSync(tsconfigPath, "utf8")).replace(
      /,\s*([}\]])/g,
      "$1",
    );
    const parsed = JSON.parse(raw) as {
      compilerOptions?: { paths?: Record<string, string[]> };
    };
    const paths = parsed?.compilerOptions?.paths;
    if (!paths) return aliases;
    for (const [alias, targets] of Object.entries(paths)) {
      const target = targets?.[0];
      if (typeof target !== "string") continue;
      if (alias.endsWith("*") && target.endsWith("*")) {
        aliases.set(alias.slice(0, -1), target.slice(0, -1).replace(/^\.\//, ""));
      } else {
        aliases.set(alias, target.replace(/^\.\//, ""));
      }
    }
  } catch {
    // Unreadable tsconfig: treat as no aliases rather than failing the scan.
    // Warn (to stderr, so --json on stdout stays parseable) so the silent
    // loss of alias coverage is never invisible to the person running the check.
    console.warn(
      `Warning: could not parse tsconfig.json at ${tsconfigPath}; ` +
        `path aliases will not be expanded by the dependency guard.`,
    );
  }
  return aliases;
}

/**
 * Remove `//` and `/* ... *\/` comments from a JSONC document without touching
 * comment-like sequences inside string literals.
 */
function stripJsoncComments(raw: string): string {
  let out = "";
  let inString: "'" | '"' | null = null;
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    const next = raw[i + 1] ?? "";
    if (inString !== null) {
      out += ch;
      if (ch === "\\") {
        out += next;
        i += 2;
        continue;
      }
      if (ch === inString) inString = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < raw.length && raw[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < raw.length && !(raw[i] === "*" && raw[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * True when a resolved/expanded target addresses the Convex backend a kernel
 * may legitimately depend on: the package's convex tree, its src/ directory,
 * or its shared/ dependency root — as a bare root or a subtree. Everything
 * else (external packages) is never kernel-surface.
 */
function isBackendSurface(target: string): boolean {
  return (
    target === "convex" ||
    target === "src" ||
    target === "shared" ||
    target.startsWith("convex/") ||
    target.startsWith("src/") ||
    target.startsWith("shared/")
  );
}

function expandAlias(specifier: string, aliases: AliasMap): string | null {
  // Mirrors TypeScript's path mapping: when several patterns match, the
  // longest matching prefix wins (not the first one inserted), so overlapping
  // aliases like `@cvx/* -> ./convex/values/*` and the narrower
  // `@cvx/values/* -> ./convex/reports/*` resolve the same way tsc does.
  let best: { prefixLength: number; expanded: string } | null = null;
  for (const [aliasPrefix, target] of aliases) {
    if (aliasPrefix.endsWith("/")) {
      if (!specifier.startsWith(aliasPrefix)) continue;
      const candidate = target + specifier.slice(aliasPrefix.length);
      if (best === null || aliasPrefix.length > best.prefixLength) {
        best = { prefixLength: aliasPrefix.length, expanded: candidate };
      }
    } else if (specifier === aliasPrefix) {
      if (best === null || aliasPrefix.length > best.prefixLength) {
        best = { prefixLength: aliasPrefix.length, expanded: target };
      }
    }
  }
  return best?.expanded ?? null;
}

type ImportEntry = { specifier: string; resolved: string; line: number };

function importsOf(
  file: SourceFile,
  packageDir: string,
  aliases: AliasMap,
): ImportEntry[] {
  const out: ImportEntry[] = [];
  for (const { specifier, line } of extractImportSpecifiers(file.source)) {
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
      out.push({ specifier, resolved, line });
      continue;
    }
    const expanded = expandAlias(specifier, aliases);
    const backendExpanded = expanded !== null && isBackendSurface(expanded);
    if (specifier.startsWith("convex/") || backendExpanded) {
      const convexRel = specifier.startsWith("convex/") ? specifier : expanded;
      const resolved = resolveConvexModule(packageDir, convexRel) ?? convexRel;
      out.push({ specifier, resolved, line });
      continue;
    }
    // External package or unexpanded bare specifier (e.g. "react"): never
    // kernel-surface and never a cycle participant; the specifier itself is
    // the identity.
    out.push({ specifier, resolved: specifier, line });
  }
  return out;
}

// ============================================================================
// Graph Building
// ============================================================================

function buildDependencyGraph(
  files: SourceFile[],
  packageDir: string,
  aliases: AliasMap,
): DependencyGraph {
  const graph = new Map<string, Set<string>>();

  for (const file of files) {
    graph.set(file.path, new Set());
  }

  for (const file of files) {
    for (const { resolved } of importsOf(file, packageDir, aliases)) {
      // Edges are only meaningful between modules the graph contains: a bare
      // `convex/values` reference never resolves to a file and adds no edge.
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
    .map((cycle) => cycle.slice().sort(compareByBytes))
    .sort((a, b) => compareByBytes(a[0], b[0]));
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
  // Test files and test-support modules are not kernel modules. The
  // `.test[A-Z]...` carve-out is deliberately narrow (e.g. *.testSeams.ts,
  // *.testPorts.ts) and only applies to genuinely test-support files, verified
  // by the boundary tests: excluded subtrees still participate in cycle
  // detection, so hiding a violation inside one does not make it invisible.
  if (filePath.endsWith(".test.ts") || filePath.endsWith(".test.tsx")) return false;
  if (/\.test[A-Z][A-Za-z]*\.tsx?$/.test(filePath)) return false;
  return true;
}

function checkKernelViolations(
  files: SourceFile[],
  kernelName: keyof typeof PROTECTED_KERNELS,
  packageDir: string,
  aliases: AliasMap,
): Violation[] {
  const kernel = PROTECTED_KERNELS[kernelName];
  const violations: Violation[] = [];

  // Every kernel file is checked — including helpers. Nothing is exempted:
  // helpers pass only because their imports are legal.
  for (const file of files) {
    if (!isKernelModule(file.path, kernel)) continue;

    for (const { specifier, resolved, line } of importsOf(
      file,
      packageDir,
      aliases,
    )) {
      const isRelative = specifier.startsWith(".");
      // Classification surface: relative imports inside the package, plus any
      // bare `convex/...` specifier or tsconfig alias that addresses the
      // backend (convex/, src/, or the package-local shared/ dependency root).
      // External packages are not kernel-surface.
      const addressesBackend = isRelative || isBackendSurface(resolved);
      if (!addressesBackend) continue;

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
          line,
        });
        continue;
      }

      // A slash-suffixed allowed prefix is a directory (startsWith is exact).
      // A non-slash allowed prefix is a single module and must match EXACTLY
      // as the module itself (`convex/values`), its own entry file
      // (`convex/values.ts`/`.tsx`), or a directory child (`convex/values/...`).
      // Any dotted child that is not exactly `prefix.ts(x)` — e.g.
      // `convex/valuesBridge.ts` or `convex/values.deep.ts` — is a lookalike
      // and never inherits the allowance, so it cannot ferry product-domain
      // imports into a kernel (leaf-to-facade).
      const allowed = kernel.allowedImports.some((prefix) =>
        prefix.endsWith("/")
          ? resolved.startsWith(prefix)
          : resolved === prefix ||
            resolved === `${prefix}.ts` ||
            resolved === `${prefix}.tsx` ||
            resolved.startsWith(`${prefix}/`),
      );
      if (!allowed) {
        violations.push({
          file: file.path,
          imports: specifier,
          resolved,
          type: "kernel-not-allowed",
          line,
        });
      }
    }
  }

  return violations;
}

// ============================================================================
// Baseline Management
// ============================================================================

type BaselineLoad =
  | { status: "missing"; baseline: null }
  | { status: "valid"; baseline: BaselineData }
  | { status: "corrupt"; baseline: null; reason: string };

/**
 * Distinguish a missing baseline (created on first `--update-baseline`) from a
 * corrupt one. A corrupt baseline must never be silently treated as missing
 * and regenerated from scratch — the failure must be loud.
 */
function loadBaseline(baselinePath: string): BaselineLoad {
  if (!existsSync(baselinePath)) return { status: "missing", baseline: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(baselinePath, "utf8"));
  } catch (error) {
    return {
      status: "corrupt",
      baseline: null,
      reason: `not valid JSON (${error instanceof Error ? error.message : String(error)})`,
    };
  }
  const candidate = parsed as Partial<BaselineData>;
  const shapeValid =
    typeof candidate === "object" &&
    candidate !== null &&
    Array.isArray(candidate.cycles) &&
    Array.isArray(candidate.kernelViolations);
  return shapeValid
    ? {
        status: "valid",
        baseline: parsed as BaselineData,
      }
    : {
        status: "corrupt",
        baseline: null,
        reason: "missing fields `cycles` or `kernelViolations`",
      };
}

function saveBaseline(baselinePath: string, baseline: BaselineData): void {
  // Write to a temp file then rename so a crash mid-write can never leave a
  // truncated baseline behind (which would read back as corrupt on the next run).
  const content = `${JSON.stringify(baseline, null, 2)}\n`;
  const tmpPath = `${baselinePath}.tmp`;
  writeFileSync(tmpPath, content);
  renameSync(tmpPath, baselinePath);
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

  const currentSet = new Set(currentCycles.map((c) => c.slice().sort(compareByBytes).join("|")));
  const baselineSet = new Set(baseline.cycles.map((c) => c.slice().sort(compareByBytes).join("|")));

  const newCycles = currentCycles.filter((c) => !baselineSet.has(c.slice().sort(compareByBytes).join("|")));
  const removedCycles = baseline.cycles.filter((c) => !currentSet.has(c.slice().sort(compareByBytes).join("|")));

  return { newCycles, removedCycles };
}

/**
 * True when a current cycle is an exact member OR a strict subset of a
 * baselined cycle. A contracted survivor is a shrink of an already-baselined
 * cycle, so in --update-baseline mode it is never treated as "new": reintroducing
 * the removed members later produces a cycle that no longer matches the
 * contracted baseline and fails again.
 */
function cycleCoveredByBaseline(
  current: string[],
  baseline: BaselineData,
): boolean {
  const members = current.slice().sort(compareByBytes);
  return baseline.cycles.some((baselined) => {
    const baselinedMembers = baselined.slice().sort(compareByBytes);
    return members.every((member) => baselinedMembers.includes(member));
  });
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
  const collector = collectSources(convexDir, packageDir);
  const files = collector.files;
  if (!silent) console.log(`Found ${files.length} source files`);

  // A guard that cannot see its protected surface must fail loudly, never pass.
  if (files.length === 0) {
    const earlyBaseline = loadBaseline(baselinePath);
    if (earlyBaseline.status === "corrupt") {
      // A corrupt baseline must surface even on an empty scan, so an empty
      // scan can never mask a corrupt baseline into a plain "no files" error.
      const message =
        `Baseline file exists but is corrupt at ${baselinePath}: ${earlyBaseline.reason}. ` +
        `It will not be treated as missing, and --update-baseline will refuse to ` +
        `regenerate it — restore or repair the baseline file.`;
      if (!silent) console.error(message);
      return {
        violations: [],
        cycles: [],
        baseline: null,
        isClean: false,
        scanError: message,
        repairHint:
          "Restore or repair the corrupt baseline file; it is never regenerated from scratch.",
      };
    }
    const message = `No Convex backend source files found at ${convexDir}. The dependency guard cannot evaluate an empty scan; refusing to pass.`;
    if (!silent) console.error(message);
    return {
      violations: [],
      cycles: [],
      baseline: earlyBaseline.baseline,
      isClean: false,
      scanError: message,
      repairHint: "Restore the convex source tree; an empty scan is never passable.",
    };
  }

  // Undeclared nested `_generated` directories are a hard failure: a kernel
  // subtree must never silently hide its own generated code.
  const undeclaredGenerated = undeclaredNestedGeneratedDirs(collector.nestedGeneratedDirs);
  if (undeclaredGenerated.length > 0) {
    const message =
      `Unexpected nested "_generated" director${undeclaredGenerated.length === 1 ? "y" : "ies"} ` +
      `${undeclaredGenerated.map((d) => `convex/${d}`).join(", ")} found under the convex tree. ` +
      `The scan would otherwise skip it silently. Declare each in a protected kernel's ` +
      `excludedPaths (for franchise-generated output) or remove it.`;
    if (!silent) console.error(message);
    return {
      violations: [],
      cycles: [],
      baseline: null,
      isClean: false,
      scanError: message,
      repairHint: "Declare the nested _generated directory in PROTECTED_KERNELS.excludedPaths or remove it.",
    };
  }

  // The guard only ever evaluates the full backend. If the scan cannot see a
  // protected kernel root at all, it is pointing at the wrong tree (e.g. a
  // foreign --convex-dir) or the kernel tree is gone — either way passing green
  // would silently disable the fence. Refuse loudly instead.
  // Presence requires an actual KERNEL MODULE per root: files that live only
  // inside excluded subtrees (profiles/, _generated/, ...) or that are test
  // files do not count, so a scan of just a kernel's excluded surface cannot
  // satisfy the check and silently fence nothing.
  const missingKernelRoots = (
    Object.keys(PROTECTED_KERNELS) as Array<keyof typeof PROTECTED_KERNELS>
  )
    .filter(
      (name) =>
        !files.some((f) => isKernelModule(f.path, PROTECTED_KERNELS[name])),
    )
    .map((name) => PROTECTED_KERNELS[name].root);
  if (missingKernelRoots.length > 0) {
    const message =
      `Protected kernel surface not found in the scan; missing root` +
      `${missingKernelRoots.length === 1 ? "" : "s"}: ${missingKernelRoots.join(", ")}. ` +
      `The dependency guard only evaluates the full backend and refuses a scan that ` +
      `cannot see every protected kernel (is --convex-dir correct?).`;
    if (!silent) console.error(message);
    return {
      violations: [],
      cycles: [],
      baseline: loadBaseline(baselinePath).status === "valid" ? loadBaseline(baselinePath).baseline : null,
      isClean: false,
      scanError: message,
      repairHint:
        "Point the check at the real backend (default convex/ under packages/athena-webapp).",
    };
  }

  const aliases = loadTsconfigAliases(packageDir);
  const graph = buildDependencyGraph(files, packageDir, aliases);
  const cycles = findSCCs(graph);
  if (!silent) {
    console.log(
      `Found ${cycles.length} dependency cycles (SCCs with >1 node or self-loops)`,
    );
  }

  const kernelViolations = (
    Object.keys(PROTECTED_KERNELS) as Array<keyof typeof PROTECTED_KERNELS>
  ).flatMap((kernelName) =>
    checkKernelViolations(files, kernelName, packageDir, aliases),
  );
  if (!silent) {
    const byKernel = (Object.keys(PROTECTED_KERNELS) as Array<keyof typeof PROTECTED_KERNELS>)
      .map(
        (name) =>
          `${name}: ${
            kernelViolations.filter((v) => v.file.startsWith(`${PROTECTED_KERNELS[name].root}/`))
              .length
          }`,
      )
      .join(", ");
    console.log(`Kernel violations (${byKernel})`);
  }

  const baselineLoad = loadBaseline(baselinePath);
  if (baselineLoad.status === "corrupt") {
    const message =
      `Baseline file exists but is corrupt at ${baselinePath}: ${baselineLoad.reason}. ` +
      `It will not be treated as missing, and --update-baseline will refuse to ` +
      `regenerate it — restore or repair the baseline file.`;
    if (!silent) console.error(message);
    return {
      violations: [],
      cycles,
      baseline: null,
      isClean: false,
      scanError: message,
      repairHint: "Restore or repair the corrupt baseline file; it is never regenerated from scratch.",
    };
  }
  const baseline = baselineLoad.baseline;

  // Cycles that `--update-baseline` would refuse to absorb: any current cycle
  // that is not an exact member or a strict subset of a baselined cycle. When
  // there is no baseline, every cycle is unabsorbable (creation is a separate,
  // explicit first-run path below).
  const unabsorbableCycles = baseline
    ? cycles.filter((cycle) => !cycleCoveredByBaseline(cycle, baseline))
    : cycles;

  const { newCycles, removedCycles } = findNewCycles(cycles, baseline);

  const cycleViolations: Violation[] = newCycles.map((cycle) => ({
    file: cycle[0],
    imports: cycle.slice(1).join(" -> "),
    resolved: cycle.join(" -> "),
    // A surviving strict subset of a baselined cycle is a contraction (safe to
    // regenerate), not a new cycle: `cycle-contraction` is what an agent relies
    // on to distinguish drift from blocked growth in the JSON.
    type:
      baseline === null
        ? "cycle-not-in-baseline"
        : cycleCoveredByBaseline(cycle, baseline)
          ? "cycle-contraction"
          : "new-cycle",
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
  // misread as already-baselined. The baseline stores the original specifier,
  // so it is reproduced here instead of a generic marker: an agent can see
  // exactly which edge was removed without re-reading the baseline file.
  const kernelDriftViolations: Violation[] = removedKernelViolations.map((v) => ({
    file: v.file,
    imports: v.imports,
    resolved: v.resolved,
    type: "baseline-drift",
  }));

  const allViolations = [
    ...newKernelViolations,
    ...cycleViolations,
    ...cycleDriftViolations,
    ...kernelDriftViolations,
  ].sort((left, right) => compareByBytes(violationKey(left), violationKey(right)));
  const isClean = allViolations.length === 0;

  let repairHint: string | undefined;
  if (!isClean) {
    // Aligned with --update-baseline: regeneration is unblocked when nothing
    // unabsorbable exists, so the hint never tells an agent "regenerate shrink-only"
    // in a state the update would refuse, nor "fix it first" when a pure
    // contraction would be accepted.
    const driftOnly =
      unabsorbableCycles.length === 0 && newKernelViolations.length === 0;
    if (baseline === null) {
      repairHint =
        "No baseline exists yet; after reviewing the current graph, create it with " +
        "--update-baseline (records the snapshot; all later updates are shrink-only).";
    } else if (driftOnly) {
      repairHint =
        "Only baseline drift was detected (removed cycles or kernel edges), or a baselined cycle contracted. " +
        "Regenerate with --update-baseline after review confirms the removals are intentional; the update " +
        "is shrink-only and refuses new cycles and new kernel violations.";
    } else {
      repairHint =
        "New cycles or kernel violations were detected. Fix them in the backend graph — --update-baseline " +
        "refuses to absorb new violations or growth of baselined cycles.";
    }
  }

  // --update-baseline: persist ONLY shrink-only changes. New cycles (or growth
  // of a baselined cycle) and new kernel violations must never be absorbed.
  if (updateBaseline) {
    const hasBaseline = baseline !== null;
    if (hasBaseline && (unabsorbableCycles.length > 0 || newKernelViolations.length > 0)) {
      const message =
        "Refusing to update baseline: the current graph introduces new cycles (or grows baselined ones) " +
        "or new kernel violations that are not already baselined. The baseline is shrink-only — fix the " +
        "new violations before regenerating; --update-baseline exists only to contract existing entries.";
      if (!silent) console.error(message);
      return {
        violations: allViolations,
        cycles,
        baseline,
        isClean: false,
        scanError: message,
        repairHint: "Fix the new cycles/kernel violations first; --update-baseline is shrink-only.",
      };
    }

    const newBaseline: BaselineData = {
      timestamp: new Date().toISOString(),
      cycles: sortCycles(cycles),
      kernelViolations: kernelViolations
        .map((v) => `${v.file}|${v.imports}|${v.resolved}|${v.type}`)
        .sort((left, right) => compareByBytes(left, right)),
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
      baselineUpdated: true,
    };
  }

  return { violations: allViolations, cycles, baseline, isClean, repairHint };
}

// ============================================================================
// CLI
// ============================================================================

const VALUE_FLAGS = new Set(["--convex-dir", "--package-dir", "--baseline"]);

function usage(): string {
  return [
    "Usage: bun scripts/convex-backend-dependency-check.ts [options]",
    "",
    "Options:",
    "  --update-baseline   Regenerate the baseline from the current graph. Only",
    "                      allowed for shrink-only changes; refuses to absorb new",
    "                      cycles or kernel violations, refuses on an empty scan,",
    "                      and refuses to regenerate a corrupt baseline.",
    "  --json              Emit machine-readable JSON (silences human progress).",
    "  --convex-dir <path> Scan this convex directory instead of the default.",
    "  --package-dir <path> Package root used to compute relative module paths.",
    "  --baseline <path>   Read/write this baseline file instead of the default.",
    "  --help, -h          Show this help.",
    "",
    "Value flags require a value; flags with a missing value or unknown flags",
    "exit with status 2.",
    "",
    "Exit codes:",
    "  0  Clean — no new cycles or kernel violations, or --update-baseline persisted.",
    "  1  Violations, scan errors, or a refused --update-baseline.",
    "  2  CLI misuse (missing value for a value flag, or an unknown flag).",
  ].join("\n");
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(usage());
    process.exit(0);
  }

  const errors: string[] = [];
  let updateBaseline = false;
  let jsonOutput = false;
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--update-baseline") {
      updateBaseline = true;
      continue;
    }
    if (arg === "--json") {
      jsonOutput = true;
      continue;
    }
    if (VALUE_FLAGS.has(arg)) {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("--")) {
        errors.push(`Flag ${arg} requires a value.`);
      } else {
        values.set(arg, value);
        i += 1;
      }
      continue;
    }
    errors.push(`Unknown flag: ${arg}`);
  }
  if (errors.length > 0) {
    console.error(errors.join("\n"));
    console.error(usage());
    process.exit(2);
  }

  const result = runDependencyCheck({
    updateBaseline,
    silent: jsonOutput,
    convexDir: values.get("--convex-dir"),
    packageDir: values.get("--package-dir"),
    baselinePath: values.get("--baseline"),
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
    console.log(`\n${v.type.toUpperCase()}: ${v.file}${v.line !== undefined ? `:${v.line}` : ""}`);
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
    if (result.repairHint) {
      console.log(`\nNext step: ${result.repairHint}`);
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