---
title: Athena POS Completed Transaction Voids Use Approved Ledger Reversal
date: 2026-05-21
category: logic-errors
module: athena-webapp
problem_type: logic_error
component: pos
symptoms:
  - "A completed sale void could patch transaction state without approval proof"
  - "Inventory restoration could happen through direct SKU edits without movement evidence"
  - "Payment and cash reversal state could be difficult to reconstruct from operational history"
  - "Retried void submissions could create multiple pending approval requests for one sale"
root_cause: completed_sale_void_without_command_boundary
resolution_type: code_fix
severity: high
tags:
  - pos
  - voids
  - payment-allocation
  - inventory-movement
  - approval-policy
---

# Athena POS Completed Transaction Voids Use Approved Ledger Reversal

## Problem

A completed POS sale is a financial and inventory fact. Voiding it as a direct
transaction edit hides too much: the operator intent, manager approval, payment
reversal, cash drawer effect, and stock restoration can drift across separate
records or disappear from the audit trail.

## Solution

Treat completed-sale voids as command-boundary reversals:

- Return `approval_required` from the same command that will perform the void.
- Reuse an existing pending void approval request for the sale so retries are
  idempotent.
- Consume a manager approval proof server-side before any durable reversal write.
- Validate daily close, register session identity, terminal identity,
  transaction status, and item adjustment boundaries before writing payment,
  cash, inventory, or transaction state.
- Preserve the original completed sale and mark the transaction void only after
  reversal evidence is recorded.
- Record outbound `retail_sale_void` payment allocations for the original
  transaction target.
- Use register-session cash-control rails for cash reversals instead of
  recalculating drawer totals in the UI.
- Restore stock through committed `inventoryMovement` rows so SKU activity can
  explain why inventory increased.
- Aggregate duplicate sale lines by SKU before restoration so one transaction
  cannot under-restore inventory.
- Record a `pos_transaction_voided` operational event with approval and reversal
  references, then expose void metadata through transaction read models.

## Prevention

- Do not add a browser-only void button around a direct mutation.
- Do not restore SKU quantity without an inventory movement source and SKU
  activity evidence.
- Do not allow voids for sales inside completed EOD Review, sales with pending
  or applied item adjustments, sales missing drawer identity, or cash sales
  whose register state cannot accept the reversal.
- Query the relevant EOD Review operating date directly; avoid fixed-size scans
  for closeout eligibility.
- Keep the transaction detail UI on the shared command approval runner so future
  POS reversal workflows reuse the same approval proof path.
- Test the command contract, no-side-effect blocked states, ledger reversal,
  read-model projection, and transaction-detail workflow together.

## Related Issues

- Linear: V26-619, V26-620, V26-621, V26-622, V26-623, V26-624.
