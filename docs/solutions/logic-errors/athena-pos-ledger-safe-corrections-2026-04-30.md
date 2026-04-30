---
title: Athena POS Corrections Preserve Ledger Facts Through Audited Events
date: 2026-04-30
category: logic-errors
module: athena-webapp
problem_type: logic_error
component: pos
symptoms:
  - "Operators needed to recover from wrong opening floats, customer attribution, or payment methods after busy POS workflows"
  - "Direct edits to completed transactions would risk hiding the original operational fact"
  - "Payment-method corrections could drift from payment-allocation summaries if only transaction display fields changed"
root_cause: correction_without_audit_boundary
resolution_type: code_fix
severity: high
tags:
  - pos
  - corrections
  - cash-controls
  - payment-allocation
  - operational-events
---

# Athena POS Corrections Preserve Ledger Facts Through Audited Events

## Problem

POS corrections are tempting to model as direct edits: change the opening float, swap the customer, or rewrite the payment method. That is unsafe for completed operational records because later reports need to know both the original fact and the recovery action.

## Solution

Treat corrections as command-boundary workflows:

- Classify the correction intent before exposing or applying it.
- Allow direct effective-value updates only for safe cases, such as opening-float corrections while a drawer is still open or active.
- Record every successful correction as an `operationalEvent` linked to the original subject.
- Keep completed transaction totals, items, discounts, cashier, register-session cash movement, and inventory untouched for metadata-only customer corrections.
- For payment-method correction, support only the same-amount single-payment/single-allocation case and patch the transaction display plus matching payment allocation together.
- Route unsupported item, quantity, amount, discount, and inventory changes to refund, exchange, manager review, or future workflows instead of creating orphaned approval records.

## Opening Float

Opening-float correction updates the effective `openingFloat` and adjusts `expectedCash` by only the float delta. Sale and deposit movement stays intact. Same-value corrections return success without creating duplicate audit history. Closing or closed drawers are blocked from direct mutation.

## Completed Transactions

Customer attribution correction is metadata-only. It may change the transaction's customer display state or clear it back to walk-in, but it must not modify financial, payment, item, cashier, register-session, or inventory fields.

Payment-method correction is stricter. The safe representation is a same-amount single-payment correction where the transaction payment row and the one matching incoming payment allocation are updated together. Multi-payment, amount-changing, or ambiguous allocation cases should return guided feedback.

## Prevention

- Do not rely on UI gates as the integrity boundary; command mutations must reject unsupported correction states.
- Do not add a direct edit control for completed sale totals, line items, discounts, or inventory movement.
- When adding a new correction category, add policy tests, command-result tests, operational-event history tests, and display tests together.
- If a correction requires approval, only create approval requests that have a concrete resolver path. Unsupported categories should show guidance instead of producing pending work that cannot be safely applied.

## Related Issues

- Linear: V26-415, V26-416, V26-417, V26-418, V26-419, V26-420, V26-421, V26-422.
