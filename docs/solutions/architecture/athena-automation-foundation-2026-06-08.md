---
title: "Athena automation foundation keeps system action auditable and bounded"
date: 2026-06-08
category: architecture
module: athena-webapp
problem_type: automation_boundary
component: daily-operations
resolution_type: automation_run_ledger
severity: medium
tags:
  - automation
  - daily-operations
  - daily-opening
  - daily-close
  - audit
---

## Problem

Athena needs to perform low-risk store-day work without being treated as a staff
profile and without hiding why a workflow changed or did not change. Daily
Operations is the first consumer: Opening Handoff can be started by Athena only
when the server readiness snapshot is clean, while EOD Review can be prepared
for manager review without bypassing the existing completion approval boundary.

## Solution

Keep automation evidence in a reusable foundation:

- `automationPolicy` stores store-scoped mode and policy version.
- `automationRun` records store, operating date, domain, action, outcome,
  idempotency key, source subjects, snapshot counts, policy version, and errors.
- Operational events can carry explicit automation actor metadata, separate from
  human `actorUserId` and `actorStaffProfileId`.

Daily Operations reads the ledger by `storeId`, `operatingDate`, `domain`, and
`action`, then exposes normalized UI status for the lifecycle lane:

- `opening.auto_start` maps to Opening Handoff status.
- `eod.prepare` maps to EOD Review status.

The UI derives calm operator copy from normalized outcomes such as `applied`,
`prepared`, `skipped`, `dry_run`, `disabled`, and `failed`. It should not render
raw backend reason codes or exception messages. Source links route back to the
workflow that owns the evidence.

## Safety Boundary

Opening automation may create the same durable `dailyOpening` record used by a
manual start only after command-time readiness is clean. EOD automation remains
preparation-only in this foundation: it can record that Athena prepared or
routed the review, but it must not call completion without the existing manager
approval proof.

Completed or opened lifecycle state remains the primary presentation boundary.
If a workflow is already started or closed, stale skipped or dry-run automation
decisions should not replace the current state. Keep those rows in the ledger
for audit history, but do not make them the first-glance status.

## Prevention

- Add new automation consumers through registered domain/action definitions
  instead of embedding one-off cron logic in workflow modules.
- Keep action mode store-scoped and disabled or dry-run by default.
- Record both action and inaction in `automationRun`; operators need to know
  what Athena did, prepared, skipped, or failed to finish.
- Normalize automation copy in frontend/read-model code before it reaches
  operators.
- Add tests at both layers: read-model tests for ledger-to-snapshot mapping and
  component tests for terminal-state suppression and source workflow links.
