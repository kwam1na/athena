import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const RAIL_CORE_DIR = path.dirname(fileURLToPath(import.meta.url));
const CONVEX_DIR = path.dirname(RAIL_CORE_DIR);

/**
 * Path-prefix ALLOWLIST — not a denylist. Anything the rail core may reach is
 * named here; everything else fails, including a `platform/*` module that is
 * not one of the three catalogs.
 */
const ALLOWED_PREFIXES = [
  "operationAdmission/",
  "_generated/",
] as const;

const ALLOWED_FILES = [
  "platform/capabilityCatalog.ts",
  "platform/readIntentCatalog.ts",
  "platform/storefrontOrigins.ts",
] as const;

/**
 * Empty, and it stays empty. The transitional re-export modules
 * (`publicMutation.ts`, `publicQuery.ts`, `actionAdmission.ts`) were deleted
 * once every call site imported the canonical wrappers from the composition
 * root, so no rail-core file reaches outside the allowlist for any reason.
 */
const TRANSITIONAL_EXEMPTIONS: readonly string[] = [];

const IMPORT_PATTERN = /(?:from|import)\s+["'](\.[^"']+)["']/g;

export function findRailCoreImportViolations(
  files: readonly { path: string; source: string }[],
): string[] {
  const violations: string[] = [];
  for (const file of files) {
    const fileDir = path.dirname(path.join(RAIL_CORE_DIR, file.path));
    for (const match of file.source.matchAll(IMPORT_PATTERN)) {
      const specifier = match[1];
      const resolved = path
        .relative(CONVEX_DIR, path.resolve(fileDir, specifier))
        .split(path.sep)
        .join("/");
      const allowed =
        ALLOWED_PREFIXES.some((prefix) => resolved.startsWith(prefix)) ||
        ALLOWED_FILES.some(
          (allowedFile) =>
            resolved === allowedFile ||
            resolved === allowedFile.replace(/\.ts$/, ""),
        );
      if (!allowed) {
        violations.push(`${file.path} imports ${specifier} (${resolved})`);
      }
    }
  }
  return violations;
}

function collectRailCoreSources(dir = RAIL_CORE_DIR): {
  path: string;
  source: string;
}[] {
  const entries: { path: string; source: string }[] = [];
  for (const name of readdirSync(dir)) {
    const absolute = path.join(dir, name);
    if (statSync(absolute).isDirectory()) {
      entries.push(...collectRailCoreSources(absolute));
      continue;
    }
    if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
    const relative = path
      .relative(RAIL_CORE_DIR, absolute)
      .split(path.sep)
      .join("/");
    if (TRANSITIONAL_EXEMPTIONS.includes(relative)) continue;
    entries.push({ path: relative, source: readFileSync(absolute, "utf8") });
  }
  return entries;
}

describe("rail core import allowlist", () => {
  it("imports only itself, _generated, and the named platform catalogs", () => {
    expect(findRailCoreImportViolations(collectRailCoreSources())).toEqual([]);
  });

  it("fails a fixture that imports the composition root", () => {
    expect(
      findRailCoreImportViolations([
        {
          path: "fixture.ts",
          source: 'import { admitPublicMutation } from "../platform/operationAdmission";',
        },
      ]),
    ).toEqual([
      "fixture.ts imports ../platform/operationAdmission (platform/operationAdmission)",
    ]);
  });

  it("fails a fixture that imports a policy module", () => {
    expect(
      findRailCoreImportViolations([
        {
          path: "fixture.ts",
          source:
            'import { createSharedDemoOperationAdapter } from "../sharedDemo/operationAdapter";\n' +
            'import { captureSharedDemoAdmittedActionWithCtx } from "../contextTracking/sharedDemoActionCapture";',
        },
      ]),
    ).toHaveLength(2);
  });

  it("has no exempt modules left", () => {
    expect([...TRANSITIONAL_EXEMPTIONS]).toEqual([]);
  });
});
