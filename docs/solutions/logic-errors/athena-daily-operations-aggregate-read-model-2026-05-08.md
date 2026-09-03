---
title: Athena Daily Operations Should Aggregate Source Workflows Without Owning Them
date: 2026-05-08
category: logic-errors
module: athena-webapp
problem_type: operational_overview_source_ownership
component: daily-operations-overview
symptoms:
  - "A store-day overview can obscure whether Daily Opening, Daily Close, or the operations queue owns the next action"
  - "Broad queue scans can let terminal work hide current open work when capped"
  - "Timeline caps can return old operational events if ordering is applied after limiting"
  - "A wall-clock read inside a snapshot predicate makes a historic operating day answer differently than it did live"
  - "A capped scan filtered afterwards can render an empty truncated read as an all-clear day"
root_cause: overview_surface_was_missing_a_bounded_source_owned_read_model
resolution_type: aggregate_snapshot_over_source_workflows
severity: medium
tags:
  - operations
  - daily-opening
  - daily-close
  - operations-queue
  - convex
  - read-model
---

# Athena Daily Operations Should Aggregate Source Workflows Without Owning Them

## Problem

Daily Operations is an operator overview, not a new workflow of record. If it
creates its own lifecycle rules or generic action items, the UI can drift from
Daily Opening, Daily Close, and the Operations queue. Operators then see a store
day posture without a clear source workflow to resolve the underlying work.

The same overview shape can also hide current work if bounded queries are
applied in the wrong place. A capped store-wide work-item scan followed by
status filtering can fill with terminal work before open work is counted. A
timeline query that limits before ordering can show old events and drop the
latest operational activity.

## Solution

Build Daily Operations as a bounded aggregate snapshot over the source
workflows:

- Call the Daily Opening and Daily Close snapshot builders and preserve their
  source subjects, link targets, and blocker/review semantics.
- Derive the store-day lifecycle from those source snapshots only:
  `not_opened`, `operating`, `close_blocked`, `ready_to_close`, and `closed`.
- Add queue attention as a separate `operations_queue` owner, with links back to
  open work or approvals rather than mutating those queues from the overview.
- Query queue work through `operationalWorkItem.by_storeId_status` for known
  open statuses instead of scanning by store and filtering after the cap.
- Query timeline events through `operationalEvent.by_storeId_createdAt`, order
  newest first, and then apply the limit.
- Include count labels such as `200+` when bounded overview lanes are capped,
  so the UI does not imply exactness.

The UI should render the snapshot as navigation: posture, lanes, attention, and
timeline. Primary and secondary actions should take the operator into the
workflow that owns the command.

## Prevention

- Do not make Daily Operations complete Daily Opening, complete Daily Close, or
  resolve queue items directly.
- Do not add new lifecycle states without mapping them back to a source
  workflow state and test fixture.
- Do not count queue work from a broad capped store scan when a status index is
  available.
- Do not sort timeline rows in memory after `.take()`; order the indexed query
  before limiting.
- Do not read `Date.now()` inside a query predicate that decides which rows a
  store-day snapshot contains. A read handler may stamp the current time onto
  what it returns; the moment the clock selects rows or switches filtering
  mode, the same store and operating date answer differently depending on when
  the question is asked, and a historic day reads smaller — or empty — than it
  was. Anchor the rule to the requested date instead.
- When a capped scan is filtered afterwards, report the day as incomplete
  whenever the cap itself was reached, not only when the surviving rows exceed
  the display limit. The index order need not match the filter's ordering key,
  so a qualifying row can sit past the prefix; and carry that incompleteness
  into the lane's status, not only into its count label, or an empty truncated
  read still renders as an all-clear day.
- Keep harness registry entries aligned with the route and read model when
  changing Daily Operations so generated validation docs keep pointing at the
  focused test set.

## Related Validation

- `bun run --filter '@athena/webapp' test -- convex/operations/dailyOperations.test.ts src/components/operations/DailyOperationsView.test.tsx`
- `bun run --filter '@athena/webapp' test -- convex/operations/dailyOperations.test.ts convex/operations/dailyOpening.test.ts convex/operations/dailyClose.test.ts convex/operations/operationsQueryIndexes.test.ts src/components/operations/DailyOperationsView.test.tsx src/components/operations/DailyOpeningView.test.tsx src/components/operations/DailyCloseView.test.tsx src/components/operations/OperationsQueueView.test.tsx src/routeTree.browser-boundary.test.ts`
- `bun run pr:athena`
