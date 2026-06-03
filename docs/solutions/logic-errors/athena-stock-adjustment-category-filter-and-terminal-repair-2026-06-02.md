---
title: Athena Stock Adjustment Filters Should Not Become Count Scope
date: 2026-06-02
category: logic-errors
module: athena-webapp
problem_type: filter_state_and_local_terminal_repair
component: stock-adjustments-and-pos-register
symptoms:
  - "Stock adjustment search could return no rows when a category filter was active even though matching SKUs existed in another category"
  - "Cycle count draft selection treated category scope as an operator workflow choice instead of deriving it from the selected SKU"
  - "A terminal integrity repair path could identify a locally provisioned terminal but did not offer an operator repair action"
root_cause: operator_filter_state_was_mixed_with_workflow_authority_state
resolution_type: url_filter_boundary_and_repair_command
severity: medium
tags:
  - operations
  - stock-adjustments
  - category-filter
  - pos
  - terminal-repair
---

# Athena Stock Adjustment Filters Should Not Become Count Scope

## Problem

Stock adjustment category state is useful for browsing, but it should not be
the authority for which inventory group is counted. When the category was
treated as a count scope, operators could combine a search query with the wrong
category and see an empty table even though matching SKUs existed elsewhere.

The same branch also exposed a related POS repair boundary: terminal setup
repair is an operator action, not a passive blocked state. When local terminal
integrity required reprovisioning and the browser fingerprint still matched the
local seed, the UI needed a repair command that re-registers the terminal and
clears the integrity block.

## Solution

Keep filter state and durable workflow state separate:

- Store stock adjustment category as a URL-backed `category` filter, not as a
  count `scope`.
- Infer the cycle-count draft scope from the selected SKU. If no SKU is
  selected, default to the first inventory item while staying out of manual
  adjustment mode.
- Apply category, query, and availability as table filters only.
- When a query has matches outside the active category, show those matching
  rows with calm recovery copy and an explicit action to switch category or
  show all categories.
- When an operator selects an outside-category result, move the category filter
  to that SKU's category so the URL, selected row, and detail rail agree.

For terminal repair, keep the operator action explicit:

- Detect the local terminal fingerprint before attempting reprovisioning.
- Use the existing terminal registration/provisioning command path to repair the
  setup when the fingerprint matches the local seed.
- Persist the repaired terminal seed and clear terminal integrity state in the
  same local-store write.
- Render a loading repair action in the drawer gate so the operator can see the
  command and its progress.

## Prevention

- Do not use category filters as durable cycle-count scope selection. Category
  filters should narrow visible rows only.
- Do not hide search matches merely because the active category filter excludes
  them. Show the matches and make the category switch explicit.
- Do not auto-clear operator filters without visible context; prefer a recovery
  state that explains which filter is excluding results.
- Do not clear POS terminal integrity state without writing the repaired
  provisioned terminal seed in the same operation.

## Related Validation

- `bun run --filter '@athena/webapp' test -- src/components/operations/StockAdjustmentWorkspace.test.tsx`
- `bun run --filter '@athena/webapp' test -- src/components/operations/OperationsQueueView.test.tsx`
- `bun run --filter '@athena/webapp' test -- src/lib/pos/presentation/register/useRegisterViewModel.test.ts`
- `bun run --filter '@athena/webapp' lint:frontend:changed`
- `bun run --filter '@athena/webapp' typecheck`
- `bun run pr:athena`
