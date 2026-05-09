---
title: Athena Store Ops Workspaces Need State-Aware Presentation Boundaries
date: 2026-05-09
category: logic-errors
module: athena-webapp
problem_type: logic_error
component: operations
symptoms:
  - "Started store days could still display stale Opening Handoff blockers from the readiness snapshot"
  - "Historical End-of-Day Review pages used current-day metric labels and transaction filters"
  - "Approval and service workspaces lost operator context when linked details omitted requester notes or collapsed long lists"
root_cause: presentation_state_boundary
resolution_type: code_fix
severity: medium
tags:
  - store-ops
  - daily-opening
  - daily-close
  - service-ops
  - pos
---

# Athena Store Ops Workspaces Need State-Aware Presentation Boundaries

## Problem

Athena store operations pages often render a server snapshot that includes both current workflow state and source detail. The UI can become misleading when it presents raw source detail without first applying the workspace's current state boundary.

Examples:

- Opening Handoff had `startedOpening`, but still displayed blocker buckets from an older readiness snapshot.
- End-of-Day Review for a prior operating date still labeled metrics as "Today's net sales" and linked transactions with a redundant current-day date filter.
- Approval cards showed a linked transaction but did not surface the requester-entered note that explained why the approval was queued.
- Service catalog previews kept growing in-place instead of linking to a dedicated service directory.

## Solution

Normalize display state before rendering buckets, metrics, and links:

```ts
const displaySnapshot = getDisplaySnapshot(snapshot, status);
const buckets = getVisibleBucketConfigs(displaySnapshot, status);
const metricLabels = getDailyCloseSalesMetricLabels(snapshot.operatingDate);
```

Use the normalized display state for:

- Bucket visibility and counts.
- Rail checklist counts.
- Default selected tabs.
- Metric labels and query params.
- Compact previews that link to a full workspace when lists grow.

Keep the raw snapshot for command submission and audit data. Presentation normalization should not mutate the backend command payload or erase source facts from reports.

## Prevention

- Treat terminal states as presentation boundaries. If a workflow is completed or started, stale blocker/review details should not drive the primary UI.
- Completed End-of-Day Review pages must render the persisted `dailyClose.reportSnapshot` instead of recomputing blockers from live register, approval, POS session, transaction, or work-item tables.
- Live End-of-Day Review blocker sources must be scoped to the selected operating date. Approval blockers should follow their linked transaction or register session when available; unresolved POS sessions should intersect the operating-day range instead of using store-wide active/held state.
- Keep current-day and historical operating-date copy separate. Historical reports should say "Net sales" and "Cash"; current-day operational views can say "Today's net sales" and "Today's cash".
- Omit default current-day filters from navigation links. Include an operating date only when the target needs a historical date.
- Surface human-entered notes near requester or actor identity, before linked technical details.
- Cap overview lists and link to a dedicated workspace when the list can grow beyond quick-scan size.
- Add regression tests for stale snapshots that carry terminal workflow state plus old blocker detail.
