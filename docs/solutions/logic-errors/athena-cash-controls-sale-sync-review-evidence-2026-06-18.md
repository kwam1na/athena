---
title: Athena Cash Controls Sale Sync Review Evidence
date: 2026-06-18
category: logic-errors
module: athena-webapp
problem_type: missing_review_evidence
component: cash-controls
symptoms:
  - "Managers could see that synced sale activity needed review without seeing the sale details behind the decision"
  - "Register-session review actions used generic sync wording even when the drawer was closed and the action would apply or reject sale activity"
  - "Expanded sale rows repeated totals in multiple places and could make item totals look inconsistent with the sale total"
  - "Applying a reviewed stock-shortfall sale could retain the sale but leave the original inventory review blocking follow-up resolution"
root_cause: sale_sync_review_payload_was_not_promoted_to_operator_evidence
resolution_type: server_owned_review_evidence_contract
severity: medium
tags:
  - cash-controls
  - local-sync
  - register-session
  - review-ia
  - pos
---

# Athena Cash Controls Sale Sync Review Evidence

## Problem

Local POS sale sync can arrive after the cloud register session is already
closed. That is recoverable, but managers need to understand the exact sale
activity before applying it to a closed drawer or rejecting it. A generic
"register was not open" reason is not enough evidence when multiple receipts,
cashiers, tenders, and item lines are involved.

The failure mode is a trust gap: the review banner says sale activity needs a
decision, while the visible register-session transaction list may only contain
already-linked cloud transactions. If the sale-review panel repeats totals in
separate metric blocks or shows line prices without a clear item subtotal, the
manager can reasonably question whether the numbers reconcile.

## Solution

Treat sale sync review as a server-owned evidence contract, not a UI-only
rewording pass:

- Enrich register-session local sync conflicts with a compact sale summary from
  the original `sale_completed` sync payload: receipt number, cashier, local
  upload order, completed time, payment methods, cash impact, item count, and
  item lines.
- Resolve staff display names on the cash-controls query boundary and pass them
  into the shared sync-status presentation helper. The browser should render
  names and operational labels, not infer staff identity from raw IDs.
- Present multiple reviewed sales as collapsed rows by default. The row summary
  should answer which receipt, who rang it, when it happened, how it was paid,
  and the sale amount. Expanded content should be reserved for item lines,
  impact details, and the review reason.
- Show item-line math in one place. Render quantity and line total per item,
  then show a single `Items total` footer that reconciles to the sale total.
  Avoid repeating the same total in a neighboring impact metric.
- Use action labels that describe the manager decision: apply reviewed sale
  activity to the drawer, or reject reviewed sale activity from the review. Keep
  closeout review copy separate because approving a closeout has different
  ledger implications than approving late sale activity.
- Treat reviewed stock shortfalls as a two-step workflow: retain the sale and
  payment evidence, skip the unsafe inventory mutation, and create an operations
  work item for the stock correction. The original selected sync conflict should
  not block its own idempotent replay after the sale mapping already exists.

## Prevention

- When a local sync review affects cash controls, promote the source event's
  operator evidence through the server read model before refining the UI.
- Do not make managers open support traces to answer basic sale-review
  questions: receipt, cashier, tender, item count, item total, and upload order
  belong in the register-session review panel.
- Keep sale rows collapsed by default so several reviewed sales stay scannable.
  Expanded panels should add detail without shifting the primary decision
  summary out of view.
- Add tests for sale summary enrichment, staff-name mapping, collapsed default
  state, item-total reconciliation, and action copy whenever register sale
  review presentation changes.
- Add a regression whenever a reviewed sync action can re-enter an idempotent
  projection path. Existing mappings must not cause the selected review conflict
  to block itself, and any required follow-up work item must still be created.
