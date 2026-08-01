---
title: "feat: Add trustworthy prior-period comparisons to Reports"
date: 2026-08-01
status: completed
origin: docs/brainstorms/2026-07-09-reports-workspace-requirements.md
---

# feat: Add trustworthy prior-period comparisons to Reports

## Summary

Extend Athena's existing Reports read models and presentation components so overview, item-period, and SKU-detail metrics compare against the immediately preceding equivalent period, while preserving bounded reads, explicit missing-data behavior, and links to source evidence.

## Problem Frame

Reports already presents current-period totals, but several high-value metrics lack a consistent prior-period baseline. Administrators can see the present value without quickly understanding direction, and individual report surfaces can drift if each derives comparisons independently. The comparison contract needs to be server-shaped, period-aware, and stable across overview, item, and SKU-detail views.

This work implements the comparison portion of the Reports workspace requirements, especially F1, F2, R5, R7, R25, R39, R42, and R43. It does not broaden Reports into an operational work queue or create new financial truth outside the reporting projections.

## Requirements

- R1. Overview rolling windows expose the preceding equivalent window for trustworthy metric comparison.
- R2. Item-period queries return totals for the immediately preceding day, week, or calendar month corresponding to the selected period.
- R3. SKU detail returns totals for the immediately preceding equal-length range, including an empty or unavailable state without inventing a zero baseline.
- R4. UI metrics use one shared restrained transition pattern and render comparison copy consistently across Reports and the adjacent operational summary metric.
- R5. Comparison calculations preserve the distinction between missing data, zero, and a legitimate positive or negative change.
- R6. Convex reads remain indexed and explicitly bounded, with tests covering read-budget and calendar-boundary behavior.
- R7. Existing table and transaction surfaces retain stable layout and operator-readable loading behavior.
- R8. All changed behavior has focused Vitest coverage and passes Athena's repository-owned merge gate.

## Scope Boundaries

### In Scope

- Reports overview current/prior rolling snapshots and compatibility enrichment.
- Item-period and SKU-detail current/prior totals.
- Shared report contracts and derived schema fields required by those read models.
- Metric comparison presentation, crossfade behavior, and table sizing needed by the changed views.
- Focused backend and React tests plus Graphify regeneration.

### Deferred to Follow-Up Work

- New report periods beyond the existing day, week, month, rolling, and custom-range contracts.
- New forecasting, inventory-age, or accounting claims.
- Historical backfills that rewrite existing financial facts.
- Broad redesign of Reports navigation or unrelated table primitives.

## Assumptions

- The dirty implementation moved into this worktree is the intended implementation baseline and should be reviewed and repaired rather than re-created.
- Calendar-month comparisons should use the prior calendar month, while custom SKU ranges should use the immediately preceding equal-length range.
- Existing optional schema fields are the correct compatibility posture until refreshed overview documents have been rebuilt.
- A shared presentation component is preferable to separate animation logic on each report surface.

## Existing Patterns to Follow

- `docs/solutions/architecture-patterns/athena-reporting-period-focus-and-lifecycle-authority-2026-08-01.md` for period ownership and report lifecycle boundaries.
- `docs/solutions/architecture-patterns/athena-reports-workspace-read-model-boundary-2026-07-11.md` for generation-coherent server-shaped reads.
- `docs/solutions/architecture-patterns/athena-reports-item-workspace-evidence-2026-07-29.md` for item evidence and bounded detail behavior.
- `docs/solutions/architecture-patterns/athena-reports-sku-mix-aggregation-2026-07-30.md` for bounded report aggregation and typed contracts.
- `packages/athena-webapp/convex/_generated/ai/guidelines.md` for indexed, bounded Convex query rules.

## Key Technical Decisions

1. **Shape comparison data on the server.** Extend the canonical report contracts and persisted overview projection so React consumes explicit prior totals rather than reconstructing report semantics client-side.
2. **Match comparison windows to period meaning.** Day and week move backward by their fixed spans, calendar month resolves the previous calendar month, rolling overview windows use adjacent equivalent windows, and custom SKU ranges use an adjacent equal-length range.
3. **Keep rollout compatibility explicit.** New persisted overview fields remain optional during rollout; legacy documents are enriched from a bounded indexed day range until the projection refreshes.
4. **Centralize visual transitions.** Use one comparison crossfade component for metric value changes and keep reduced-motion and missing-comparison behavior deterministic.
5. **Treat query budgets as part of correctness.** Tests must prove bounds and edge cases, not only returned arithmetic.

## Implementation Units

### U1. Extend overview comparison snapshots

**Files:**

- `packages/athena-webapp/convex/reports/overview.ts`
- `packages/athena-webapp/convex/reports/overview.test.ts`
- `packages/athena-webapp/convex/reports/contract.test.ts`
- `packages/athena-webapp/convex/schemas/reports/derived.ts`
- `packages/athena-webapp/shared/reportsContract.ts`

Add current/prior rolling snapshots to the overview contract, derive them from the bounded day set, and retain compatibility for legacy documents.

**Test scenarios:**

1. Trailing 30-day totals compare with the immediately preceding 30 days.
2. Trailing three-calendar-month totals compare with the preceding three-calendar-month window across unequal month lengths.
3. Empty data returns typed empty snapshots without fabricated changes.
4. Legacy overview documents are enriched within the documented 184-day cap.

### U2. Add prior-period totals to item and SKU queries

**Files:**

- `packages/athena-webapp/convex/reports/queries.ts`
- `packages/athena-webapp/convex/reports/queries.test.ts`
- `packages/athena-webapp/src/lib/skuSearch/productSkuSearchAdapters.ts`

Resolve prior ranges according to period semantics, aggregate source-backed transaction and SKU facts, and return explicit prior totals through the canonical query results.

**Test scenarios:**

1. Day and week periods resolve their immediately preceding equivalent spans.
2. Month periods resolve the prior calendar month across year boundaries and different month lengths.
3. SKU custom ranges resolve an adjacent equal-length prior range.
4. Empty current or prior SKU activity preserves identity and missing-data semantics.
5. Transaction totals continue to use Daily Close evidence when available and bounded live POS evidence otherwise.
6. SKU price identity does not substitute a retail price where a net price is unknown.

### U3. Present consistent metric comparisons

**Files:**

- `packages/athena-webapp/src/components/reports/ReportMetricComparisonCrossfade.tsx`
- `packages/athena-webapp/src/components/reports/ReportPeriodMetrics.tsx`
- `packages/athena-webapp/src/components/reports/ReportsItemsPerformance.tsx`
- `packages/athena-webapp/src/components/reports/ReportsItemsTable.tsx`
- `packages/athena-webapp/src/components/reports/ReportsItemsView.tsx`
- `packages/athena-webapp/src/components/reports/ReportsOverviewView.tsx`
- `packages/athena-webapp/src/components/reports/ReportsSkuDetailView.tsx`
- `packages/athena-webapp/src/components/operations/OperationsSummaryMetric.tsx`

Render server-provided comparison totals using shared copy and transition behavior, while preserving stable widths, loading states, and period context.

**Test scenarios:**

1. Positive, negative, unchanged, zero-baseline, and missing comparisons render the correct operational language.
2. Overview rolling periods select the matching prior snapshot.
3. Item and SKU views forward query-provided prior totals without recalculating source semantics.
4. Metric changes crossfade without layout collapse and respect reduced-motion behavior.

### U4. Preserve adjacent surface layout contracts

**Files:**

- `packages/athena-webapp/src/components/base/table/data-table.tsx`
- `packages/athena-webapp/src/components/base/table/data-table.test.tsx`
- `packages/athena-webapp/src/components/pos/transactions/TransactionsView.tsx`
- `packages/athena-webapp/src/components/pos/transactions/TransactionsView.test.tsx`
- `packages/athena-webapp/src/components/reports/ReportsCatalogLookup.tsx`
- `packages/athena-webapp/src/components/reports/ReportsCatalogLookup.test.tsx`

Keep tables and embedded report-adjacent views sized predictably when the new comparison content changes vertical and horizontal pressure.

**Test scenarios:**

1. Data tables accept and apply the intended constrained-height contract.
2. Transaction and catalog lookup surfaces preserve their expected viewport sizing.

### U5. Refresh generated architecture artifacts and validate delivery

**Files:**

- `graphify-out/GRAPH_REPORT.md`
- `graphify-out/graph.json`
- `graphify-out/wiki/index.md`
- `graphify-out/wiki/packages/storefront-webapp.md`
- `graphify-out/wiki/packages/valkey-proxy-server.md`

Rebuild Graphify after final code edits, run focused Vitest suites during repair, and finish with `bun run pr:athena` as the merge-ready gate.

## Dependencies and Sequencing

1. Confirm shared contracts and range semantics before reviewing UI consumption.
2. Validate Convex query behavior and bounds before presentation refinements.
3. Verify component and layout tests after backend result shapes stabilize.
4. Rebuild Graphify only after final code changes.
5. Run the repository merge gate, review, commit, push, create the PR, and keep ownership through merge and local-main alignment.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Calendar comparisons silently use unequal or overlapping ranges | Encode period-specific range tests, including month and year boundaries. |
| Compatibility enrichment exceeds Convex read budgets | Keep the indexed day read capped and assert the cap in tests. |
| Missing prior data is displayed as a real zero | Preserve optional/null semantics through contracts and presentation tests. |
| Shared transition behavior causes layout or accessibility regressions | Centralize it, keep widths stable, and test rendered states. |
| Generated graph artifacts drift from final code | Run `bun run graphify:rebuild` after the last code edit. |

## Validation

- Focused Convex report tests via `bun run test -- convex/reports/...` from `packages/athena-webapp`.
- Focused React tests for every changed component test file.
- `bun run graphify:rebuild` after final code changes.
- `bun run pr:athena` from the repository root as the authoritative merge gate.
