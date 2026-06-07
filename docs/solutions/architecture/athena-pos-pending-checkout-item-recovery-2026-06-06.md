---
title: "Athena POS Pending Checkout Item Recovery"
date: 2026-06-06
category: architecture
module: athena-webapp
problem_type: checkout_catalog_gap
component: pos
resolution_type: pending_review_audit_boundary
severity: high
tags:
  - pos
  - catalog-recovery
  - offline
  - audit
---

# Athena POS Pending Checkout Item Recovery

## Problem

Stores can reach checkout with sellable items that are not yet in the Athena
catalog. Cashiers need to keep the sale moving, but cashier-created catalog and
inventory records are too trusted for stores with dishonesty risk.

## Solution

Split checkout recovery from trusted catalog management:

- Cashiers create or reuse a `posPendingCheckoutItem` for the sale line.
- The pending item can be reused in later sales before manager review, so repeat
  demand raises review priority instead of blocking checkout.
- The sale line records `pendingCheckoutItemId` and the quantity sold, but never
  treats that quantity as trusted inventory.
- A hidden zero-stock product/SKU anchor exists only to satisfy existing cart and
  transaction shape until the item is reviewed.
- The server records operator-readable operational events for creation, reuse,
  and review decisions, including the actor and sold quantity evidence.
- Offline terminals record a `pending_checkout_item.defined` local event and sync
  it through the same idempotent POS local event projection as completed sales.

Manager/admin review is a reconciliation step, not a checkout precondition. A
reviewer can mark the evidence reviewed, link it to a real catalog item later,
reject it, or flag it for investigation.

## Boundaries

Do not convert pending checkout quantities into `quantityAvailable`,
`inventoryCount`, inventory movements, or stock holds. The only quantity fact in
this flow is "quantity sold in this transaction." Trusted inventory must come
from manager/admin catalog or inventory workflows after review.

Do not require manager approval for every pending item sale. Suspicious signals,
such as repeated use, lookup variation, or inconsistent prices, should raise the
review priority and audit visibility while preserving normal cashier flow.

## Prevention

- Keep pending checkout item creation at a server command boundary that derives
  the Athena actor from authentication.
- Keep offline pending item definitions in the POS local event log, not ad hoc
  browser storage.
- Preserve `pendingCheckoutItemId` through session items, transaction items, and
  sync projection.
- Exclude pending checkout lines from inventory validation, hold consumption,
  SKU decrement, and trusted stock reporting.
- Keep owner/admin review routes behind `full_admin`.
