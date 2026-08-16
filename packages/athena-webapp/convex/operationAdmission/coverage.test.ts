import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

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
