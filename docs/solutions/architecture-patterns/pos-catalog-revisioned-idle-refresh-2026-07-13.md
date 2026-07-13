---
title: POS Catalog Refreshes Use Revisions, Durable Versions, and Runtime Pins
date: 2026-07-13
category: architecture-patterns
module: POS register catalog
problem_type: architecture_pattern
component: database
resolution_type: code_fix
severity: high
applies_when:
  - A large local-first snapshot must update while a route remains mounted
  - Active workflow state must keep using the exact data version it started with
  - Full reactive subscriptions would create excessive backend reads
tags: [pos, catalog, convex, local-first, indexeddb, revision, snapshot, concurrency]
delivery_diff_fingerprint: c54b140b1a1db54fd429e963e60daad6f6660a90b75447ae06fb511f6897ade3
---

# POS Catalog Refreshes Use Revisions, Durable Versions, and Runtime Pins

## Problem

The POS register reads its product catalog from a browser-local snapshot so
search remains fast and available offline. A one-shot refresh on route mount
kept backend reads bounded, but it also meant a product created remotely stayed
invisible while the register route remained open. Subscribing every terminal to
the full catalog would close the freshness gap at the cost of repeatedly
reading and transferring the entire store catalog.

## Solution

Separate change detection from snapshot transfer:

1. Maintain one store-scoped monotonic metadata revision. Advance it in the
   same mutation transaction only when register-visible membership or metadata
   changes. Do not advance it for stock, holds, or availability overlays.
2. Subscribe the register only to the constant-size revision query. When the
   observed revision is newer, imperatively fetch an atomic
   `{ revision, rows }` envelope.
3. Store catalog versions in IndexedDB. Stage the envelope first, then promote
   it monotonically while the register is operationally idle. Keep the legacy
   snapshot record as a compatibility mirror of the promoted default.
4. Capture the selected revision and rows when the register becomes busy. The
   first durable sale event materializes that version and its terminal pin in
   the same transaction, so remounts and other-tab promotions cannot change the
   catalog used by active work.
5. Coalesce revision churn through one single-flight coordinator. Busy and
   offline terminals retain only the latest target and perform no full read.
6. Give the register one catalog owner. Nested product-entry components receive
   trusted rows from the view model and cannot start an independent refresh.

The important boundary is that fetched rows are never trusted directly. UI
state changes only from a successfully persisted and selected local version.

## Why This Matters

A tiny revision subscription makes steady-state cost independent of catalog
size. Full reads happen only after effective metadata changes, not after every
inventory movement or React lifecycle event. Durable staging protects the old
catalog on storage failure, while runtime pins preserve price and search
consistency throughout an active sale even if another tab promotes a newer
default.

Catalog refresh is background maintenance. Busy, offline, retry, and
authorization-paused states remain inside the coordinator rather than becoming
app messages or cashier controls. Transient failures retry automatically, while
the last trusted catalog stays active until a newer durable version is safe to
adopt.

## Prevention

- Keep the revision's effective-change predicate aligned with the fields and
  membership rules used by the snapshot projection.
- Aggregate fanout changes and advance once per logical mutation rather than
  once per affected SKU.
- Test that availability-only writes leave the metadata revision unchanged.
- Recheck scope and operational idle before staging, before promotion, and
  after the promotion commit; never expose the fetched envelope on a failed or
  stale attempt.
- Treat legacy/unversioned data separately from numeric server revision zero.
- Retain active, staged, and durably pinned versions; prune only versions with
  no pointer or runtime reference.
- Ensure every catalog consumer on the register route receives the same trusted
  view-model rows.
- Keep refresh status internal unless a future operator decision is genuinely
  required; autonomous waiting and retry should not compete with actionable
  register messages.

## Examples

Before, route mount or an explicit refresh key controlled the full snapshot:

```ts
useConvexRegisterCatalog({
  refreshMetadataSnapshot: true,
  storeId,
});
```

After, the register observes only the revision and supplies its complete idle
boundary to the coordinator:

```ts
useConvexRegisterCatalogState({
  registerRefresh: {
    isOperationallyIdle,
    isOperationallyIdleNow: () => idleRef.current,
    terminalId,
  },
  storeId,
});
```

Mutation callers report whether the effective register snapshot changed:

```ts
await advanceRegisterCatalogRevision(ctx, {
  didChange: projectionOutcome === "changed",
  storeId,
});
```

## Related

- [Athena POS Register Catalog Uses Projection Snapshots](../performance/athena-pos-register-catalog-snapshot-and-closeout-gate-2026-06-30.md)
- [Athena POS Cart Operations Avoid Full-Catalog Reactivity](../performance/athena-pos-cart-latency-foundation-2026-05-05.md)
- Linear: V26-1049, V26-1050, V26-1051, V26-1052, V26-1053, V26-1054
