---
title: "Daily Operations review and cash closeout continuity"
date: 2026-07-11
category: architecture-patterns
module: athena-webapp
problem_type: architecture_pattern
component: documentation
resolution_type: code_fix
severity: high
applies_when:
  - "Daily Operations must route unresolved register sessions to their cash-control closeout"
  - "A manager resolves local-sync sales conflicts that need both an inventory review and a register-session repair"
  - "Open Work contains repeated synced-sale inventory reviews for one product SKU"
tags: [athena, daily-operations, cash-controls, closeout, open-work, local-sync]
delivery_diff_fingerprint: 1d74ad91ab92fa491755c77b04b6b0d4cfb7c5c33659dfb717df8b86a114a63e
---

# Daily Operations review and cash closeout continuity

## Problem

Daily Operations and Cash Controls describe the same operating day from
different entry points. If their read models and actions drift, an operator can
lose the path from an open register session or a reviewed synced sale to the
cash closeout and inventory work that must follow.

## Solution

Treat Daily Operations as a routing surface and preserve the authoritative
workflows behind it:

- Query open register sessions for the requested operating date with the same
  store authorization as the daily snapshot. Link each session to its Cash
  Controls closeout route, including a terminal and register label.
- Keep cash detail behind the existing manager/full-admin capability. The
  register-session view may show a sales and payment summary only after that
  capability permits the protected snapshot.
- Resolve local-sync sale conflicts in one review action. A selected sale can
  project its transaction, clear matching conflicts, create or reuse a missing
  register-session mapping, and leave the inventory review as the durable
  follow-up signal.
- Group Open Work's synced-sale inventory reviews by SKU for presentation, but
  retain every underlying work item so the grouped action marks each review
  through the existing resolver.

## Why This Matters

Closeout, settlement, and inventory follow-up are not interchangeable. The
shared operating-day snapshot provides visibility, while Cash Controls and the
Open Work resolver retain their own authorization, audit, and mutation
boundaries. Grouping may reduce operator noise, but it must never discard the
individual sale evidence needed for review and auditability.

## Prevention

- Test current and historical operating dates separately. The current snapshot
  can expose live open sessions, while a historical day needs its own bounded
  session query.
- Test the manager-visible financial summary and the cashier-redacted state
  together whenever session data is added to a Cash Controls read model.
- Test selected-conflict filtering, missing-register-session mapping repair,
  projected sale ids, and review resolution as one local-sync workflow.
- When grouping Open Work, assert both the display count and that the bulk
  action submits every underlying work-item id.
- Refresh generated Convex APIs and Graphify whenever backend query or route
  surfaces change.

## Examples

An open session is a navigation aid, not a second closeout implementation:

```ts
getDailyOperationsOpenRegisterSessionsSnapshot({ storeId, operatingDate });
// Each result links to the existing cash-controls register-session route.
```

A grouped inventory card represents many durable reviews:

```ts
resolveOpenWork({
  workItemIds: groupedItems.map((item) => item._id),
});
```

## Related

- [EOD Review automation completion](../architecture/athena-eod-review-automation-completion-2026-06-22.md)
- [Manager-gated operational surfaces](athena-manager-gated-operational-surfaces-2026-07-07.md)
- [Open Work resolution ownership](../architecture/athena-open-work-resolution-ownership-2026-07-02.md)
