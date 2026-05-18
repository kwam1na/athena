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
- Persist that order with the local event row. The upload cursor is per local
  register session, while local-only precursor events keep normal local event
  ordering without consuming upload sequence.
- Keep cashier attribution on the event as actor evidence for receipts,
  transactions, payment allocation, cash controls, and workflow traces.
- Persist the cashier's event-scoped sync proof on uploadable pending events
  when they are appended. Upload cannot depend on the cashier proof still being
  available in memory after a reload or staff switch.
- Keep submission authority separate from actor attribution. The POS hub or
  provisioned terminal submits the batch with terminal-scoped authority, while
  the event payload preserves the original cashier/manager actor.
- Treat the POS hub and provisioned terminal as the foreground sync drain owner.
  The register flow appends durable events and can show status, but it should
  not be the surface that decides whether upload runs.
- Allow the register flow to trigger a narrow, one-shot drain immediately after
  an uploadable local event is appended. This is an opportunistic online upload
  hint, not a foreground scheduler: it must not make Convex upload part of the
  cashier success path, and it must not replace hub route-entry, reconnect,
  visibility, or interval catch-up drains.
- Do not require the original cashier to sign in again just to drain local
  history. Permission drift should become reconciliation or review work, not a
  permanent upload blocker.
- Keep local-only precursor events, such as no-item `session.started` records,
  out of the upload sequence so they cannot strand sync.

## Regression Targets

The V26-604/V26-605 regression set should prove the bug as a full multi-staff
offline sequence, not just as isolated helpers:

- `posLocalStore.test.ts` should prove uploadable events receive immutable
  upload sequence when appended, while `session.started`, cart item updates, and
  payment edits remain local-only and do not consume upload sequence.
- `syncContract.test.ts` should prove an event without the original cashier's
  proof remains uploadable, later staff events do not shift into earlier
  sequence numbers, and upload uses the stored `uploadSequence`.
- `usePosLocalSyncRuntime.test.ts` should prove `drainEnabled: false` reads
  status without calling `ingestLocalEvents`, while hub-owned
  `drainEnabled: true` uploads pending rows on route entry or reconnect.
- `usePosLocalSyncRuntime.test.ts` should also prove the register can opt into
  a one-shot post-append drain from status-only mode without uploading on route
  entry by default.
- `PointOfSaleView.test.tsx` should prove opening `/pos` with a provisioned
  terminal starts a hub drain for pending uploadable events.
- `useRegisterViewModel.test.ts` and `POSRegisterView.test.tsx` should prove the
  register can show pending/synced status without owning upload and that compact
  labels stay limited to `pending sync` and `synced`.
- POS support diagnostics should show both browser-local event sequence and
  upload sequence. Local event order explains the IndexedDB timeline; upload
  sequence explains Convex cursor failures such as out-of-order held events.
- `ingestLocalEvents.test.ts` and `public/sync.test.ts` should prove one
  terminal authority can submit ordered events for multiple actor staff profiles,
  accepted retries stay idempotent, and true missing earlier upload sequence is
  still held as out-of-order evidence.
- `projectLocalEvents.test.ts` should prove sale, payment, receipt,
  cash-control, and workflow-trace projection retain actor staff attribution,
  while permission drift becomes review/conflict state without losing the local
  sale timeline.

For plan HTML review artifacts, use the repo-local HTML validator rather than
system `tidy`. The local validator accepts semantic HTML5 review artifacts while
still enforcing the important constraints: static HTML, a charset, a title, no
JavaScript, and no remote assets.

## Prevention

- Never compute POS upload sequence from a filtered set of currently syncable
  events.
- Never make original staff proof presence the gate for preserving upload order.
- Never keep pending upload proof only in memory; event-scoped proof must
  survive reload until the event reaches synced or review state.
- Keep actor staff identity separate from terminal or hub submission authority.
- Keep the validation map pointed at every POS local sync boundary, including
  the local sync repository, shared sync contract, hub/register runtime, local
  store, ingestion, projection, and public sync endpoint. Otherwise changed-file
  validation can miss the exact ordering and actor-vs-submitter regressions.
- Run `bun run plan-html:check` for plan HTML review artifacts instead of
  falling back to system `tidy`.
- Update `docs/solutions` whenever POS local sync ownership, ordering, or
  reconciliation behavior changes substantially.

## Related

- [Athena POS Local-First Sync Uses Event Logs](./athena-pos-local-first-sync-2026-05-13.md)
- [Athena POS Local Staff Authority Uses Terminal-Scoped Verifiers](./athena-pos-local-staff-authority-2026-05-14.md)
- [Athena POS Local-First Runtime Feedback Mirrors The Local Event Log](./athena-pos-local-first-runtime-feedback-2026-05-15.md)
- Linear: V26-604, V26-605
