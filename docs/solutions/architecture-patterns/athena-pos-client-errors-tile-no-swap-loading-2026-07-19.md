---
title: Keep POS Client Diagnostics Discoverable and Honest Across Async State
date: 2026-07-19
last_updated: 2026-08-27
category: architecture-patterns
module: pos
problem_type: architecture_pattern
component: frontend_stimulus
resolution_type: code_fix
severity: low
applies_when:
  - Adding store-level diagnostic summaries to a page with an unbounded terminal roster
  - Adding terminal-scoped diagnostic evidence to an individual terminal detail page
  - Rendering operator-facing diagnostics from an asynchronous query
tags: [pos, diagnostics, terminal-health, async-state, sheet, convex]
---

# Keep POS Client Diagnostics Discoverable and Honest Across Async State

## Problem

POS client diagnostics serve two different operator questions: whether a store has recent client errors, and what happened on one terminal. A single surface cannot answer both well. A store-wide panel below an unbounded terminal roster becomes hard to find, while a store-wide count alone forces support to leave a terminal detail workflow to inspect terminal-specific evidence.

The asynchronous query state is also operationally meaningful. Rendering an unresolved query as an empty result can briefly tell an operator that nothing was reported when the application does not know that yet. Avoiding layout shift does not justify hiding the distinction between loading, unavailable, and confirmed empty.

## Solution

Keep the store-level **Client errors** tile in the Terminal Health summary metrics. The tile remains in a stable location regardless of terminal count and opens a sheet for the store-wide event list.

Also surface a terminal-scoped **Client diagnostics** section in terminal detail. Place it after Attention and Conflicts and before Support notes, where support reads actionable state before supplemental context. Pass the terminal id into the diagnostics query so this section reports only evidence owned by that terminal.

Separate stable placement from honest asynchronous state:

- Keep the metric tile mounted in its final location so the page does not swap structural components while the query resolves.
- In the sheet, render an explicit loading status while the query is unresolved.
- Render a distinct query-unavailable alert when diagnostics cannot be fetched.
- Render the empty state only after the query resolves with no matching events.
- Keep Errors and Warnings as explicit filters, with Errors selected first for the support workflow.
- Own sheet-open state above the keyed query boundary so changing severity does
  not remount and close an operator's active sheet.
- Let unexpected query dependency failures reach a localized React error
  boundary; converting them to an empty result makes the unavailable state
  unreachable in production.

## Why This Matters

The two placements preserve context at both support levels. The summary tile makes store-wide diagnostic volume discoverable without depending on roster length. The terminal detail section keeps terminal evidence beside the conflicts and attention signals used to diagnose that terminal.

Explicit asynchronous states preserve evidence quality. Loading means the answer is pending, unavailable means it could not be obtained, and empty means the query succeeded with no matching events. Collapsing those states into a temporary zero or blank region creates false reassurance precisely where an operator is trying to establish what is known.

## Prevention

- Decide whether a diagnostic is store-scoped, terminal-scoped, or useful in both contexts before choosing placement.
- Put summary signals in the existing summary region rather than after an unbounded repeated list.
- Put terminal evidence in the terminal detail sequence before supplemental support notes.
- Keep structural placement stable, but model loading, query failure, and confirmed empty as different presentation states.
- Keep interaction state outside keyed query/filter boundaries, and exercise
  the live query-throw path rather than only a hand-authored unavailable prop.
- Test section ordering, terminal query scope, default severity filtering, and every asynchronous state independently.

## Examples

`POSTerminalHealthView` renders `PosClientErrorsMetricTile` in the store metrics row. `POSTerminalDetailView` renders the same tile with a terminal id inside **Client diagnostics**, after the Attention and Conflicts sections and before **Support notes**.

`PosClientErrorsMetricTileContent` keeps the tile present while its sheet distinguishes:

- `isLoading`: "Loading client errors…"
- `queryUnavailable`: "Client diagnostics are not available right now"
- resolved empty errors: "No client errors reported"
- resolved empty warnings: "No client warnings reported"

This is the intended pattern: stable information architecture outside the sheet, truthful query state inside it.

## Related

- V26-1403: POS frontend exception visibility
- `packages/athena-webapp/src/components/pos/terminals/POSTerminalHealthView.tsx`
- `packages/athena-webapp/src/components/pos/terminals/POSTerminalDetailView.tsx`
- `packages/athena-webapp/src/components/pos/terminals/PosClientErrorsPanel.tsx`
- `packages/athena-webapp/src/components/pos/terminals/PosClientErrorsPanel.test.tsx`
- `packages/athena-webapp/src/components/pos/terminals/POSTerminalDetailView.test.tsx`
