---
title: Athena POS Local Sync Drains From The Hub
date: 2026-05-18
category: architecture
module: athena-webapp
problem_type: offline_pos_sync_ordering
component: pos
symptoms:
  - "Offline POS events remain pending after reconnect until the original cashier signs in"
  - "Later cashier events can sync before earlier local history"
  - "POS sync diagnostics show out-of-order holds for history that exists locally"
root_cause: upload_order_was_derived_from_currently_syncable_staff_proof_state
resolution_type: terminal_owned_sync_drain
severity: high
tags:
  - pos
  - local-first
  - offline
  - sync
  - reconciliation
---

# Athena POS Local Sync Drains From The Hub

## Problem

POS local sync order must be stable even when multiple cashiers use the same
provisioned terminal offline. The broken pattern is to decide which events are
syncable by checking for the currently signed-in cashier's transient proof and
then deriving upload sequence from that filtered set.

That makes local history mutable at upload time. If Staff A creates earlier
offline events, signs out, and Staff B later completes a sale, Staff A's events
can disappear from the upload set while Staff B's events receive lower upload
sequence numbers. The backend correctly enforces contiguous local register
history, so the omitted earlier events are later held as out of order.

## Solution

Make upload sequence and upload ownership terminal-local concepts:

- Assign upload ordering when uploadable local POS events are written, not when
  they are uploaded.
- Keep cashier attribution on the event as actor evidence for receipts,
  transactions, payment allocation, cash controls, and workflow traces.
- Treat the POS hub and provisioned terminal as the foreground sync drain owner.
  The register flow appends durable events and can show status, but it should
  not be the surface that decides whether upload runs.
- Do not require the original cashier to sign in again just to drain local
  history. Permission drift should become reconciliation or review work, not a
  permanent upload blocker.
- Keep local-only precursor events, such as no-item `session.started` records,
  out of the upload sequence so they cannot strand sync.

For plan HTML review artifacts, use the repo-local HTML validator rather than
system `tidy`. The local validator accepts semantic HTML5 review artifacts while
still enforcing the important constraints: static HTML, a charset, a title, no
JavaScript, and no remote assets.

## Prevention

- Never compute POS upload sequence from a filtered set of currently syncable
  events.
- Never make original staff proof presence the gate for preserving upload order.
- Keep actor staff identity separate from terminal or hub submission authority.
- Run `bun run plan-html:check` for plan HTML review artifacts instead of
  falling back to system `tidy`.
- Update `docs/solutions` whenever POS local sync ownership, ordering, or
  reconciliation behavior changes substantially.

## Related

- [Athena POS Local-First Sync Uses Event Logs](./athena-pos-local-first-sync-2026-05-13.md)
- [Athena POS Local Staff Authority Uses Terminal-Scoped Verifiers](./athena-pos-local-staff-authority-2026-05-14.md)
- [Athena POS Local-First Runtime Feedback Mirrors The Local Event Log](./athena-pos-local-first-runtime-feedback-2026-05-15.md)
