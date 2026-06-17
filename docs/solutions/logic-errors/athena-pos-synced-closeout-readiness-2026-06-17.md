---
title: Athena POS Synced Closeouts Should Not Keep Local Sales Blocked
date: 2026-06-17
category: logic-errors
module: athena-webapp
problem_type: pos_synced_closeout_stale_local_block
component: pos-local-readiness
symptoms:
  - "A register can stay blocked by local closeout state after the closeout has synced"
  - "Opening the next drawer can be rejected by a stale drawer_closed sale block"
  - "Cashiers can be prevented from starting the next sale even though the prior drawer is settled"
root_cause: local_readiness_treated_all_closed_locally_closeouts_as_active_blocks_without_checking_sync_settlement
resolution_type: synced_closeout_settlement_releases_local_drawer_block
severity: high
tags:
  - pos
  - local-first
  - drawer-lifecycle
  - sync
  - cashier-continuity
---

# Athena POS Synced Closeouts Should Not Keep Local Sales Blocked

## Problem

Local-first POS must block sales while a drawer closeout is still only local.
That protects cash-control lifecycle integrity. The same block becomes stale
after the closeout event has synced successfully, because the prior drawer is no
longer an unresolved local-only fact.

If readiness only checks `closeoutState.status === "closed_locally"`, the POS
entry gate can keep reporting a local closeout blocker after cloud settlement.
If the command gateway also treats every `drawer_closed` sale block as hard, the
next drawer open can be rejected even though the previous closeout was already
accepted.

## Solution

Distinguish active local closeouts from settled closeouts:

- Keep blocking when the latest `register.closeout_started` event for the active
  local register session is not synced.
- Release the local readiness block when that latest closeout event has
  `sync.status === "synced"`.
- Let `openDrawer` proceed past a `drawer_closed` sale block only when that
  block is backed by a synced closeout for the same local register session.
- Keep other sale blocks intact, including unresolved drawer authority blocks
  and unsynced local closeouts.

This keeps the cashier-continuity rule precise: unresolved local closeout work
still blocks new sales, but settled drawer history does not keep the next drawer
from starting.

## Regression Targets

- Local readiness tests should prove unsynced `closed_locally` closeouts still
  return `local_closeout`.
- Local readiness tests should prove a synced closeout returns `ready` when the
  store day is otherwise started.
- Local command-gateway tests should prove `openDrawer` succeeds after the prior
  closeout event has synced.
- Command-gateway tests should continue proving unrelated sale blockers reject
  sale-affecting appends and drawer reuse.

## Prevention

- Do not treat all projected closeout state as current authority. Check the
  underlying event sync state before deciding whether it still blocks cashiers.
- Keep the settlement check scoped to the same local register session. A synced
  closeout for another drawer must not release this drawer's block.
- Do not clear history to unblock POS. Preserve closeout evidence and interpret
  it correctly.

## Related

- [Athena POS Stale Terminal Sale Blocks](./athena-pos-stale-terminal-sale-block-2026-05-29.md)
- [Athena POS Drawer Authority Replacement Recovery](./athena-pos-drawer-authority-replacement-recovery-2026-06-06.md)
- [Athena POS Local First Register](../architecture/athena-pos-always-local-first-register-2026-05-14.md)
