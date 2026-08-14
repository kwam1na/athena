---
title: Daily Close saturation must preserve evidence and alert once
date: 2026-08-14
category: logic-errors
module: daily_operations
problem_type: logic_error
component: background_job
symptoms:
  - Daily Close automation could quarantine a day solely because open operational work exceeded a read cap.
  - A repeatedly owed operating day remained visible only in internal sweep evidence and did not notify a manager.
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [daily-close, automation, notifications, source-completeness, deduplication]
delivery_diff_fingerprint: c27cb5ba912519fd6459c6f6770a61115315eba8108e292891646d3ff2c608a3
---

# Daily Close saturation must preserve evidence and alert once

## Problem

Daily Close treated every incomplete source read as a completion blocker. That was too broad for open operational work: exceeding its bounded read cap means the snapshot cannot enumerate every member, but it does not make the observed open-work evidence unsafe to carry forward. Separately, the owed-close sweep recorded a stale event without creating a manager-facing notification.

## Symptoms

- A store with more open operational work than the source cap could remain quarantined even though the work was safe to carry forward.
- Repeated sweeps accumulated internal retry evidence without giving managers a direct EOD Review action.
- A naive notification emitted on every retry would risk duplicate email.

## What Didn't Work

- Treating `snapshot.sourceCompleteness.complete` as one global completion predicate erased the distinction between sources that must be exhaustive and operational work that can be conservatively carried forward.
- Using the normal selected-member count under saturation understated the persisted carry-forward count because the selected IDs are necessarily incomplete.
- Sending directly from the sweep would bypass the notification registry's durable deduplication and recipient policy.

## Solution

Classify incomplete source reads by whether they block completion. Daily Close still blocks on incomplete financial or transactional sources, while an incomplete `operational_work_item` source preserves all observed carry-forward items and records the observed logical count. Historic automation applies the same classification.

Emit `eod.stale_daily_close` through the notification registry from the existing stale-escalation mutation. Its dedupe key is stable for one store and operating date:

```text
eod.stale_daily_close:<storeId>:<operatingDate>
```

The notification prepares its email only while the close is still open and the latest EOD automation run is skipped or failed. It reuses the Daily Manager Report payload builder for store schedule, blocker, cash-position, and EOD Review URL semantics rather than reconstructing those rules in the sweep.

The sweep escalates only dates it actually attempted in that invocation. This
keeps dates beyond the three-date work bound from consuming their permanent
store/date intent before the backlog reaches them. A successful historic
close reports `applied` and is excluded from escalation. The escalation
mutation also rechecks the active completed close inside its transaction.

If a stale intent initially finds no EOD subscribers, a later owed-date retry
re-arms that same suppressed intent after subscription setup. The intent and
recipient dedupe keys remain unchanged, so recovery does not weaken duplicate
delivery protection.

## Why This Works

Source completeness remains authoritative where missing rows could corrupt a close. Open operational work uses a different conservative rule: preserve every observed group, acknowledge that enumeration was capped, and carry forward the observed count instead of pretending the source was empty or complete.

The stale alert stays idempotent because operational-event deduplication and notification-intent deduplication share the stable store/date identity. Preparation rechecks live state, so a close completed after intent creation produces no stale email.

## Prevention

- Do not collapse heterogeneous source-completeness entries into a single boolean when sources have different safe fallback behavior.
- When a bounded read is allowed to proceed, persist explicit observed-count and completeness evidence; never infer zero from a truncated member list.
- Route manager email through the notification registry with a stable business dedupe key and a send-time state recheck.
- Test cap boundaries, repeated sweeps, recently owed days, completed-close suppression, and null preparation when the automation run no longer qualifies.

## Related Issues

- `packages/athena-webapp/convex/operations/dailyClose.ts`
- `packages/athena-webapp/convex/operations/owedDailyCloseSweep.ts`
- `packages/athena-webapp/convex/notifications/registry.ts`
