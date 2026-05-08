---
title: Athena Stock Adjustments Should Name Checkout And POS Reservation Sources
date: 2026-05-08
category: logic-errors
module: athena-webapp
problem_type: reservation_source_visibility
component: stock-adjustments
symptoms:
  - "Stock adjustments can show fewer available units than on-hand units without explaining the reservation source"
  - "Active checkout sessions reserve stock by decrementing productSku.quantityAvailable, while POS sessions reserve stock through inventoryHold rows"
  - "Operators cannot tell whether reserved stock is in checkout or POS from the stock-adjustment table"
root_cause: stock_adjustment_snapshot_exposed_pos_holds_but_not_active_checkout_session_reservations
resolution_type: source_aware_read_model_and_labels
severity: medium
tags:
  - operations
  - stock-adjustments
  - checkout
  - point-of-sale
  - inventory
---

# Athena Stock Adjustments Should Name Checkout And POS Reservation Sources

## Problem

Athena has two active reservation models. Storefront checkout sessions reserve
stock by reducing `productSku.quantityAvailable`, while POS sessions reserve
stock through `inventoryHold` ledger rows. A stock-adjustment workspace that
only summarizes inventory holds can still show available quantity below on-hand
quantity, but the row-level reservation label is missing for checkout-held SKUs.

That makes the count table look inconsistent: operators see a numeric gap, but
not whether the reserved units are held by customer checkout or by POS activity.

## Solution

Keep the stock-adjustment snapshot source-aware:

- Read active, unexpired checkout sessions for the store and sum their
  `checkoutSessionItem.quantity` values by `productSkuId`.
- Keep POS hold quantities separate from checkout quantities.
- Report `reservedQuantity` as the total of checkout plus POS reservations.
- Compute sellable availability by subtracting POS holds from the durable SKU
  availability, because checkout reservations are already reflected in
  `productSku.quantityAvailable`.
- Render compact row labels for each source, such as `1 checkout` and `2 POS`,
  and make the page summary name checkout sessions and POS sessions separately.

## Prevention

- Do not treat every stock reservation as an `inventoryHold`; checkout sessions
  already reserve availability through SKU quantity updates.
- Do not subtract checkout reservation totals from `productSku.quantityAvailable`
  a second time in read models.
- When a UI explains reserved stock, include the source whenever multiple
  reservation systems can affect the same SKU.

## Related Validation

- `bun run --filter '@athena/webapp' test -- convex/stockOps/adjustments.test.ts`
- `bun run --filter '@athena/webapp' test -- src/components/operations/StockAdjustmentWorkspace.test.tsx`
- `bun run pr:athena`
