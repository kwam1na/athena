---
title: Athena POS Register Sync Repair and Runtime Reconciliation
date: 2026-06-26
category: logic-errors
module: athena-webapp
problem_type: logic_error
component: pos-register-sync
symptoms:
  - "Synced register review could only reject completed sales even when the business record should be retained"
  - "Cash Controls could show review items without a visible completed-sale mapping"
  - "The POS register could keep showing the open-drawer gate while the cloud terminal had an active register session"
root_cause: review_state_without_repairable_mapping_or_runtime_reconciliation
resolution_type: code_fix
severity: high
tags:
  - pos
  - cash-controls
  - register-session
  - local-sync
  - terminal-runtime
---

# Athena POS Register Sync Repair and Runtime Reconciliation

## Problem

Register sync conflicts are business-record problems, not just queue problems.
When a synced sale belongs to a completed POS transaction but is missing the
register-session mapping, rejecting the event loses the operational intent. The
manager needs a repair path that links the completed sale to the drawer and lets
the register totals settle.

The same boundary appears in the terminal runtime. A browser can have stale
local register history while the cloud terminal session is already active. If
the register view only trusts the stale local read model, the cashier sees the
open-drawer gate even though Cash Controls and the cloud terminal agree that the
drawer is active.

## Solution

Keep the repair bounded and evidence-driven:

- Register review actions should repair completed-sale mappings when the cloud
  sale exists and matches the reviewed local event. Reject remains available for
  genuinely invalid synced activity, but it is not the only manager path.
- Applying reviewed activity should hold closeout settlement behind a generic
  closeout-hold mechanism so future review types can block settlement without
  duplicating closeout-specific control flow.
- The POS heartbeat can return an active-register directive when local runtime
  status reports no usable drawer but the cloud terminal has a sale-usable
  register session.
- Runtime directive repair should append through the local command gateway, not
  mutate the event store directly. It must keep drawer-authority and terminal
  integrity checks, and it must not overwrite a different local drawer that is
  already operable.
- Debug state should show the heartbeat drawer, local read model, and repair
  seed result so support can see whether the mismatch is cloud state, local
  projection, or gateway rejection.

## Prevention

- Test the manager repair command at the Convex boundary and the Cash Controls
  UI boundary: visible review rows, per-item repair, batch apply, and linked
  transaction totals.
- Test local runtime reconciliation at three layers: the command gateway
  allowing only directive-scoped repair over stale history, the heartbeat hook
  recording repair diagnostics, and the register view model passing runtime
  state into the debug panel.
- Add a stale-directive regression whenever runtime reconciliation changes: a
  cloud directive must not seed over a different local drawer that can already
  sell.
- Keep the cashier hot path local-first. Cloud reads for reconciliation belong
  in the POS heartbeat/runtime channel, not inside sale-entry interactions.
- Treat future terminal-local state repair as event-model work. Do not patch
  IndexedDB records manually or hide stale local history by bypassing the read
  model.
