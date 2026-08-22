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

export function isKernelModule(relative: string): boolean {
  if (!relative.startsWith("convex/agentHarness/")) return false;
  if (relative.startsWith("convex/agentHarness/profiles/")) return false;
  if (relative.startsWith("convex/agentHarness/agentRuntime/")) return false;
  if (relative.startsWith("convex/agentHarness/evals/")) return false;
  if (relative.startsWith("convex/agentHarness/_generated/")) return false;
  if (/\.test\.tsx?$/.test(relative)) return false;
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
export const AGENT_RUNTIME_SHIM = "convex/agentHarness/agentRuntime/convexAgent.config";

export function isRuntimeNativeSpecifier(specifier: string): boolean {
  return RUNTIME_NATIVE_PACKAGE_PATTERNS.some((pattern) => pattern.test(specifier));
}

export function findRuntimeNativeImportViolations(files: readonly SourceFile[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    if (file.path.startsWith(AGENT_RUNTIME_DIR)) continue;
    for (const { specifier } of importsOf(file)) {
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
      : specifier === "convex/server" || specifier === "convex/values";
    if (!allowed) violations.push(`${file.path} imports ${specifier}`);
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
  "convex/platform/readIntentCatalog",
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
        fixture("convex/agentHarness/agentRuntime/convexAgent.config.ts", 'import agent from "@convex-dev/agent/convex.config";'),
        fixture("convex/agentHarness/agentRuntime/convexAgent.contract.test.ts", 'import { components } from "../../_generated/api";\nimport { Agent } from "@convex-dev/agent";'),
      ]),
    ).toEqual([]);
  });

  it("root convex.config.ts imports only convex/* and the local registration shim", () => {
    const root = collectSources(CONVEX_DIR, (relative) => relative === "convex/convex.config.ts");
    expect(root).toHaveLength(1);
    expect(findRootConvexConfigViolations(root[0])).toEqual([]);
    expect(
      findRootConvexConfigViolations(
        fixture("convex/convex.config.ts", 'import agent from "@convex-dev/agent/convex.config";\nimport { defineApp } from "convex/server";'),
      ),
    ).toEqual(["convex/convex.config.ts imports @convex-dev/agent/convex.config"]);
    expect(
      findRootConvexConfigViolations(
        fixture(
          "convex/convex.config.ts",
          'import { defineApp } from "convex/server";\nimport { registerConvexAgent } from "./agentHarness/agentRuntime/convexAgent.config";',
        ),
      ),
    ).toEqual([]);
    expect(
      findRootConvexConfigViolations(
        fixture("convex/convex.config.ts", 'import { registerConvexAgent } from "./agentHarness/agentRuntime/convexAgent";'),
      ),
    ).toHaveLength(1);
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
});
