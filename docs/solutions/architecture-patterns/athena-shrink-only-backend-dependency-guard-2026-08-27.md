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
delivery_diff_fingerprint: "31f6298fb7822258122c0429432589086c7c878a62b5b8e42f076f09d3c439a4"
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

- Added `dependency:check:backend` to the root `package.json`.
- Wired the guard into the `athena.convex-backend-adjacent` harness scenario as a raw repo-root command (`bun run dependency:check:backend`, the same pattern `agent-sdk:check` uses): the check runs whenever Convex sources change. The scenario note states the shrink-only contract. A `script`-kind command was rejected because scenario `script` commands resolve against the webapp package manifest while the guard is a repo-root script, and the harness contract fixtures validate exactly that boundary.
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

### 6. Hardening pass (post-review)

The first delivery was reviewed by nine specialized agents (correctness, adversarial, reliability, testing, maintainability, agent-native, project-standards, cli-readiness, learnings). The review produced two P1/contract items worth single-line summaries plus a set of P2/P3 defensive gaps; this pass closed the actionable set **without changing the committed baseline** (the real tree still reports the same 4 cycles and 7 grandfathered kernel violations):

- **Import extraction is now statement-anchored and regex-aware.** `(?<![A-Za-z0-9_$.])` before `from|import` stops member calls like `data.from("x")` or `selection.import("y")` from ever becoming a finding; regex literals in expression positions are masked as non-code (so `/from "..\/reports\/access"/` inside a regex is ignored); backtick/template-literal specifiers are extracted too (unless they contain `${` interpolation, which is not statically resolvable). Regression tests pin both directions.
- **Nested `_generated` directories are fail-closed.** Only the exact top-level `convex/_generated` (the Convex runtime facade) is excluded from the scan. Any deeper `_generated` directory is a hard `scanError` unless a protected kernel declares it in `excludedPaths` — `agentHarness/_generated/` is the legitimate, declared franchise-generated registry; an undocumented `inventoryLedger/_generated/` now fails loudly instead of hiding violations. Note that type-only imports stay graph edges: the baselined `manifestRegistrations ↔ profiles/syntheticSecondSurfaceConformance` pair only exists because the reverse edge is an `import type`, so any "drop type edges from cycles" change would silently rewrite the committed snapshot.
- **Bare `convex/...` and tsconfig aliases are kernel-surface.** Kernel checks now classify `convex/values`/`convex/server` (allowed), bare `convex/<domain>` specifiers, and alias-expanded targets (`@cvx/*` → `convex/*`, `@/*` → `src/*`, read from `compilerOptions.paths`) exactly like relative imports; external packages remain invisible. Addressed the reviewer probe where `import { x } from "@cvx/reports/access"` would otherwise evade detection.
- **Corrupt vs missing baselines are distinct.** `loadBaseline` now returns a discriminated result; a corrupt baseline is a loud failure that `--update-baseline` refuses to regenerate from scratch (it must be restored/repaired), never silently treated as absent. Shape validation covers well-formed-but-missing-fields JSON.
- **CLI value flags are strict.** `--convex-dir`/`--package-dir`/`--baseline` require a value; a missing/swallowed value or an unknown flag exits with status 2 instead of silently using defaults.
- **Shrink-only update admits strict cycle contraction.** `--update-baseline` treats a current cycle that is an exact member **or a strict subset** of a baselined cycle as a contraction (not "new"), so splitting a baselined cycle can be persisted; reintroducing the removed members later produces a cycle that no longer matches the contracted baseline and fails again. The normal check still reports the contraction as drift.
- **Deterministic byte comparison** replaces `localeCompare`, so output is identical across ICU collation data.
- **Kernel config deduplicated.** Both kernels now share `SHARED_FORBIDDEN_PRODUCT_DOMAINS` (which includes both `convex/storefront/` and `convex/storeFront/` casings, since the real directory is `storeFront`) plus per-kernel extras; the driver loop iterates `Object.keys(PROTECTED_KERNELS)` instead of hardcoding two calls.
- **Reparability output.** Kernel violations carry a 1-based `line`, and every failure emits a `repairHint` (drift-only → regenerate; new violation → fix first) in both human and `--json` output.
- **Semantics pinned for excluded subtrees.** Boundary tests prove a cycle *through* an excluded subtree (`profiles/`) is still detected while a forbidden import *inside* it is deliberately not a kernel violation, and self-loops are reported as single-node cycles.

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
- Use `--update-baseline` **only** after intentional refactoring that removes cycles or kernel edges, and only for shrink-only changes (a baselined cycle may contract to a strict subset).
- Never create a nested `_generated` directory under a kernel unless it is franchise-generated and declared in that kernel's `excludedPaths`; never write kernel imports through tsconfig aliases that resolve into `convex/` product domains.
- If the baseline reads as corrupt, restore/repair it — the guard refuses to regenerate it from scratch.
- The baseline is the contract — it should only shrink over time.

## Files Created / Modified

- `scripts/convex-backend-dependency-check.ts` — Main check script with CLI (defaults for convex dir and baseline path; `--update-baseline`, `--json`, `--convex-dir`, `--package-dir`, `--baseline`, `--help`)
- `scripts/convex-backend-dependency-check.test.ts` — Test suite (21 sandbox-based scenarios + real-tree characterization)
- `scripts/convex-backend-dependency-baseline.json` — Committed baseline (4 real cycles, 7 grandfathered kernel violations)
- `package.json` — `dependency:check:backend` script
- `scripts/harness-app-registry.ts` — `athena.convex-backend-adjacent` scenario now includes the guard command and document the shrink-only contract

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