---
title: Coordinate Data-State Motion at the Ownership Boundary
date: 2026-07-30
category: design-patterns
module: athena-reports
problem_type: design_pattern
component: frontend_stimulus
severity: medium
resolution_type: code_fix
applies_when:
  - "A data-backed surface transitions between populated and empty states"
  - "Summary metrics and results must remain visually coherent during exit"
tags:
  - reports
  - animation
  - layout-shift
  - empty-state
  - react
  - framer-motion
delivery_diff_fingerprint: d1850a19bce19149c02737929fa4889d8b3459e9a1fe2c6284398037ed94339b
---

# Coordinate Data-State Motion at the Ownership Boundary

## Problem

Data-backed surfaces often render summary metrics, freshness metadata, and a
results table as separate siblings. When a query changes from a populated
result to an empty result, conditionally removing those siblings before the
table's exit animation finishes produces a visibly choppy transition. Adding a
height animation only around the table does not solve the problem because the
parent layout still collapses in multiple phases.

Responsive charts have a related failure mode. If the responsive measurement
container is unmounted with the empty state and mounted again with data, its
initial zero-size measurement can consume or restart the chart's entry
animation. Configuration flags may say that animation is active even though no
visible sector transition occurs.

## Solution

Place all content that belongs to one data state under the same keyed motion
owner. Athena's `AnimatedDataState` keeps the populated summary and results
together, then uses `AnimatePresence` with `mode="wait"` so the outgoing state
finishes before the incoming state mounts.

Use asymmetric motion:

- Data exits with opacity only. Scaling a large table while it disappears makes
  text and borders shimmer.
- Data enters with opacity plus a restrained `0.99` scale so the appearance has
  depth without feeling theatrical.
- Reduced-motion users receive an opacity-only transition.

Use `AnimatedHeight` at the stable surface boundary to observe intrinsic
content size and retarget an interruptible height transition. Do not nest
multiple height animators around the same content; one owner should be
responsible for the layout change.

For responsive charts, keep the measurable chart surface mounted across
empty/data transitions. Mount and animate only the chart content once the
container is eligible. This preserves a settled width and height for Recharts
without leaving stale chart content visible.

## Why This Matters

The ownership boundary is the core fix. A one-off fade on the table cannot
coordinate totals or metadata that disappear earlier in the render. Grouping
the semantic state produces one DOM lifecycle, one exit, and one height
transition. It also makes the pattern reusable by other report surfaces without
copying timing logic.

The persistent measurement boundary separates layout responsibility from data
visibility. This prevents responsive chart measurement from competing with
entry motion and makes behavior predictable across data-to-data,
data-to-empty, and empty-to-data changes.

## Prevention

- Model selection context separately from filter context when only part of a
  screen should react to a selection.
- Keep summary metrics and their result surface inside the same data-state
  owner.
- Use one intrinsic-height animator per changing region.
- Keep responsive measurement containers mounted when remounting would affect
  animation initialization.
- Test observable lifecycle or rendered geometry, not only animation props and
  callbacks.
- Make animation cleanup functions return `void`, especially when a library's
  cancellation method returns an animation object.
- Respect reduced-motion preferences in every shared motion primitive.

## Examples

The reports Items view wraps totals, freshness copy, and the SKU table in one
`AnimatedDataState`. A period with sales fades out as a coherent unit before
the empty state enters. The Overview product-mix surface follows the same
state-owner pattern while retaining its responsive chart measurement surface.

`FlipNumber` is intentionally separate from the container transition. It
handles positive-to-positive value changes, while an empty-to-data transition
synchronizes the initial value before paint so operators never see a misleading
`0 units sold` to real-value flip.

## Related

- [Avoid Swap Flash and Layout Shift in Data Tiles](../architecture-patterns/athena-pos-client-errors-tile-no-swap-loading-2026-07-19.md)
- [Phase-Gate Presence Transitions at the Shared Owner](../logic-errors/athena-stock-workspace-header-animation-boundary-2026-06-23.md)
