---
title: Daily operations carry-forward rows need operator-facing copy
date: 2026-07-04
category: design-patterns
module: athena-webapp
problem_type: design_pattern
component: rails_view
resolution_type: code_fix
severity: medium
applies_when:
  - "Daily opening or close surfaces render operational work items"
  - "Backend work item titles or metadata may contain raw identifiers"
  - "A review card is reused across queue, opening, and close contexts"
tags: [daily-operations, carry-forward, product-copy, operations]
---

# Daily operations carry-forward rows need operator-facing copy

## Problem
Daily opening and end-of-day close views can render carry-forward operational
work items that originated in Open Work. Those items often carry backend-shaped
titles and metadata such as `service_case`, `normal`, or
`pos_pending_checkout_item_review`, which are accurate but not calm
operator-facing copy.

## Solution
Normalize carry-forward item presentation at the daily operations boundary,
even when the underlying work item remains generic. The card should:

- Capitalize plain lower-case titles without changing intentionally cased copy.
- Preserve meaningful title prefixes such as `Review inventory for` and
  `Review pending checkout item:` while title-casing the product or subject.
- Convert work item type, status, and priority metadata into operator-facing
  labels before rendering.
- Keep operational work item metadata visible in the collapsed card instead of
  requiring an extra details disclosure.
- Put the source action in the card header so the operator sees the next action
  next to the row identity.

For example, render `service_case` as `Service case`, `normal` as `Normal`,
and `Review pending checkout item: protein Brazilian hair repair mask` as
`Review pending checkout item: Protein Brazilian Hair Repair Mask`.

## Why This Matters
Daily opening and close are handoff surfaces. Operators scan them to decide
whether the store can open, whether the day can close, or what work must carry
forward. Raw identifiers make that scan feel like backend inspection instead of
operations work, and hiding key work-item metadata behind a disclosure adds an
avoidable step when the row itself is already the work summary.

The same shared review card can still be reused, but each caller should decide
which fields are primary for that workflow. For ordinary review evidence, a
compact row plus details disclosure is helpful. For carry-forward operational
work, the type/status/priority triplet is the compact summary.

## Prevention
- Add component tests that assert the rendered copy, not only the raw snapshot
  shape.
- Include representative work item types such as service cases, synced-sale
  inventory reviews, and POS pending checkout reviews in daily opening and close
  fixtures.
- Keep product-copy normalization close to the surface that owns the operator
  decision, instead of mutating durable work item records for one view.
- When reusing `OperationReviewItemCard`, choose `headerActionSlot`,
  `collapsedMetadataEntries`, and `metadataEntries` deliberately for each
  workflow.

## Examples
Before:

```text
tokin
type: service_case
priority: normal
status: open
```

After:

```text
Tokin
Type: Service case
Priority: Normal
Status: Open
```

Before:

```text
Review inventory for slides
```

After:

```text
Review inventory for Slides
```

## Related
- `docs/product-copy-tone.md`
- `docs/solutions/design-patterns/athena-open-work-row-context-metadata-2026-06-29.md`
- `docs/solutions/architecture-patterns/athena-open-work-resolution-ownership-2026-07-02.md`
- `packages/athena-webapp/src/components/operations/DailyOpeningView.tsx`
- `packages/athena-webapp/src/components/operations/DailyCloseView.tsx`
- `packages/athena-webapp/src/components/operations/OperationReviewItemCard.tsx`
