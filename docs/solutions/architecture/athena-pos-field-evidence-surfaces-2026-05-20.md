---
title: Athena POS Field Evidence Surfaces Stay Attached To Completed Facts
date: 2026-05-20
category: architecture
module: athena-webapp
problem_type: pos_field_troubleshooting_and_receipts
component: pos
symptoms:
  - "Operators need receipt or diagnostic proof after a local POS action finishes"
  - "Support diagnostics are useful in production but hidden behind platform-specific shortcuts"
  - "Expense completion can clear the workspace before receipt evidence is printed"
root_cause: evidence_was_treated_as_screen_state_instead_of_completed_workflow_state
resolution_type: completion_snapshot_plus_support_diagnostics
severity: medium
tags:
  - pos
  - local-first
  - diagnostics
  - receipts
  - expense
---

# Athena POS Field Evidence Surfaces Stay Attached To Completed Facts

## Problem

Field support and cashier workflows both need evidence after a POS action
finishes. If diagnostic panels, receipts, closeout gates, or completion screens
depend only on transient UI state, operators can lose the exact facts they need
to continue: which local event is pending, which register/session owns a gate,
which staff actor completed work, or which expense report should print.

This is especially risky in local-first POS because successful local completion
and later cloud reconciliation are separate events. The UI should not imply that
the cloud is the source of immediate cashier success, but it should preserve
enough evidence for support and follow-up printing.

## Solution

Keep operator-facing evidence tied to completed workflow facts:

- Preserve completed transaction or expense report snapshots long enough for the
  success screen, receipt printing, and intentional reprint actions.
- Use separate receipt renderers for distinct workflow semantics. POS sale
  receipts can include customer/payment/change language; expense report
  receipts should be internal inventory evidence and should not imply a sale.
- Return persisted identifiers from completion commands, such as transaction id,
  report number, and completion time, so receipts and success panels use the
  durable record rather than inventing a client label.
- Keep register diagnostics available in the register shell even when the
  operator is gated by sync, closeout, or staff-auth state. The diagnostics
  explain what support needs to inspect without forcing the cashier out of the
  workflow.
- Make support shortcuts cross-platform. A diagnostics shortcut that only
  checks `Meta` works on macOS but fails on Windows and Linux; use both
  `Meta+/` and `Control+/` when the action is meant for all terminals.
- Keep display shortcuts secondary to visible operational controls. Shortcuts
  should help support, not be the only way an operator can respond to a gate.

## Regression Targets

- POS register tests should prove the support diagnostics panel opens with both
  macOS and Windows/Linux modifier keys.
- Expense completion tests should prove the completion command result preserves
  the persisted report id/number and completed-at timestamp in the success
  state before the next expense clears it.
- Receipt tests should prove expense receipts print from completed expense
  facts and can be intentionally reprinted from the expense report detail page.
- POS local sync tests should keep support diagnostics aligned with local event
  sequence, upload sequence, runtime mode, pending counts, and failure details.
- Register gate tests should prove closeout or locally-closed states render
  inside the register shell with enough context for the operator to respond.

## Prevention

- Do not clear completed workflow evidence until the user explicitly starts the
  next workflow.
- Do not reuse POS sale receipt copy for expense, closeout, or internal
  inventory evidence.
- Do not make support-only diagnostics depend on a single operating-system
  modifier key.
- Do not compute diagnostic labels from filtered upload state when local event
  order and upload order are different concepts.
- Run the changed POS register tests and the full `pr:athena` gate after
  changing register diagnostics, local sync, completion, or receipt behavior.
