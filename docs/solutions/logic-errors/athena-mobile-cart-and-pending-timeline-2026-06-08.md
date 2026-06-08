---
title: Athena Mobile Cart Items and Pending Checkout Timeline
date: 2026-06-08
category: logic-errors
module: athena-webapp
problem_type: mobile_cart_and_pending_timeline_visibility
component: pos
symptoms:
  - "Transaction and expense report detail pages hide cart items on narrow screens"
  - "Mobile cart item cards clip product names to one character"
  - "Product detail operations timelines omit pending checkout item events"
root_cause: desktop_first_grid_constraints_and_product_only_timeline_subjects
resolution_type: mobile_first_item_layout_and_subject_bridge
severity: medium
tags:
  - pos
  - mobile
  - operations
  - timeline
  - pending-checkout
---

# Athena Mobile Cart Items and Pending Checkout Timeline

## Problem

POS detail pages reused desktop two-column layouts on mobile. The summary rail
kept priority, while cart items were pushed out of view or squeezed into grid
columns that left product names clipped. Operators could see that items existed,
but they could not read the actual product line names on a phone.

Product detail timelines also queried only product and SKU subjects. Pending
checkout item creation events are anchored to `pos_pending_checkout_item`, so
the product page for the hidden provisional product could miss the event that
explains why the SKU exists.

## Solution

Treat cart items as the first mobile information block on transaction and
expense report detail pages. Keep the desktop rail layout at the wide breakpoint,
but order the item list first on narrow screens and give it a stable minimum
height so it is visibly present.

Inside comfortable cart cards, use a mobile-first vertical rhythm instead of a
fixed twelve-column grid. Product images and quantity badges stay compact, while
product names wrap naturally. SKU and barcode text can break across lines, and
line totals move to a bottom row where they no longer compete with product copy.

For the product operations timeline, bridge from the product's provisional SKUs
to matching pending checkout items through the existing
`by_storeId_provisionalProductSkuId` index. Fetch those
`pos_pending_checkout_item` events alongside product and SKU events, then reuse
the SKU label metadata so the UI can show the same badge language as normal SKU
events.

## Implementation Notes

- Keep mobile ordering on the detail page containers, not inside `CartItems`, so
  transaction and expense report pages can preserve their desktop rail behavior.
- Avoid `truncate` on mobile product names in comfortable cart cards. Use natural
  wrapping on mobile and clamp only at wider breakpoints where the grid has a
  predictable width.
- Let SKU and barcode metadata use `break-all` on mobile because provisional
  codes and barcodes are operational identifiers, not prose.
- Resolve pending checkout events server-side in
  `convex/operations/operationalEvents.ts`; do not make the React product page
  issue a second timeline query or know about pending item internals.
- Deduplicate timeline subject IDs before fetching events so product, SKU, and
  pending item fan-out does not create duplicate rows.

## Verification

- Add React tests for mobile ordering on transaction and expense report detail
  pages.
- Add a cart item rendering test that asserts product names wrap instead of
  using `truncate` and that SKU metadata can break.
- Add a Convex timeline test that creates a provisional SKU, pending checkout
  item, and pending item operational event, then verifies the product timeline
  includes that event.
- Run focused tests for the affected React and Convex files, TypeScript,
  changed-file frontend and Convex lint, `audit:convex`, graphify rebuild, and
  the full Athena PR gate before merge.

## Prevention

- Do not use desktop grid spans as the only layout definition for mobile cart
  cards. Start with the phone layout, then opt into the dense desktop grid.
- Do not make summary rails outrank item evidence on narrow transaction or
  expense detail screens.
- Do not assume product timelines can be complete by querying only `product` and
  `product_sku` subjects. Recovery flows may use operational subjects that
  point back to product or SKU anchors.
