---
title: Athena Open Work Rows Should Show Context-Specific Operator Metadata
date: 2026-06-29
category: design-patterns
module: athena-webapp
problem_type: design_pattern
component: rails_view
resolution_type: contextual_row_metadata
severity: medium
applies_when:
  - "Building operational review queues with multiple work types in one list"
  - "Replacing backend-oriented labels with operator-facing metadata"
tags:
  - athena-webapp
  - operations
  - open-work
  - row-design
  - product-copy
---

# Athena Open Work Rows Should Show Context-Specific Operator Metadata

## Problem

Open work combines service cases, pending checkout reviews, and synced sale
inventory reviews in one operator queue. A single generic row treatment made
different kinds of work look interchangeable, and raw backend fields such as
internal SKU ids, unformatted minor currency values, and ambiguous lookup
labels reached the UI.

## Solution

Treat the work type as the row's context contract. Keep the shared shell calm,
then let each work type choose the title shape, icon, secondary action, and
metadata that helps an operator decide what to do next.

- Service cases should show customer, owner, due date, and created time.
- Pending checkout reviews should show sale quantities, formatted price, item
  code when available, and approval status only when expanded.
- Synced sale inventory reviews should show receipt, the operator action
  needed, and created time. Keep technical counts such as affected sale lines
  in expanded details unless they materially change the collapsed decision.
- Link only the entity name or identifier that navigates away. Avoid making
  the entire sentence a link when only the product or receipt is the target.

Normalize values before render. Product names should be title-cased for the
row, receipt numbers should use `#123456`, and money should be formatted from
minor units instead of exposing stored integer values.

## Why This Matters

Operational queues are scanned repeatedly. Generic metadata makes operators
parse implementation details, while context-specific rows answer the immediate
question: what is this, what needs action, and where do I go next?

## When to Apply

- A queue aggregates records from multiple workflow sources.
- Backend fields are accurate but not phrased for operators.
- A row needs deep links to the product, transaction, or adjustment workflow.
- Dark mode or compact layouts make loud borders and badges harder to scan.

## Prevention

- Add row tests that assert type-specific collapsed and expanded metadata.
- Prefer product-copy normalization helpers over rendering raw backend labels.
- Check dark mode when adding new work-type colors, icons, or status text.
- Keep technical identifiers hidden unless they are the operator's next action.

## Examples

Instead of showing a synced sale row as:

```text
Review inventory for ADORE DYE
Primary SKU kx79zd...
Skipped lines 0
```

Render the operator-facing context:

```text
Synced sale inventory review
Review inventory for Adore Dye
Receipt #536534
Needs action Check stock count
Created 5 days ago
```

For pending checkout rows, keep the action phrase stable and link only the
normalized product name:

```text
Review pending checkout item: Jogodo
Quantity sold 4
Total sold 15
Price GH₵700
```

## Related

- `docs/product-copy-tone.md`
- `packages/athena-webapp/src/components/operations/OperationReviewItemCard.tsx`
- `packages/athena-webapp/src/components/operations/OperationsQueueView.tsx`
