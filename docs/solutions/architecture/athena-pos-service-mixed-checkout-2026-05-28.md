---
title: Athena POS Service Mixed Checkout Keeps Retail And Service Ledgers Split
date: 2026-05-28
category: architecture
module: athena-webapp
problem_type: pos_service_mixed_checkout_boundary
component: pos
symptoms:
  - "Mixed service and retail receipts can hide which amount belongs to a service case"
  - "Service material usage can be mistaken for a customer-purchased retail add-on"
  - "Split payment allocations can accidentally count one drawer tender more than once"
root_cause: service_and_retail_checkout_targets_have_different_systems_of_record
resolution_type: ledger_boundary_rule
severity: high
tags:
  - pos
  - service-ops
  - receipts
  - cash-controls
  - local-first
---

# Athena POS Service Mixed Checkout Keeps Retail And Service Ledgers Split

## Problem

A cashier can collect one payment for a service and retail product add-ons, but
Athena cannot treat both lines as the same kind of sale. Retail add-ons belong
to POS product items and inventory movement. Service work belongs to first-class
service cases, service balances, and service payment allocations.

If those targets blur, reports become ambiguous, service cases can lose payment
context, and cash controls can count one tender twice when allocations split.

## Solution

Mixed POS checkout must keep three facts explicit:

- Product add-ons are customer-purchased retail lines. They stay in
  `posTransactionItem` and continue to restore inventory through the retail void
  path.
- Service lines are service-case payments. Receipts and transaction detail can
  show the service line and linked service case, but the service case remains the
  service system of record.
- Drawer movement is the tender event. Payment allocations may split retail and
  service value, but register-session expected tender is recorded once for the
  full collected payment.

Internal service material usage stays outside POS v1. Staff-consumed materials
remain Service Ops inventory usage and should not be auto-created from product
add-ons.

## Prevention

- Keep service catalog search local-first by snapshotting POS-ready active
  service catalog rows alongside product catalog readiness. Do not make service
  checkout depend on a live Convex service-catalog query.
- Add service and retail allocation totals as explicit report fields when a
  report needs both. Do not silently reinterpret existing retail totals.
- Block mixed-sale voids unless the implementation can reverse service case
  payment state, retail inventory, payment allocations, and drawer tender
  together. V1 should route unsupported service-payment reversal through Service
  Ops instead of voiding only the retail side.
- Keep harness validation mapped across POS transaction detail, service cases,
  service catalog readiness, payment allocations, daily close, and cash controls
  whenever mixed checkout surfaces change.

## Related

- [Athena POS Register Commands Are Always Local First](./athena-pos-always-local-first-register-2026-05-14.md)
- [Athena POS Local-First Sync Uses Event Logs](./athena-pos-local-first-sync-2026-05-13.md)
