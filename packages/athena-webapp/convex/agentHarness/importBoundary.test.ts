/**
 * Static import boundaries of the agent harness.
 *
 * - Kernel modules under `convex/agentHarness/` may not import Daily
 *   Operations or any other product domain; profiles select into the kernel
 *   through contracts only.
 * - Convex Agent / runtime-native imports are permitted ONLY under
 *   `convex/agentHarness/agentRuntime/` (implementation, registration shim,
 *   adapter-specific tests). Root `convex/convex.config.ts` may import only
 *   `convex/*` and that local shim. The directory need not exist yet; the
 *   checks pass either way and enforce the moment it appears.
 * - Capability, admission, executor, evidence, completion, and presentation
 *   contracts may not name runtime-native identifiers.
 * - `shared/agentHarness/*` stays browser-safe.
 * - The synthetic second profile imports no product domain.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HARNESS_DIR = path.dirname(fileURLToPath(import.meta.url));
const CONVEX_DIR = path.dirname(HARNESS_DIR);
const PACKAGE_DIR = path.dirname(CONVEX_DIR);

type SourceFile = { readonly path: string; readonly source: string };

const IMPORT_PATTERN = /(?:from|import)\s*\(?\s*["']([^"']+)["']\s*\)?/g;

/** This file carries runtime-native strings as fixtures; it is never a scan subject. */
const SELF = "convex/agentHarness/importBoundary.test.ts";

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
      out.push({ specifier, resolved: specifier });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Kernel modules: no product-domain imports
// ---------------------------------------------------------------------------

/** Everything the kernel may reach. Product domains are absent on purpose. */
export const KERNEL_ALLOWED_PREFIXES = [
  "convex/_generated/",
  "convex/agentHarness/",
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
] as const;

/** Kernel files may never reach these, even though some start with an allowed prefix. */
export const KERNEL_DENIED_PREFIXES = [
  "convex/agentHarness/profiles/",
  "convex/agentHarness/evals/",
  "shared/agentHarness/dailyOperationsMatrix.fixture",
] as const;

/** Product-domain roots that must never appear in a kernel import (belt and braces). */
export const PRODUCT_DOMAIN_PREFIXES = [
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
  "src/",
] as const;

/**
 * Build-time composition roots. They are not kernel modules: they exist so
 * the registry generator can discover profiles and domain capability packages from
 * explicit registration points. The Convex runtime reads the generated
 * artifacts instead, so no kernel module may import one.
 */
export const AGENT_COMPOSITION_ROOTS = ["convex/agentHarness/manifestRegistrations.ts"] as const;

export function isCompositionRoot(relative: string): boolean {
  return (AGENT_COMPOSITION_ROOTS as readonly string[]).includes(relative);
}

export function isKernelModule(relative: string): boolean {
  if (!relative.startsWith("convex/agentHarness/")) return false;
  if (relative.startsWith("convex/agentHarness/profiles/")) return false;
  if (isCompositionRoot(relative)) return false;
  if (relative.startsWith("convex/agentHarness/agentRuntime/")) return false;
  if (relative.startsWith("convex/agentHarness/evals/")) return false;
  if (relative.startsWith("convex/agentHarness/_generated/")) return false;
  if (/\.test\.tsx?$/.test(relative)) return false;
  // Test-support modules carry a two-dot basename (`x.testPorts.ts`); the Convex
  // bundler never deploys multi-dot basenames, so they are not kernel modules.
  if (/\.test[A-Z][A-Za-z]*\.tsx?$/.test(relative)) return false;
  return true;
}

export function findKernelImportViolations(files: readonly SourceFile[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    for (const { specifier, resolved } of importsOf(file)) {
      if (!specifier.startsWith(".")) continue; // package imports are checked by the runtime-native rule
      const denied = KERNEL_DENIED_PREFIXES.some((prefix) => resolved.startsWith(prefix));
      const product = PRODUCT_DOMAIN_PREFIXES.some((prefix) => resolved.startsWith(prefix));
      const allowed = KERNEL_ALLOWED_PREFIXES.some((prefix) => resolved.startsWith(prefix));
      if (denied || product || !allowed) {
        violations.push(`${file.path} imports ${specifier} (${resolved})`);
      }
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Leaf modules: helpers every kernel module may call without a cycle
// ---------------------------------------------------------------------------

/**
 * The provisional-narrative helper is called from `lifecycle.ts`,
 * `completionOutbox.ts`, `retention.ts`, and `turns.ts`. The repo has no cycle
 * detector, so the guarantee that none of those imports can loop back is this
 * allowlist: the helper reaches only the generated server/data-model types and
 * `convex/values`, never a sibling kernel module (its TTL is its own literal,
 * not `turnBindings.ts`'s step-staleness window).
 */
export const PROVISIONAL_NARRATIVE_LEAF = "convex/agentHarness/provisionalNarrative.ts";
export const LEAF_ALLOWED_IMPORTS = ["convex/_generated/server", "convex/_generated/dataModel", "convex/values"] as const;

export function findLeafImportViolations(file: SourceFile): string[] {
  const violations: string[] = [];
  for (const { specifier, resolved } of importsOf(file)) {
    const allowed = (LEAF_ALLOWED_IMPORTS as readonly string[]).includes(resolved) || (LEAF_ALLOWED_IMPORTS as readonly string[]).includes(`${resolved}.ts`);
    if (!allowed) violations.push(`${file.path} imports ${specifier} (${resolved})`);
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Runtime-native imports: only inside convex/agentHarness/agentRuntime/
// ---------------------------------------------------------------------------

export const RUNTIME_NATIVE_PACKAGE_PATTERNS = [
  /^@convex-dev\/agent(\/|$)/,
  /^@ai-sdk\//,
  /^ai(\/|$)/,
  /^@convex-dev\/rag(\/|$)/,
] as const;

export const RUNTIME_NATIVE_IDENTIFIERS = [
  "@convex-dev/agent",
  "components.agent",
  "ThreadDoc",
  "MessageDoc",
  "createThread(",
  "saveMessage(",
  "listMessages(",
] as const;

export const AGENT_RUNTIME_DIR = "convex/agentHarness/agentRuntime/";
/** Constants-only module (component mount name); it may not import anything or call `use`. */
export const AGENT_RUNTIME_SHIM = "convex/agentHarness/agentRuntime/convexAgentRegistration";
export const ROOT_CONVEX_CONFIG = "convex/convex.config.ts";
/**
 * The one runtime-native import allowed outside `agentRuntime/`: the component
 * definition, imported and mounted directly by the root config. Mounting it
 * through a local module makes the Convex backend reject the push
 * (`start_push 500`; see `docs/agent/agent-harness-runtime.md`).
 */
export const AGENT_COMPONENT_CONFIG_SPECIFIER = "@convex-dev/agent/convex.config";

export function isRuntimeNativeSpecifier(specifier: string): boolean {
  return RUNTIME_NATIVE_PACKAGE_PATTERNS.some((pattern) => pattern.test(specifier));
}

export function findRuntimeNativeImportViolations(files: readonly SourceFile[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    if (file.path.startsWith(AGENT_RUNTIME_DIR)) continue;
    for (const { specifier } of importsOf(file)) {
      if (file.path === ROOT_CONVEX_CONFIG && specifier === AGENT_COMPONENT_CONFIG_SPECIFIER) continue;
      if (isRuntimeNativeSpecifier(specifier)) {
        violations.push(`${file.path} imports runtime-native ${specifier}`);
      }
    }
  }
  return violations;
}

export function findRootConvexConfigViolations(file: SourceFile): string[] {
  const violations: string[] = [];
  for (const { specifier, resolved } of importsOf(file)) {
    const local = specifier.startsWith(".");
    const allowed = local
      ? resolved === AGENT_RUNTIME_SHIM || resolved === `${AGENT_RUNTIME_SHIM}.ts`
      : specifier === "convex/server" || specifier === "convex/values" || specifier === AGENT_COMPONENT_CONFIG_SPECIFIER;
    if (!allowed) violations.push(`${file.path} imports ${specifier}`);
  }
  return violations;
}

/** The registration shim is constants only: no imports, no `use`, no `defineApp`. */
export function findRegistrationShimViolations(file: SourceFile): string[] {
  const violations: string[] = [];
  for (const { specifier } of importsOf(file)) violations.push(`${file.path} imports ${specifier}`);
  const code = file.source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  if (/\.use\s*\(/.test(code) || /defineApp\s*\(/.test(code)) violations.push(`${file.path} mounts a component`);
  return violations;
}

/** Components are mounted only by the root config: nothing else imports a component definition or defines an app. */
export function findIndirectComponentMountViolations(files: readonly SourceFile[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    if (file.path === ROOT_CONVEX_CONFIG) continue;
    for (const { specifier } of importsOf(file)) {
      if (/\/convex\.config(\.js)?$/.test(specifier)) violations.push(`${file.path} imports component definition ${specifier}`);
    }
    const code = file.source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    if (/\bdefineApp\s*\(/.test(code)) violations.push(`${file.path} defines an app`);
  }
  return violations;
}

export function findRuntimeNativeIdentifierViolations(files: readonly SourceFile[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    if (file.path.startsWith(AGENT_RUNTIME_DIR)) continue;
    // Strip comments so prose explaining the boundary does not trip it.
    const code = file.source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const identifier of RUNTIME_NATIVE_IDENTIFIERS) {
      if (code.includes(identifier)) violations.push(`${file.path} names runtime-native ${identifier}`);
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Browser-safe shared contracts and profile isolation
// ---------------------------------------------------------------------------

export const SHARED_FORBIDDEN_SPECIFIERS = [/^convex\/server$/, /^node:/, /^fs$/, /^path$/];

export function findSharedContractViolations(files: readonly SourceFile[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    for (const { specifier, resolved } of importsOf(file)) {
      const reachesConvex = specifier.startsWith(".") && resolved.startsWith("convex/");
      const forbidden = SHARED_FORBIDDEN_SPECIFIERS.some((pattern) => pattern.test(specifier));
      if (reachesConvex || forbidden || isRuntimeNativeSpecifier(specifier)) {
        violations.push(`${file.path} imports ${specifier}`);
      }
    }
  }
  return violations;
}

/** Profiles may reach product domains only through their published agent capability modules. */
export const PROFILE_ALLOWED_PREFIXES = [
  "shared/agentHarness/",
  "convex/agentHarness/registry",
  "convex/agentHarness/conformance",
  "convex/agentHarness/manifestRegistrations",
  "convex/agentHarness/profiles/",
  "convex/platform/readIntentCatalog",
  // Port modules obtain `defineAgentReadPortQuery` from the admission composition root.
  "convex/platform/operationAdmission",
  // Declaration-side manifest constants shared by domain packages.
  "convex/lib/agentCapabilityManifests",
  // Environment-neutral runtime-adapter identity. The build-time composition
  // root pins the published compatibility identity to the selected adapter;
  // the constants module names it without loading the Node adapter or any
  // runtime-native package (asserted separately by the shim rules below).
  "convex/agentHarness/agentRuntime/convexAgentKind",
] as const;

export function findProfileImportViolations(
  files: readonly SourceFile[],
  options: { readonly allowProductCapabilityModules: boolean },
): string[] {
  const violations: string[] = [];
  for (const file of files) {
    for (const { specifier, resolved } of importsOf(file)) {
      if (!specifier.startsWith(".")) continue;
      const allowed = PROFILE_ALLOWED_PREFIXES.some((prefix) => resolved.startsWith(prefix));
      const capabilityModule = options.allowProductCapabilityModules && /^convex\/[a-zA-Z]+\/agentCapabilities\//.test(resolved);
      if (!allowed && !capabilityModule) violations.push(`${file.path} imports ${specifier} (${resolved})`);
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const fixture = (relativePath: string, source: string): SourceFile => ({ path: relativePath, source });

describe("agent harness import boundaries", () => {
  const kernelFiles = collectSources(HARNESS_DIR, isKernelModule);

  it("scans the kernel modules that exist today", () => {
    const names = kernelFiles.map((file) => file.path);
    expect(names).toContain("convex/agentHarness/lifecycle.ts");
    expect(names).toContain("convex/agentHarness/registry.ts");
    expect(names.some((name) => name.startsWith("convex/agentHarness/profiles/"))).toBe(false);
  });

  it("kernel modules import no Daily Operations or other product domain", () => {
    expect(findKernelImportViolations(kernelFiles)).toEqual([]);
  });

  it("rejects kernel fixtures that reach Daily Operations, a profile, or the matrix fixture", () => {
    expect(
      findKernelImportViolations([
        fixture(
          "convex/agentHarness/executor.ts",
          'import { buildDailyOperationsSnapshotWithCtx } from "../operations/dailyOperations";',
        ),
      ]),
    ).toEqual(["convex/agentHarness/executor.ts imports ../operations/dailyOperations (convex/operations/dailyOperations)"]);
    expect(
      findKernelImportViolations([
        fixture("convex/agentHarness/registry.ts", 'import { DAILY } from "./profiles/dailyOperations";'),
        fixture("convex/agentHarness/grants.ts", 'import { FIXTURE } from "../../shared/agentHarness/dailyOperationsMatrix.fixture";'),
        fixture("convex/agentHarness/bridge.ts", 'import { resolveOperatingDay } from "../storeTime/operatingPeriods";'),
      ]),
    ).toHaveLength(3);
    expect(
      findKernelImportViolations([
        fixture("convex/agentHarness/grants.ts", 'import { isAthenaReadIntent } from "../platform/readIntentCatalog";\nimport { denial } from "../../shared/agentHarness/execution";'),
      ]),
    ).toEqual([]);
  });

  it("keeps the provisional-narrative helper a leaf: generated types and convex/values only, no sibling", () => {
    const leaf = collectSources(HARNESS_DIR, (relative) => relative === PROVISIONAL_NARRATIVE_LEAF);
    expect(leaf).toHaveLength(1);
    expect(findLeafImportViolations(leaf[0])).toEqual([]);
    expect(leaf[0].source).toMatch(/export const AGENT_PROVISIONAL_NARRATIVE_TTL_MS = 5 \* 60 \* 1000;/);
    expect(
      findLeafImportViolations(
        fixture(PROVISIONAL_NARRATIVE_LEAF, 'import { AGENT_TURN_STEP_STALE_AFTER_MS } from "./turnBindings";\nimport { retentionExpiresAt } from "../../shared/agentHarness/execution";'),
      ),
    ).toEqual([
      `${PROVISIONAL_NARRATIVE_LEAF} imports ./turnBindings (convex/agentHarness/turnBindings)`,
      `${PROVISIONAL_NARRATIVE_LEAF} imports ../../shared/agentHarness/execution (shared/agentHarness/execution)`,
    ]);
    expect(findLeafImportViolations(fixture(PROVISIONAL_NARRATIVE_LEAF, 'import type { Doc } from "../_generated/dataModel";\nimport { v } from "convex/values";'))).toEqual([]);
    // Every caller that must reach it does so directly, so a cycle through the helper is impossible.
    for (const caller of ["convex/agentHarness/lifecycle.ts", "convex/agentHarness/completionOutbox.ts", "convex/agentHarness/retention.ts", "convex/agentHarness/turns.ts"]) {
      const file = kernelFiles.find((candidate) => candidate.path === caller);
      expect(file, caller).toBeDefined();
      expect(importsOf(file!).some(({ resolved }) => resolved === "convex/agentHarness/provisionalNarrative"), caller).toBe(true);
    }
  });

  it("permits runtime-native imports only inside convex/agentHarness/agentRuntime/", () => {
    const everything = [
      ...collectSources(CONVEX_DIR),
      ...collectSources(path.join(PACKAGE_DIR, "shared")),
      ...collectSources(path.join(PACKAGE_DIR, "src")),
    ];
    expect(everything.length).toBeGreaterThan(100);
    expect(findRuntimeNativeImportViolations(everything)).toEqual([]);
    expect(
      findRuntimeNativeImportViolations([
        fixture("convex/agentHarness/runtimeHost.ts", 'import { Agent } from "@convex-dev/agent";'),
        fixture("convex/agentHarness/tools.ts", 'import { tool } from "ai";'),
        fixture("src/components/agent/AthenaAgentPanel.tsx", 'import { useThreadMessages } from "@convex-dev/agent/react";'),
      ]),
    ).toHaveLength(3);
    expect(
      findRuntimeNativeImportViolations([
        fixture("convex/agentHarness/agentRuntime/convexAgent.ts", 'import { Agent } from "@convex-dev/agent";'),
        fixture("convex/agentHarness/agentRuntime/convexAgent.contract.test.ts", 'import { components } from "../../_generated/api";\nimport { Agent } from "@convex-dev/agent";'),
        fixture(ROOT_CONVEX_CONFIG, 'import agent from "@convex-dev/agent/convex.config";\nimport { defineApp } from "convex/server";'),
      ]),
    ).toEqual([]);
    expect(findRuntimeNativeImportViolations([fixture(ROOT_CONVEX_CONFIG, 'import { Agent } from "@convex-dev/agent";')])).toHaveLength(1);
  });

  it("root convex.config.ts imports only convex/*, the component definition, and the constants-only shim", () => {
    const root = collectSources(CONVEX_DIR, (relative) => relative === ROOT_CONVEX_CONFIG);
    expect(root).toHaveLength(1);
    expect(findRootConvexConfigViolations(root[0])).toEqual([]);
    // The component must be mounted here directly (indirect mounts fail to push).
    expect(root[0].source).toMatch(/import agent from "@convex-dev\/agent\/convex\.config";/);
    expect(root[0].source).toMatch(/app\.use\(agent, \{ name: CONVEX_AGENT_COMPONENT_NAME \}\)/);
    expect(
      findRootConvexConfigViolations(
        fixture(ROOT_CONVEX_CONFIG, 'import agent from "@convex-dev/agent/convex.config";\nimport { defineApp } from "convex/server";'),
      ),
    ).toEqual([]);
    expect(findRootConvexConfigViolations(fixture(ROOT_CONVEX_CONFIG, 'import { Agent } from "@convex-dev/agent";'))).toEqual([
      "convex/convex.config.ts imports @convex-dev/agent",
    ]);
    expect(
      findRootConvexConfigViolations(
        fixture(ROOT_CONVEX_CONFIG, 'import { defineApp } from "convex/server";\nimport { CONVEX_AGENT_COMPONENT_NAME } from "./agentHarness/agentRuntime/convexAgentRegistration";'),
      ),
    ).toEqual([]);
    expect(
      findRootConvexConfigViolations(fixture(ROOT_CONVEX_CONFIG, 'import { registerConvexAgent } from "./agentHarness/agentRuntime/convexAgent";')),
    ).toHaveLength(1);
  });

  it("mounts components only in root convex.config.ts; the registration shim is constants only", () => {
    const shim = collectSources(HARNESS_DIR, (relative) => relative === `${AGENT_RUNTIME_SHIM}.ts`);
    expect(shim).toHaveLength(1);
    expect(findRegistrationShimViolations(shim[0])).toEqual([]);
    expect(shim[0].source).toMatch(/export const CONVEX_AGENT_COMPONENT_NAME = "agent" as const;/);
    expect(
      findRegistrationShimViolations(
        fixture(`${AGENT_RUNTIME_SHIM}.ts`, 'import agent from "@convex-dev/agent/convex.config";\nexport function registerConvexAgent(app) { app.use(agent); }'),
      ),
    ).toHaveLength(2);
    const everything = [...collectSources(CONVEX_DIR), ...collectSources(path.join(PACKAGE_DIR, "shared")), ...collectSources(path.join(PACKAGE_DIR, "src"))];
    expect(findIndirectComponentMountViolations(everything)).toEqual([]);
    expect(
      findIndirectComponentMountViolations([
        fixture("convex/agentHarness/agentRuntime/convexAgentRegistration.ts", 'import agent from "@convex-dev/agent/convex.config";'),
        fixture("convex/agentHarness/apps.ts", 'import { defineApp } from "convex/server";\nconst app = defineApp();'),
      ]),
    ).toHaveLength(2);
  });

  it("capability, admission, executor, evidence, completion, and presentation contracts name no runtime-native identifiers", () => {
    const contractFiles = [
      ...collectSources(path.join(PACKAGE_DIR, "shared", "agentHarness")),
      ...collectSources(HARNESS_DIR, (relative) => !relative.startsWith(AGENT_RUNTIME_DIR)),
      ...collectSources(path.join(CONVEX_DIR, "operationAdmission")),
      ...collectSources(path.join(PACKAGE_DIR, "src", "components", "agent")),
    ];
    expect(contractFiles.map((file) => file.path)).toContain("shared/agentHarness/agentRuntime.ts");
    expect(findRuntimeNativeIdentifierViolations(contractFiles)).toEqual([]);
    expect(
      findRuntimeNativeIdentifierViolations([
        fixture("shared/agentHarness/agentRuntime.ts", "export type Turn = { thread: ThreadDoc };"),
        fixture("convex/agentHarness/completion.ts", "const messages = await components.agent.messages.list();"),
      ]),
    ).toHaveLength(2);
    expect(
      findRuntimeNativeIdentifierViolations([
        fixture("convex/agentHarness/agentRuntime/convexAgent.ts", "const thread: ThreadDoc = await components.agent.threads.get();"),
      ]),
    ).toEqual([]);
  });

  it("shared agent-harness contracts stay browser-safe", () => {
    const shared = collectSources(path.join(PACKAGE_DIR, "shared", "agentHarness"));
    expect(shared.length).toBeGreaterThan(8);
    expect(findSharedContractViolations(shared)).toEqual([]);
    expect(
      findSharedContractViolations([
        fixture("shared/agentHarness/bridge.ts", 'import { internalQuery } from "../../convex/_generated/server";'),
        fixture("shared/agentHarness/profile.ts", 'import { readFileSync } from "node:fs";'),
        fixture("shared/agentHarness/agentRuntime.ts", 'import type { ThreadDoc } from "@convex-dev/agent";'),
      ]),
    ).toHaveLength(3);
  });

  it("the synthetic second profile imports no product domain and the kernel does not import it", () => {
    const synthetic = collectSources(
      path.join(HARNESS_DIR, "profiles"),
      (relative) => relative === "convex/agentHarness/profiles/syntheticSecondSurface.ts",
    );
    expect(synthetic).toHaveLength(1);
    expect(findProfileImportViolations(synthetic, { allowProductCapabilityModules: false })).toEqual([]);
    expect(synthetic[0].source).not.toMatch(/dailyOperations|DailyOperations/);
    expect(
      findProfileImportViolations(
        [fixture("convex/agentHarness/profiles/syntheticSecondSurface.ts", 'import { x } from "../../operations/dailyOperations";')],
        { allowProductCapabilityModules: false },
      ),
    ).toHaveLength(1);
    expect(
      findProfileImportViolations(
        [fixture("convex/agentHarness/profiles/dailyOperations.ts", 'import { STORE_DAY } from "../../operations/agentCapabilities/storeDay";')],
        { allowProductCapabilityModules: true },
      ),
    ).toEqual([]);
    for (const file of kernelFiles) {
      expect(file.source, file.path).not.toMatch(/profiles\/syntheticSecondSurface|profiles\/dailyOperations/);
    }
  });

  /**
   * Daily Operations — the first real product package. Three invariants on
   * top of the general rules above: the kernel never imports a capability
   * module or a Daily Operations profile; the profile modules reach product
   * domains only through published capability modules; and the DECLARATION half
   * of each package (manifests, extractors, port index) imports no composition
   * root, which is what lets `convex/platform/operationAdmission.ts` build the
   * evidence-extractor index without an import cycle.
   */
  describe("daily operations package", () => {
    const CAPABILITY_MODULE = /^convex\/[a-zA-Z]+\/agentCapabilities\//;
    const DECLARATION_MODULES = [
      "convex/automation/agentCapabilities/evidence.ts",
      "convex/cashControls/agentCapabilities/registers.ts",
      "convex/operations/agentCapabilities/activity.ts",
      "convex/operations/agentCapabilities/storeDay.ts",
      "convex/operations/agentCapabilities/work.ts",
      "convex/reports/agentCapabilities/sales.ts",
      "convex/stockOps/agentCapabilities/inventory.ts",
    ];
    /** Modules outside the domains themselves that may reach a capability module. */
    const CAPABILITY_CONSUMERS = [
      "convex/agentHarness/evals/dailyOperations.smokeHarness.ts",
      // The release smoke's direct harness wraps the same domain handlers in
      // its own admission so the contracts can be exercised before the
      // operator switch is flipped.
      "convex/agentHarness/evals/directHarness.ts",
      "convex/agentHarness/profiles/dailyOperations.ts",
      "convex/agentHarness/profiles/dailyOperationsConformance.ts",
      "convex/platform/operationAdmission.ts",
    ];

    it("keeps every Daily Operations import out of the kernel", () => {
      expect(findKernelImportViolations(kernelFiles)).toEqual([]);
      for (const file of kernelFiles) {
        expect(file.source, file.path).not.toMatch(/agentCapabilities\//);
        expect(file.source, file.path).not.toMatch(/profiles\/dailyOperations/);
      }
      expect(
        findKernelImportViolations([
          fixture(
            "convex/agentHarness/executor.ts",
            'import { STORE_DAY_MANIFEST } from "../operations/agentCapabilities/storeDay";',
          ),
        ]),
      ).toHaveLength(1);
    });

    it("lets the profile modules reach product domains only through capability modules", () => {
      const profileModules = collectSources(
        path.join(HARNESS_DIR, "profiles"),
        (relative) =>
          relative.startsWith("convex/agentHarness/profiles/dailyOperations") && !relative.endsWith(".test.ts"),
      );
      expect(profileModules.map((file) => file.path).sort()).toEqual([
        "convex/agentHarness/profiles/dailyOperations.ts",
        "convex/agentHarness/profiles/dailyOperationsConformance.ts",
        "convex/agentHarness/profiles/dailyOperationsUiCoverage.ts",
      ]);
      expect(findProfileImportViolations(profileModules, { allowProductCapabilityModules: true })).toEqual([]);
      expect(
        findProfileImportViolations(
          [
            fixture(
              "convex/agentHarness/profiles/dailyOperations.ts",
              'import { buildDailyOperationsSnapshotWithCtx } from "../../operations/dailyOperations";',
            ),
          ],
          { allowProductCapabilityModules: true },
        ),
      ).toHaveLength(1);
    });

    it("keeps the declaration half free of the composition root, so the extractor index cannot cycle", () => {
      const declarations = collectSources(CONVEX_DIR, (relative) => DECLARATION_MODULES.includes(relative));
      expect(declarations.map((file) => file.path).sort()).toEqual([...DECLARATION_MODULES].sort());
      for (const file of declarations) {
        for (const { specifier, resolved } of importsOf(file)) {
          if (!specifier.startsWith(".")) continue;
          expect(resolved, `${file.path} imports ${resolved}`).not.toMatch(/^convex\/platform\/operationAdmission/);
          expect(
            resolved.startsWith("shared/agentHarness/") ||
              resolved.startsWith("convex/lib/agentCapabilityManifests") ||
              resolved.startsWith("convex/agentHarness/conformance"),
            `${file.path} imports ${resolved}`,
          ).toBe(true);
        }
      }
    });

    it("names every module outside the domains that reaches a capability module", () => {
      const everything = [
        ...collectSources(CONVEX_DIR),
        ...collectSources(path.join(PACKAGE_DIR, "shared")),
        ...collectSources(path.join(PACKAGE_DIR, "src")),
      ];
      const consumers = everything
        .filter((file) => !CAPABILITY_MODULE.test(file.path) && !/\.test\.tsx?$/.test(file.path))
        .filter((file) =>
          importsOf(file).some(({ specifier, resolved }) => specifier.startsWith(".") && CAPABILITY_MODULE.test(resolved)),
        )
        .map((file) => file.path)
        .sort();
      expect(consumers).toEqual([...CAPABILITY_CONSUMERS].sort());
    });
  });

  it("keeps the build-time composition root out of every kernel module", () => {
    const roots = collectSources(HARNESS_DIR, isCompositionRoot);
    expect(roots.map((file) => file.path)).toEqual([...AGENT_COMPOSITION_ROOTS]);
    // The composition root is exactly where profile imports are allowed ...
    expect(findProfileImportViolations(roots, { allowProductCapabilityModules: true })).toEqual([]);
    expect(roots[0].source).toMatch(/profiles\/syntheticSecondSurface/);
    // ... and no kernel module may reach it, so the runtime keeps reading the
    // generated artifacts rather than the profiles themselves.
    for (const file of kernelFiles) {
      expect(file.source, file.path).not.toMatch(/manifestRegistrations/);
    }
  });
});
