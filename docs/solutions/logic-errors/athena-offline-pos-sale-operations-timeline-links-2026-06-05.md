---
title: Athena Offline POS Sale Operations Timeline Links
date: 2026-06-05
category: logic-errors
module: athena-webapp
problem_type: offline_pos_sale_timeline_attribution
component: operations-timeline
symptoms:
  - "Offline POS sale sync events show generic messages without receipt, total, or tender context"
  - "Daily operations timeline entries do not link directly to the projected POS transaction"
  - "Product SKU timeline links can lose useful labels when sync metadata is partial"
root_cause: sale_projection_and_timeline_linking_did_not_share_operator_audit_metadata
resolution_type: server_owned_timeline_metadata_and_inline_links
severity: medium
tags:
  - pos
  - local-sync
  - operations
  - timeline
  - auditability
---

# Athena Offline POS Sale Operations Timeline Links

## Problem

Offline POS sale sync events reached the operations timeline as generic
`Offline POS sale synced.` messages. That made the event auditable in a narrow
sense, but operators could not quickly answer which receipt synced, how many
lines were included, how it was paid, or where to inspect the resulting POS
transaction.

The same timeline code already handled product links, so adding richer sale
copy only on the client would have split the audit source of truth across
projection and rendering layers.

## Solution

Build the operator-facing sale summary when the local event is projected. Store
receipt number, line count, payment methods, and total in the timeline event
metadata, and use a calm sentence such as:

`Sale #R-100 synced: 2 sale lines, GHS 120.00, cash and card.`

Expose a transaction link from the daily operations read model when the event
subject is a POS transaction. Keep product links server-derived as well, and
resolve SKU metadata from `productSkuId` when local sync recorded the SKU but
did not include every product label field.

On the React side, render one inline timeline link chosen from the transaction
link first, then the product link. This keeps the message readable while giving
operators a direct route into the relevant transaction or catalog record.

## Implementation Notes

- Keep message construction in
  `convex/pos/application/sync/projectLocalEvents.ts` so replayed projections
  and timeline reads share one wording source.
- Format money through the existing currency helpers and fall back to GHS when
  a store currency value is malformed.
- Deduplicate payment method labels before writing metadata so split payments
  do not repeat the same tender type.
- In `convex/operations/dailyOperations.ts`, enrich timeline events with
  transaction links for POS transaction subjects and product links for SKU
  subjects or SKU metadata.
- In `DailyOperationsView`, splice the inline link into the message by matching
  the link label. Fall back to the full linked label when the message does not
  contain it.

## Verification

- Add projection tests that assert sale timeline messages include receipt,
  line-count, total, and payment labels.
- Add operations read-model tests for transaction links and product SKU links.
- Add React tests that prove the timeline renders transaction links inline and
  still handles product links.
- Run focused Convex and React tests first, then `bun run pr:athena` before
  merge-ready handoff.

## Prevention

- Do not make the operations timeline infer offline sale totals or payment
  labels from client-only state. Record those details when the sale projection
  creates the timeline event.
- Do not rely on `subjectLabel` alone for product SKU events. Prefer explicit
  metadata and resolve the SKU document when the event has `productSkuId`.
- Do not render multiple competing inline links in one timeline sentence.
  Prefer transaction links for transaction events and product links for product
  events.
- Do not surface raw payment method enum values directly to operators. Normalize
  labels such as `mobile_money` into restrained operational copy.
