---
title: Athena Procurement Preserves Selection And Pagination In URL State
date: 2026-05-06
category: logic-errors
module: athena-webapp
problem_type: navigation_state_loss
component: procurement-workspace
symptoms:
  - "Selecting a stock-pressure row was not encoded as route state"
  - "Returning from a selected SKU detail link could reopen procurement on page 1"
  - "Controlled URL page state was clamped back into the URL during loading or filtering"
root_cause: mixed_local_and_route_owned_procurement_selection_state
resolution_type: route_state_refactor_plus_regression_tests
severity: medium
tags:
  - procurement
  - url-state
  - pagination
  - tanstack-router
---

# Athena Procurement Preserves Selection And Pagination In URL State

## Problem

The procurement workspace had local-only selection and pagination state for the
stock-pressure list. That made the visible SKU detail panel easy to lose across
browser navigation: selecting a row, opening a linked detail, and navigating back
could return to the default first page rather than the page where the operator
started.

The first URL-state pass exposed a second issue: page clamping reused the same
callback as an operator page change. When recommendation rows were temporarily
unavailable or filtered below the current page count, the component rendered a
clamped page and wrote that clamped value back into the URL.

## Solution

Make the route own durable procurement navigation state:

- `sku` identifies the selected pressure row.
- `page` identifies the visible recommendation page.
- Mode changes reset `page` to `1` while preserving the selected SKU when
  appropriate.
- Row selection emits both the selected SKU and the currently visible page in one
  route update.

Inside the component, keep render clamping separate from route writes. Controlled
URL state can be clamped for display, but internal clamping must not call the
route page-change callback. Only explicit operator navigation should update
`page`.

## Pagination UI

When adding non-table pagination to Athena surfaces, reuse the same interaction
language as the shared data-table pagination:

- Outline 32px icon buttons.
- `ChevronsLeft`, `ChevronLeft`, `ChevronRight`, and `ChevronsRight`.
- Screen-reader labels such as `Go to first page`.
- Primary range label near the controls, with `Page n of m` as the quieter
  secondary label.

This keeps operator workflows visually consistent even when the list is not
rendered through the generic data-table component.

## Prevention

- Add route-helper tests for URL search-state transitions.
- Add component tests that prove row selection emits both SKU and page.
- Add a regression test that controlled `page` is not rewritten when visible rows
  are temporarily unavailable.
- Keep render-only clamps separate from callbacks that mutate durable route
  state.
