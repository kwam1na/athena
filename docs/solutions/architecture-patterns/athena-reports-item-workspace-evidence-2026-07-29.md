---
title: "Athena reports item workspace keeps summaries bounded and evidence on demand"
date: 2026-07-29
category: architecture-patterns
module: athena-webapp
problem_type: architecture_pattern
component: service_object
resolution_type: code_fix
severity: medium
applies_when:
  - "Extending a report SKU detail view with transaction-level investigation"
  - "Adding richer catalog identity to a read-optimized reporting surface"
tags:
  - reporting
  - sku-detail
  - bounded-evidence
  - convex
delivery_diff_fingerprint: 3109e90121b28a94a628484feceda9d4173f18c8700c88039aab38a1200deaeb
---

# Athena reports item workspace keeps summaries bounded and evidence on demand

## Problem

Operators could see an SKU's daily rollups but could not inspect the source
transactions behind a selected operating day. The detail surface also exposed
too little catalog identity to make a report row easy to recognize or navigate
back to product management.

## Solution

Keep the period detail query focused on rollups and issue a separate,
authorized evidence query only when an operator opens a day. The query reads at
most 501 report facts, uses the extra row as a truncation sentinel, and returns
only POS or storefront transactions grouped by stable source identity. It then
loads at most one owned source record per grouped transaction.

The shared reporting contract carries the identity data the view needs:
current net price and an optional primary image. The UI presents that identity
in the item workspace, links deliberately to product management, and opens the
transaction evidence in a sheet instead of expanding every day eagerly.

## Why This Matters

The reporting read model remains predictable: ordinary SKU detail reads do not
fan out into unbounded evidence, and a high-volume day tells the operator that
its evidence is partial rather than implying completeness. Source records are
accepted only when they belong to the requested store, so an invalid or stale
source ID degrades to an unavailable reference without crossing store scope.

## Prevention

- Keep summary and drill-down queries separate; an optional investigation
  surface must not inflate the subscribed summary read path.
- Use a `limit + 1` sentinel whenever an evidence response has a fixed read
  budget, and expose the resulting truncation state in the UI.
- Add backend and view tests for grouping, source ownership, missing source
  records, and the selected-day sheet before changing this boundary.

## Examples

```ts
const factsWithSentinel = await ctx.db
  .query("reportFact")
  .withIndex("by_storeId_productSkuId_operatingDate", bySkuDay)
  .take(SKU_DAY_EVIDENCE_FACT_LIMIT + 1);

const truncated = factsWithSentinel.length > SKU_DAY_EVIDENCE_FACT_LIMIT;
```

The extra fact is never returned. It only records that the response has reached
its trusted evidence limit.

## Related

- `docs/solutions/architecture/athena-reporting-read-optimized-redesign-2026-07-28.md`
- `docs/solutions/architecture/athena-reporting-fact-projection-boundary-2026-07-09.md`
