---
title: Athena POS Operations URL State And Timeline Affordances
date: 2026-07-01
category: logic-errors
module: athena-webapp
problem_type: operator_navigation_state_loss
component: pos-operations
symptoms:
  - "Returning to POS operations surfaces lost table page, filter, or sheet state"
  - "Daily operations timeline entries exposed backend-style wording without durable links to the owning record"
  - "Mobile transaction lists rendered every row instead of using the same pagination model as desktop"
  - "Terminal readiness state could flicker when repair policy treated recoverable local state as terminal repair"
root_cause: operator_state_and_recovery_affordances_were_split_between_local_ui_state_and_partial_backend_metadata
resolution_type: route_owned_state_shared_pagination_and_server_owned_timeline_links
severity: medium
tags:
  - pos
  - operations
  - url-state
  - timeline
  - pagination
  - terminal-readiness
---

# Athena POS Operations URL State And Timeline Affordances

## Problem

Several POS and operations surfaces were operator-hostile in the same way: the
UI had the right local state while the operator stayed on the page, but that
state was not durable enough to survive navigation or refresh. Timeline events
also depended on raw event wording and incomplete metadata, so operators could
see what happened but not always jump to the transaction, order, or product that
owned the work.

Mobile transaction lists had a related split. Desktop used the shared table and
its pagination model, while mobile cards mapped the full filtered data array.
That made page state durable on desktop but not on phone-sized layouts.

## Solution

Make the route and backend read model own durable operator state:

- Store restorable page, filter, and sheet state in TanStack Router search params
  for POS operations surfaces.
- Build timeline links in the daily operations read model from stable IDs and
  metadata, with fallbacks for older sparse events that only include labels such
  as `Transaction #856721`.
- Persist future event anchors when recording POS item adjustments and pending
  checkout evidence corrections, so the read model does not need to infer from
  wording for new rows.
- Move mobile-card rendering into `GenericDataTable` through a
  `renderMobileCard` hook, and render those cards from `table.getRowModel()` so
  mobile and desktop share the same pagination state.
- Keep terminal readiness policy focused on durable blocking states. Recoverable
  local state should not make the repair-needed gate flicker while normal POS
  actions are happening.

## Implementation Notes

- Treat URL search state as the durable source for operator navigation, not a
  copy of local component state.
- Reset `page` when changing a table filter, but preserve unrelated return
  context such as `o`.
- Resolve timeline product links from explicit product/SKU metadata first, then
  from the pending checkout item document when the event subject is a pending
  checkout item.
- Normalize timeline copy before it reaches React. The view should render links
  inline; it should not invent business wording from raw event types.
- Shared mobile cards should be opt-in for `GenericDataTable` callers so
  existing desktop-only tables keep their current behavior.

## Verification

- Add route-state tests for URL-backed page/filter/sheet restoration.
- Add Convex read-model tests for transaction, order, and product timeline
  links, including sparse historical event metadata.
- Add event-producer tests proving future operational events store the IDs the
  read model needs.
- Add a shared table test proving mobile cards render from the paginated row
  model.
- Run focused POS/operations tests, typecheck, graphify rebuild, and
  `bun run pr:athena` before merge.

## Prevention

- Do not introduce local-only page, filter, or side-sheet state on operator
  workflows that contain drill-in links.
- Do not make mobile card lists bypass table pagination when the desktop view
  already uses `GenericDataTable`.
- Do not rely on raw backend event type names for operator-facing timeline copy.
- Do not treat repairable local POS continuity states as hard terminal repair
  blockers unless new sales truly cannot proceed.
