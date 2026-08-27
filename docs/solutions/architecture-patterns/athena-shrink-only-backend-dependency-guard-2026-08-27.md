---
module: "athena-webapp"
date: "2026-08-27"
problem_type: "architecture_pattern"
component: "tooling"
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
---

## Problem

Athena's Convex backend has grown to ~245K lines across 199 tables and 617 admitted operations. Over time, implicit dependency cycles formed between modules, making changes risky and harder to reason about. The inventoryLedger and agentHarness kernels — which encode core business invariants (inventory valuation, agent lifecycle) — were importing product domains (operations, reports, cashControls, etc.), creating unwanted coupling.

We needed a structural guardrail that:
1. Snapshots current dependency cycles as a baseline
2. Fails only on **new** violations (shrink-only)
3. Protects kernel modules from importing product domains
4. Allows legitimate same-transaction domain composition (leaf helpers)
5. Is deterministic, harness-owned, and blocks only new violations

## Solution

Created a new dependency check script at `scripts/convex-backend-dependency-check.ts` with:

### 1. Protected Kernel Definitions

```typescript
export const PROTECTED_KERNELS = {
  inventoryLedger: {
    root: "convex/inventoryLedger",
    allowedImports: [
      "convex/_generated/",
      "convex/values",
      "convex/server",
      "convex/schemas/inventoryLedger",
      "convex/operations/inventoryMovements",
      "convex/operations/skuActivity",
      "convex/inventoryLedger/",
    ],
    forbiddenImports: [
      "convex/operations/", "convex/reports/", "convex/cashControls/",
      "convex/automation/", "convex/stockOps/", "convex/inventory/",
      "convex/pos/", "convex/storefront/", "convex/serviceOps/",
      // ... all other product domains
    ],
    leafHelpers: [
      "convex/inventoryLedger/types",
      "convex/inventoryLedger/valuation",
      "convex/inventoryLedger/positionRevisions",
      // ... other leaf modules that only import generated types + convex/values
    ],
  },
  agentHarness: {
    root: "convex/agentHarness",
    allowedImports: [
      "convex/_generated/", "convex/values", "convex/server",
      "convex/schemas/agentHarness", "convex/schemas/intelligence",
      "convex/intelligence/", "convex/operationAdmission/",
      "convex/platform/operationAdmission", "convex/platform/readIntentCatalog",
      "convex/platform/capabilityCatalog", "convex/lib/",
      "shared/agentHarness/", "shared/intelligence/",
      "convex/agentHarness/",
    ],
    forbiddenImports: [
      "convex/operations/", "convex/reports/", "convex/cashControls/",
      "convex/automation/", "convex/stockOps/", "convex/inventory/",
      "convex/pos/", "convex/storefront/", "convex/serviceOps/",
      // ... all other product domains
    ],
    leafHelpers: [
      "convex/agentHarness/provisionalNarrative",
      "convex/agentHarness/turnTrace",
      "convex/agentHarness/narrativeTrail",
      // ... other leaf helpers
    ],
    excludedPaths: [
      "convex/agentHarness/profiles/", "convex/agentHarness/evals/",
      "convex/agentHarness/agentRuntime/", "convex/agentHarness/programRuntime/",
      "convex/agentHarness/_generated/",
    ],
  },
};
```

### 2. Baseline-Driven Cycle Detection

- Uses Tarjan's algorithm to find strongly connected components (SCCs)
- Stores baseline of exact violating edges/SCC identities in `scripts/convex-backend-dependency-baseline.json`
- On each run: compares current cycles against baseline
- **New cycles** → fail
- **Removed cycles** → baseline drift (must regenerate with `--update-baseline`)
- **Unchanged cycles** → pass (grandfathered)

### 3. Kernel Violation Detection

- Only kernel modules (non-test, non-profile, non-runtime) are checked
- Leaf helpers are explicitly allowed (they only import generated types + `convex/values`)
- Two violation types:
  - `kernel-forbidden`: imports a product domain (hard error)
  - `kernel-not-allowed`: imports something not in allowed list (configurable)

### 4. Integration

- Added `dependency:check:backend` script to root `package.json`
- Registered test file at `scripts/convex-backend-dependency-check.test.ts`
- Runs as part of `harness:test` suite
- Baseline file committed to repo (regenerates on intentional changes)

### 5. Test Scenarios

```typescript
// Happy path: current baseline produces zero new-cycle findings
// Error path: fixture adds product-domain import into inventoryLedger → reports exact edge
// Edge case: removing baseline edge makes baseline stale; regeneration contracts it
// Error path: removing one known cycle while adding a different cycle still fails
// Integration: facade-preserving helper imports accepted; leaf-to-facade imports fail
```

## Why This Works

1. **Characterization-first**: Captures today's graph exactly before enforcing anything
2. **Shrink-only baseline**: A removed edge cannot pay for a new cycle elsewhere — the baseline only contracts
3. **Kernel protection**: The two most critical transaction kernels (inventoryLedger for stock/valuation, agentHarness for agent lifecycle) are isolated from product-domain churn
4. **Legitimate composition preserved**: Narrowly owned direct domain helper imports (like `inventoryLedger/effects.ts` importing `operations/inventoryMovements`) remain legal via the leaf helper allowlist
5. **Deterministic & harness-owned**: Runs in CI, blocks only new violations, no false positives from test files
6. **Extensible**: New kernels can be added to `PROTECTED_KERNELS` as the program identifies them (U14, U18, etc.)

## Prevention

- Run `bun run dependency:check:backend` locally before pushing
- If a new cycle is detected, refactor to break it rather than updating baseline
- If a kernel violation is detected, move the imported logic to a leaf helper or a shared platform module
- Use `--update-baseline` **only** after intentional refactoring that removes cycles
- The baseline is the contract — it should only shrink over time as we eliminate cycles

## Files Created

- `scripts/convex-backend-dependency-check.ts` — Main check script with CLI
- `scripts/convex-backend-dependency-check.test.ts` — Test suite (6 tests)
- `scripts/convex-backend-dependency-baseline.json` — Committed baseline (grandfathered cycles + kernel violations)

## Usage

```bash
# Run check (fails on new violations)
bun run dependency:check:backend

# Update baseline after intentional cycle removal
bun run dependency:check:backend --update-baseline

# JSON output for CI integration
bun run dependency:check:backend --json
```

## Related Work

- Follows the pattern established in `convex/agentHarness/importBoundary.test.ts` for kernel boundary enforcement
- Part of the Backend Reliability & Maintainability epic (V26-1353), Unit U1
- Enables downstream units: U16 (admission checker decomposition), U18 (schema composition), U44 (resource-budget coverage)