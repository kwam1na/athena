---
title: "Daily Operations review and cash closeout continuity"
date: 2026-07-11
last_updated: 2026-07-15
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
  - "EOD Review and Opening Handoff must preserve exact logical-work membership across store days"
tags: [athena, daily-operations, cash-controls, closeout, open-work, local-sync, logical-groups, eod-snapshot]
delivery_diff_fingerprint: 8dca8c88c10d612fc109b0ab8a02514ae2ad4b0f3a7d659090757a9ebe58a7b2
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
- Project operational work into logical groups on the server before any
  consumer counts, caps, displays, freezes, or resolves it. Synced-sale
  inventory reviews share one group only when store and canonical SKU match;
  unrelated work and rows without a usable SKU stay source-owned singletons.
- Keep every raw work row authoritative for audit and terminal state. The
  logical projection retains representative and alias membership, but exposes
  only an allowlisted queue DTO to clients.
- Resolve a normal logical group with one Convex mutation. The command
  re-derives current open and in-progress membership and compares it exactly
  with the IDs the operator reviewed. Any membership change produces zero
  writes and asks the operator to review the refreshed group. This intentionally
  avoids observation tokens, signatures, expiry, and key rotation.
- Separate source completeness from presentation overflow. A complete probe
  can produce an exact logical count even when more cards exist than the UI
  displays. An incomplete probe reports an observed lower bound such as `N+`,
  exposes no actionable membership, and blocks both human and automated EOD
  completion.
- Freeze versioned logical groups at EOD with their stable key, display
  evidence, and complete raw member IDs. Opening Handoff reconstructs only
  those frozen members, excludes later same-SKU work, and treats missing frozen
  evidence as non-bypassable for normal, manager-routed, and automated starts.
- Route groups above the normal atomic mutation budget through an internal,
  audited repair workflow. Repair freezes membership, requires support
  evidence, validates stock proof and membership before each bounded batch,
  and pauses on drift while the queue continues to show one logical group.
  Persist each repair lifecycle action as its own typed append-only row rather
  than growing an unbounded evidence array on the repair document.

## Why This Matters

Closeout, settlement, and inventory follow-up are not interchangeable. The
shared operating-day snapshot provides visibility, while Cash Controls and the
Open Work resolver retain their own authorization, audit, and mutation
boundaries. The shared logical projection separates two legitimate truths: the
operator reviews one SKU-scoped inventory decision, while audit, stock proof,
source validation, and terminal transitions remain attached to every
sale-level work row. Centralizing that distinction prevents Open Work, Daily
Operations, EOD, and Opening from inventing different grouping or count rules.

Exact command-time membership comparison is the concurrency contract. For
this operational surface, a stale view may require another review; it does not
need to remain actionable. That tradeoff is simpler and easier to audit than a
cryptographic observation-token lifecycle.

Frozen EOD membership answers “what did the prior close carry forward?” rather
than recomputing whatever is currently open for the SKU. New work cannot enter
an older acknowledgement, and terminal changes cannot rewrite historical
evidence.

## Prevention

- Test current and historical operating dates separately. The current snapshot
  can expose live open sessions, while a historical day needs its own bounded
  session query.
- Test the manager-visible financial summary and the cashier-redacted state
  together whenever session data is added to a Cash Controls read model.
- Test selected-conflict filtering, missing-register-session mapping repair,
  projected sale ids, and review resolution as one local-sync workflow.
- Keep source identity, deterministic ordering, grouping, completeness, and
  resolution availability in the server-domain projection. Do not recreate
  those rules in React or individual workspace queries.
- Group before presentation caps. Never derive an exact count or actionable
  member IDs from an incomplete source probe.
- Assert exact current membership inside the resolving mutation and throw on
  any late member failure so Convex aborts every earlier patch and audit event.
- Test that Open Work, Daily Operations, EOD, and Opening count the same logical
  groups while retaining every underlying raw work-item ID.
- Test that versioned EOD snapshots freeze complete membership, Opening
  excludes later same-SKU rows, fully terminal frozen groups disappear, and
  missing evidence fails closed on every start path.
- Keep oversized repair credential-gated, evidence-bearing, bounded,
  resumable, and invisible as a public application mutation.
- Preserve the queue redaction boundary: expose allowlisted logical fields,
  never generic source metadata, proof IDs, or repair evidence.
- Refresh generated Convex APIs and Graphify whenever backend query or route
  surfaces change.

## Examples

An open session is a navigation aid, not a second closeout implementation:

```ts
getDailyOperationsOpenRegisterSessionsSnapshot({ storeId, operatingDate });
// Each result links to the existing cash-controls register-session route.
```

A logical inventory card represents many durable reviews while retaining one
server-owned identity:

```ts
projectLogicalOperationalWork(sourceItems, {
  sourceComplete: true,
});
```

Resolution rechecks the operator's observed membership atomically:

```ts
resolveLogicalOpenWork({
  logicalKey: group.logicalKey,
  expectedWorkItemIds: group.items.map((item) => item._id),
});
```

If the membership changed, the command returns no writes and the UI presents:

> This work changed. Review the refreshed group before marking it reviewed.

## Related

- [EOD Review automation completion](../architecture/athena-eod-review-automation-completion-2026-06-22.md)
- [Manager-gated operational surfaces](athena-manager-gated-operational-surfaces-2026-07-07.md)
- [Open Work resolution ownership](../architecture/athena-open-work-resolution-ownership-2026-07-02.md)
- [Pending checkout inventory resolution](athena-pending-checkout-inventory-resolution-2026-07-03.md)
- [Daily Operations aggregate read model](../logic-errors/athena-daily-operations-aggregate-read-model-2026-05-08.md)
- [Immutable Daily Close history snapshots](../logic-errors/athena-daily-close-history-snapshots-2026-05-09.md)
- [Daily Opening readiness gate](../logic-errors/athena-daily-opening-readiness-gate-2026-05-08.md)
