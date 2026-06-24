---
title: Athena POS Entry Routes and Cart Removal Projection
date: 2026-06-24
category: logic-errors
module: athena-webapp
problem_type: pos_entry_and_local_cart_projection
component: pos-register
root_cause: entry_routes_and_cart_projection_used_nearby_state_instead_of_authoritative_role_and_event_facts
resolution_type: shared_route_helper_and_event_log_projection_fix
severity: high
tags:
  - pos
  - local-first
  - register
  - routing
  - cart
---

# Athena POS Entry Routes and Cart Removal Projection

## Problem

POS-only operators can enter Athena through several route surfaces: login
handoff, organization entry, store entry, and direct store-root links. Fixing
only one redirect can leave another entry path sending POS-only staff into Daily
Operations.

The POS register cart has a similar multi-source shape. A visible cart line can
come from cloud session state, local read-model projection, or an optimistic
browser overlay. If a remove or decrement-to-zero action only hides one source,
the item can disappear for one render and then reappear when an older projected
cart item wins the next merge.

## Solution

Use shared, authoritative facts for both workflows:

- Put POS-only store entry routing behind one helper and call it from
  organization-entry, store-entry, and store-root redirects.
- Treat register-like POS routes as parent-shell concerns. If a route needs the
  POS terminal fullscreen shell, the authenticated layout must classify the path
  before the child component renders.
- Treat local cart event history as authoritative for removals. In
  `cartItemsFromLocalRegisterModel`, the latest `cart.item_added` event per SKU
  plus inventory source determines whether a line is visible. A quantity `0`
  event must suppress stale cloud and local projected rows, even if an earlier
  add still exists in the current read-model snapshot.
- Keep optimistic removed-line state keyed by SKU plus inventory source, not
  only by rendered item id. Local item ids can differ between cloud rows,
  optimistic rows, and local projection fallback rows.
- Clear removed-line overlays on explicit re-add, quantity increase, draft
  reset, or session change. Do not clear them just because the cart is
  temporarily empty; that is the rebound window.

## Prevention

- Add route tests for the actual entry flow, not just the route that looks
  nearby. Login-to-organization-entry should be covered separately from
  store-root fallback routing.
- Add cart projection tests where `activeSale.items` still contains a stale
  quantity-one line while the latest source event has quantity `0`.
- Product cart controls should send a remove intent for decrement-from-one
  without displaying a transient visible quantity of `0`.
- Trash buttons need item-specific accessible labels so browser evidence and
  tests can identify the exact action.
- When POS behavior is local-first, prefer event-log and read-model invariants
  over UI-only state fixes. UI overlays are allowed for responsiveness, but the
  projection contract must also reject stale rows.
