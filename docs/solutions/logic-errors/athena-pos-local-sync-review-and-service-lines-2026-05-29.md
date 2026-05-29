---
title: Athena POS Local Sync Review and Service Lines
date: 2026-05-29
category: logic-errors
module: athena-webapp
problem_type: pos_local_sync_review_service_line_recovery
component: pos-register
root_cause: local_service_activity_and_review_state_were_not_projected_as_operator_actions
resolution_type: local_projection_and_operator_recovery_alignment
severity: high
tags:
  - pos
  - local-first
  - service-lines
  - sync-review
  - cash-controls
---

# Athena POS Local Sync Review and Service Lines

## Problem

Local POS activity can settle into states that look synced but remain
non-actionable for operators. Server-rejected closeout or register review
activity may be attached to a register session, but the register session view
does not always surface enough context or a valid recovery action. At the same
time, service lines added from POS behave differently from product SKUs: they
need customer attribution, transaction detail visibility, completed-list counts,
and service-case financial sync without tripping Convex pagination limits.

The result is a mixed cart that can complete locally, but is hard to inspect,
recover, or trust after sync review.

## Solution

Treat service lines and sync review as first-class POS read-model inputs:

- Keep local service line state in the same register view model surfaces as
  product items, but make service catalog entries single-add cart lines. Disable
  duplicate service search results instead of incrementing hidden quantities.
- Gate payment methods and sale completion when services are in the cart without
  a customer. The recovery action should open the existing find/add customer
  flow, not add another disconnected warning.
- Include service lines in completed transaction detail, transaction summaries,
  and completed transaction list item counts. The POS list should count product
  quantity plus service line count so mixed sales are not understated.
- Persist and project server-rejected synced activity against the associated
  register session. Register views should surface the rejected activity and
  expose a recovery route instead of showing a stale "already resolved" action.
- Avoid multiple paginated queries inside Convex mutations and queries. Load
  service-case financial context through one paginated path per function and
  pass derived maps into downstream sync helpers.
- Keep support diagnostics and terminal health as link-out recovery surfaces
  when the POS panel itself should stay focused on selling.

## Regression Targets

- Register view-model tests should prove duplicate service additions do not
  append another local service event or increment a visible service quantity.
- Product-entry tests should prove service result cards add on card click, show
  duplicate disabled state, use service icons, and do not render product
  no-results copy when services match.
- Cart and transaction tests should prove service lines render alongside product
  items, use product-card-aligned price placement, and avoid quantity chrome for
  non-repeatable services.
- Order summary and checkout tests should prove service checkout requires a
  customer and that the warning action opens the customer attribution surface.
- Convex repository and sync tests should prove service-case financial sync uses
  one paginated query path per function and records service payment totals.
- Register session and terminal tests should prove rejected synced activity is
  visible from the associated drawer/register session and can route to terminal
  health or support trace recovery.

## Prevention

- Do not add service cart behavior by copying product quantity semantics. A
  service catalog line is a scheduled or case-backed unit of work unless the
  catalog explicitly models repeatability.
- Do not show product-only empty states under service search results. Unified
  search needs result-aware copy so operators are not told nothing was found
  while service results are present.
- Do not bury server-rejected local activity in terminal diagnostics only. If it
  affects a register session, the cash-controls register view needs enough
  evidence for the operator to decide where to recover it.
- Do not run separate paginated scans in one Convex function to gather related
  service data. Build the needed maps from one paginated result set or split the
  work across separate functions.
- When a POS change spans local sync, cash controls, services, and transaction
  history, validate the full path: local append, read-model projection, checkout
  gate, sync ingest, completed transaction detail, and completed transaction
  list.
