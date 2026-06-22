---
title: Athena Store Pulse Daily Operations Reuse
date: 2026-06-22
category: architecture
module: athena-webapp
problem_type: shared_operations_visualization
component: daily-operations-store-pulse
symptoms:
  - "Daily Operations needed the same POS sales trend, item movement, and payment mix views already proven on the POS hub"
  - "Reusing POS visuals directly from a POS-owned component path would make Daily Operations depend on POS presentation ownership"
  - "Daily Operations store-day windows need to be selected from the operating date, not wall-clock today"
root_cause: pos_pulse_presentation_and_aggregation_were_tightly_owned_by_pos_hub
resolution_type: shared_presentation_with_server_owned_snapshot
severity: medium
tags:
  - daily-operations
  - pos
  - store-pulse
  - financial-redaction
  - frontend-reuse
---

# Athena Store Pulse Daily Operations Reuse

## Problem

The POS hub already had an operator-friendly store pulse surface: sales trend,
top items, payment mix, metric cards, loading states, and window tabs. Daily
Operations needed the same visual language, but copying the component would
fork chart behavior and copying the backend aggregation would risk drifting
from the POS payment allocation contract.

The ownership boundary matters. Daily Operations should not import a POS hub
component as its primary visualization primitive, and POS should not start
depending on Daily Operations layout state. The shared layer needs to sit below
both surfaces.

## Solution

Extract the presentation into a neutral shared component that accepts
a store pulse summary, visibility flag, selected window, and window-change
callback. Keep the POS hub file as a compatibility wrapper that preserves the
existing POS export names and props.

Build Daily Operations store pulse data on the server snapshot:

- Add an optional `storePulseWindow` query argument with the public POS window
  values: `today`, `this_week`, `this_month`, and `all_time`.
- Interpret `today` from the selected Daily Operations operating date/range,
  not the current browser or server wall clock.
- Reuse the POS pulse aggregation helper and the shared net payment allocation
  helper instead of recomputing trend, item, or payment mix data in React.
- Include `storePulse` only when the Daily Operations snapshot already includes
  financial details. Redacted responses should omit it rather than returning
  hidden totals for the browser to suppress.

For layout, keep store pulse in the Daily Operations main workspace column and
put compact review-only content in the right rail. Opening review works well
above the store-day timeline when it uses a rail-specific summary: status,
count chips, three evidence rows, overflow text, and one full-width CTA back to
Opening Handoff.

## Prevention

- When sharing a POS visualization with another operations surface, extract the
  presentation below both surfaces and leave feature-owned wrappers in place.
- Treat store-day reporting windows as server-owned query inputs. Do not make
  Daily Operations pulse windows derive from client wall-clock state.
- Keep role redaction in the snapshot contract. If a surface is financially
  restricted, the query should omit detailed pulse data.
- Add tests at all three layers: POS wrapper compatibility, Daily Operations
  rendering/window search behavior, and backend store pulse window/redaction
  behavior.
