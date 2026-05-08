---
title: Athena Operational Review Lists Need Scannable Pagination And Precise Money Displays
date: 2026-05-08
category: logic-errors
module: athena-webapp
problem_type: ux_logic_error
component: operations
symptoms:
  - "Operational review cards exposed every detail by default and overwhelmed operators"
  - "Ready review lists could grow without pagination or URL state"
  - "Stored pesewa amounts with fractional display values could render as whole-cedi values"
root_cause: presentation_logic_error
resolution_type: code_fix
severity: medium
tags:
  - daily-close
  - operations
  - pagination
  - money-units
  - cash-controls
---

# Athena Operational Review Lists Need Scannable Pagination And Precise Money Displays

## Problem

Operational review surfaces are used while staff are closing or checking the operating day. These lists need to support fast scanning first, then detail inspection on demand. Showing every transaction, expense, or review detail by default makes the operator parse repeated metadata before they can decide whether an item matters.

The same surfaces also display stored money values. Athena stores money in minor units, so display helpers must preserve fractional cedi values when a pesewa-level difference matters. Whole-unit formatting can hide real variance by rendering a non-zero stored value like `2` pesewas as `GH₵0`.

## Symptoms

- Daily-close ready cards took too much vertical space because each card expanded all metadata by default.
- Operators had no page state in the URL, so a long ready list could not be linked or restored to the same page.
- Pagination logic started to appear inside feature components instead of being reusable outside the data-table stack.
- Cash-control summaries could make expected and counted cash look equal even when stored minor-unit values differed.

## Solution

Use compact operational cards as the default state. The collapsed card should show the minimum fields an operator needs to scan the list: record type, status, primary reference, terminal/register, payment method or category, and total. Put secondary fields behind an explicit details control.

Use shared pagination for list-like operational surfaces that are not data tables. Keep the page size close to the operator workflow rather than the table default. For daily close, five cards per page keeps the right rail and review list usable together, while the page number belongs in the URL so the view is restorable.

For stored money displays, use a helper that understands minor units and can reveal fractional display values only when needed. Whole cedi values should stay quiet, but stored amounts such as `1897598` should be able to render as `GH₵18,975.98` instead of being rounded to `GH₵18,976`.

## Why This Works

Collapsed cards make the ready list scannable without hiding the ability to inspect details. URL-backed pagination makes the list stable across refreshes, links, and browser navigation. A shared list pagination component prevents non-table workspaces from reaching into the data-table-specific pagination code.

Precision-aware stored-money display keeps the operator-facing summary honest. It avoids noisy decimals for ordinary whole-cedi amounts while still showing the pesewa-level differences that can block closeout or explain a variance.

## Prevention

- Keep repeated operational review items collapsed by default unless the item itself is the primary workflow.
- Use shared list pagination for non-table card lists instead of duplicating pagination controls in each workspace.
- Store page state in the route when the list is part of a durable workspace or review queue.
- Use `formatStoredCurrencyAmount` or an equivalent stored-money helper when rendering persisted minor-unit values.
- Prefer revealing minor units conditionally over forcing every cash amount to show two decimal places.
- Keep tests around page reset behavior when filters or tabs change.

## Related Files

- `packages/athena-webapp/src/components/operations/DailyCloseView.tsx`
- `packages/athena-webapp/src/components/common/ListPagination.tsx`
- `packages/athena-webapp/src/components/procurement/ProcurementView.tsx`
- `packages/athena-webapp/src/lib/pos/displayAmounts.ts`
- `packages/athena-webapp/shared/currencyFormatter.ts`

