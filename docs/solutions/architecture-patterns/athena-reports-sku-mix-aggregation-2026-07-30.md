---
title: "Athena Reports Bounds SKU Mix Aggregation Before Identity Hydration"
date: 2026-07-30
category: architecture-patterns
module: athena-webapp
problem_type: architecture_pattern
component: database
resolution_type: code_fix
severity: medium
applies_when:
  - "Adding a range-wide SKU breakdown to Athena Reports"
  - "Aggregating reportSkuDay rows before fetching SKU identities"
related_components:
  - "convex-reports"
  - "reports-workspace-ui"
tags:
  - reporting
  - sku-mix
  - bounded-reads
  - convex
delivery_diff_fingerprint: 0d8c89ae517d63df5c474c3ab355ed346555c5df8d91ed37a70b542599ea4d55
---

# Athena Reports Bounds SKU Mix Aggregation Before Identity Hydration

## Problem

The Reports days workspace had daily totals, but not a range-level view of which products account for the units sold. Computing that mix in the browser would duplicate reporting logic and could turn a broad date range into an unbounded read or a large set of SKU lookups.

## Solution

Add a reporting-owned `listRangeSkuMix` query that authorizes the store, validates the date range, reads a bounded set of `reportSkuDay` rows, and aggregates units by SKU before resolving only the visible leaders.

```ts
const skuDays = await ctx.db
  .query("reportSkuDay")
  .withIndex("by_storeId_operatingDate_productSkuId", (q) =>
    q.eq("storeId", storeId).gte("operatingDate", startDate).lte("operatingDate", endDate),
  )
  .take(RANGE_SKU_MIX_ROW_LIMIT + 1);

if (skuDays.length > RANGE_SKU_MIX_ROW_LIMIT) {
  throw new Error("SKU mix covers too much activity to summarize accurately. Choose a shorter range.");
}
```

The query ranks positive-unit SKUs, returns the top 5 with resolved identities, and folds the remaining sales into `Other SKUs`. The React chart renders this server-shaped DTO alongside the daily table and uses the same date range.

## Why This Matters

The range query remains truthful under load: it fails rather than silently truncating data. Identity work is proportional to the handful of labels shown, not every SKU seen in the period, while the client receives a complete denominator and an explicit remainder bucket.

## Prevention

- Keep range-wide reporting aggregates server-owned, authenticated, and explicitly bounded before fan-out work.
- Test normal ranking, tied rows, empty sales, the `Other SKUs` remainder, and the over-limit failure path whenever the query shape changes.
- When extending the chart, use its typed `ReportSkuMixData` contract instead of rebuilding totals from the day list in React.

## Related

- [Athena Reports Workspace Uses Generation-Coherent Server-Shaped Read Models](athena-reports-workspace-read-model-boundary-2026-07-11.md)
