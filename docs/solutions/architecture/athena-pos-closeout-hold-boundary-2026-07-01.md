---
title: Athena POS Closeout Hold Boundary
date: 2026-07-01
category: architecture
module: athena-webapp
problem_type: closeout_hold_policy_drift
component: pos
symptoms:
  - "Pending sale voids and pending item adjustments can affect the same drawer cash total but drift across Cash Controls, POS, and Daily Operations"
  - "Submitted closeouts can be mistaken for final closeout history when projection appends closeout records too early"
  - "Terminal retry can become too broad if collected review evidence is replayed after current runtime evidence has cleared"
root_cause: cash_impacting_review_state_and_local_lifecycle_retry_rules_were_encoded_at_each_consumer_instead_of_one_boundary
resolution_type: shared_policy_boundary
severity: high
tags:
  - pos
  - cash-controls
  - closeout
  - local-first
  - terminal-health
related:
  - docs/solutions/architecture/athena-pos-register-lifecycle-policy-2026-06-23.md
  - docs/solutions/architecture/athena-terminal-operational-state-aggregate-2026-06-27.md
  - docs/solutions/performance/athena-pos-register-catalog-snapshot-and-closeout-gate-2026-06-30.md
---

# Athena POS Closeout Hold Boundary

## Problem

Register closeout readiness is not just a drawer status question. It also
depends on unresolved business review state that can change the final cash
expectation. Completed sale void approvals and transaction item adjustment
approvals both affect the same operational decision: whether Cash Controls can
finalize or deposit against the drawer.

The same area also has a local-first retry path. Terminal retry is safe only for
the narrow register lifecycle evidence that can recreate a missing local drawer
open. It is not safe to replay arbitrary collected review items, and it should
not retry from stale evidence after the runtime has reported that review work is
gone.

## Decision

Keep cash-impacting closeout holds in one server-side summary boundary and feed
that boundary to every consumer:

- Cash Controls closeout finalization
- deposit creation
- active register-session repository snapshots
- POS register and drawer-gate presentation
- Daily Operations closeout readiness

Use `closeoutOwnedAt` plus `closeoutOwnershipSource:
"closeout_submission"` for submitted closeout reviews. Do not append
`closeoutRecords` until the closeout is actually finalized or reopened as
history. `closeoutRecords` remains settled history, not submitted-review state.

Keep terminal-local retry narrower than review collection. The retry lane should
only replay uploaded `register.opened` review events from current runtime
evidence. If current runtime evidence clears or only reports a count without
items, collect review evidence instead of issuing retry commands.

## Solution

Centralize pending review reads with
`listPendingRegisterSessionApprovalRequests`, then partition the bounded
register-session queue into sale void approvals and item adjustment approvals.
Build one `RegisterSessionPendingVoidApprovalSummary` that includes:

- void count and cash exposure
- cash item adjustment count
- cash item adjustment delta
- combined expected-cash-after-review presentation

Consumers should ask that summary whether any cash-impacting corrections remain
instead of checking `pendingVoidApprovals.count` directly. A drawer with no
pending voids can still be blocked by a pending cash item adjustment.

For synced closeout projection, submitted closeout ownership patches should
write `closeoutOwnedAt` and `closeoutOwnershipSource` without creating a final
history record. Tests should assert both sides of that boundary.

For terminal retry, classify replayable local review events before creating
commands. The safe allow-list is uploaded `register.opened` evidence from the
current runtime review set.

## Invariants

- Pending cash sale void approvals block closeout finalization and deposits.
- Pending cash item adjustment approvals also block closeout finalization and
  deposits.
- Pending non-cash item adjustments do not block cash closeout or deposits.
- Submitted closeout review state is represented by closeout ownership fields,
  not final `closeoutRecords`.
- Unknown closeout review boundaries do not supersede stale replacement opens
  unless a caller explicitly opts into that fallback.
- Terminal retry must not replay sale, payment, inventory, closeout, variance,
  customer, staff proof, unknown payload, or stale collected review facts.

## Regression Targets

- Closeout mutation tests for pending void, pending cash item adjustment, and
  pending non-cash item adjustment paths.
- Deposit tests for the same cash and non-cash item adjustment split.
- Projection tests that prove synced submitted closeouts write ownership fields
  and do not append `closeoutRecords`.
- Shared lifecycle policy tests for known and unknown closeout review
  boundaries.
- Terminal operational-state tests for runtime-count-only, runtime-cleared, and
  business-fact review item cases.
- Frontend Cash Controls tests proving item-adjustment-only cash corrections
  block finalize and deposit actions.

## Prevention

- Do not introduce new closeout blockers by checking only a single approval
  request type at the UI or mutation boundary.
- Do not query the same register-session approval queue once per approval kind;
  fetch the bounded queue once and partition it in memory.
- Treat submitted closeout ownership and settled closeout history as different
  concepts in every projection and UI surface.
- Keep terminal retry allow-lists explicit. When a new local review type appears,
  decide whether it is replayable in policy first and cover it with terminal
  operational-state tests.
