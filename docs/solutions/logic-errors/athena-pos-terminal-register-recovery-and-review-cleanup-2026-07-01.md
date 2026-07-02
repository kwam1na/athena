---
title: Athena POS Terminal Register Recovery And Review Cleanup
date: 2026-07-01
category: logic-errors
module: athena-webapp
problem_type: terminal_state_reconciliation
component: pos-terminal-recovery
symptoms:
  - "A terminal can loop on the drawer-open gate when runtime active drawer evidence points at a local register session that was reused or conflicted with a different synced cloud register session"
  - "Support cleanup for terminal-local review backlogs can become unsafe if it clears by count instead of by exact local event ids"
  - "Already-seeded register sessions can appear usable while the local-to-cloud register-session mapping remains missing"
root_cause: terminal_recovery_commands_were_not_bound_to_exact_runtime_evidence
resolution_type: evidence_bound_terminal_recovery
severity: high
tags:
  - pos
  - terminal-recovery
  - local-sync
  - register-session
  - indexeddb
---

# Athena POS Terminal Register Recovery And Review Cleanup

## Problem

Terminal recovery sits between server-owned support commands and terminal-local
IndexedDB state. That boundary is dangerous when the server preview is broad
but the terminal mutation is specific. A support action that says "clear all
review items" can be useful for terminal repair, but it must not become a
generic count-based delete of whatever review rows happen to exist locally when
the command runs.

The same evidence boundary applies to register-session repair. If a terminal
already has the target local drawer projected, idempotent seeding should still
repair the local-to-cloud register-session mapping. Otherwise later read models
can keep treating the drawer as local-only, which can feed the drawer gate loop
or make runtime active-session reconciliation ambiguous.

## Solution

Bind terminal repair commands to the exact runtime evidence that made the
server preview safe:

- Build clear-all local review actions only from fresh runtime evidence, not
  stale count-only snapshots or stale collected evidence.
- Include the exact `localReviewEventIds` in `commandContext` and the matching
  `localReviewClearedEventIds` in `expectedEvidence`.
- Keep the action visibly dangerous in the UI, but hide it unless the command
  ids and expected cleared ids are present, unique, and matching.
- On the terminal, reject clear-all execution if the current scoped local review
  rows differ from the evidenced id set or include non-clearable business facts.
  The safe repair set is uploaded `register.opened` review rows; sale,
  payment, inventory, and closeout facts stay in review.
- Keep explicit-id cleanup idempotent by accepting ids that were already
  cleared by the same terminal recovery command reason.
- When register-session seeding resolves to `already_seeded`, still write the
  local-to-cloud register-session mapping when the cloud id is available.

For drawer-gate loop fixes, do not suppress server active-register directives
just because some runtime local drawer exists. Resolve the runtime drawer to a
cloud register session when possible, then only suppress the directive when the
runtime cloud session is sale-usable or already matches the directive target.

## Prevention

- Never issue terminal-local repair commands that mutate IndexedDB by count
  alone. Carry exact ids and make the executor re-check current local state
  before mutating.
- Keep support cleanup actions out of generic "safe action" groups when they
  discard local review state. Render a separate dangerous affordance with calm,
  explicit operator copy.
- Treat local/cloud mapping repair as part of idempotent register-session
  seeding, not only first-time seeding.
- Add paired tests at the policy, public command, UI, and local executor
  boundaries whenever a recovery action crosses from server evidence into
  terminal-local mutation.
- Include stale evidence, duplicate ids, business-fact review rows, and
  already-cleared retries in the regression set.
