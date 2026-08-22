/**
 * Static import boundaries of the agent harness (plan U2 scenarios 5 and 8).
 *
 * - Kernel modules under `convex/agentHarness/` may not import Daily
 *   Operations or any other product domain; profiles select into the kernel
 *   through contracts only.
 * - Convex Agent / runtime-native imports are permitted ONLY under
 *   `convex/agentHarness/agentRuntime/` (implementation, registration shim,
 *   adapter-specific tests). Root `convex/convex.config.ts` may import only
 *   `convex/*` and that local shim. The directory does not exist until U5;
 *   the checks pass today and enforce the moment it appears.
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
 * Build-time composition roots (U3). They are not kernel modules: they exist
 * so the generator can discover profiles and domain capability packages from
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
 * (`start_push 500`; U5 deviation, see `docs/agent/agent-harness-runtime.md`).
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
  // Port modules obtain `defineAgentReadPortQuery` from the admission composition root (U4).
  "convex/platform/operationAdmission",
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
    // The component must be mounted here directly (U5 deviation; indirect mounts fail to push).
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
