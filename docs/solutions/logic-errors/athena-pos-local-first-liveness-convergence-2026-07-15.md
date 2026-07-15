---
title: "POS local-first liveness and convergence hardening"
date: "2026-07-15"
category: logic-errors
module: athena-webapp
problem_type: logic_error
component: service_object
symptoms:
  - "A data-shaped projector condition throws after a sale row is written, aborting the ingest mutation and wedging a register's sync stream on every retry"
  - "The IndexedDB event ledger grows unbounded all day until appendEvent hits quota_exceeded and the terminal can no longer sell"
  - "A locally-cleared review shows as synced on the terminal while the server still holds the posLocalSyncConflict open"
  - "A held successor of a needs_review precursor loops silently in backoff forever"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags:
  - athena
  - pos
  - local-first
  - convex
  - sync
  - convergence
  - event-sourcing
delivery_diff_fingerprint: 3d96d5e5419f730de433939c959be80cc1695cfbd8ec68b7f6dd754cfb5f0150
---

# POS local-first liveness and convergence hardening

## Problem

The Athena POS runs local-first: sales append to an IndexedDB event log and drain to Convex via a single exactly-once ingest mutation. Four seams around that sound core produced liveness and convergence failures — a poison event could wedge a register's sync stream, an all-day terminal could grow into a quota-exceeded sell-block, a manager could "clear" a review that the server still held open, and a held successor could loop silently.

## Symptoms

- A projector that writes a sale row and then throws a data-shaped condition (e.g. the store organization is unresolved) aborts the whole batch; the retry throws again — the register wedges.
- Unbounded ledger growth → `quota_exceeded` on `appendEvent`.
- Terminal chip reads "synced"/"ready" while a `posLocalSyncConflict` stays `needs_review` server-side.
- A `held` event whose precursor is `needs_review` never advances and is indistinguishable from a transient network failure.

## What Didn't Work

- **Catch-and-continue around a projector.** Convex mutations are one OCC transaction with no partial-transaction rollback. Wrapping a projector in try/catch and continuing does not undo the writes it already made — it commits a corrupted half-projected sale. The fix must be validate-BEFORE-the-first-write, returning a `conflicted` result, not catch-after.
- **Treating `locally_resolved` as settled everywhere.** A locally-cleared review that the server has not acknowledged has not converged. Any surface that treats it as settled — the sync-status chip OR the ledger purge — is wrong. The purge case is the most dangerous: it would permanently delete the local record needed to reconcile.

## Solution

Four coordinated units, one integration PR:

1. **Total projection for data-shaped failures (U3).** Move the reachable post-write data condition — an unresolved store organization — ahead of the first `ctx.db` write in `validateSaleCompletedInputs`, returning a `needs_review` conflict for every sale (not only service sales). Zero committed rows for the poison event, the cursor advances, and good events in the batch still commit. Genuine infra errors still throw and abort for a real retry.

2. **Evidence-gated ledger purge (U4).** Activate the dead `assessPosLocalLedgerRetention` classifier with a `pastRetentionBoundary` fact and a `serverConfirmedResolution` fact, and add `store.purgeSettledLedgerEvents` — a selective purge that deletes only `settled_unreferenced` events past a store-day/rollover boundary, reusing the cashier-presence safety gate but not the whole-DB `events.length > 0` refusal. It consults drawer authority and `current` register mappings per event and never purges an unconfirmed `locally_resolved` event. Triggered at the runtime's idle health boundary when ledger pressure is elevated; the purge count is surfaced, never silent.

3. **Truthful sync status + held-cursor escalation (U5).** `derivePosLocalSyncStatus` treats a `locally_resolved` event as outstanding until `sync.localResolution.serverConfirmedAt` is set; `RegisterSyncStatusChip` renders an operable review as an actionable "needs review" attention chip, never masked as success "ready", while the register stays operable. The scheduler surfaces a held-without-forward-progress batch via `heldWithoutProgress` + `onHeldWithoutProgress`, and the runtime escalates once with a review-inclusive drain so the stuck precursor is re-projected.

4. **Round-trip local review resolution (U6).** An authorization-checked `resolveLocalSyncReview` mutation (one explicit POS org role, built on the existing `resolveConflictsForEvent` primitive, idempotent, attributable) transitions the server conflict to `resolved`. The terminal-recovery clear path round-trips through it and stamps `serverConfirmedAt` (the U5 convergence marker) only after the server acks; on failure the events stay `needs_review` to reconcile next sync.

## Why This Works

The event-sourcing core (single-mutation exactly-once ingest, durable-commit-before-ack, monotonic cursor) is untouched. Every fix sits at a seam: validation (U3), purge (U4), status derivation + scheduler (U5), and convergence round-trip (U6). The cross-cutting invariant that ties U4/U5/U6 together is **"a locally-cleared review is not settled until the server confirms it"** — encoded once as `serverConfirmedAt`/`serverConfirmedResolution` and honored consistently by the chip, the high-water mark, and the purge, so no surface can diverge from another.

## Prevention

- **Never catch-and-continue mid Convex mutation.** There is no partial rollback; convert a post-write data-shaped throw into pre-write validation that returns `conflicted`. Assert the hard invariant in tests: a data-failed event produces ZERO committed rows plus a conflict plus an advanced cursor, and a genuine infra error still aborts (no false conflict). The in-memory sync repository models the real post-write throws so the zero-write assertion is meaningful.
- **A local "resolve" of server-owned state must round-trip and only mark settled after ack.** Reuse one settlement predicate across every surface (status, high-water, purge) so an unconverged state cannot read as settled anywhere — a destructive delete is the worst place to use a laxer definition than the status chip.
- **Never mask a review/needs-reconciliation state as success in an operator UI.**

## Related Issues

- Linear: V26-1058 (U3), V26-1059 (U4), V26-1060 (U5), V26-1061 (U6). Follow-up V26-1065 (remaining post-write projector throws in service/payment/posSession paths).
- Plan: `docs/plans/2026-07-15-001-fix-pos-local-first-hardening-plan.md`.
- Prior POS sync work: register authority replication (#642), sync replay/contract (#633/#637), read amplification (#657).
