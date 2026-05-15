---
title: Athena POS Local-First Runtime Feedback Mirrors The Local Event Log
date: 2026-05-15
category: architecture
module: athena-webapp
problem_type: offline_pos_runtime_feedback
component: pos
symptoms:
  - "The POS header can show pending sync even after IndexedDB events are marked synced"
  - "Online drawer-open events can remain pending until a later route or runtime trigger"
  - "Local-first transaction numbers can leak machine-readable local ids into cashier-facing lists"
  - "Manager drawer-open authentication can accidentally leave the register in an unsigned-out presentation state"
root_cause: local_first_runtime_state_was_not_refreshed_from_the_local_event_log_after_each_command
resolution_type: runtime_read_model_contract
severity: high
tags:
  - pos
  - local-first
  - sync
  - diagnostics
  - receipts
---

# Athena POS Local-First Runtime Feedback Mirrors The Local Event Log

## Problem

Once POS commands are always local first, the browser has two timelines to keep
honest: the durable IndexedDB event log and the visible register runtime state.
It is not enough for sync to mark an event as uploaded in IndexedDB if the
header, diagnostic panel, staff indicator, or transaction list still reflect an
older local read model.

The main failure modes are subtle:

- Important events such as `register.opened` look pending while the terminal is
  online because the runtime waits for a later incidental refresh.
- The UI can say synced while the local event row still says pending, or the
  reverse, depending on which source last updated.
- A local receipt identifier can leak into operator surfaces as
  `local-txn-...` instead of the same human-readable transaction number used by
  cloud-first POS.
- Staff proof and manager drawer-open state can sync correctly while the
  presentation layer still behaves as if no cashier is signed in.

## Solution

Treat local event append as the runtime wake-up boundary. After a POS command is
durably appended, the runtime should refresh the local event summary, mark the
specific trigger source, and attempt upload immediately when the browser has an
active connection. Route entry, reconnect, manual retry, and timer triggers can
still exist, but they are fallbacks rather than the primary feedback path.

Render POS sync status from the same local event summary that upload mutates.
When upload marks rows synced, failed, or pending review, the header and debug
panel should observe that change without needing a page refresh. Stale async
runtime callbacks must be ignored after the terminal, store, or local seed scope
changes, otherwise an older upload result can overwrite the current register
state.

Keep two receipt identifiers:

- `localReceiptNumber` is a durable, terminal-scoped local idempotency key for
  sync and reconciliation.
- `receiptNumber` is the human-readable transaction number shown to cashiers,
  transaction history, receipts, and cloud projections.

Cloud projection should use `receiptNumber` for the transaction number while
retaining `localReceiptNumber` for local-to-cloud mapping and retry idempotency.

## Diagnostics

POS diagnostics are support tooling, not cashier workflow copy. They can expose
sync source, trigger, proof, upload, and cloud-current state, but labels should
stay operational and avoid raw backend jargon where possible. The debug panel
must be available in all environments through the supported shortcut so a
production support session can inspect runtime flow without shipping a separate
build.

Operator toasts should describe the completed action, not the background sync
implementation. For example, opening a drawer should present `Drawer open`.
Item-add, sale-started, and sale-completed success toasts are redundant when the
cart and transaction-complete screen already show the result.

## Prevention

- Trigger runtime sync immediately after local event append when online.
- Refresh header/debug status from the local event store after upload changes
  row sync state.
- Guard async runtime callbacks against stale terminal, store, and seed scopes.
- Keep staff signed-in presentation derived from local-first session state, not
  only from cloud session state.
- Never show `local-*` ids as cashier-facing transaction numbers.
- Test the public sync contract and projection contract whenever local event
  payload fields are added.
- Keep debug copy support-facing and operator toasts action-facing.

## Related

- [Athena POS Local-First Sync Uses Event Logs](./athena-pos-local-first-sync-2026-05-13.md)
- [Athena POS Register Commands Are Always Local First](./athena-pos-always-local-first-register-2026-05-14.md)
- [Athena POS Local Staff Authority Uses Terminal-Scoped Verifiers](./athena-pos-local-staff-authority-2026-05-14.md)
