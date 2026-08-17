import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OPERATION_ADMISSION_DEFINITIONS } from "./definitions";
import { OPERATION_READ_ADMISSION_DEFINITIONS } from "./readDefinitions";

/**
 * End-state admission coverage.
 *
 * Successor to the deleted `migrationInventory.ts`: there is no exemption or
 * inventory list any more, so the assertion is simply that the structural
 * checker reports ZERO findings — every exported public mutation, query, and
 * action and every Hono route is declared and wrapped, `FRAMEWORK_ENTRY_POINTS`
 * matches discovery in both directions, no `api.*` self-call exists, and the
 * router's CORS middleware is a fixed allowlist.
 *
 * ---------------------------------------------------------------------------
 * EXPECTED RED DURING PHASE B (plan 2026-08-16-002, units U2-U11).
 *
 * This test is deliberately failing from the moment it lands until U12 closes
 * the migration. It is the closure sensor, not a regression: a Phase B unit's
 * own sensor is `bun scripts/convex-operation-admission-check.ts --path <its
 * prefixes>`. Do NOT weaken, skip, or add an allowlist to this test to make the
 * branch green — that would recreate the exemption concept this delivery
 * deletes.
 * ---------------------------------------------------------------------------
 */
function findRepoRoot(start: string) {
  let current = path.resolve(start);
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(path.join(current, "scripts/convex-operation-admission-check.ts"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(
    "Could not locate the repo root from " +
      start +
      "; expected scripts/convex-operation-admission-check.ts above it.",
  );
}

const REPO_ROOT = findRepoRoot(process.cwd());

const CHECKER_PATH = path.join(
  REPO_ROOT,
  "scripts/convex-operation-admission-check.ts",
);

async function loadChecker() {
  return (await import(/* @vite-ignore */ CHECKER_PATH)) as typeof import(
    "../../../../scripts/convex-operation-admission-check"
  );
}

describe("operation admission coverage", () => {
  it("has no unadmitted backend ingress anywhere under convex/", async () => {
    const { collectOperationAdmissionCheckResult } = await loadChecker();
    const result = await collectOperationAdmissionCheckResult(REPO_ROOT);

    expect(
      result.findings.map(
        (finding) =>
          `${finding.filePath}${finding.line ? `:${finding.line}` : ""} ${finding.id}`,
      ),
    ).toEqual([]);
  }, 120_000);

  it("assigns every ingress-bearing file to exactly one ownership unit", async () => {
    const { collectOperationAdmissionCheckResult } = await loadChecker();
    const result = await collectOperationAdmissionCheckResult(REPO_ROOT);

    expect(result.orphanFiles).toEqual([]);
  }, 120_000);

  it("keeps the generated caller table and downstream-write list current", async () => {
    const { readFile } = await import("node:fs/promises");
    const {
      collectOperationAdmissionCheckResult,
      formatCallerTable,
      formatDownstreamWrites,
    } = await loadChecker();
    const result = await collectOperationAdmissionCheckResult(REPO_ROOT);

    await expect(
      readFile(
        path.join(REPO_ROOT, "docs/plans/2026-08-16-002-backend-caller-table.md"),
        "utf8",
      ),
    ).resolves.toBe(formatCallerTable(result.callerTable));

    await expect(
      readFile(
        path.join(REPO_ROOT, "docs/plans/2026-08-16-002-downstream-writes.md"),
        "utf8",
      ),
    ).resolves.toBe(formatDownstreamWrites(result.downstreamWrites));
  }, 120_000);
});

/**
 * Registry integrity (round 6). The checker proves the object handed to each
 * wrapper IS the registered instance; freezing closes the remaining hole — a
 * later-loaded module mutating the registered instance at import time so the
 * registry array, the handed object, and the runtime policy are all the same
 * now-lax object. `defineOperation` / `defineReadOperation` deep-freeze at
 * construction, so this pins that every registered definition (and every
 * plain object reachable from it) is frozen and that a mutation throws.
 */
describe("operation admission registry is frozen", () => {
  const plainObjectsWithin = (root: unknown) => {
    const found: unknown[] = [];
    const seen = new Set<unknown>();
    const walk = (value: unknown) => {
      if (value === null || typeof value !== "object" || seen.has(value)) return;
      seen.add(value);
      const prototype = Object.getPrototypeOf(value);
      if (
        prototype !== Object.prototype &&
        prototype !== Array.prototype &&
        prototype !== null
      ) {
        return;
      }
      found.push(value);
      for (const key of Object.keys(value as Record<string, unknown>)) {
        walk((value as Record<string, unknown>)[key]);
      }
    };
    walk(root);
    return found;
  };

  it("deep-freezes every write/action/http definition", () => {
    expect(OPERATION_ADMISSION_DEFINITIONS.length).toBeGreaterThan(0);
    const unfrozen = OPERATION_ADMISSION_DEFINITIONS.filter((definition) =>
      plainObjectsWithin(definition).some((value) => !Object.isFrozen(value)),
    ).map((definition) => definition.operationId);
    expect(unfrozen).toEqual([]);
  });

  it("deep-freezes every read definition", () => {
    expect(OPERATION_READ_ADMISSION_DEFINITIONS.length).toBeGreaterThan(0);
    const unfrozen = OPERATION_READ_ADMISSION_DEFINITIONS.filter((definition) =>
      plainObjectsWithin(definition).some((value) => !Object.isFrozen(value)),
    ).map((definition) => definition.operationId);
    expect(unfrozen).toEqual([]);
  });

  it("throws on an import-time style mutation of a registered definition", () => {
    const [definition] = OPERATION_ADMISSION_DEFINITIONS;
    expect(() => {
      (definition as unknown as { actors: { public: string } }).actors.public =
        "admit";
    }).toThrow(TypeError);
    expect(() => {
      (definition as unknown as { capability: string }).capability = "x";
    }).toThrow(TypeError);
  });

  /**
   * Round 7: the registry ARRAYS themselves. The hole the round-6 freeze
   * targets is a module pushing an operation into the registry at import time
   * so the checker's identity comparison treats it as declared; `readonly` on
   * the type is compile-time only, so this pins the runtime `Object.freeze` on
   * both arrays and that every array mutator throws.
   */
  it("freezes both registry arrays so nothing can be pushed in at import time", () => {
    expect(Object.isFrozen(OPERATION_ADMISSION_DEFINITIONS)).toBe(true);
    expect(Object.isFrozen(OPERATION_READ_ADMISSION_DEFINITIONS)).toBe(true);

    const writes = OPERATION_ADMISSION_DEFINITIONS as unknown as unknown[];
    const reads = OPERATION_READ_ADMISSION_DEFINITIONS as unknown as unknown[];
    const writeCount = writes.length;
    const readCount = reads.length;

    expect(() => writes.push(writes[0])).toThrow(TypeError);
    expect(() => reads.push(reads[0])).toThrow(TypeError);
    expect(() => writes.unshift(writes[0])).toThrow(TypeError);
    expect(() => reads.splice(0, 1)).toThrow(TypeError);
    expect(() => {
      writes[writeCount] = writes[0];
    }).toThrow(TypeError);
    expect(() => {
      reads.length = 0;
    }).toThrow(TypeError);

    expect(writes).toHaveLength(writeCount);
    expect(reads).toHaveLength(readCount);
  });
});
