---
title: Athena POS Register Session Activity Ledger
date: 2026-07-05
last_updated: 2026-07-19
category: architecture-patterns
module: athena-webapp-pos
problem_type: architecture_pattern
component: database
resolution_type: code_fix
severity: high
applies_when:
  - "POS support needs to replay what a terminal did during one register session"
  - "A cloud outcome is disputed but local cashier actions must remain independently inspectable"
  - "Local POS events include sensitive payload fields that must not reach support-facing views"
tags: [pos, register-session, activity-ledger, local-sync, convex]
delivery_diff_fingerprint: 6df7470c234b5ad4cb5f025580955a87bb3262179374745dfc6b472bfcb40b82
related_components:
  - "pos-local-store"
  - "convex-sync"
  - "cash-controls"
---

# Athena POS Register Session Activity Ledger

## Problem

When support needs to answer what happened in a POS register session, the evidence cannot be limited to closeout outcomes or the subset of local events that core sync projects into cloud business records. A cashier may report that they closed a session while the cloud session remains open, but closeout is only one use case for a broader need: replay the activity that POS performed for that register session.

## Solution

Create a dedicated register-session activity ledger beside core sync settlement:

- Classify local POS event types into a stable activity category and operator label.
- Sanitize browser-local payloads through a positive allowlist before upload.
- Persist activity rows in Convex by store, terminal, local event id, local register session id, optional cloud register session id, local sequence, category, status, and safe metadata.
- Keep activity upload state separate from core `sync` state in IndexedDB.
- Let `mapping_pending` rows exist when local activity reaches the server before the local-to-cloud register-session mapping exists.
- Expose the ledger through a full-admin Cash Controls query that prefers the activity read model and only falls back to existing sync evidence when no activity rows/checkpoints exist.
- Derive presentation-only details such as item label, SKU, quantity, unit price, opening float, and a deduplicated payment-method summary from the same allowlisted metadata. A quantity of zero in a cart-item event means removal, not addition.

The activity report should use the terminal sync secret and normal POS auth, but the support read surface should use stricter full-admin access. This keeps terminal reporting possible without broadening the visibility of register-session replay data.

## Why This Matters

Core sync state answers whether a local event has been accepted, projected, held, conflicted, rejected, or reviewed. It does not preserve every POS action, and it can intentionally skip local-only actions such as cart edits, payment edits, service changes, and session start markers. A replay ledger fills that gap without changing settlement semantics.

The ledger also prevents a common modeling mistake: deriving activity visibility from closeout-specific tables. Closeout status is a consumer of the timeline, not the owner of it. A foundational activity stream can explain closeout, reopen, sale, cash movement, expense, cart, payment, and review behavior from the same ordered session evidence.

## Prevention

- Do not couple activity ingestion or presentation to closeout status. Model closeout as one activity category.
- Keep raw payloads, proof tokens, PINs, notes, customer contact details, and arbitrary metadata out of activity rows. Use a positive metadata allowlist on both browser and server boundaries.
- Use local event id plus store and terminal as the idempotency key so retries update the same activity row.
- Preserve `mapping_pending` rather than rejecting activity when the cloud register-session mapping is not available yet.
- Keep local `activity.status` independent from core `sync.status`; reporting activity must not mark a sale, expense, or closeout core sync event as settled.
- Bound session reads by indexes and pagination. Support-facing replay queries should not scan store-wide sync evidence by default.
- Add tests at every boundary: sanitizer, local activity state, runtime reporting, server ingestion/idempotency, full-admin read authorization, and UI rendering.
- Keep the table focused on activity context and state. Do not duplicate evidence-link chips when the session detail already owns evidence navigation.

## Examples

Activity upload should include local-only events without core-uploading them:

```ts
if (
  isPosLocalRuntimeDrainCandidate(event, options, uploadSupport) ||
  isPosLocalRuntimeActivityReportCandidate(event)
) {
  return event;
}
```

When reporting succeeds, only the activity state changes:

```ts
await store.markEventsActivityReported(["event-cart"], {
  status: "reported",
});
```

Core sync remains responsible for business-record projection:

```ts
await store.markEventsSynced(["event-sale"], { uploaded: true });
```

## Related

- [Athena POS Terminal Recovery Readiness Boundary](../architecture/athena-pos-terminal-recovery-readiness-boundary-2026-06-14.md)
- [Athena Terminal Sync Review Currentness](../logic-errors/athena-terminal-sync-review-currentness-2026-06-28.md)
- [Athena POS Terminal Review Reason Reconciliation](../logic-errors/athena-pos-terminal-review-reason-reconciliation-2026-05-26.md)
- [Athena POS Stale Terminal Sale Blocks](../logic-errors/athena-pos-stale-terminal-sale-block-2026-05-29.md)
