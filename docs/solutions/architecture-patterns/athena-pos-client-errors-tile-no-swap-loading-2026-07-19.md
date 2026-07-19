---
title: Surface a New Metric Without Layout Shift or Component-Swap Flash
date: 2026-07-19
category: architecture-patterns
module: pos
problem_type: ui_placement
component: pos-terminals-health
resolution_type: feature_delivery
severity: low
applies_when:
  - Adding a new Convex-query-backed metric tile to an existing metrics row
  - A loading state currently swaps one component for another (skeleton → content, spinner → count)
  - Deciding where to surface a new operator-facing signal on a page with an unpredictable number of repeated cards
tags: [pos, ui, loading-state, layout-shift, sheet, convex]
delivery_diff_fingerprint: d665b38b25f0cb872dec0432ee2f5fa51ad5605c4a012659666fd8c3b965ec99
---

# Surface a New Metric Without Layout Shift or Component-Swap Flash

## Problem

The POS client-error telemetry (from the prior POS observability delivery) needed a product surface. The first attempt placed a full panel below the terminal roster on the Terminal Health page — but that page renders one card per registered terminal, so with a realistic terminal count the panel sat thousands of pixels below the fold and was effectively invisible.

The second attempt moved it into the page's existing metrics row as a tile, which fixed placement, but introduced a loading-state problem: a skeleton placeholder swapped for the real count/list once the Convex query resolved. Even with the skeleton sized to match the final content, the swap produces a visible flash/shift, because a skeleton element is being unmounted and a different element mounted in its place — layout-stability techniques (matching the skeleton's box size) don't fix content-swap flicker, only content-random-size shift.

## Solution

Two decisions, both grounded in the page's existing conventions rather than inventing new primitives:

**Placement:** Surfacing a store-level, cross-cutting signal (like error counts) belongs in the page's metrics-tile row, not in a per-terminal list or a section appended after an unbounded roster. The existing row (Terminals / Healthy / Pending sync / Needs review / Stale) already established the pattern: tiles summarize, a drill-in (here, a sheet) elaborates. This scales independently of terminal count.

**Loading state:** Removed entirely, in favor of a value that is correct at every render:
- The tile's count starts at `0` (the default for an unresolved query's `undefined` treated as `events.length` of an empty array) and updates in place when the query resolves — no placeholder is ever mounted, so there is nothing to swap out.
- The sheet's list region renders nothing (`null`) while loading, then the list or the "no errors" empty state appears once — never a placeholder in between.

This trades a moment of "3 becomes 0 then updates" ambiguity (a query response is typically sub-second on a Convex live query) for zero swap-flash. For a low-stakes advisory metric — not a primary action gate — that trade is the right one. It also has zero extra cost: no skeleton components, no transition timers, no extra state to keep synchronized with `isLoading`.

## Prevention

- Before reaching for a skeleton, ask whether the metric is advisory (fine to render 0/empty for a moment) or blocking (must show *something is loading* because a wrong-looking zero could mislead a decision). Advisory metrics on a live-query-backed UI usually don't need a loading treatment at all.
- A skeleton sized to match final content prevents *layout shift* but not *swap flash* — they are different problems. If flash is the actual complaint, removing the swap (rendering the real, if temporarily default, value) is simpler than animating the skeleton away.
- When adding a signal to a page with an unbounded list of repeated cards (here: terminals, could be N), put summary-level signals in the page's existing summary region, not appended after the list.
