---
title: Athena POS Stale Terminal Sale Blocks
date: 2026-05-29
category: logic-errors
module: athena-webapp
problem_type: pos_stale_terminal_local_sale_authority
component: pos-register
symptoms:
  - "A revoked or re-provisioned POS terminal can keep appending local sales"
  - "Sync authorization failures can be converted into generic local review work"
  - "Register commands can reuse an open local drawer after terminal authority is lost"
root_cause: local_sale_authority_was_inferred_from_event_projection_alone
resolution_type: persisted_terminal_and_drawer_authority_state
severity: high
tags:
  - pos
  - local-first
  - terminal-authority
  - drawer-authority
  - sync
---

# Athena POS Stale Terminal Sale Blocks

## Problem

The POS register can continue to look locally operable after the server rejects
the terminal sync secret or drawer lifecycle authority. That is unsafe because
the local read model only knows about the event log; it does not remember that
the terminal itself has lost the right to append more sale-affecting activity.

Treating those failures as ordinary `needs_review` local events also hides the
right recovery path. A revoked or stale terminal needs setup repair, while an
invalid drawer lifecycle needs register recovery. Neither should become a new
sale, payment, or closeout event.

## Solution

Persist sale authority separately from local activity:

- Store terminal integrity by store and terminal. Sync/check-in authorization
  failures write a non-secret `requires_reprovision` state and leave existing
  local events intact.
- Store drawer authority by store, terminal, and local register session. Drawer
  authority can block one register session without erasing terminal evidence or
  unrelated local events.
- Project terminal integrity and drawer authority into the local register read
  model. `canSell` must require an open drawer, no closeout flow, and no
  authority block.
- Gate all sale-affecting local commands at the command gateway: cart item,
  service line, payment, completion, closeout, reopen, register seed, and drawer
  reuse. Allow explicit cloud-drawer bootstrap only when no authority block is
  present.
- Surface terminal repair in POS Settings and drawer recovery in the register
  gate. Keep copy operational and preserve local activity for support.
- Publish authority summaries through terminal runtime status and terminal
  health without exposing sync secrets, staff proof tokens, payload bodies, or
  backend error text.

## Regression Targets

- Local store tests should prove authority state survives independently of local
  events and is cleared only by successful terminal setup repair.
- Local read-model tests should prove terminal integrity and drawer authority
  block `canSell`, while pending/offline local events remain recoverable.
- Local command-gateway tests should prove blocked authority rejects drawer
  reuse and sale-affecting appends even when the caller supplies an explicit
  register session id.
- Sync runtime tests should prove authorization failures persist terminal
  integrity and do not mark preserved local events as generic review events.
- Register view-model and drawer-gate tests should prove operators see setup or
  drawer repair instead of an ordinary sale surface.
- Terminal health tests should prove new attention reasons route to POS
  Settings for terminal repair and POS Register for drawer recovery.

## Prevention

- Do not infer terminal authority from the local event log alone. Authority
  state is a separate durable input to projection.
- Do not mark events `needs_review` merely because terminal authorization failed.
  Preserve the events and block future sale-affecting writes.
- Do not clear local events during terminal repair. A successful re-provision
  clears terminal integrity state, not cashier activity.
- Do not expose raw authorization failures in operator copy or runtime evidence.
  Normalize them to repair actions and redact secrets.
- Whenever adding a local register command, decide whether it is sale-affecting
  and route it through the same authority gate.

## Related

- [Athena POS Local First Register](../architecture/athena-pos-always-local-first-register-2026-05-14.md)
- [Athena POS Local Staff Authority](../architecture/athena-pos-local-staff-authority-2026-05-14.md)
- [Athena POS Terminal Health Visibility](../architecture/athena-pos-terminal-health-visibility-2026-05-20.md)
- [Athena POS Terminal Runtime Review Actions](../architecture/athena-pos-terminal-runtime-review-actions-2026-05-28.md)
