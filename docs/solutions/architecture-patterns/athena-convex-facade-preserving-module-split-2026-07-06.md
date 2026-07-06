---
title: Athena Convex Facade-Preserving Module Split
date: 2026-07-06
category: architecture-patterns
module: athena-webapp-convex-daily-close
problem_type: architecture_pattern
component: service_object
resolution_type: code_fix
severity: medium
applies_when:
  - "A registered Convex module has become a graphify hotspot but its public API path must stay stable"
  - "Helper logic can be grouped by cohesive domain boundaries without moving public query or mutation exports"
  - "Generated Convex API output and graphify artifacts need to stay current after a structural split"
tags: [convex, graphify, daily-close, module-boundaries, generated-artifacts]
related_components:
  - "daily-close"
  - "convex-generated-api"
  - "graphify"
---

# Athena Convex Facade-Preserving Module Split

## Problem

Large registered Convex files can become graphify hotspots because they mix public queries and mutations with internal read models, approval policies, automation rules, and report math. Moving registered exports directly into child modules would reduce file size, but it would also change generated API paths such as `api.operations.dailyClose.getDailyCloseSnapshot`.

## Solution

Keep the existing registered Convex file as the public facade and move cohesive helper clusters into sibling modules that do not register public Convex functions.

For Daily Close, `convex/operations/dailyClose.ts` stayed responsible for the public `query`, `mutation`, and `internalMutation` exports. The helper logic moved into modules under `convex/operations/dailyClose/`:

- `adjustmentReports.ts` owns applied transaction adjustment normalization and totals.
- `approval.ts` owns Daily Close approval subject and requirement construction.
- `automationPolicy.ts` owns end-of-day automation risk evidence and policy validation.

When existing TypeScript imports depend on helper names from the facade file, re-export those helper names from the facade instead of forcing unrelated call sites to learn the new module layout immediately.

```ts
import {
  buildAdjustmentReportTotals,
  listAppliedTransactionAdjustmentsForDay,
  readAppliedTransactionAdjustmentsForDay,
} from "./dailyClose/adjustmentReports";

export {
  buildAdjustmentReportTotals,
  listAppliedTransactionAdjustmentsForDay,
};
```

Add module-boundary tests beside the extracted helpers so the split has direct ownership signals:

- totals tests for same-day and prior-day transaction adjustments
- approval subject/action contract tests
- automation policy risk evidence tests

After the split, run the generated-artifact hook so Convex generated API docs and graphify indexes reflect the new module graph:

```bash
bun run pre-commit:generated-artifacts
```

## Why This Matters

Convex generated API paths are part of the product contract. A refactor that reduces a god-node but changes public paths creates avoidable churn for every consumer and can turn a cleanup ticket into a compatibility migration.

Facade-preserving splits let the architecture improve while keeping the externally visible Convex surface stable. Graphify then sees smaller, more cohesive helper modules, and future agents can inspect ownership by domain instead of searching one large registered file.

## Prevention

- Do not move registered `query`, `mutation`, `action`, or `internalMutation` exports out of a public Convex module unless the ticket explicitly accepts an API path change.
- Extract plain helper functions, type definitions, policy builders, and report math first.
- Keep child modules free of registered Convex exports when they are intended to be implementation details.
- Re-export helper names from the facade only when existing callers already rely on that import path.
- Add tests at the extracted module boundary, then keep representative public return validator proofs in the facade test when public function returns are touched.
- Run `bun run pre-commit:generated-artifacts`, `bun run graphify:check`, and changed Convex lint after structural Convex moves.

## Examples

The public API remains stable:

```ts
export const getDailyCloseSnapshot = query({
  args: { date: v.optional(storeDateArg) },
  returns: vDailyCloseSnapshotResponse,
  handler: async (ctx, args) => {
    return buildDailyCloseSnapshot(ctx, args.date);
  },
});
```

The implementation modules can still evolve independently:

```ts
const adjustmentTotals = buildAdjustmentReportTotals({
  adjustments,
  reportDate,
});

const decision = validateEodAutomationPolicyForSnapshot({
  snapshot,
  now,
});
```

## Related

- [Convex Public Return Validators Need Executable Contract Proof](../harness/convex-return-validator-contract-proof-2026-06-18.md)
- [Athena EOD Review Automation Completion](../architecture/athena-eod-review-automation-completion-2026-06-22.md)
