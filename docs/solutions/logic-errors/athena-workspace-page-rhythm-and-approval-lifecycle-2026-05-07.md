---
title: Athena Workspaces Share Page Rhythm And Close Inline Approval Requests
date: 2026-05-07
category: logic-errors
module: athena-webapp
problem_type: workspace_consistency_and_approval_lifecycle
component: operations-workspaces
symptoms:
  - "Operations workspaces drifted into different header, spacing, and empty-state patterns"
  - "Approval queue cards read as mechanically dense instead of operationally scannable"
  - "Payment method correction requests approved inline by a manager could remain in the pending approval queue"
root_cause: duplicated_workspace_layout_and_split_approval_resolution_paths
resolution_type: shared_ui_pattern_plus_lifecycle_fix
severity: medium
tags:
  - athena-webapp
  - operations
  - workspace-layout
  - command-approval
  - design-system
---

# Athena Workspaces Share Page Rhythm And Close Inline Approval Requests

## Problem

Athena's operational workspaces need to feel like parts of the same system.
When each workspace owns its own header scale, section spacing, card rhythm, and
empty state treatment, small visual decisions compound into a fragmented app.
Operators end up reading layout noise instead of the work queue.

The approval workspace also exposed a lifecycle split in payment method
corrections. The command first created an async approval request, then the
same-submission manager fast path retried with an inline proof and applied the
correction. Because the retry did not carry the queued approval request id, the
request stayed `pending` and continued to surface as needing action even though
the manager had already approved it in flow.

## Solution

Make page rhythm a shared design-system primitive instead of a per-workspace
habit. Use the shared page header and workspace layout wrappers for operational
surfaces so headers, primary columns, rails, and section spacing line up across
approvals, stock adjustments, open work, procurement, cash controls, and
analytics.

For dense work queues, prefer calm separation over more labels:

- Use vertical rhythm between cards and sections so each unit can be scanned.
- Reserve cards for real repeated items and remove empty-state framing when
  there is no work to review.
- Normalize backend wording before it reaches the UI.
- Use restrained design-system button and badge treatments instead of loud
  one-off colors.

For approval commands, keep the command boundary authoritative. The ui can use
same-submission manager credentials only after the server returns an
`ApprovalRequirement`. If that requirement includes an async approval request and
the inline proof retry succeeds, pass the approval request id into the retry.
The command should validate that the request matches the transaction, store, and
requested correction, then mark the request approved in the same mutation that
applies the correction.

## Prevention

- Add new workspaces through the shared page rhythm primitives instead of
  copying local header and spacing classes.
- Keep empty states unframed unless the frame itself carries useful workflow
  structure.
- When an approval requirement offers both `inline_manager_proof` and
  `async_request`, treat the async request as a lifecycle record that must be
  closed if the inline proof path completes the work.
- Do not hide stale approvals in the queue query. Fix the command or resolver
  path that left the request pending.
- Regression tests for approval fast paths should assert both the retry payload
  and the final approval request status.
