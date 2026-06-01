---
title: "Trace POS quick-add catalog recovery with operational events"
date: 2026-05-30
category: architecture
module: athena-webapp
problem_type: auditability
component: pos-quick-add
resolution_type: operational_event_audit_boundary
severity: medium
tags:
  - pos
  - quick-add
  - operational-events
  - audit
---

## Problem

POS quick add creates or changes catalog records from checkout-adjacent recovery
flows. Without a server-side audit row, operators cannot later answer which item
was added, which barcode was attached, or which Athena user performed the action.

## Solution

Record successful quick-add catalog mutations as `operationalEvent` rows from the
Convex command boundary:

- `pos_quick_add_product_created` when the flow creates a new hidden quick-add
  product and SKU.
- `pos_quick_add_variant_created` when the flow adds a SKU to an existing
  product.
- `pos_quick_add_barcode_attached` when the flow attaches a scanned barcode to
  an existing SKU.

Use `product_sku` as the subject, set `actorUserId` from the command's
`createdByUserId`, include the store organization, and put product/SKU/barcode,
price, and quantity details in metadata.

The event `message` should also be operator-readable on its own because Daily
Operations previews it directly. Include the actor label and quantity for
created products or variants, for example: `Kwamina Nuh quick added Cheeky
Bastard with quantity 1.`

## Prevention

Keep quick-add audit records in `operationalEvent` unless the domain grows a
real lifecycle trace. Workflow trace milestones should stay reserved for domains
that already own a lifecycle, such as POS sessions and register sessions.
