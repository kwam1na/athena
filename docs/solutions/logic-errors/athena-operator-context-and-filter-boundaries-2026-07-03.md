---
title: Athena Operator Context Should Not Be Reused As Filter Scope
date: 2026-07-03
category: logic-errors
module: athena-webapp
problem_type: logic_error
component: frontend_stimulus
symptoms:
  - "Pending checkout SKU linking compared the wrong displayed price boundary instead of the stored provisional sale price."
  - "Daily Operations timeline events could lose the distinction between the reviewed provisional SKU and the approved catalog SKU."
  - "Stock adjustment routes reused one SKU parameter for both table filtering and selected-row restoration."
root_cause: scope_issue
resolution_type: code_fix
severity: medium
tags: [athena-webapp, operator-context, sku-linking, daily-operations, stock-adjustments]
---

# Athena Operator Context Should Not Be Reused As Filter Scope

## Problem
Several operator workflows carried two different meanings through one field or query boundary. A SKU could mean "filter this table to one row" or "restore the row the operator had selected"; a pending checkout SKU could mean the provisional sale item or the approved catalog target; and Daily Operations could hydrate automation or timeline context through broader snapshots than the UI needed.

When those meanings blur, the UI can appear coherent while enforcing the wrong rule. Operators may be blocked from linking a valid pending checkout item, land on an empty stock-adjustment table after route restore, or see timeline copy that links to the wrong product context.

## Symptoms
- Pending checkout link review rejected or messaged based on display/net price context instead of the stored pending checkout price.
- Timeline entries for pending checkout review events could only expose one product link, even though operators need both provisional and approved catalog context.
- Stock adjustment routes treated `sku` as both the table filter and durable selected row, so restoring a selection could unintentionally narrow the table.
- Paginated operational tables had no consistent way to show custom empty states or loading-more affordances when route filters and server pagination interacted.

## What Didn't Work
- Reusing an existing route/query key for another piece of operator state. It saves a parameter but makes later restore logic ambiguous.
- Letting broad snapshots carry every hydration concern. It makes lightweight panes depend on data that belongs behind separate intent-specific queries.
- Throwing raw backend errors for operator-correctable conflicts. It bypasses the command-result contract and leaks implementation wording into UI flows.

## Solution
Keep operator intent boundaries explicit:

- Use stored pending checkout/provisional SKU price for link validation, and return command results for user-correctable conflicts.
- Preserve both sides of a pending checkout review event: the provisional product context and the approved catalog product link.
- Split route-selected SKU state from route-filtered SKU state. In stock adjustments, `selectedSku` restores the detail rail while `sku` remains a table filter.
- Give shared table primitives explicit `emptyState`, `isLoadingMore`, and `showPagination` controls so operational screens do not encode pagination behavior in local table forks.
- Hydrate Daily Operations automation status through a separate snapshot query instead of forcing it into the base snapshot.

## Why This Works
Operator context is not interchangeable with filter scope. A filter changes what data is visible; a selection identifies where the operator was working; a link target identifies which durable record an event should navigate to. Keeping those meanings separate lets the backend enforce the real business rule and lets the UI restore state without inventing hidden side effects.

The command-result boundary also keeps expected conflicts in the normal operator flow. The UI can normalize a conflict such as a duplicate lookup alias without treating it as an unexpected exception.

## Prevention
- Before adding a URL or query parameter, name whether it is a filter, a selection, a hydration target, or an action input. Do not reuse it for another category.
- When a timeline event involves both source and target records, model both links explicitly instead of picking whichever record is easiest to fetch.
- For pending checkout SKU linking, compare stored values from the provisional/pending checkout record against the trusted catalog SKU; do not compare formatted display amounts.
- Prefer small hydration queries for Daily Operations panes that can update independently.
- Add focused tests for route restore, pagination, and command-result conflicts whenever operational context is split.

## Related Issues
- [Daily Operations Hydration Should Be Split From Hook-Safe Delivery Checks](../harness/daily-operations-hydration-and-hook-env-2026-06-30.md)
- [Athena Stock Adjustment Filters Should Not Become Count Scope](athena-stock-adjustment-category-filter-and-terminal-repair-2026-06-02.md)
- [Athena SKU Search And Detail Surfaces Share One Matcher](athena-shared-sku-search-and-detail-surfaces-2026-05-27.md)
