---
title: Athena POS Register Review and Adjusted Sale Projection
date: 2026-05-21
category: logic-errors
module: athena-webapp
problem_type: logic_error
component: pos
symptoms:
  - "Offline synced sales can be attached to a closed register session but remain invisible to closeout totals"
  - "Register review banners can explain that activity needs review without showing which local events are unresolved"
  - "Adjusted transaction detail views can continue showing original item quantities and totals after an approved correction"
root_cause: review_state_without_explicit_projection
resolution_type: code_fix
severity: high
tags:
  - pos
  - cash-controls
  - register-session
  - local-sync
  - item-adjustments
---

# Athena POS Register Review and Adjusted Sale Projection

## Problem

POS review states must not stop at flags. When local register activity syncs after a drawer has closed, the session needs a manager-visible review item and a way to project the reviewed sale into register totals. When a completed sale receives an approved item adjustment, the transaction detail view needs to show the adjusted operational truth first while keeping the original sale as audit context.

If either path only stores the review or adjustment event, operators see stale totals: cash controls can omit reviewed sales, and transaction detail can keep presenting the original item count and receipt total as if no adjustment was applied.

## Solution

Treat review and adjustment records as explicit projections:

- Register sync events that need manager review should expose the unresolved event count, readable event context, and a manager action that applies reviewed sales into the register session totals.
- The projection command should be idempotent and should only settle reviewed sale events that still need projection.
- Completed transaction detail should derive display items from applied adjustment lines when they exist, filtering removed lines and recalculating the read-only item totals.
- The summary rail should label adjusted financial truth directly: adjusted sale total, original sale total, item adjustment delta, and settlement movement.
- Original sale fields remain audit context. Do not silently reinterpret original receipt totals as adjusted totals.

## Prevention

- Keep tests for both pending and applied adjustment records so pending review does not alter displayed adjusted items or closeout totals.
- Test register review projection at the command boundary and the UI boundary: review item visibility, action availability, and projected sale totals.
- For completed transaction detail, assert the right rail receives adjusted item quantities and adjusted net total after approval.
- Use calm operator-facing copy for review states. Backend event IDs and queue details are useful evidence, but the primary labels should describe what needs manager attention.
