---
title: "Shrink-Only Backend Dependency Guard for Athena Convex Kernels"
module: "athena-webapp"
date: "2026-08-27"
problem_type: "architecture_pattern"
category: "architecture-patterns"
component: "tooling"
resolution_type: "tooling_addition"
severity: "medium"
applies_when:
  - "Adding a structural guardrail to prevent new backend dependency cycles"
  - "Protecting stable kernel modules (inventoryLedger, agentHarness) from product-domain imports"
  - "Establishing a shrink-only baseline for dependency cycles that must contract over time"
tags:
  - "dependency-guard"
  - "architecture-boundary"
  - "convex-backend"
  - "shrink-only-baseline"
  - "kernel-protection"
related_components:
  - "inventoryLedger"
  - "agentHarness"
  - "operationAdmission"
delivery_diff_fingerprint: "c6ec1b71bdba08cc71abcb9267e7173d4eb9027bdb6532e949daa9538897ff6b"
---

## Problem

Athena's Convex backend has grown to ~245K lines across 199 tables and 617 admitted operations. Over time, implicit dependency cycles formed between modules, making changes risky and harder to reason about. The inventoryLedger and agentHarness kernels — which encode core business invariants (inventory valuation, agent lifecycle) — were importing product domains (operations, reports, cashControls, storeTime, etc.), creating unwanted coupling.

We needed a structural guardrail that:
1. Snapshots current dependency cycles as a baseline
2. Fails only on **new** violations (shrink-only)
3. Protects kernel modules (and every helper inside them) from importing product domains
4. Is deterministic, harness-owned, and produces exact, actionable edges
5. Never passes on an empty scan or silently absorbs a new violation

## Solution

Created `scripts/convex-backend-dependency-check.ts`, a characterization-first guard that scans the Convex source tree, builds a real import graph, and compares it against a committed baseline.

### 1. Real graph building (not pattern matching)

- Imports are extracted comment/string-aware: a commented-out import or prose that quotes an import never produces a finding (`collectNonCodeRanges` + `extractImportSpecifiers`).
- Relative specifiers are resolved to the concrete file the runtime would load — `./x` → `x.ts` / `x.tsx` / `index.ts` / `index.tsx` (`resolveLocalImportTarget`). Graph nodes always carry their real extension, so cycle and edge identities match what actually executes.
- Only modules under `convex/` participate in the graph; external/bare package imports never form edges.

### 2. Protected Kernel Definitions

```typescript
export const PROTECTED_KERNELS = {
  inventoryLedger: {
    root: "convex/inventoryLedger",
    allowedImports: [
      "convex/_generated/", "convex/values", "convex/server",
      "convex/schemas/inventoryLedger", "convex/inventoryLedger/",
    ],
    forbiddenImports: [ /* every product domain prefix */ ],
  },
  agentHarness: {
    root: "convex/agentHarness",
    allowedImports: [
      "convex/_generated/", "convex/values", "convex/server",
      "convex/schemas/agentHarness", "convex/schemas/intelligence",
      "convex/intelligence/", "convex/operationAdmission/",
      "convex/platform/operationAdmission", "convex/platform/readIntentCatalog",
      "convex/platform/capabilityCatalog", "convex/lib/",
      "shared/agentHarness/", "shared/intelligence/", "convex/agentHarness/",
    ],
    forbiddenImports: [ /* every product domain prefix */ ],
    excludedPaths: [
      "convex/agentHarness/profiles/", "convex/agentHarness/evals/",
      "convex/agentHarness/agentRuntime/", "convex/agentHarness/programRuntime/",
      "convex/agentHarness/_generated/",
    ],
  },
};
```

Key decisions baked into the kernel check:

- **No name-based exemption.** Every kernel file — including helpers inside the kernel directories — is checked. Helpers pass only because their imports are legal, never because they are exempted. A "leaf" helper that reaches into a product facade is flagged exactly like a kernel root would be.
- **Forbidden takes precedence over allowed.** A product domain named in `forbiddenImports` can never be imported by a kernel, even if a narrower path also appears in `allowedImports`. This is why the two powerful `operations/*` helpers that the first draft grandfathered as `kernel-not-allowed` are instead recorded as `kernel-forbidden` in the baseline.
- **Subdirectories that are not kernel modules** (`profiles/`, `evals/`, `agentRuntime/`, `programRuntime/`, `_generated/`) and test files are excluded from the kernel surface.

### 3. Baseline-Driven Cycle + Violation Detection

- Tarjan's algorithm (`findSCCs`) finds strongly connected components with >1 node or a self-loop, then sorts them deterministically.
- The committed baseline (`scripts/convex-backend-dependency-baseline.json`) freezes **exact SCC identities** for cycles and **exact edge keys** (`file|imports|resolved|type`) for kernel violations.
- On each run:
  - **New cycles / new kernel violations** → fail
  - **Removed cycles / removed kernel violations** → `baseline-drift` (the baseline is stale and must be regenerated)
  - **Unchanged entries** → pass (grandfathered)
- `--update-baseline` regenerates the baseline, but **only shrink-only**: it refuses to persist when the current graph introduces a cycle or kernel violation not already baselined, and it refuses on an empty scan. A removed edge can never pay for a new violation elsewhere.

### 4. Integration

- Added `dependency:check:backend` to the root `package.json` and to `packages/athena-webapp/package.json` (delegating with `cd ../.. && bun scripts/...`), matching the `agent-sdk:check` precedent.
- Wired the guard into the `athena.convex-backend-adjacent` harness scenario: the check runs whenever Convex sources **or the guard's own files** change, and the scenario note explains the shrink-only contract.
- The test file (`scripts/convex-backend-dependency-check.test.ts`) runs in the `harness:test` suite.
- No runtime behavior changed — sensor/guardrail only.

### 5. Test Scenarios (sandbox-based)

Tests build ephemeral graphs under `mkdtemp` so error-path scenarios are exercised against controlled fixtures, never the live tree:

- Real-tree characterization: the committed baseline exactly matches the current backend graph (green).
- Empty scan fails loudly (and `--update-baseline` on an empty scan refuses).
- A new cycle between extensionless modules is detected and reported with exact `.ts` members.
- Removing one known cycle while adding a different cycle still fails (both `new-cycle` and `baseline-drift` reported).
- Removing a baselined kernel edge is drift; regeneration contracts it; reintroducing the same edge then fails.
- `--update-baseline` refuses when the graph grows (new, unrelated violation) and leaves the baseline untouched.
- Leaf-to-facade imports fail while facade-preserving kernel-internal imports stay legal.
- Imports quoted inside comments or string literals are ignored.
- A new kernel violation reports the exact resolved edge (file + resolved `.ts` module).

## Why This Works

1. **Characterization-first**: Captures today's graph exactly (4 real cycles + 7 grandfathered inventoryLedger kernel violations) before enforcing.
2. **Real resolution**: Nodes and edges carry real file extensions, so cycle detection actually sees the runtime graph — the first draft's extensionless path comparison formed zero edges and falsely reported 0 cycles.
3. **Shrink-only baseline**: Removals are drift until regenerated, and regeneration cannot absorb growth; a removed edge is never reusable.
4. **Kernel protection with no exemption holes**: Every helper inside a kernel directory is checked; forbidden product domains can never slip past an allowlist entry.
5. **Deterministic & harness-owned**: Stable traversal + sorted output, runs in CI, and can never pass on an empty scan.
6. **Extensible**: New kernels can be added to `PROTECTED_KERNELS` as the program identifies them.

## Prevention

- Run `bun run dependency:check:backend` locally before pushing.
- If a new cycle is detected, refactor to break it rather than updating the baseline.
- If a kernel violation is detected, move the imported logic into a leaf helper or a shared platform module; never add a product domain to `allowedImports`.
- Use `--update-baseline` **only** after intentional refactoring that removes cycles or kernel edges, and only for shrink-only changes.
- The baseline is the contract — it should only shrink over time.

## Files Created / Modified

- `scripts/convex-backend-dependency-check.ts` — Main check script with CLI (defaults for convex dir and baseline path; `--update-baseline`, `--json`, `--convex-dir`, `--package-dir`, `--baseline`, `--help`)
- `scripts/convex-backend-dependency-check.test.ts` — Test suite (9 sandbox-based scenarios + real-tree characterization)
- `scripts/convex-backend-dependency-baseline.json` — Committed baseline (4 real cycles, 7 grandfathered kernel violations)
- `package.json` + `packages/athena-webapp/package.json` — `dependency:check:backend` scripts
- `scripts/harness-app-registry.ts` — `athena.convex-backend-adjacent` scenario now includes the guard command and its files

## Usage

```bash
# Run check (fails on new violations or stale baseline drift)
bun run dependency:check:backend

# Update baseline after an intentional shrink-only change
bun run dependency:check:backend --update-baseline

# JSON output for CI integration
bun run dependency:check:backend --json
```

## Related Work

- Follows the kernel-boundary enforcement pattern established in `convex/agentHarness/importBoundary.test.ts`.
- Part of the Backend Reliability & Maintainability epic (V26-1353), Unit U1.
- The 7 grandfathered inventoryLedger kernel violations are scheduled to shrink in downstream units (U18 schema composition, U20 POS projector split, U21 catalog import split, U22 cash-controls consolidation).