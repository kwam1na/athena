---
title: Athena POS Sync Review Workspace Boundaries
date: 2026-06-19
category: logic-errors
module: athena-webapp
problem_type: sync_review_workspace_boundary_drift
component: pos-terminal-health
symptoms:
  - "Terminal health reports local review counts without enough item-level context"
  - "Cash Controls can show review actions for inventory work that belongs in Operations"
  - "Queued manager approvals can drift from the drawer state that made the request safe"
  - "Operator-facing review copy can leak backend conflict summaries or internal ids"
root_cause: review_state_was_counted_without_preserving_the_owning_workflow_and_operator_evidence
resolution_type: bounded_runtime_evidence_and_scoped_review_actions
severity: medium
tags:
  - pos
  - local-sync
  - terminal-health
  - cash-controls
  - operations
  - product-copy
---

# Athena POS Sync Review Workspace Boundaries

## Problem

POS local sync review state can span several workspaces. A late synced sale can
need Cash Controls review for duplicate register activity, Operations review for
inventory shortfall, and terminal support review for local runtime settlement.
If the same count or conflict is projected into every workspace without a clear
owner, operators see extra actions, stale review rows, or links to the wrong
workflow.

The most visible failure is terminal health reporting a local review count while
cloud conflict evidence only shows a subset. A count is not enough for support:
the runtime check-in must either include bounded item-level review evidence or
the UI must say that details were not included in the latest report.

## Solution

Keep each review decision attached to its owner and evidence contract:

- Terminal runtime check-ins may publish a bounded, sanitized sample of local
  review events: local event id, sequence, type, upload status, and local
  session ids. Never include raw payloads, payments, customer data, staff proof
  tokens, PIN material, sync secrets, or browser fingerprints.
- Terminal detail should render the local review sample when present. If the
  terminal reports a positive review count but omits details, say that the
  latest check-in did not include item-level local review details.
- Cash Controls review actions should resolve only the review item that matches
  the current sale decision. Hide global apply/reject bars when review items do
  not share the same action scope.
- Projected inventory-review sales belong to Operations once an open
  `synced_sale_inventory_review` work item owns the inventory decision. Cash
  Controls should suppress that review only for open matching work items, and
  receipt-only matching must be scoped to the same local register session.
- Queued void approvals may outlive an active drawer, but approval replay should
  only bypass the usable-drawer check for the transitional `closing` state. A
  fully `closed` drawer still blocks the void.
- Operator-facing review copy should be derived from review kind, action policy,
  and known workflow state. Raw backend conflict summaries and internal ids are
  evidence, not product copy.

## Regression Targets

- `src/lib/pos/infrastructure/local/terminalRuntimeStatus.test.ts` should prove
  local review samples are sanitized and can come from sync debug when event
  state is stale.
- `src/components/pos/terminals/POSTerminalDetailView.test.tsx` should prove the
  no-details fallback appears when review counts arrive without review events.
- `convex/pos/application/terminals.test.ts` should prove terminal health
  annotates inventory conflicts from open Operations work items instead of
  relying on pre-seeded view-model fields.
- `convex/cashControls/deposits.test.ts` should prove inventory handoff review
  suppression ignores closed work items and receipt-only matches from another
  local drawer.
- `convex/pos/application/completeTransaction.test.ts` should prove queued void
  approvals are allowed for `closing` register sessions and blocked for `closed`
  register sessions.
- `src/components/cash-controls/RegisterSessionView.test.tsx` should cover
  review action rows with normalized state/action copy, not raw conflict text.

## Prevention

- Treat local sync review as workflow-owned state, not a generic count.
- Add negative tests whenever a review row is hidden because another workspace
  owns the next decision.
- Keep terminal-health support surfaces explanatory only; do not add hidden
  approval authority there.
- Prefer scoped row-level decisions over drawer-level actions whenever review
  items have mixed action policies.
- Normalize product copy at the UI or read-model boundary before it reaches
  operators.
