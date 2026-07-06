---
title: Athena Convex Posture Queries Stay Separate From Detail Reads
date: 2026-06-29
last_updated: 2026-07-06
category: performance
module: athena-webapp
problem_type: convex_read_amplification
component: operations-pos-read-models
symptoms:
  - "Convex production usage showed a June 27 Database I/O spike concentrated in default dashboard and POS queries"
  - "Default subscriptions mixed operator posture with full analytics, sync evidence, and full catalog metadata"
root_cause: default_read_models_hydrated_detail_evidence_and_metadata
resolution_type: posture_detail_query_split
severity: high
tags:
  - convex
  - performance
  - pos
  - operations
  - catalog
---

# Athena Convex Posture Queries Stay Separate From Detail Reads

## Problem

Default Convex subscriptions are production hot paths. A route, register boot, or
terminal roster should not hydrate full history, sync evidence, analytics, or
full catalog metadata unless the operator asks for that detail.

The June 27, 2026 production read spike showed that several default queries were
doing detail-grade work:

- daily operations mixed operational posture with week metrics, store pulse, and
  full timeline history
- register and cash-control snapshots scanned store-level sync review rows when
  a single register session was being viewed
- terminal rosters used the same evidence-heavy builder as terminal detail
- register catalog metadata stayed live-subscribed even though IndexedDB already
  held a local search snapshot

## Solution

Split read contracts by intent:

- Keep default posture queries bounded and route-safe.
- Move analytics, full timelines, and detail evidence behind explicit companion
  queries or drill-in actions.
- For targeted review paths, pass the target register/session/terminal id so the
  query can avoid store-wide conflict scans.
- Keep cached metadata local by default. Refresh it with an explicit one-shot
  authenticated Convex query and then persist the result locally.
- Preserve command-side validation as the durable authority. A local cache can
  speed search and boot, but checkout/catalog commands must still validate
  current server truth.

## July 2026 Follow-up: Push Selectivity Into Indexes

When a production warning names a function close to Convex's per-execution read
limit, do not stop at client caching. Inspect each server query in the route and
move the selective predicates into index range expressions wherever the schema
allows it.

The daily operations read-reduction pass used this pattern:

- `dailyClose` prior-close lookup now pushes `operatingDate < currentDate` into
  `by_storeId_status_operatingDate` and walks the descending iterator only until
  the existing lifecycle-compatible limit is reached.
- terminal runtime status now uses `by_storeId_status_terminalId` for each
  sale-usable status instead of scanning recent sessions by terminal alone. It
  still takes a bounded window per status so a newer incompatible register
  number does not hide an older compatible session.
- context-event abuse quota checks now use
  `by_storeId_surface_status_abusePartitionKey_receivedAt` instead of filtering
  recorded events after a broader surface/status scan.
- bag merge, saved-bag merge, POS recovery-code auth, and organization-member
  authorization paths gained compound indexes matching the exact equality
  predicates they use.

The key review lesson was that an index optimization can accidentally narrow
behavior. If the old path used `take(25).find(...)`, replacing it with `.first()`
is only safe when the first row is guaranteed to be compatible. Add a regression
test with a newer incompatible row and an older compatible row before accepting
that kind of rewrite.

## Prevention

- Do not add detail evidence, full history, or analytics payloads back to default
  route/register/roster subscriptions.
- Add characterization tests that assert targeted paths do not call broad
  store-status indexes such as `by_store_status` when a target id is available.
- For Convex performance fixes, prefer index names that spell out every indexed
  field exactly. This keeps schema review aligned with Convex AI guidance and
  makes source-level tests less ambiguous.
- When replacing a broad scan with a selective index, preserve the old
  compatibility predicates in tests, especially "skip incompatible newest row"
  cases.
- Add high-cardinality fixtures for roster, timeline, and catalog surfaces before
  changing read-model boundaries.
- When adding a companion query, update the frontend so it is lazy or tied to an
  explicit detail action; do not immediately subscribe to the companion query on
  initial route load.
- Run `bun run pre-commit:generated-artifacts` and Graphify after changing Convex
  read boundaries.

## Related Validation

- `bun run --filter '@athena/webapp' test -- convex/pos/infrastructure/repositories/registerSessionRepository.test.ts convex/cashControls/deposits.test.ts`
- `bun run --filter '@athena/webapp' test -- convex/operations/dailyOperations.test.ts src/components/operations/DailyOperationsView.test.tsx`
- `bun run --filter '@athena/webapp' test -- convex/pos/application/queries/terminals.test.ts convex/pos/public/terminals.test.ts`
- `bun run --filter '@athena/webapp' test -- src/lib/pos/infrastructure/convex/catalogGateway.test.tsx`
- `bun run --filter '@athena/webapp' audit:convex`
- `bun run --filter '@athena/webapp' lint:convex:changed`
- `bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json`
- `bun run --filter '@athena/webapp' build`
- July 2026 follow-up:
  `bun run test -- convex/operations/dailyClose.test.ts convex/operations/dailyOperations.test.ts convex/pos/application/terminals.test.ts convex/pos/infrastructure/repositories/terminalRepository.test.ts convex/inventory/sessionQueryIndexes.test.ts convex/storeFront/commerceQueryIndexes.test.ts convex/contextTracking/contextEvents.test.ts convex/pos/public/posRecoveryCodes.test.ts convex/remoteAssist/transportInternal.test.ts`

## Related Issues

- Linear: V26-905, V26-906, V26-907, V26-908, V26-909, V26-910, V26-911.
