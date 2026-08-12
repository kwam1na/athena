---
title: Daily Close Must Include Every Completed Sales Channel
date: 2026-08-12
category: logic-errors
module: athena-webapp-reporting
problem_type: logic_error
component: database
symptoms:
  - "End of day review net sales are lower than the Reports workspace for the same store day"
  - "Completed storefront orders appear in reporting facts but not in Daily Close totals"
root_cause: missing_include
resolution_type: code_fix
severity: high
related_components:
  - reports-workspace
  - storefront-orders
  - daily-close
tags:
  - daily-close
  - storefront
  - net-sales
  - source-completeness
  - convex
delivery_diff_fingerprint: 4d79178e4438fa24d1e3e7bff0b559a670a413e7f889bf6e072714b429e16a5e
---

# Daily Close Must Include Every Completed Sales Channel

## Problem

Daily Close treated completed POS transactions as the entire store-day sales
boundary. The Reports workspace also folds fulfilled storefront orders, so a
day with online revenue produced two internally valid but different net-sales
figures.

## Symptoms

- The EOD Review sales total omitted fulfilled online orders.
- The Reports workspace showed the higher channel-complete figure.
- Simply adding order totals risked inconsistent transaction counts, legacy
  discount errors, and unbounded per-order line queries.

## What Didn't Work

- Adding storefront totals without changing `transactionCount` made the summary
  internally inconsistent.
- Reading only `onlineOrderItem` rows dropped older orders that retain inline
  `order.items`.
- Launching one 201-row probe per order concurrently could exceed Convex read
  limits before the aggregate 200-line completeness budget was applied.
- Sequentially loading current-format child rows preserved the cap but put an
  N+1 query path on the live Daily Close snapshot.

## Solution

Treat fulfilled storefront orders as first-class Daily Close sales evidence:

- Read `delivered` and `picked-up` orders through the
  `by_storeId_status_completedAt` index for the operating-day range.
- Add their authoritative `paymentDue` to `salesTotal` and count each order in
  `transactionCount`.
- Persist a compact `itemCount` when a new online order is created. Current
  orders can then populate EOD evidence from the parent row without child
  queries.
- For older orders, reconstruct lines from inline `order.items` or bounded
  `onlineOrderItem` rows. Record incomplete source evidence when the shared
  200-line probe is exceeded.
- Emit a linked `Completed online order` ready item so the total remains
  inspectable by operators.

## Why This Works

The parent order already owns the charged total in `paymentDue`; copying only
the derived item count at creation gives Daily Close the two values it needs
without creating a competing money calculation. Optional fields preserve old
documents, while the legacy fallback maintains historical accuracy and fails
closed when it cannot prove completeness.

## Prevention

- When a new sales channel contributes reporting facts, add it to the
  store-day close boundary or explicitly document why it is excluded.
- Keep totals, counts, visible evidence rows, and source-completeness entries in
  the same change.
- Prefer compact parent-row projections for hot aggregate reads; reserve child
  reconstruction for bounded legacy fallback paths.
- Test mixed POS/storefront days, legacy inline discounts, and both parent and
  child source caps.

## Related Issues

- [Athena Daily Close Is A Store-Day Boundary](athena-daily-close-store-day-boundary-2026-05-07.md)
- [Athena Convex Read Amplification](../performance/athena-convex-read-amplification-2026-06-29.md)
- [Athena Reporting Fact Projection Boundary](../architecture/athena-reporting-fact-projection-boundary-2026-07-09.md)
