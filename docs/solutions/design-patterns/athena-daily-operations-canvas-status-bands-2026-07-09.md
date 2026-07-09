---
title: Daily Operations status bands should live on the canvas
date: 2026-07-09
category: design-patterns
module: athena-webapp
problem_type: design_pattern
component: rails_view
resolution_type: code_fix
severity: medium
applies_when:
  - "Daily Operations or Opening Handoff shows automation status, completion evidence, or historical state notices"
  - "A dense operations workspace mixes metrics, charts, workflow lanes, and review evidence"
  - "A reusable analytical component needs a card and non-card presentation"
tags: [daily-operations, opening-handoff, canvas-treatment, store-pulse, automation]
related_components: [convex, graphify, operation-review-workspace]
---

# Daily Operations status bands should live on the canvas

## Problem
Daily Operations and Opening Handoff accumulated several operational evidence
blocks: Athena automation status, EOD completion attribution, historical
incomplete-close notices, workflow follow-up lanes, Store Pulse charts, top
items, and payment mix. Rendering each as a card made the page feel crowded and
made secondary evidence compete visually with the metrics and workflow cards.

The layout also put some evidence too far from the context it explained. For
example, EOD completion attribution appeared below Store Pulse analytics even
though it describes the store-day state, and Opening Handoff automation appeared
below the metric cards even though it explains how the workflow was started.

## Solution
Treat status and evidence bands as canvas content when they explain the whole
store-day context. Keep actual work lanes and repeated work-item rows as cards.

In practice:

- Place Athena automation, historical incomplete-close notices, and EOD
  completion attribution in the top operational stack before metric cards.
- Remove rounded card chrome from those bands: no border, raised background, or
  shadow. Use page-aligned padding such as `px-layout-md py-layout-sm` when a
  band still needs readable text rhythm.
- Add explicit variants to reusable analytical components instead of replacing
  their default card behavior globally. `StorePulseTimeline`,
  `TopItemsPanel`, `PaymentMethodsPanel`, and their loading states now support a
  canvas presentation while POS Store Pulse keeps the default card presentation.
- Keep workflow lanes carded. They are actionable repeated units, so the card
  boundary still helps scanning.
- Move shared workspace layout with extension points rather than special-casing
  order inside each page. `OperationReviewWorkspace` gained `beforeMetrics` so
  Opening Handoff can render automation evidence before metrics without
  changing Daily Close behavior.

Tests should pin both placement and chrome. Useful assertions include:

```tsx
expect(panel).not.toHaveClass(
  "rounded-lg",
  "border",
  "bg-surface-raised",
  "shadow-surface",
);
expect(
  panel.compareDocumentPosition(screen.getByText("Net sales")) &
    Node.DOCUMENT_POSITION_FOLLOWING,
).toBeTruthy();
```

## Why This Matters
Operators scan these pages to understand the state of a store day and decide
which workflow owns the next action. Too many cards make evidence feel like a
pile of competing objects. Canvas bands let page-level facts read as context,
while cards remain reserved for repeated actionable work.

Position matters as much as styling. Automation and completion evidence should
sit near the controls and metrics that summarize the operating date. Store Pulse
details belong below the weekly sales context. Follow-up lanes belong near the
workflow area. Keeping each piece in the layer it explains reduces first-glance
overload.

## Prevention
- Before adding a new Daily Operations or Opening Handoff evidence block, decide
  whether it is page-level context, an analytical visualization, or an
  actionable repeated work item.
- Use canvas treatment for page-level context and cards for repeated lanes,
  review items, and framed tools.
- When adding a canvas variant, include loaded, empty, and loading states in the
  variant so the page does not flash back to card treatment while data hydrates.
- Add tests for both DOM order and class-level chrome, especially when moving a
  band above metrics.
- Keep default card behavior for other consumers unless the caller explicitly
  opts into a canvas variant.

## Examples
Before:

```tsx
<div className="rounded-lg border border-success/25 bg-success/10 p-layout-md shadow-surface">
  <p>Athena completed EOD Review under store policy.</p>
</div>
```

After:

```tsx
<DailyOperationsCompletionAttributionNotice
  carryForwardCount={snapshot.completedClose?.carryForwardCount}
  completedClose={snapshot.completedClose}
/>

<div className="grid gap-layout-md ...">
  <OperationsSummaryMetric label="Net sales" />
</div>
```

The notice component owns the canvas styling:

```tsx
<div className="px-layout-md py-layout-sm text-sm leading-6">
  <p className="font-medium text-success">
    Athena completed EOD Review under store policy.
  </p>
</div>
```

## Related
- `packages/athena-webapp/src/components/operations/DailyOperationsView.tsx`
- `packages/athena-webapp/src/components/operations/DailyOpeningView.tsx`
- `packages/athena-webapp/src/components/operations/OperationReviewWorkspace.tsx`
- `packages/athena-webapp/src/components/store-pulse/StorePulseSummaryView.tsx`
