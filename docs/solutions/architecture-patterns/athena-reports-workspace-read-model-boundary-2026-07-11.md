---
title: "Athena Reports Workspace Uses Generation-Coherent Server-Shaped Read Models"
date: 2026-07-11
category: architecture-patterns
module: athena-webapp
problem_type: architecture_pattern
component: service_object
resolution_type: code_fix
severity: high
applies_when:
  - "Building a reporting workspace from independently activated projections"
  - "Adding period, comparison, sorting, filtering, or pagination to Reports"
  - "Hydrating report evidence or operational destinations from aggregate rows"
  - "Sharing URL period state across nested Reports routes"
related_components:
  - "convex-reporting-projections"
  - "custom-range-materialization"
  - "tanstack-router-search-state"
  - "reports-workspace-ui"
tags:
  - reporting
  - read-models
  - projections
  - custom-ranges
  - cursor-coherence
  - tanstack-router
  - server-shaped-ui
delivery_diff_fingerprint: ace8dc2268a6a5c396d3dbc2f24fed7960b146292157d27d6797ef643dbb436c
---

# Athena Reports Workspace Uses Generation-Coherent Server-Shaped Read Models

## Problem

Verified facts and projections do not by themselves provide a safe workspace boundary. If public APIs expose projection-oriented rows, React can accidentally become responsible for store-time periods, comparisons, cross-generation coherence, SKU aggregation, currency interpretation, evidence routing, and custom-range orchestration.

Reports therefore must not assemble business meaning from low-level projections in the browser. It needs server-shaped, generation-aware read models whose DTOs already express period, trust, coverage, comparison, identity, pagination, and unavailable states.

## Solution

Build Reports as a thin presentation layer over reporting-owned composite read models.

1. Resolve presets and comparisons on the server from an explicit evaluation instant and store timezone. For partial-day comparisons, use cumulative 15-minute store checkpoints and inspect only the bounded remainder after the nearest checkpoint. Fail closed when that indexed remainder exceeds the hard limit; never truncate or silently substitute a full day.
2. Persist workspace-shaped store, SKU, rollup, facet, inventory exposure, inventory movement, and Daily Close trust summaries. Expose bounded Overview, Items, and Inventory entry points rather than many projection subscriptions.
3. Bind continuation state to store, page kind, period, filters, sort, contract versions, captured generation IDs, stable watermarks, and the active workspace epoch. Any semantic change starts a new page sequence.
4. Keep custom ranges asynchronous and resumable through explicit `store -> sku -> derive` phases. Freeze compatible source generations and use deterministic result-family identities so retries stay idempotent.
5. Return typed application destinations and explicit trust metadata. Money DTOs carry currency and minor-unit scale; unknown cost remains partial rather than becoming zero; Daily Close is trust evidence rather than a competing accounting total.
6. Build summaries into an isolated watermark-keyed workspace epoch. Verify every family and required intraday evidence before atomically switching the read pointer; never clear or rebuild the live epoch in place.
7. Layer URL ownership. Reports tabs preserve shared period keys (`preset`, `comparison`, `start`, `end`) and preserve `runId` only for a custom range. They discard view-owned cursor, filter, and sort state. Storefront may reuse its analytics presentation under `/reports/storefront`, but it remains independent from financial reporting queries.

The primary code boundaries are:

- `packages/athena-webapp/convex/reporting/periods.ts`
- `packages/athena-webapp/convex/reporting/readModels/reportingReadModels.ts`
- `packages/athena-webapp/convex/reporting/public.ts`
- `packages/athena-webapp/convex/reporting/customRangeRequests.ts`
- `packages/athena-webapp/shared/reportingContract.ts`
- `packages/athena-webapp/src/components/reports/ReportsLayout.tsx`

## Why This Matters

This boundary keeps store-time and partial-day comparisons identical across clients, prevents pagination from crossing activation or interpretation boundaries, and makes incomplete evidence visible instead of producing plausible false totals. Current inventory position remains distinct from period movement, and React renders a business answer with its trust state instead of reconstructing accounting semantics.

This extends the reporting fact/projection boundary: that pattern establishes facts, projections, activation, and historical interpretation; this pattern establishes the composite read-model and presentation boundary above verified projections.

## Prevention

- Do not calculate report date ranges, comparisons, rollups, classifications, profit coverage, or inventory movement totals in React.
- Do not read mutable operational rows directly from Reports; use reporting-owned active generations and durable evidence.
- Capture generation and watermark context once per composite read and bind it to every cursor.
- Materialize into an isolated epoch, reject duplicate page deliveries transactionally, and switch the public pointer only after verification.
- Use indexed server-side filters and sorts, and cap pages before identity hydration.
- Preserve revenue and valuation currencies separately, including `minorUnitScale`.
- Treat unknown cost as partial coverage and Daily Close as supporting trust evidence.
- Preserve only shared period search state across tabs, plus the validated run ID for custom ranges; clear route-specific continuation and filter state.
- Test scale gates, cursor context, auth, typed destinations, URL cleanup, explicit unavailable presentation, lazy evidence, and Storefront query independence.

## Examples

```ts
const cursorContextKey = buildCursorContextKey({
  storeId,
  pageKind: "items",
  period: periodKey,
  filter: classification,
  sort,
  contractVersions,
  generationIds,
  stableWatermarks,
});
```

Changing any input requires a fresh page sequence. Likewise, workspace navigation should rebuild search state from the shared period keys instead of spreading the current URL wholesale.

## Related

- [Athena Reporting Uses a Fact and Projection Boundary](../architecture/athena-reporting-fact-projection-boundary-2026-07-09.md)
- [Athena Analytics Workspace Snapshot](../performance/athena-analytics-workspace-snapshot-2026-05-08.md)
- [Athena Convex Read Amplification](../performance/athena-convex-read-amplification-2026-06-29.md)
- Linear: V26-1012 through V26-1021
