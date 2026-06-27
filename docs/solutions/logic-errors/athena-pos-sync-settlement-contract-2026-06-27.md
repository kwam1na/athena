---
title: Athena POS Sync Settlement Contract
date: 2026-06-27
category: logic-errors
module: athena-webapp
problem_type: logic_error
component: pos-local-sync
symptoms:
  - "Expense sync could share cursor state with POS drawer sync"
  - "Rejected local closeout and reopen events could look locally settled"
  - "Terminal recovery commands could execute without a server-issued claim identity"
root_cause: local_sync_settlement_and_recovery_claim_state_used_implicit_cursor_and_command_identity
resolution_type: code_fix
severity: high
tags:
  - pos
  - local-sync
  - register-session
  - terminal-recovery
  - cash-controls
---

# Athena POS Sync Settlement Contract

## Problem

Local sync had two implicit identity boundaries. First, upload cursors were keyed
around POS register sessions even though expense sync uses a different local
session identity. That let POS and expense batches share cursor state and made
ordering depend on incidental timestamps instead of durable upload sequence.

Second, local runtime settlement treated some server outcomes as more final than
they are. A rejected local closeout or reopen still needs manager review and
should remain locally pending. Terminal recovery commands also needed stronger
claim identity; command type and id alone are not enough to prove the local
terminal is executing the server-issued claim instance.

## Solution

Make settlement identity explicit across the local and cloud contract:

- Carry `syncScope`, `localSyncCursorId`, and optional
  `localExpenseSessionId` through local batching, public sync, Convex cursor
  persistence, and result handling. Keep `localRegisterSessionId` for legacy POS
  compatibility.
- Batch local uploads by terminal, scope, cursor id, and durable upload
  sequence before `createdAt`; do not let later local rows starve earlier rows.
- Treat `projected`, `conflicted`, `held`, and `rejected` as distinct local
  outcomes. `rejected` remains reviewable/unsynced and must not settle embedded
  local-only precursors.
- Do not upload newly generated `register.reopened` events. Existing uploaded
  reopen rows remain reviewable so historical data can be resolved safely.
- Require a server-issued recovery command `executionId` before local execution
  and include that execution id in acknowledgement, including non-`update_app`
  commands.
- When opening a replacement drawer after closeout review, carry the prior
  Cash Controls register-session target so support surfaces identify the cloud
  drawer rather than only the local id.

## Prevention

- Add cursor tests for mixed POS and expense uploads, inverted created-at
  ordering, held rows, and scoped public sync return validation.
- Keep runtime tests for every server outcome: projected, conflicted, held,
  rejected, and rejected-with-local-precursors.
- Test recovery command execution and acknowledgement with server-issued
  execution ids for every command type, not only app updates.
- Keep closeout and deposit tests in the validation set whenever local closeout
  settlement changes, even if Cash Controls code is not edited directly.
