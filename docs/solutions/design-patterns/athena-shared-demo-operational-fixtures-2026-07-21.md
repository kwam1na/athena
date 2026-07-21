---
title: Shared Demo Operational Fixtures Need Server Continuity and Client Overlays
date: 2026-07-21
category: design-patterns
module: athena-webapp
problem_type: design_pattern
component: frontend_stimulus
resolution_type: code_fix
severity: medium
applies_when:
  - "Extending the shared demo with historical operational workspaces"
  - "Promoting shared-demo baselines while preserving live operational continuity"
  - "Rendering POS or operations history that should look populated without mutating live demo state"
tags:
  - athena-webapp
  - shared-demo
  - operations
  - fixtures
  - convex
  - pos
delivery_diff_fingerprint: 40979ba408c7eb28c25a047ecc7f6bb58fab3c75bf601591506b461df16632ed
---

# Shared Demo Operational Fixtures Need Server Continuity and Client Overlays

## Problem

The shared demo needs operational workspaces that feel complete across opening,
daily operations, closeout, and POS history. Treating all demo history as live
Convex state makes baseline promotion risky: older demo stores can lose staff
story updates, product image versions, opening links, or operational continuity
when the baseline advances.

## Solution

Split the demo into two layers:

- Use Convex baseline promotion for durable store state that must survive
  re-provisioning: staff profiles, staff credentials, opening messages, product
  image version updates, daily opening records, and operational events linked to
  those records.
- Use client-owned fixture overlays for historical, read-only workspace views:
  Daily Operations, Daily Opening, Daily Close, POS transactions, and transaction
  details can render fixture-backed snapshots when the route is inside the
  shared-demo context and the requested date or transaction is demo-owned.
- Keep live current-day data available where it matters. Current Daily
  Operations still uses the connected runtime view, but it can receive
  client-provided week analytics so the demo has realistic week context without
  forcing extra backend rows.
- Make fixture transaction IDs explicit and read-only. Detail routes skip live
  transaction queries for fixture IDs and suppress mutation affordances such as
  update, void, and receipt printing.

That boundary keeps mutable operational state in Convex and puts static
historical storytelling in React fixtures, where it is deterministic and cheap
to test.

## Why This Matters

Shared-demo state serves two jobs: it is a live operational sandbox and a
curated product story. The live sandbox needs continuity across baseline
versions; the curated story needs stable historical surfaces that do not depend
on whatever a visitor did in the current session. Separating those jobs avoids
turning demo history into fragile seed data while still letting the real runtime
own current operational behavior.

## Prevention

- When increasing `SHARED_DEMO_BASELINE_VERSION`, register each intermediate
  migration in `planSharedDemoMigration` and test both reset and continuity
  paths.
- Promote baseline documents through transform helpers when staff, credentials,
  messages, or product assets change; do not patch only the live rows.
- Route shared-demo-only historical views through fixture factories and add
  component tests that prove live queries are skipped or supplemented exactly
  where intended.
- Restore fake timers in fixture tests with `try/finally`; leaked timers can
  hang unrelated async tests in the same file.
- Run `bun run graphify:rebuild` and the focused Vitest files before the full
  `bun run pr:athena` gate so generated docs and fixture tests fail close to the
  changed surface.

## Examples

Use a live connected view for current-day operations, but inject client week
analytics from deterministic demo fixtures:

```tsx
<DailyOperationsConnectedRuntimeView
  clientWeekAnalytics={{
    fetchedAt,
    metrics: fixture.cachedWeekMetrics ?? [],
    storePulse: fixture.cachedWeekStorePulse,
  }}
/>
```

Use fixture transaction IDs as a query boundary:

```tsx
const liveTransaction = useQuery(
  api.inventory.pos.getTransactionById,
  transactionId && sharedDemoContext !== undefined && !isFixtureTransactionId
    ? { transactionId: transactionId as Id<"posTransaction"> }
    : "skip",
);
```

## Related

- `packages/athena-webapp/convex/sharedDemo/provision.ts`
- `packages/athena-webapp/src/components/shared-demo/sharedDemoOperationsFixture.ts`
- `packages/athena-webapp/src/components/shared-demo/sharedDemoTransactionsFixture.ts`
- `packages/athena-webapp/src/components/operations/DailyOperationsView.tsx`
- `packages/athena-webapp/src/components/pos/transactions/TransactionView.tsx`
- `docs/solutions/workflow-issues/athena-landing-story-day-dark-mode-and-cash-policy-2026-07-20.md`
