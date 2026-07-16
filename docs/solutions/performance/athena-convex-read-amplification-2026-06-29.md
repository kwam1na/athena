---
title: Athena Convex Posture Queries Stay Separate From Detail Reads
date: 2026-06-29
last_updated: 2026-07-16
category: performance
module: athena-webapp
problem_type: performance_issue
component: database
symptoms:
  - "Convex production usage showed a June 27 Database I/O spike concentrated in default dashboard and POS queries"
  - "Default subscriptions mixed operator posture with full analytics, sync evidence, and full catalog metadata"
root_cause: logic_error
resolution_type: code_fix
severity: high
delivery_diff_fingerprint: e72ee0ef3ebbb3d517f0826cb45e249828eaef7bae4497ecc5b3b7ced726709f
tags:
  - convex
  - performance
  - pos
  - operations
  - catalog
  - daily-operations
  - runtime-status
  - storefront
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

## July 13, 2026 Follow-up: Contain Reads Across the Entire Caller-to-Index Path

Database I/O reached 29.4 GB of a 50 GB billing allocation while function-call
and compute usage remained low. That shape means recurring functions were
reading too much or rerunning too often; it is not evidence of proportional
business volume. Containment therefore has to cover every layer that can
amplify a read:

- The app shell consumes the one-row `catalogSummary` projection. It hides an
  unresolved-products badge when the summary is missing, dirty, or has never
  been refreshed, and it never repairs catalog state from global navigation.
- Daily Operations loads one bounded week-analytics contract. Selected-day
  command-grade detail and store pulse are separate, intent-driven reads; the
  route does not rebuild seven full daily snapshots on mount.
- POS opening consumes a small authenticated Daily Close lifecycle gate. The
  full Daily Close snapshot and mutations retain evidence and command
  authority.
- Runtime recovery verification uses
  `by_store_terminal_verification` with a 20-row budget: five newest commands
  remain prompt while a cursor on the existing terminal runtime-status row
  rotates fifteen rows through the full verification-ready backlog. Verification
  still requires completed status, fresh post-acknowledgement evidence, and an
  exact evidence match.
- Terminal heartbeat clients and the server share one material projection.
  Volatile timestamps, browser/storage diagnostics, snapshot ages, and counts
  do not trigger writes; cashier identity and operational posture still do.
  A store-and-terminal lease elects one browser-context publisher, followers
  forward newer material, and server idempotency remains authoritative because
  storage and Web Locks are best-effort load-shedding rails.
- Storefront homepage composition pushes store equality into merchandising and
  product indexes, hydrates candidates in small batches only until visible
  quotas are filled, and applies banner expiry at exact request time. Only the
  inner query is minute-bucketed; the cookie-bearing HTTP response is not.
- Register catalog metadata and full-availability refreshes are coordinated by
  store and refresh class. Consumers share in-flight or recently persisted
  success, persistence is serialized, and generations prevent an older result
  from overwriting or stranding a newer refresh. The local snapshot remains a
  continuity cache, not checkout authority.

The maintenance/backfill follow-up is deliberately excluded from this delivery:
the Dev backfill had already run, so V26-1047 is deferred and contributes no
claimed read savings.

### Observation Contract

Do not add continuous logs or an in-app telemetry surface for this work. Record
point-in-time evidence using matching 24-hour and 72-hour windows in Convex
Usage:

1. Capture Database I/O and Function Calls by deployment and function family.
2. Derive average bytes per call so frequency and working-set regressions are
   distinguishable.
3. Use `bunx convex insights --prod --details --json` only as a bounded
   diagnostic snapshot when a function needs investigation.
4. Interpret production heartbeat results only after the M Supplies terminal
   reports the target build. Production proves the single-terminal longitudinal
   rate; cross-context concurrency is proven in Dev and automated tests.

Bounded logs remain a diagnostic fallback for a named failure window, never the
measurement surface.

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

## July 16, 2026 Follow-up: Compact Counts Preserve Bounded-Read Honesty

Compact navigation counts are posture reads, not miniature detail snapshots.
The Operations sidebar now subscribes to dedicated open-work and pending-
approval summaries only while the Operations section is expanded and the
operator has financial-detail access. Each summary uses indexed, status- and
type-selective probes with a shared total budget instead of mounting the full
queue snapshot from global navigation.

The summary contract returns both `count` and `completeness`. When a probe
exhausts its budget, the UI renders `N+` rather than presenting a lower bound as
an exact count. Open work is projected through the same logical-group boundary
as the queue, including oversized-repair source identities, so multiple source
rows do not inflate the operator-facing count. Pending approvals include
bounded local-sync conflict evidence without hydrating approval details.

The same rule applies to operating-day reads. Daily Close deposit allocation now
uses `by_storeId_allocationType_direction_status_recordedAt` so allocation type,
direction, status, and the operating-day range are enforced by the index before
the limit. It probes one row beyond the budget and records incomplete source
evidence when the cap is reached instead of filtering a broad store scan after
truncation.

These optimizations do not move command authority into summaries. Queue detail,
Daily Opening carry-forward membership, Daily Close evidence, and command-side
validation remain on their existing source-owned paths. The compact contracts
only answer whether attention exists and whether that answer is exact.

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
- Treat a compact contract as incomplete until its default callers are proven
  not to mount detail companions eagerly.
- Return explicit completeness with bounded count summaries, and render a lower
  bound as `N+` rather than an exact value.
- Count logical operational groups through the same projection used by queue
  detail; never count raw work-item rows when several rows represent one task.
- Push operating-day predicates into compound indexes before applying caps, and
  probe one row beyond the budget so source incompleteness is observable.
- Include operational identity in heartbeat material even when expiry and
  observation timestamps are excluded. A cashier handoff is not diagnostic
  churn.
- When a bounded verification queue can retain unmatched rows, reserve a small
  newest slice for prompt operator work and persist a bounded rotation cursor;
  static newest/oldest edge samples can still starve middle rows forever.
- A superseded one-shot refresh must settle from the newer persisted generation;
  never leave an older consumer indefinitely in `refreshing`.
- Run `bun run pre-commit:generated-artifacts` and Graphify after changing Convex
  read boundaries.

## Related Validation

- `bun run --filter '@athena/webapp' test -- convex/pos/infrastructure/repositories/registerSessionRepository.test.ts convex/cashControls/deposits.test.ts`
- `bun run --filter '@athena/webapp' test -- convex/operations/dailyOperations.test.ts src/components/operations/DailyOperationsView.test.tsx`
- `bun run --filter '@athena/webapp' test -- convex/pos/application/queries/terminals.test.ts convex/pos/public/terminals.test.ts`
- `bun run --filter '@athena/webapp' test -- src/lib/pos/infrastructure/convex/catalogGateway.test.tsx`
- `bun run --filter '@athena/webapp' test -- src/components/app-sidebar.test.tsx`
- `bun run --filter '@athena/webapp' test -- convex/operations/dailyClose.test.ts src/components/pos/register/POSRegisterOpeningGuard.test.tsx`
- `bun run --filter '@athena/webapp' test -- convex/pos/application/terminalRecovery/terminalCommandService.test.ts convex/pos/infrastructure/repositories/terminalRecoveryRepository.test.ts convex/pos/infrastructure/repositories/terminalRepository.test.ts shared/pos/terminalRuntimeMaterial.test.ts src/lib/pos/infrastructure/local/runtimeStatusPublisher.test.ts src/lib/pos/infrastructure/local/usePosLocalSyncRuntime.test.ts`
- `bun run --filter '@athena/webapp' test -- convex/storeFront/homepageSnapshot.test.ts convex/http/domains/customerChannel/routes/homepageSnapshot.test.ts`
- `bun run --filter '@athena/webapp' audit:convex`
- `bun run --filter '@athena/webapp' lint:convex:changed`
- `bun run --filter '@athena/webapp' lint:frontend:changed`
- `bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json`
- `bun run --filter '@athena/webapp' build`
- `bun run pre-commit:generated-artifacts`
- `bun run graphify:check`
- July 2026 follow-up:
  `bun run test -- convex/operations/dailyClose.test.ts convex/operations/dailyOperations.test.ts convex/pos/application/terminals.test.ts convex/pos/infrastructure/repositories/terminalRepository.test.ts convex/inventory/sessionQueryIndexes.test.ts convex/storeFront/commerceQueryIndexes.test.ts convex/contextTracking/contextEvents.test.ts convex/pos/public/posRecoveryCodes.test.ts convex/remoteAssist/transportInternal.test.ts`
- July 16 bounded-count follow-up:
  `bun run test -- convex/operations/dailyClose.test.ts convex/operations/dailyOpening.test.ts convex/operations/operationalWorkItems.test.ts src/components/app-sidebar.test.tsx src/components/operations/DailyOpeningView.test.tsx`

## Related Issues

- Linear: V26-905, V26-906, V26-907, V26-908, V26-909, V26-910, V26-911.
- July 13 containment: V26-1041, V26-1042, V26-1043, V26-1044,
  V26-1045, V26-1046, V26-1048.

## Related Guidance

- [POS runtime-status check-in storms](athena-pos-runtime-status-check-in-storm-2026-07-02.md)
- [Homepage snapshot contract](../logic-errors/athena-homepage-snapshot-contract-2026-06-22.md)
- [Foundation SKU search and catalog summary](../logic-errors/athena-foundation-sku-search-catalog-summary-2026-06-25.md)
- [Daily Operations current-day refresh](../logic-errors/athena-daily-operations-current-day-refresh-2026-06-30.md)
- [Daily Operations aggregate read model](../logic-errors/athena-daily-operations-aggregate-read-model-2026-05-08.md)
- [Operations review and cash-closeout continuity](../architecture-patterns/athena-operations-review-and-cash-closeout-continuity-2026-07-11.md)
- [Operator context and filter boundaries](../logic-errors/athena-operator-context-and-filter-boundaries-2026-07-03.md)
- [POS terminal recovery readiness](../architecture/athena-pos-terminal-recovery-readiness-boundary-2026-06-14.md)
- [POS offline inventory snapshot](../architecture/athena-pos-offline-inventory-snapshot-2026-05-15.md)
- [POS register authority replication](../logic-errors/athena-pos-register-authority-replication-2026-07-10.md)
