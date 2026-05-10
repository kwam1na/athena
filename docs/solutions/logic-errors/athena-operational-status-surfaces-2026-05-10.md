---
title: Athena Operational Status Surfaces Should Use Backend State As The Visual Contract
date: 2026-05-10
category: logic-errors
module: athena-webapp
problem_type: operational_status_drift
component: operations-workspace
symptoms:
  - "Daily close blockers showed lower-priority register state above approval work"
  - "Approval blockers did not visually distinguish variance reviews even though the backend exposed the approval type"
  - "Closed and clear operational states used too much explanatory copy instead of concise status cues"
root_cause: presentation_order_and_status_cues_not_anchored_to_domain_state
resolution_type: status_surface_contract_alignment
severity: medium
tags:
  - athena-webapp
  - operations
  - daily-close
  - approvals
  - frontend
---

# Athena Operational Status Surfaces Should Use Backend State As The Visual Contract

## Problem

Operational workspaces are read under time pressure. If the UI sorts blockers by
incidental construction order, uses generic labels for typed approval work, or
adds explanatory copy around already-final states, operators have to parse more
than the domain actually requires.

In the daily close flow, pending approval work needed to appear before register
session mechanics because approvals are the highest-precedence blocker. Variance
approval requests also needed a first-glance visual cue, because the backend
already distinguished `variance_review` approval requests through blocker
metadata. Historical closed-day panels had the opposite problem: the state was
already final, so explanatory copy competed with the only useful action.

## Solution

Treat backend status and metadata as the presentation contract:

- Sort daily-close blockers by domain precedence before deriving readiness:
  approval requests first, then register sessions, then POS sessions.
- Preserve approval metadata on daily-close blockers and use it for small visual
  distinctions, such as a variance-review badge.
- Use icon-only success cues when checklist rows are clear; keep textual counts
  only when work remains.
- Collapse closed historical panels down to the review action when the operating
  date is already closed.

The UI should still be restrained. Avoid adding explanatory paragraphs when the
state, label, and available action already communicate the next move.

## Prevention

- Add tests around ordering when a backend snapshot combines approvals,
  register sessions, and POS sessions.
- Add component tests for visual state contracts that depend on metadata, not
  only the visible title string.
- When copy appears in a completed or closed state, check whether it changes the
  operator's next action. If it does not, prefer the action and concise status
  cue.
- Keep new operational badges scoped to typed backend state so they do not
  become decorative labels.
