---
title: A Shared Timestamp Primitive Beats Per-Surface Date Formatting
date: 2026-08-02
category: architecture-patterns
module: Athena Admin UI
problem_type: architecture_pattern
component: ui_component
resolution_type: code_fix
severity: medium
applies_when:
  - "The same presentational pattern is being reinvented on multiple surfaces"
  - "A relative label hides the exact value a user needs to make a decision"
  - "A global CSS transform or zoom is applied above a portalled overlay"
  - "Adding a denormalized field to a persisted read model"
tags:
  - ui-primitives
  - timestamps
  - radix
  - popper-positioning
  - reports
  - read-models
delivery_diff_fingerprint: ffeba6794f0c388ff3b454fd52f3cd0e78e9ea000dd4e8096474e3d762724c64
---

# A Shared Timestamp Primitive Beats Per-Surface Date Formatting

## Problem

Roughly fifty call sites rendered `getRelativeTime(...)` as bare text. "5 minutes ago" is the right default for scanning, but it is the wrong unit for deciding: a cashier reconciling a drawer or a manager chasing a fulfillment needs the exact time, and on most surfaces that value was simply unreachable.

Two surfaces had independently solved this — the register session trace view and `ProductOperationalTimeline` — with the same shape and, in the second case, a local formatter byte-identical to the one in the trace view. Independent reinvention is the signal that the pattern belongs in one place.

A second, unrelated defect was hiding underneath. The admin shell applies `zoom: 0.95` to `<html>` on desktop. Radix positions a popper with a `position: fixed` wrapper whose transform is computed from `getBoundingClientRect` values that already account for the root zoom; the browser then scales that transform by the same zoom again. Every popper drifted by `(1 - zoom)` of its distance from the viewport origin — invisible in a sidebar, roughly 70px in a right-hand table column.

## Solution

Extract one `ui/` primitive that owns the whole pattern: a relative label, an accessible `<time dateTime>` value, and a tooltip carrying the absolute timestamp. Give it the props the call sites actually need rather than the union of everything they might: `prefix` for surfaces reading "Latest sale …", `fallback` for the many `x ? format(x) : "—"` ternaries, and `precision` for date-only contexts.

Migrate by decision weight, not by file count. Money and fulfillment surfaces first, then event timelines where the exact time is the entire point of the view, and leave low-stakes browsing tables for later. Three call sites stay on the raw helper on purpose: they interpolate into strings, so there is no JSX seam to hand a component.

For the zoom defect, cancel the root zoom on the popper wrapper so the transform resolves in the coordinate space it was measured in, and re-apply it to the inner content so overlays still render at app scale. Hold the scale in one custom property rather than repeating the literal.

For denormalized read models, resolve derived values where the projection is built, not where it is read. The reports overview query holds a documented steady-state budget of one document read; resolving each trend day's transaction count from its register close on every dashboard load would spend exactly the cost the projection exists to avoid — and the open-day fallback path can throw past a fact limit. Resolve at sweep time, keep the field optional in both the shared contract and the stored validator, and let the surface degrade honestly until the next sweep.

## Why This Matters

A relative label is a summary, and a summary is the wrong unit for a decision. Reconciling a drawer, chasing a fulfillment, or auditing an untrusted sale all turn on which day and which shift a record belongs to. Leaving that value unreachable does not make the surface simpler; it makes it unanswerable, and the user goes somewhere else to find the same fact.

Consolidating also changes what a global defect costs to find. The zoom-versus-popper bug had been shipping on every desktop dropdown, select, and context menu, but it only became legible once a tooltip appeared in a far-right table column where the proportional error was large enough to see. One primitive means the next such defect is found and fixed once.

The boundaries matter as much as the behavior. The primitive does not tick, so a label computed at render freezes until something re-renders it — acceptable here, and a real cost to reverse across a fifty-row table. Radix tooltips do not open on tap, so removing the native `title` deliberately trades away touch access. A day with no register close carries no transaction count rather than a zero that a later closeout would contradict. Each of these is a stated limit, not an oversight.

## Prevention

- Extract a presentational pattern on its second independent implementation, not its third; a byte-identical local formatter in another file is the signal.
- Give a new primitive the props its call sites actually need — a prefix, a fallback, a precision — rather than the union of everything a surface might want.
- When a shared formatter serves several meanings, add a dedicated one for the meaning you are changing; widening the shared one leaks into surfaces nobody asked about.
- Measure a positioning bug in the running browser before naming a cause, and revert the fix that measurement disproves.
- Pair a popper trigger to its content by `aria-describedby`, never by document order — a closing overlay still in the DOM will otherwise be measured against the wrong trigger.
- Resolve derived values for a persisted projection where it is built, not where it is read, and keep the new field optional so the rollout degrades honestly.
- Distrust a chart or tooltip test whose harness mocks a fixed payload; it passes regardless of the props under test.

## Examples

Before: a surface renders `{getRelativeTime(x)}`, and the exact timestamp exists nowhere in the DOM.

After: `<RelativeTimestamp value={x} />` renders the same label inside a `<time dateTime>` element with the absolute value in a tooltip. Nullable sources use `fallback`; `x ? getRelativeTime(x) : "Not scheduled"` becomes `fallback="Not scheduled"`.

Before: a tooltip in a right-hand table column renders ~70px from its trigger under the shell's `zoom: 0.95`.

After: the popper wrapper cancels the root zoom so its transform resolves in the space it was measured in, and the inner content re-applies it; trigger and tooltip centres agree to within 1px.

Before: a trend tooltip can only report units, because the persisted projection carries no transaction count.

After: the overview builder resolves each trend day's count from its register close at sweep time, the field is optional in both the contract and the stored validator, and the tooltip reads "31 units · 27 transactions" once the sweep lands.

## Related

- [Reports workspace read-model boundary](athena-reports-workspace-read-model-boundary-2026-07-11.md)
- [Report prior-period comparisons](athena-report-prior-period-comparisons-2026-08-01.md)
