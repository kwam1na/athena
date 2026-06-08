---
title: Athena Cash Controls Closeout Review IA
date: 2026-06-08
category: logic-errors
module: athena-webapp
problem_type: missing_context
component: cash-controls
symptoms:
  - "Synced closeout review states showed manager-facing warning copy without the staff note entered during closeout"
  - "Register detail and dashboard cards repeated review status lines instead of prioritizing the cash values that drive the decision"
  - "Variance amounts were visually neutral, making overage and shortage states harder to scan"
root_cause: presentation_projection_gap
resolution_type: ui_state_contract
severity: medium
tags:
  - cash-controls
  - closeout-review
  - register-sync
  - operations-ia
---

# Athena Cash Controls Closeout Review IA

## Problem

Synced register closeout review is a cross-surface state: the projection layer
creates the review item, the register detail page approves or rejects it, and
the Cash Controls dashboard summarizes the same drawer for managers. When the
UI only presents the backend review reason, managers lose the cashier-entered
closeout note and have to infer why the variance happened from duplicated
status lines.

The failure mode is especially easy to introduce when desktop and mobile
layouts are refined independently. A mobile-first warning banner can become too
loud on desktop, action buttons can compete with the evidence, and dashboard
cards can repeat the same register in multiple lanes.

## Solution

Treat a closeout review item as a compact decision packet, not as a generic
sync-review warning. The projection should carry the closeout note and counted
cash context into the review item. The detail view should show expected,
counted, and variance values together, keep the staff note visible when present,
and place approve/reject actions after the evidence so the manager reads before
acting.

Dashboard cards should collapse the duplicate "needs action" and "live drawer"
state for closeout-review sessions. In that state, show the register identity
once, use value rows for expected cash and variance, and keep the action link
focused on reviewing the closeout.

Variance presentation should encode direction consistently. Positive values use
the existing success/green treatment, negative values use the destructive/red
treatment, and zero or missing variance remains neutral.

## Prevention

- When adding or changing register sync review items, verify the projection
  includes operator-entered context that managers need to decide, especially
  notes captured at the original action point.
- Keep closeout review layouts value-first: identity, cash values, staff note,
  then actions.
- Avoid showing the same closeout-review register in multiple dashboard lanes;
  consolidate the state and let the card explain why action is needed.
- Add component tests for staff notes, variance direction styling, dashboard
  consolidation, and action placement whenever closeout review IA changes.
