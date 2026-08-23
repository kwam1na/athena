/**
 * Static import boundaries of the reusable agent host.
 *
 * The host is product-neutral: it consumes Athena's turn contract and the
 * browser-safe agent contracts, and nothing else. It may not import a product
 * surface (Daily Operations included), a Convex server module, or anything
 * runtime-native — a profile reaches the host through the presentation adapter,
 * never the other way around.
 *
 * The checkers are exercised against fixtures as well as the real tree, so a
 * green result cannot mean "the scan found nothing to look at".
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HOST_DIR = path.dirname(fileURLToPath(import.meta.url));
const COMPONENTS_DIR = path.dirname(HOST_DIR);
const SRC_DIR = path.dirname(COMPONENTS_DIR);
const PACKAGE_DIR = path.dirname(SRC_DIR);

type SourceFile = { readonly path: string; readonly source: string };

const IMPORT_PATTERN = /(?:from|import)\s*\(?\s*["']([^"']+)["']\s*\)?/g;

/** This file quotes forbidden specifiers as fixtures; it never scans itself. */
const SELF = "src/components/agent/importBoundary.test.ts";

function collectSources(dir: string): SourceFile[] {
  const files: SourceFile[] = [];
  for (const name of readdirSync(dir)) {
    const absolute = path.join(dir, name);
    if (statSync(absolute).isDirectory()) {
      files.push(...collectSources(absolute));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(name)) continue;
    const relative = path.relative(PACKAGE_DIR, absolute).split(path.sep).join("/");
    if (relative === SELF) continue;
    files.push({ path: relative, source: readFileSync(absolute, "utf8") });
  }
  return files;
}

function importsOf(file: SourceFile): string[] {
  return Array.from(file.source.matchAll(IMPORT_PATTERN), (match) => match[1] as string);
}

/** Everything the host may reach. Product surfaces are absent on purpose. */
export const HOST_ALLOWED_SPECIFIER_PATTERNS = [
  /^react$/,
  /^react\//,
  /^convex\/react$/,
  /^lucide-react$/,
  /^vitest$/,
  /^@testing-library\//,
  /^@\/lib\//,
  /^@\/hooks\//,
  /^~\/shared\/agentHarness\//,
  /^~\/shared\/commandResult$/,
  /^~\/convex\/_generated\//,
  /^\.\.\/ui\//,
  /^\.\//,
  /^node:/,
] as const;

export const PRODUCT_SURFACE_PATTERNS = [
  /dailyoperations/i,
  /\/operations\//i,
  /agentCapabilities/i,
  /agentHarness\/profiles/i,
] as const;

/**
 * Runtime-native names are assembled rather than written out: the kernel's own
 * boundary test scans this directory for those literals, and a scanner that
 * trips on its own rule book is a false alarm.
 */
const AGENT_COMPONENT_PACKAGE = ["@convex-dev", "agent"].join("/");
const RAG_COMPONENT_PACKAGE = ["@convex-dev", "rag"].join("/");

export const RUNTIME_NATIVE_PATTERNS = [
  new RegExp(`^${AGENT_COMPONENT_PACKAGE}(/|$)`),
  /^@ai-sdk\//,
  /^ai(\/|$)/,
  new RegExp(`^${RAG_COMPONENT_PACKAGE}(/|$)`),
] as const;

export const RUNTIME_NATIVE_IDENTIFIERS = [
  AGENT_COMPONENT_PACKAGE,
  ["components", "agent"].join("."),
  ["Thread", "Doc"].join(""),
  ["Message", "Doc"].join(""),
  ["create", "Thread("].join(""),
  ["save", "Message("].join(""),
  ["list", "Messages("].join(""),
] as const;

export function findDisallowedImports(files: readonly SourceFile[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    for (const specifier of importsOf(file)) {
      if (
        !HOST_ALLOWED_SPECIFIER_PATTERNS.some((pattern) => pattern.test(specifier))
      ) {
        violations.push(`${file.path} imports ${specifier}`);
      }
    }
  }
  return violations;
}

export function findProductSurfaceImports(files: readonly SourceFile[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    for (const specifier of importsOf(file)) {
      if (PRODUCT_SURFACE_PATTERNS.some((pattern) => pattern.test(specifier))) {
        violations.push(`${file.path} imports product surface ${specifier}`);
      }
    }
  }
  return violations;
}

export function findRuntimeNativeViolations(files: readonly SourceFile[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    for (const specifier of importsOf(file)) {
      if (RUNTIME_NATIVE_PATTERNS.some((pattern) => pattern.test(specifier))) {
        violations.push(`${file.path} imports runtime-native ${specifier}`);
      }
    }
    // Strip comments so prose about the boundary does not trip it.
    const code = file.source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    for (const identifier of RUNTIME_NATIVE_IDENTIFIERS) {
      if (code.includes(identifier)) {
        violations.push(`${file.path} names runtime-native ${identifier}`);
      }
    }
  }
  return violations;
}

const hostFiles = collectSources(HOST_DIR);

describe("agent host import boundary", () => {
  it("scans every host module", () => {
    expect(hostFiles.map((file) => file.path).sort()).toEqual([
      "src/components/agent/AthenaAgentPanel.test.tsx",
      "src/components/agent/AthenaAgentPanel.tsx",
      "src/components/agent/AthenaAgentPresentationAdapter.test.ts",
      "src/components/agent/AthenaAgentPresentationAdapter.ts",
      "src/components/agent/AthenaAgentSafeText.test.tsx",
      "src/components/agent/AthenaAgentSafeText.tsx",
      "src/components/agent/streamReveal.test.ts",
      "src/components/agent/streamReveal.ts",
      "src/components/agent/useAthenaAgentRun.test.tsx",
      "src/components/agent/useAthenaAgentRun.ts",
    ]);
  });

  it("imports no product surface", () => {
    expect(findProductSurfaceImports(hostFiles)).toEqual([]);
  });

  it("imports nothing outside the host's allowlist", () => {
    expect(findDisallowedImports(hostFiles)).toEqual([]);
  });

  it("never reaches a Convex server module", () => {
    const serverImports = hostFiles.flatMap((file) =>
      importsOf(file).filter(
        (specifier) =>
          /(^|\/)convex\//.test(specifier) &&
          specifier !== "convex/react" &&
          !specifier.startsWith("~/convex/_generated/"),
      ),
    );

    expect(serverImports).toEqual([]);
  });

  it("names nothing runtime-native", () => {
    expect(findRuntimeNativeViolations(hostFiles)).toEqual([]);
  });

  it("catches a product-surface import, a server import, and a runtime-native one", () => {
    const profileSpecifier = ["~/convex/agentHarness/profiles", "dailyOperations"].join("/");
    const componentsAgent = ["components", "agent"].join(".");
    const fixtures: SourceFile[] = [
      {
        path: "src/components/agent/Bad.tsx",
        source: [
          `import { PROFILE } from "${profileSpecifier}";`,
          `import { Agent } from "${AGENT_COMPONENT_PACKAGE}";`,
          'import { components } from "~/convex/_generated/api";',
          `const runtimeThread = ${componentsAgent};`,
        ].join("\n"),
      },
    ];

    expect(findProductSurfaceImports(fixtures)).toEqual([
      `src/components/agent/Bad.tsx imports product surface ${profileSpecifier}`,
    ]);
    expect(findRuntimeNativeViolations(fixtures)).toEqual([
      `src/components/agent/Bad.tsx imports runtime-native ${AGENT_COMPONENT_PACKAGE}`,
      `src/components/agent/Bad.tsx names runtime-native ${AGENT_COMPONENT_PACKAGE}`,
      `src/components/agent/Bad.tsx names runtime-native ${componentsAgent}`,
    ]);
    expect(findDisallowedImports(fixtures)).toContain(
      `src/components/agent/Bad.tsx imports ${profileSpecifier}`,
    );
  });
});

describe("the mount depends on the host, not the other way round", () => {
  it("keeps Daily Operations out of the host's vocabulary", () => {
    for (const file of hostFiles) {
      if (file.path.endsWith(".test.ts") || file.path.endsWith(".test.tsx")) continue;
      expect(file.source).not.toMatch(/daily[_ ]?operations/i);
    }
  });

  it("mounts the host from the Daily Operations surface", () => {
    const mount = readFileSync(
      path.join(SRC_DIR, "components/operations/DailyOperationsView.tsx"),
      "utf8",
    );

    expect(mount).toMatch(/from "@\/components\/agent\/AthenaAgentPanel"/);
  });
});
