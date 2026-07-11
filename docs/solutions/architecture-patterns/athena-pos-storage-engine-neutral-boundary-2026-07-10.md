---
title: Athena POS Storage Engine-neutral Boundary
date: 2026-07-10
category: architecture-patterns
module: athena-webapp
problem_type: architecture_pattern
component: database
resolution_type: code_fix
severity: high
delivery_diff_fingerprint: c85d9852b4e5c2fa6a02a2d788f5463c32f4cd280181ec94e218987657019adb
applies_when:
  - "Adding or replacing a POS local persistence engine"
  - "Changing local-first POS commands, projections, sync, or authority persistence"
  - "Introducing asynchronous storage startup, migrations, or worker initialization"
  - "Preserving PR 642 register authority semantics across storage engines"
related_components:
  - "pos-local-first-runtime"
  - "register-lifecycle-authority"
  - "offline-sync"
  - "terminal-provisioning"
tags: [pos, local-first, storage-engine, indexeddb, application-ports, persistence, architecture]
---

# Athena POS Storage Engine-neutral Boundary

## Problem

Athena's local-first POS behavior was durable at the domain level, but operational consumers selected IndexedDB themselves through browser-global checks, constructors, and concrete store types. That let initialization be bypassed, made a future asynchronous engine difficult to select consistently, encouraged low-level key-value APIs to become the universal seam, and left hot ledger operations, version evolution, maintenance, migration, and storage health tied to the first engine.

The goal is not to define SQLite, IndexedDB, or another engine's mechanics in shared code. The shared boundary defines the POS outcomes that every production engine must preserve; each implementation retains the freedom to use its native schema, queries, transactions, concurrency, workers, and durability features.

## Solution

Route production consumers through one runtime-selected durable engine generation. Application code depends on narrow capabilities named after POS outcomes: durable event append, scoped upload pages, exact event transitions, terminal seed, catalog snapshots, mapping lookup and replacement, cashier presence, and atomic register-authority application. The stable facade waits for asynchronous engine initialization and logical migration before dispatching any operation.

Keep physical mechanics below that facade. IndexedDB uses a native version-10 layout with indexes for scoped upload candidates, exact local-event lookup, and current register mappings. A future SQLite or worker engine may use SQL tables, indexes, transactions, or message passing without emulating IndexedDB object stores or callback transactions.

Bound hot paths by domain contract. Upload candidates are store/terminal scoped, stably ordered, limited, and continued through an opaque engine-owned token. Exact-ID status changes and current-mapping replacement cannot fall back to whole-store enumeration. Full enumeration remains a maintenance/export concern, not an application query language.

Separate version ownership:

- The selected engine owns its physical layout version.
- The application contract owns the logical POS-record version.
- Portable migration snapshots own an independent envelope version.

Runtime initialization persists and validates the logical version separately from the IndexedDB layout. A legacy v9 IndexedDB database upgrades in place to the current indexed layout; an unknown future logical version fails non-destructively.

Keep health and lifecycle separate from cashier authority. Browser persistence and quota are advisory evidence. Initialization failure, failed durable commit, corruption, or quota-exceeded writes are authoritative storage failures. Terminal Health receives only allowlisted freshness, readiness, pressure, migration, maintenance, and last-commit facts.

Maintenance and migration fail closed. Missing inspection facts, protected events or authority, invalid snapshot sections, insufficient capacity, semantic mismatch, and ambiguous activation cannot authorize clear or activation. If activation outcome is unknown, both source and target remain for explicit recovery. Production alternate-engine activation and retained-source destruction are deliberately absent from this foundation.

## Why This Matters

A local-first cashier command succeeds only when its non-reconstructable facts survive reload. One selected engine prevents login, register, expense, catalog, recovery, and sync from splitting writes across different stores. Semantic ports preserve that durable boundary without reducing every engine to a lowest-common-denominator key-value adapter.

Native bounded operations let the event ledger grow without turning normal sync or recovery into full-history scans. Independent versions let layout and business records evolve for different reasons. Fail-closed lifecycle outcomes protect evidence during clear and future cutover. Redacted, fresh health evidence helps support distinguish eviction risk from actual commit failure without allowing diagnostics to grant drawer or staff authority.

No SQLite schema, VFS, worker topology, locking scheme, transaction strategy, snapshot encoding, or digest algorithm is prescribed here.

## Prevention

- Reject implicit production memory fallback and prove all consumers observe one selected ready generation.
- Keep direct IndexedDB globals, layout, indexes, cursors, and deletion inside its implementation; retain a structural boundary test.
- Maintain an independent semantic conformance engine that implements the complete production port, including compatibility, events, scoped paging, readiness, catalog, staff/cashier authority, mappings, integrity, and PR 642 authority outcomes without reusing the key-value adapter.
- Test failed commits as all-or-neither for sequence, mapping, authority, activity, and projection state.
- Poison whole-store primitives in bounded upload, exact-ID transition, and mapping replacement tests.
- Test physical layout, logical record, and portable envelope compatibility independently.
- Treat incomplete or malformed maintenance inspection as failure, never as an empty store.
- Validate every declared snapshot section before import and retain both engines when activation is uncertain.
- Keep retention classification separate from deletion; unsettled activity, review, workflow, receipt, and authority dependencies stay protected.
- Allowlist and age storage diagnostics. Stale evidence cannot claim readiness.
- Treat a failed durable write as central engine unavailability until a later durable commit succeeds, and classify ledger pressure from allowlisted counts and oldest-record age rather than payloads.
- Make the ledger summary itself a bounded semantic outcome so each engine can use native count/oldest queries without materializing history.
- Surface blocked upgrade and maintenance acquisition as retryable health states; never leave initialization pending indefinitely.
- Request persistent browser storage at the explicit provisioning gesture, while treating denial as advisory rather than blocking POS setup.

## Examples

Consumers request a POS outcome rather than storage mechanics:

```ts
const page = await store.readUploadCandidatePage({
  storeId,
  terminalId,
  limit: 100,
  continuation,
});
```

The continuation can be passed back to the same selected engine but cannot be inspected or constructed by the application. IndexedDB may satisfy the call with compound indexes; SQLite may use an ordered query. Both must preserve scope, stable order, limits, and no-gap/no-duplicate continuation behavior.

Register authority remains an atomic domain outcome:

```ts
await authorityPort.applyRegisterLifecycleAuthority({
  expectedMapping,
  observation,
  storeId,
  terminalId,
});
```

The engine must compare the exact mapping, advance mapping and lifecycle revisions, preserve the independent local-review channel, and publish all changes only after one durable commit.

## Related

- [Athena POS Runtime Decoupling Boundaries](../architecture/athena-pos-runtime-decoupling-boundaries-2026-06-15.md)
- [Athena POS Local-First Sync Uses Event Logs](../architecture/athena-pos-local-first-sync-2026-05-13.md)
- [Athena POS Local Sync Contract Is Single-Sourced](../architecture/athena-pos-local-sync-contract-2026-07-09.md)
- [Athena POS Register Session Activity Ledger](./athena-pos-register-session-activity-ledger-2026-07-05.md)
- [Athena POS Register Authority Replication](../logic-errors/athena-pos-register-authority-replication-2026-07-10.md)
