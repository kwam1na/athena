---
title: Athena POS Closeout Replacement Self-Heal
date: 2026-06-25
category: logic-errors
module: athena-webapp
problem_type: local_sync_recovery_conflict
component: pos-register
symptoms:
  - "A terminal with a submitted closeout can open a new local register session but fail to project it to cloud"
  - "POS can show the closeout review gate before switching to the open-drawer gate"
  - "Retrying terminal repair can resurrect an older duplicate register-open conflict"
root_cause: replacement_register_open_recovery_was_not_sequence_scoped_or_idempotent
resolution_type: code_fix
severity: high
tags:
  - pos
  - register-session
  - local-first
  - sync
  - closeout
  - recovery
---

# Athena POS Closeout Replacement Self-Heal

## Problem

Terminals are allowed to open a replacement register session while the previous
session is closing or waiting on closeout review. That invariant protects store
operations: a manager review should pause the old drawer, not strand the
terminal.

The failure mode appears when local-first POS records the replacement
`register.opened` event but cloud projection treats the previous reviewed
drawer as a hard duplicate-open conflict. The UI can briefly present the old
closeout-review gate, then the open-drawer gate, and a manual repair can replay
duplicate conflicts out of order.

## Solution

Keep replacement recovery tied to the event that is actually being projected:

- Allow superseding reviewed or closing register sessions only when the
  replacement local session is in the same store and terminal scope.
- Compare the replacement event sequence against the latest review sequence.
  Unknown sequence data must use an explicit compatibility path; production
  projection and repair should pass real sequence values.
- Let POS local sync retry uploaded review events that are specifically
  register-open replacement candidates, so the terminal can self-heal without
  operator data surgery.
- During cloud repair, choose one deterministic latest safe duplicate
  register-open conflict, project it once, and mark older safe duplicate-open
  conflicts obsolete. This keeps repeat repair idempotent instead of reopening
  stale drawers.
- Show the operator the next useful gate. If the main action is opening the
  replacement drawer, route directly to the open-drawer gate instead of
  presenting an extra closeout-review stop.

## Prevention

- Cover stale and fresh sequence comparisons in
  `shared/registerSessionLifecyclePolicy.test.ts`.
- Add projection tests for closing or reviewed sessions that should allow a new
  local register open, plus stale sequence cases that must still block.
- Add terminal repair tests that run repair twice and prove only one active
  register session remains.
- Keep UI gate tests focused on intent: replacement drawer CTAs should reveal
  the open-drawer workflow, not call the open action before the operator enters
  required drawer data.
- Keep local session labels and cloud session labels visibly distinct in
  operator-facing diagnostics so support can tell which side of sync is being
  inspected.

## Related

- [Athena POS Closeout Review-Only Lifecycle](./athena-pos-closeout-review-only-lifecycle-2026-06-25.md)
- [Athena POS Drawer Authority Replacement Recovery](./athena-pos-drawer-authority-replacement-recovery-2026-06-06.md)
- [Athena POS Register Lifecycle Policy](../architecture/athena-pos-register-lifecycle-policy-2026-06-23.md)
