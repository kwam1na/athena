---
title: Athena POS Terminal Identity Handoff
date: 2026-08-27
category: logic-errors
module: athena-webapp
problem_type: logic_error
component: service_object
symptoms:
  - "A replacement browser identity opens a second local drawer while the original cloud register session remains active"
  - "Sales from the replacement terminal accumulate missing register-session mapping reviews"
  - "A physical cash count can be mistaken for a second opening float"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags:
  - pos
  - local-sync
  - cash-controls
  - register-session
  - terminal-identity
  - authority
delivery_diff_fingerprint: fee36cfe46f71e7b88010ae263f371c4b6aae33e5d50523d7ad4e67da751631c
---

# Athena POS Terminal Identity Handoff

## Problem

Clearing a POS browser identity and registering the same browser again creates a
new terminal scope. If the original cloud register session is still active, the
replacement browser can record a local `register_opened` event and subsequent
sales against a new local register-session id. Cloud projection correctly
rejects the second open and refuses to infer a cross-terminal mapping, leaving
the sales for manager review.

The replacement opening amount may be a physical count of the same drawer. It
must not become a second opening float or increase expected cash.

## Solution

Treat the incident as a terminal-authority handoff inside one Convex
transaction:

- Expose the action only on the replacement terminal detail page after the
  public, return-validated read model proves the drawer is eligible. Require a
  consumable manager approval proof bound to the canonical session, exact
  previous terminal, replacement terminal, and local register-session id.
  Re-check the register number,
  duplicate-open blocker, and physical count evidence. Persist the proof and
  approving manager ids in the operational audit.
- Re-read every open conflict and conflicted event for the replacement local
  drawer at mutation execution time. Review ids from an earlier UI read are not
  the repair boundary because more offline sales may upload before approval.
- Refuse the handoff if the drawer contains any review kind other than the
  blocking duplicate open and missing register-session mappings for supported
  sale history (`sale_completed` and the non-financial `sale_cleared`).
- Map the replacement local register-session id to the existing canonical cloud
  session, reject the duplicate open without projecting its amount, and replay
  every eligible synced sale or clear event in sequence.
- Throw on any projection drift after writes begin so Convex rolls back the
  mapping, sales, conflict resolution, and authority transfer together.
- Transfer the canonical session's terminal authority with a revision bump,
  mark the old identity lost, and record the count, pre-replay expected cash,
  and handoff variance in the operational ledger.
- Queue an exact, idempotent terminal recovery command for the repaired local
  event ids. The replacement browser round-trips server resolution before it
  marks those IndexedDB rows locally resolved, and its next runtime heartbeat
  proves whether the local review count reached zero.

The installed mapping is durable. Sales that upload after the handoff resolve
through the canonical session normally rather than requiring another snapshot
repair.

## Prevention

- Never relax cross-terminal mapping inference globally. It is unsafe without
  explicit identity-replacement evidence and manager approval.
- Never treat a replacement browser's drawer count as opening float when a
  canonical cloud session already exists.
- Re-read the entire pending local drawer at command execution; do not limit a
  state transfer to review ids selected from a stale query.
- Preserve a completeness sentinel on bounded conflict and event reads and fail
  closed when the pending drawer exceeds it.
- Keep terminal ownership changes on the centralized register-session authority
  writer and increment the lifecycle authority revision.
- Test at least one sale absent from the caller's review-id snapshot and verify
  cash and non-cash payment effects separately.
- Test the real mixed history shape: completed sales plus a non-financial clear
  event. Keep the UI candidate predicate aligned with mutation preflight so a
  manager is never asked to approve a command that is known to fail.
- Upload another sale only after the handoff transaction completes and prove it
  projects through the durable mapping without creating a new review conflict.
- Treat cloud repair, terminal recovery acknowledgement, a fresh zero-review
  runtime heartbeat, and exact post-deploy reads as the production finish line.

## Related

- `packages/athena-webapp/convex/cashControls/deposits.ts`
- `packages/athena-webapp/convex/operations/registerSessionAuthorityRevision.ts`
- `docs/solutions/logic-errors/athena-terminal-sync-review-currentness-2026-06-28.md`
