---
title: "Athena Store Ops Catalog Visibility Boundaries"
date: 2026-06-24
category: architecture
module: athena-webapp
problem_type: store_ops_catalog_visibility
component: daily-operations-pos
resolution_type: boundary_scoped_visibility
severity: medium
tags:
  - athena
  - daily-operations
  - pos
  - inventory-import
  - operations
---

# Athena Store Ops Catalog Visibility Boundaries

## Problem

Store operations surfaces share catalog, POS, automation, and workflow data, but
each surface owns a different operator decision. If archived legacy import SKUs
remain visible in POS, cashiers can sell products that operators already removed
from active sale flow. If low-level scheduled-run evidence appears in Daily
Operations, managers see backend execution detail in a workspace meant for store
day decisions.

Both failures come from the same boundary issue: using available data as the
display contract instead of scoping the contract to the surface's job.

## Solution

Filter visibility at the query or composition boundary closest to the surface:

- POS catalog snapshots and checkout completion must exclude archived legacy
  import products and SKUs before they reach cashier-facing search, quick add,
  or transaction flows.
- Archived products remain available to archived-product management surfaces so
  operators can audit or restore them without leaking them into active POS.
- Daily Operations can surface workflow blockers, approvals, opening review
  carry-forward, and EOD links because those are manager decisions.
- Scheduled-run evidence remains a reusable component, but Daily Operations
  should not render it unless the surface explicitly needs backend automation
  diagnostics.

## Implementation Notes

- Keep legacy import filtering server-side for POS snapshot and transaction
  validation. Client filtering is useful for polish, not enforcement.
- Preserve explicit props for store-pulse labels such as `"Today's top items"`
  instead of changing shared components globally.
- Pass operating-date search params through workflow links so historical review
  surfaces open on the same store day the manager was inspecting.
- Paginate carried-forward Opening review evidence in the review workspace
  rather than trimming or hiding it.

## Prevention

- When adding data to Daily Operations, identify the operator decision it
  supports. If it is mainly diagnostic evidence, put it behind a deeper
  workspace or reusable component instead.
- Tests for POS catalog queries should cover archived legacy import SKUs at the
  server boundary, not just the rendered search list.
- Tests for Daily Operations composition should assert that advanced scheduled
  run detail stays off the default workspace while workflow-status links remain
  visible.
- Shared UI components should accept scoped copy or visibility props when only
  one surface needs different wording.

## Validation

Focused coverage should prove:

- Archived legacy import SKUs do not appear in POS catalog snapshots.
- Checkout completion rejects archived legacy import product lines.
- Archived-product management still finds archived legacy import products.
- Daily Operations omits scheduled-run evidence from the default workspace.
- Daily Operations keeps day-scoped top items, payment mix, approval counts,
  Opening Handoff links, and EOD Review links aligned with the selected
  operating date.
