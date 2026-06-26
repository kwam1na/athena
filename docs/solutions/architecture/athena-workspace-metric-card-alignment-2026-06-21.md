---
title: Athena Workspace Metric Cards Should Share One Component Contract
date: 2026-06-21
category: architecture
module: athena-webapp
problem_type: presentation_component_drift
component: operations
symptoms:
  - "Stock Adjustments and Procurement used bespoke compact metric tiles while Daily Operations used shared metric cards"
  - "Clickable filter metrics had separate markup from read-only summary metrics"
  - "Workspace rails presented KPI counts with row lists or icon cards that did not match the store-ops metric language"
root_cause: workspace_metric_presentation_split_across_local_markup
resolution_type: component_consolidation
severity: low
tags:
  - store-ops
  - metrics
  - design-system
  - procurement
  - stock-adjustments
---

# Athena Workspace Metric Cards Should Share One Component Contract

## Problem

Athena store-ops workspaces gradually accumulated multiple metric-card styles.
Daily Operations used `OperationsSummaryMetric`, while Stock Adjustments,
Procurement, and Operations Queue rendered local metric tiles, row lists, or
icon-led count cards. The cards carried the same operator job - quick scan of a
label, value, and optional helper - but differed in typography, spacing, border
treatment, and interaction markup.

The split was especially visible when an operator moved between Daily
Operations, Stock Adjustments, and Procurement. It also made clickable metrics
harder to keep consistent: the Stock Adjustments `Reserved` card acted as a
filter but had a separate button layout from the read-only metric cards.

## Solution

Use `OperationsSummaryMetric` as the shared metric contract for Store-ops
workspace KPIs:

```tsx
<OperationsSummaryMetric
  label="Reserved"
  value={formatInventoryNumber(inventoryState.unavailableUnits)}
  onClick={handleUnavailableMetricClick}
  ariaPressed={isUnavailableScopeSelectionActive}
  disabled={inventoryState.unavailableUnits === 0}
/>
```

Keep the shared card responsible for:

- Default Daily Operations card scale, typography, border, and shadow.
- Optional helper copy for secondary context.
- Optional link affordances.
- Optional button behavior for metric-as-filter interactions.

Workspace-specific code should provide the data, labels, helper copy, and
handlers. It should not recreate the card shell unless the surface is not a
KPI metric.

## Prevention

- Before adding a new workspace KPI card, check whether `OperationsSummaryMetric`
  can express it with `label`, `value`, `helper`, `link`, or `onClick`.
- Preserve interactive semantics inside the shared metric component instead of
  wrapping custom card markup in local buttons.
- Use local cards for bounded forms, queue items, detail panels, and true
  sub-decisions. Use `OperationsSummaryMetric` for operator-scan KPI totals.
- When aligning one workspace, grep sibling store-ops surfaces for local
  metric tile markup so the pattern does not remain split across adjacent
  workflows.
- Update focused rendering tests when consolidating markup so they assert
  operator-visible labels and values, not the previous local DOM structure.
