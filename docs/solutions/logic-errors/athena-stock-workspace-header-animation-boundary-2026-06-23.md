---
title: Athena Stock Workspace Header Animation Should Be Phase-Gated
date: 2026-06-23
category: logic-errors
module: athena-webapp
problem_type: route_entry_animation_replay
component: operations-stock-adjustments
symptoms:
  - "Returning to Stock Adjustments replayed the loaded header label animation"
  - "The final loaded stock label could appear to animate twice"
  - "Unrelated queue loading could force the stock route through generic loading copy"
root_cause: stock_header_animation_was_keyed_to_copy_and_conflated_with_queue_loading
resolution_type: phase_scoped_loading_and_animation_gate
severity: medium
tags:
  - operations
  - stock-adjustments
  - animation
  - loading-state
  - framer-motion
---

# Athena Stock Workspace Header Animation Should Be Phase-Gated

## Problem

The stock adjustments workspace needs a gentle transition from default loading
copy to loaded inventory copy. The route also reuses the broader operations
queue view, which fetches open work and stock inventory together.

If the stock header animation is keyed by the rendered title or description,
ordinary loaded-state copy changes can look like a second enter/exit animation.
If the stock loading state is derived from the combined queue and inventory
loading state, a cached inventory snapshot can still briefly render generic
stock loading copy while unrelated queue data is pending.

Both cases make route return feel broken: operators see the final loaded label
replay even though the stock data was already available.

## Solution

Separate data readiness from animation eligibility:

- Derive stock workspace loading from the inventory snapshot only. Open-work
  queue readiness should not decide whether Stock Adjustments shows stock body
  content.
- Key the animated header by business phase, not by the rendered copy. Use a
  stable loaded key so inventory summary text can update in place without
  creating another exit/enter pair.
- Gate the animated header path behind an instance-local record that the
  loading header actually rendered. If the route mounts with ready inventory,
  render the loaded header as plain DOM instead of mounting it through Framer
  Motion.
- Keep the body hidden only for genuine stock loading, so cached route returns
  do not lose controls while unrelated operations data settles.

## Prevention

- Do not key motion transitions by copy unless every copy change should animate.
  For status labels, prefer phase keys such as `loading` and `loaded`.
- Do not use a shared page loading boolean for sibling workflows with different
  data dependencies. Split loading signals at the workflow boundary.
- Add regression coverage for cached-ready route entry. The loaded header should
  exist without motion-managed inline styles when the component did not render
  a loading phase first.
- Keep `AnimatePresence initial={false}` for default page text. It prevents
  first-render enters, but it does not by itself prevent mount-time motion styles
  on keyed motion elements.

## Validation

Focused coverage should include:

- Loading stock renders only the generic stock header and no stock body.
- Ready inventory with pending queue data renders the loaded stock header and
  stock body.
- Cached-ready stock route entry renders the loaded heading without motion
  inline styles.
- Stable loaded header keys update copy in place.
