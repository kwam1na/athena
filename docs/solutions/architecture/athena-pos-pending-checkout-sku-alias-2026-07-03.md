---
title: Athena POS Pending Checkout SKU Alias
date: 2026-07-03
category: architecture
module: athena-webapp
problem_type: architecture_pattern
component: service_object
resolution_type: code_fix
severity: high
applies_when:
  - "Linking POS pending checkout items to trusted catalog SKUs"
  - "Attributing pending checkout sale activity to trusted inventory"
  - "Preserving cashier sale evidence after catalog review"
tags:
  - athena-webapp
  - pos
  - pending-checkout
  - sku-alias
  - catalog
  - convex
---

# Athena POS Pending Checkout SKU Alias

## Problem

Pending checkout review can link a cashier-created item to an existing trusted
catalog SKU. If downstream code keeps treating every `pendingCheckoutItemId` as
unresolved provisional inventory, the linked item disappears from the review
queue without behaving like a normal trusted SKU in POS search, checkout,
operations timelines, or product activity.

## Solution

Treat `linked_to_catalog` pending checkout items as aliases to their approved
trusted SKU at command and read boundaries, while preserving
`pendingCheckoutItemId` as audit provenance.

The implementation has three durable pieces:

- A server-side resolver classifies pending checkout identity. Unresolved
  pending items keep existing cashier-continuity behavior; linked items resolve
  to `approvedProductId` and `approvedProductSkuId`; finalized trusted rows stay
  trusted.
- A narrow lookup-alias projection maps a pending lookup code to the approved
  trusted SKU when the trusted SKU already has a barcode. Linking must not
  overwrite existing trusted barcode data just to preserve a cashier-entered
  lookup code.
- Checkout and read models use the trusted SKU for future stock validation,
  inventory movement, operations attribution, and cart source keys. They do not
  fabricate retroactive stock movement for earlier pending sales.

The key boundary is identity versus stock mutation. Linking changes which SKU
owns display and attribution for the pending item. It does not by itself create
trusted inventory movement for prior cashier sales.

```ts
if (
  pendingItem.status === "linked_to_catalog" &&
  pendingItem.approvedProductId === item.productId &&
  pendingItem.approvedProductSkuId === item.productSkuId
) {
  // Treat this sale line as trusted inventory from this command forward.
  linkedPendingTrustedItemIds.add(item.pendingCheckoutItemId);
}
```

POS frontend projection should not infer alias semantics from arbitrary pending
ids. It should consume server-resolved rows and use an explicit alias state only
when pending provenance is still present:

```ts
if (
  product.pendingCheckoutItemId &&
  product.pendingCheckoutAliasState !== "linked_to_catalog"
) {
  return `pending_checkout:${product.pendingCheckoutItemId}`;
}

return "trusted_inventory";
```

## Why This Matters

Operators see the same SKU everywhere after review: barcode lookup, search,
cart merge behavior, transaction completion, Daily Operations, product
timelines, and SKU activity attribution all converge on the trusted SKU. At the
same time, Athena keeps the cashier-created pending item as source evidence, so
review history and ledger provenance remain auditable.

The separation also protects inventory integrity. Old pending sale evidence is
not silently converted into stock movement, and a later correction must use an
explicit inventory-affecting workflow if stock needs repair.

## Prevention

- Use a shared server-owned pending checkout resolver before adding new pending
  checkout branches in POS commands or reads.
- Preserve `pendingCheckoutItemId` in source records when it explains sale
  provenance, but use approved trusted product/SKU ids for linked alias
  display, attribution, and future trusted checkout commands.
- Add bounded indexes or projections for alias lookup paths instead of scanning
  pending checkout items from catalog/search or product timeline reads.
- Block relinking after transaction attribution unless a new audited correction
  workflow owns the historical meaning change.
- Cover both unresolved and linked states in tests: unresolved pending must
  avoid trusted stock mutation, while linked aliases must validate and decrement
  the trusted SKU for future sales.

## Examples

A linked pending item with lookup code `ALIAS-1` and approved SKU `SKU-1`
should resolve barcode lookup to `SKU-1`. If `SKU-1` already has barcode
`TRUSTED-1`, keep that barcode and insert a pending lookup alias for `ALIAS-1`.

A session item that still carries `pendingCheckoutItemId` should be treated as
trusted only when the pending item is `linked_to_catalog` and its approved
product/SKU matches the line's trusted product/SKU. Mismatched, missing,
flagged, or pending-review items keep the existing unresolved pending behavior.

A Daily Operations event for a linked pending item should route product links
to the approved trusted product/SKU. The event can still expose the pending
subject where authorized, but the product attribution belongs to the trusted
catalog SKU.

## Related

- `docs/plans/2026-07-03-001-fix-pending-checkout-sku-alias-plan.md`
- `docs/solutions/architecture-patterns/athena-pending-checkout-inventory-resolution-2026-07-03.md`
- `docs/solutions/architecture/athena-pos-pending-checkout-item-recovery-2026-06-06.md`
- `docs/solutions/architecture/athena-pos-provisional-import-availability-2026-06-11.md`
- `docs/solutions/logic-errors/athena-pos-ledger-safe-corrections-2026-04-30.md`
- `packages/athena-webapp/convex/pos/application/pendingCheckoutSkuResolution.ts`
- `packages/athena-webapp/convex/pos/public/catalog.ts`
- `packages/athena-webapp/convex/pos/application/commands/completeTransaction.ts`
- `packages/athena-webapp/convex/operations/dailyOperations.ts`
- `packages/athena-webapp/convex/operations/operationalEvents.ts`
