---
title: Athena POS Drawer Authority Replacement Recovery
date: 2026-06-06
category: logic-errors
module: athena-webapp
problem_type: pos_drawer_authority_replacement_recovery
component: pos-register
symptoms:
  - "A terminal can keep showing the open-drawer gate after a drawer was reopened"
  - "A lifecycle-review block on an old local drawer can survive a successful replacement open"
  - "Retrying open drawer can create repeated replacement drawer attempts"
root_cause: recoverable_drawer_authority_blocks_were_not_reconciled_after_replacement_open_mapping
resolution_type: mapped_replacement_open_clears_superseded_recoverable_blocks
severity: high
tags:
  - pos
  - local-first
  - drawer-authority
  - sync
  - recovery
---

# Athena POS Drawer Authority Replacement Recovery

## Problem

Drawer authority is stored per local register session so one rejected drawer does
not erase unrelated local activity. That is the right safety boundary, but it
creates a recovery trap when the server accepts a replacement `register.opened`
event and maps it to the same cloud drawer as the blocked local session.

If the old local session keeps a recoverable `lifecycle_rejected` or
`authority_unknown` block after the replacement open is accepted, the read model
can keep projecting the register as unsellable. The cashier then sees the drawer
gate again even though the drawer recovery already succeeded.

## Solution

Treat an accepted replacement open as the authority handoff for older
recoverable local drawer blocks when all of these are true:

- The replacement `register.opened` event synced successfully.
- The server returned a `registerSession` mapping for the replacement local
  session.
- An older local drawer block maps to the same cloud register session.
- The older block reason is recoverable, such as `lifecycle_rejected` or
  `authority_unknown`.
- The replacement open is newer than the blocked local drawer.

Clear only those superseded recoverable blocks. Do not clear hard
`cloud_closed` blocks this way; a server-closed drawer is not repaired merely by
another local open attempt.

## Regression Targets

- Sync runtime tests should prove a replacement `register.opened` clears an
  older recoverable drawer-authority block when both local sessions map to the
  same cloud drawer.
- Sync runtime tests should prove the replacement open is still marked synced
  after the superseded block is cleared.
- Register read-model tests should keep `cloud_closed` as a hard sale block so
  stale closed-drawer recovery does not weaken drawer lifecycle safety.
- Projection tests should prove lifecycle-review failures on an already-open
  drawer do not create endless replacement opens.

## Prevention

- Do not clear drawer authority from retry intent alone. Wait for a successful
  server mapping that proves the replacement open was accepted.
- Keep recoverable lifecycle review separate from hard cloud-closed drawer
  state. They have different recovery semantics.
- When adding a new drawer-authority block reason, decide whether a later mapped
  replacement open may supersede it and cover that decision with sync runtime
  tests.
- Keep duplicate-open protection in the projection path and stale-closed-drawer
  recovery in the sync/runtime path. Collapsing them makes it easy to either
  loop replacement opens or block valid recovery.

## Related

- [Athena POS Stale Terminal Sale Blocks](./athena-pos-stale-terminal-sale-block-2026-05-29.md)
- [Athena POS Local First Register](../architecture/athena-pos-always-local-first-register-2026-05-14.md)
- [Athena POS Offline Sales Continuity](../architecture/athena-pos-offline-sales-continuity-2026-06-04.md)
- [Athena POS Hub App Session Continuity](../architecture/athena-pos-hub-app-session-continuity-2026-06-02.md)
