---
title: Athena Procurement Keeps SKU Pressure As The Stock Continuity Source
date: 2026-05-05
category: logic-errors
module: athena-webapp
problem_type: logic_error
component: stock-ops
symptoms:
  - "Procurement could show low-stock recommendations without giving operators an in-context reorder path"
  - "Draft, submitted, and approved purchase orders could be confused with real inbound stock cover"
  - "Vendor, purchase-order, and receiving actions were split away from the daily SKU pressure queue"
root_cause: missing_workflow_step
resolution_type: code_fix
severity: medium
tags:
  - procurement
  - stock-ops
  - sku-pressure
  - purchase-orders
  - receiving
  - vendors
---

# Athena Procurement Keeps SKU Pressure As The Stock Continuity Source

## Problem

Procurement is operational stock continuity work, not just purchase-order
administration. Operators need to start from exposed SKU pressure, then decide
whether to create vendor-backed draft POs, advance planned work, receive inbound
stock, or resolve an exception.

The previous workspace surfaced low-stock recommendations and PO facts, but it
did not make the ownership boundaries explicit enough for daily operation.

## Solution

Keep four boundaries distinct:

- The SKU pressure read model owns the decision state. It derives exposed,
  planned, inbound, partially covered, resolved, and exception states from
  inventory, vendor, purchase-order, and receiving facts.
- The reorder draft owns short-lived browser selection. It lets the operator
  choose SKUs, adjust suggested quantities, and assign vendors before durable PO
  creation.
- Purchase-order and receiving commands own durable mutations. Creating draft
  POs, submitting, approving, marking ordered, cancelling, and receiving stock
  all stay server-owned and permission checked.
- Inventory movements own stock facts. Receiving can change stock; planned PO
  action cannot pretend inventory is covered until the order is actually
  inbound or received.

This keeps the procurement workspace SKU-pressure-first while still using POs as
the durable execution artifact.

## Interface Pattern

Keep the main stock-pressure list as the operator's source of truth. Purchase
orders can appear in the right rail for broad awareness, but row-level actions
belong beside the stock item they affect. When a purchase order is ready to
order or receive, put the command on that row so the operator can see the SKU,
vendor, order identifier, and cover state before acting.

Show purchase-order identity as supporting metadata, not as the primary object.
The row should lead with product and stock state, then show vendor and purchase
order details where they help reconcile multiple vendors or multiple purchase
orders for the same SKU. Avoid status badges that share the main action color;
state labels should read as facts, while buttons should read as commands.

When an authorized operator starts receiving, mark the active purchase-order row
as the row being received and open a compact receiving panel in the rail. After a
successful receipt, close that panel instead of leaving an empty 0-unit workflow
behind. This keeps the workspace focused on the remaining stock-continuity work.

## Why This Works

Operators think in terms of stock risk: what is exposed, what is already being
handled, what is inbound, and what is broken. A purchase-order-first view makes
them reconcile those facts manually.

The read model can safely explain current pressure because it does not mutate
state. The browser draft can stay local because it is review intent, not
business history. Durable commands remain the only place where vendor, PO,
receiving, operational-event, and inventory records change.

## Prevention

- Do not count draft, submitted, or approved PO lines as inbound cover.
- Do not persist reorder drafts until there is a clear operator need for saved
  procurement planning sessions.
- Do not create POs without a vendor; vendor-backed POs are the procurement
  execution artifact.
- Keep expected vendor, PO, and receiving failures behind command-result
  wrappers so operator copy stays calm and actionable.
- Keep receiving as the inventory mutation path; lifecycle status changes alone
  should not alter stock counts.
- If a command can advance a draft purchase order to the next operational state,
  make that sequence server-owned behind one explicit operator command instead
  of forcing the UI through every intermediate transition.
- Use plain operator language in the workspace: spell out purchase order in
  visible copy, reserve compact identifiers for reconciliation, and prefer
  "Handled" for completed stock-pressure work.

## Related Issues

- Linear: V26-482, V26-483, V26-484, V26-485, V26-486, V26-487.
- GitHub: https://github.com/kwam1na/athena/pull/377
