---
title: Athena Operations Links Should Preserve Context And Inventory Availability Should Subtract Active Holds
date: 2026-05-08
category: logic-errors
module: athena-webapp
problem_type: workspace_navigation_and_sellable_inventory_accuracy
component: operations-workspaces
symptoms:
  - "Operations summary cards can link to POS lists without a return path or the right filter context"
  - "Product detail can show stock as sellable even when active inventory holds reserve part of the quantity"
  - "POS detail workspaces can fall back to the default page shell and lose the workspace back affordance"
root_cause: presentation_surfaces_recomputed_context_instead_of_reusing_navigation_and_inventory_contracts
resolution_type: shared_workspace_primitives_and_hold_aware_read_model
severity: medium
tags:
  - operations
  - point-of-sale
  - inventory
  - navigation
  - workspace-layout
---

# Athena Operations Links Should Preserve Context And Inventory Availability Should Subtract Active Holds

## Problem

Operations workspaces frequently summarize data owned by another workflow. If
those summary cards hand-roll their links, operators can arrive at POS lists
without a way back to the originating workspace or without the filter that made
the summary meaningful. The same drift happens when POS detail pages use a
different shell than the operations workspace: the visual hierarchy and back
affordance stop matching the rest of the app.

Inventory detail pages have a parallel risk. Product SKU stock is a durable
ledger quantity, but sellable quantity is the durable quantity minus active
holds. Showing both values as the same number makes reserved stock look
available for sale, especially after POS sessions or stock workflows place
holds without completing the final movement yet.

## Solution

Keep summarized workflow data attached to the context that produced it:

- Use a reusable operations metric card for overview and close-review summaries
  so the label, amount weight, helper text, and link-out affordance stay aligned.
- Include the origin search parameter on summary-card links into POS lists so
  the destination can render the workspace back button.
- Carry meaningful filters into the destination. For cash totals, filter by
  transactions whose payment allocations include cash rather than only
  transactions paid exclusively by cash.
- Render POS list/settings detail pages in the shared workspace shell and encode
  the optional back button in the page header primitive, with bottom borders
  opt-in for workspaces.

For inventory detail, separate durable stock from sellable availability in the
read model. Batch read active holds for the visible SKUs, subtract the held
quantity from the durable SKU quantity, and expose both the durable quantity and
reserved quantity when the UI needs to explain the difference.

## Prevention

- Do not add a summary card that links out without checking whether the
  destination needs an origin parameter or a filter.
- Do not filter payment-method reports only by a single stored payment method
  when multi-method allocations can include the requested method.
- Do not make every page header show a bottom border by default; workspaces
  should opt in only when the border carries useful separation.
- Do not treat `productSku.quantityAvailable` as sellable availability in UI
  read models without subtracting active inventory holds.
- Keep reusable workspace/card primitives covered by component tests so visual
  consistency changes land once and propagate to the relevant operations views.

## Related Validation

- `bun run --filter '@athena/webapp' test -- convex/inventory/products.sku.test.ts convex/pos/application/getTransactions.test.ts convex/pos/public/transactions.test.ts`
- `bun run --filter '@athena/webapp' test -- src/components/operations/DailyOperationsView.test.tsx src/components/operations/DailyCloseView.test.tsx src/components/pos/transactions/TransactionsView.test.tsx src/components/pos/expense-reports/ExpenseReportsView.test.tsx src/components/common/PageLevelHeader.test.tsx`
- `bun run pr:athena`
