---
title: Athena POS Item Adjustment Reports Preserve Original Sale Totals
date: 2026-05-20
category: logic-errors
module: athena-webapp
problem_type: logic_error
component: pos
symptoms:
  - "Completed transaction item adjustments need to affect settlement and cash movement reports"
  - "Reusing original sale total fields for adjusted values would make daily close reports ambiguous"
  - "Pending or rejected adjustment requests could be accidentally counted before they are applied"
root_cause: adjusted_value_without_explicit_report_field
resolution_type: code_fix
severity: high
tags:
  - pos
  - daily-close
  - daily-operations
  - cash-controls
  - validation-map
---

# Athena POS Item Adjustment Reports Preserve Original Sale Totals

## Problem

Completed-sale item adjustments create a second financial fact: the original receipt total remains historical truth, while the applied adjustment creates an effective adjusted total and, sometimes, a refund or collection settlement. Reports become misleading if they silently reinterpret `salesTotal`, `paymentTotals`, or completed transaction totals as adjusted values.

## Solution

Keep original sale fields stable and add explicit adjusted/net fields beside them:

- `salesTotal` and `paymentTotals` continue to describe the original completed sale rows.
- `adjustedSalesTotal` describes completed sales after applied item adjustments.
- `adjustmentCollectionTotal`, `adjustmentRefundTotal`, and `adjustmentNetSettlementTotal` describe applied adjustment settlement.
- `adjustmentCashSettlementTotal` and `netCashMovementTotal` make cash movement explicit without hiding the original cash-tendered sale amount.
- Pending, rejected, cancelled, or stale adjustments are excluded from adjusted/net totals.

Daily close should also show applied item adjustments as separate ready items so operators can see the original transaction and adjustment settlement as distinct evidence.

## Prevention

- Add report fields rather than changing the meaning of existing transaction or payment totals.
- Build tests with both no-adjustment and applied-adjustment cases so zero-valued compatibility and new settlement math are both protected.
- Include pending and rejected adjustment rows in tests to prove they do not affect adjusted/net totals.
- Keep the validation map pointed at POS adjustment commands, schemas, transaction detail, cash controls, daily close, and daily operations together because the workflow crosses all of those surfaces.
