---
title: Athena Terminal Health Reconciliation Lanes
date: 2026-06-27
category: logic-errors
module: pos-terminal-health
problem_type: boundary_confusion
component: terminal-recovery
resolution_type: regression_guard
severity: medium
tags:
  - pos
  - terminal-health
  - terminal-recovery
  - cloud-repair
  - sync-review
related:
  - docs/solutions/architecture/athena-terminal-operational-state-aggregate-2026-06-27.md
  - docs/solutions/logic-errors/athena-pos-sync-review-workspace-boundaries-2026-06-19.md
  - docs/solutions/logic-errors/athena-pos-register-sync-repair-and-runtime-reconciliation-2026-06-26.md
---

# Athena Terminal Health Reconciliation Lanes

## Problem

Terminal Health can hold several true facts at once: the terminal may be online, the cashier may be able to sell, a safe duplicate drawer-open repair may be available, and a business review conflict may still require a human owner. Treating those facts as one generic "unhealthy terminal" state leads to two failures:

- support copy can imply sales are blocked when sale readiness is intact
- safe repair can appear to own business facts that must remain in Cash Controls or Operations review

## Solution

Keep reconciliation lane ownership explicit in the server-derived terminal state:

- Sale readiness: whether the cashier can transact now.
- Terminal health: whether runtime, sync, register, and recovery evidence need attention.
- Support recovery: whether a terminal command or safe cloud repair is available.
- Review ownership: who owns unresolved business or operational evidence.
- Operational explanation: the display-safe summary that ties those facts together for roster and detail views.

`operationalExplanation` is the boundary for operator-facing interpretation. UI surfaces should consume the lane, sale impact, support action, owner, and bounded evidence references from the server instead of rejoining raw sync ledgers or inferring owners from conflict strings.

## Repair Safety Rules

Safe cloud repair is narrow:

- It can only resolve stale duplicate register/drawer-open lifecycle evidence that has a matching source event.
- It must skip conflicts that are already resolved, missing source events, scoped to a different store or terminal, not stale, not duplicate register-open evidence, or not projection-safe.
- It must skip any conflict or source payload containing sale, payment, inventory, closeout, variance, customer, staff-proof, or unknown business facts.
- It must compare the current safe-conflict set with the expected precondition hash before mutating anything.
- It must leave manual-review facts unresolved, even when a separate safe repair succeeds in the same terminal backlog.

Manual review plus safe repair is therefore a mixed state, not a promotion of manual review into repair. The safe repair may be a secondary support action, but Cash Controls or Operations still owns the business review lane.

## Prevention

When adding terminal health diagnostics, extend the operational explanation model and its tests. Do not add UI-only ledger joins or broad repair buttons.

Regression coverage should include:

- unsafe business facts are skipped by cloud repair policy
- missing source events do not mutate review facts
- resolved conflicts do not become repair candidates
- precondition mismatch fails before any patch
- manual-review facts remain unresolved when safe repair handles a separate duplicate lifecycle conflict

Use calm operational copy that names state and next action. Avoid exposing raw backend summaries, sync payloads, secrets, staff proof/PIN material, payment/customer data, browser fingerprints, or exception text.
