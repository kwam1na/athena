---
title: POS Observability via Write-Riding Telemetry and Edge-Triggered Alerts
date: 2026-07-19
last_updated: 2026-08-27
category: architecture-patterns
module: pos
problem_type: architecture_pattern
component: tooling
resolution_type: code_fix
severity: high
applies_when:
  - "Adding telemetry, health signals, or alerting to a local-first client"
  - "Frontend exceptions need remote diagnosis without persisting free-form error text"
  - "Diagnostic attribution must survive offline reloads, navigation, or terminal changes"
  - "An existing bounded telemetry rail should be extended instead of duplicated"
related_components:
  - "Convex POS telemetry"
  - "Terminal Health"
  - "POS local storage"
tags:
  [
    pos,
    observability,
    telemetry,
    convex,
    local-first,
    occurrence-scoping,
    privacy,
    retention,
  ]
delivery_diff_fingerprint: ca49f1ddc505ff28777eb56623a3bafdee210f6980456051d2d1aa185a47450b
---

# POS Observability via Write-Riding Telemetry and Edge-Triggered Alerts

## Problem

Athena's local-first POS already had local error handling, a durable diagnostic
buffer, Convex ingest, runtime heartbeats, and Terminal Health. The gaps were at
the seams: some POS routes had no telemetry owner, handled infrastructure
failures stopped at the console, reconnect-time state could misattribute older
events, the envelope still accepted dynamic diagnostic text, and neither local
nor server rows had an enforced 30-day lifecycle.

The constraint was to close those gaps without adding another telemetry system,
making telemetry a prerequisite for checkout, promoting expected operator
outcomes into exceptions, or exposing business and credential data.

## Solution

Treat the existing rail as one end-to-end contract.

### Own capture structurally

`src/routes/_authed/$orgUrlSlug/store/$storeUrlSlug/pos.tsx` is the single
parent for every `/pos/**` route. It owns `PosClientTelemetryHost`, the child
outlet, and the POS error boundary. Bootstrap listeners installed from
`src/main.tsx` cover the smaller pre-effect window for `window.error` and
unhandled rejections. Authored fixture mode stays side-effect free.

This keeps route coverage additive: new child routes inherit the owner instead
of remembering to mount another host. Boundary and global capture share one
dedupe path so the same route-render failure is not reported twice.

### Stamp occurrence-time scope

`telemetryContext.ts` records the query-free org/store route pair and a closed
POS route ID when an event is enqueued. An owner-tokened registry can resolve
that exact pair to an authorized store and client-reported terminal/fingerprint;
a stale owner cannot clear or claim a newer route context.

The route host registers the authorized store and locally available fingerprint
before optional terminal-seed I/O, but holds the drain until the first seed-read
attempt settles. A successful read completes terminal correlation before
upload; a definitive read failure deliberately releases store/fingerprint
evidence. Later identity refreshes run on a bounded poll, window focus, and the
specific fingerprint storage signal, coalescing while a read is in flight. They
use an explicitly non-reporting seed read and expose persistent storage failure
through runtime counters, so a telemetry dependency cannot recursively create
more diagnostic events.

Terminal-seed writes publish synchronous `changing` and `changed` phases. The
host removes the previous terminal/fingerprint context and closes the drain gate
before reprovision I/O starts, then reopens it only after the newest identity
read settles. Exceptions raised immediately after same-tab reprovisioning are
therefore pending for the new terminal rather than stamped with the previous
one.

A pending event may fill only correlations that were missing at occurrence time
from that same registered route/store context; it is never reassigned to a
different store or allowed to overwrite recorded correlation.

The drain never relabels an event from current UI state. It selects one oldest
eligible recorded scope (`store + reported terminal or none + fingerprint or
none`) per wakeup, submits at most 50 events, and removes only the submitted IDs
after `accepted + duplicates` acknowledges the entire batch. Partial
acknowledgements retain the prefix. Rejected scopes receive independent backoff
so one terminal cannot block unrelated evidence. Backoff deadlines persist per
scope across host remounts and tabs, preventing navigation from erasing upload
pressure.

Buffer writes use one immutable local-storage key per client event. Appends from
different tabs therefore touch independent keys instead of competing to replace
one shared array, and correctness does not depend on a non-atomic browser lock.
Per-event tombstones make acknowledgement/removal safe against a concurrent
reader rewriting stale occurrence context, while shard deletion is attempted
independently if allocating a tombstone fails at quota. Merged rows sort by
`occurredAt` and then `clientEventId` before FIFO selection or ring pressure.
Pending correlation is stored in a separate one-way occurrence binding; the
immutable event shard is never rewritten. Each shard also records the active
capture generation, and only that generation may establish the first binding.
If binding persistence cannot be verified, the row remains unattributed and a
later terminal generation cannot claim it. Reads merge the first durable binding
before attempting any current-context resolution, so reload or reprovisioning
cannot relabel the event. Acknowledgement, expiry, and eviction delete the shard
and binding together, while tombstones take precedence over both.
Removal fences are capped at 400 after their event, occurrence binding, and
quarantine artifacts are proven absent. Every valid fence still suppresses its
row during the pruning read, and a failed artifact deletion retains the fence
even if that temporarily exceeds the nominal cap. Future-dated fence timestamps
are normalized behind a new current removal, so correcting a terminal clock
cannot let old fences monopolize the bounded set.

Bootstrap capture can precede the route host, so each document creates a stable
bootstrap generation before mounting. Its pre-host rows carry that token and
only that document's host adopts it; another matching document cannot compete
for the claim. Cross-tab reprovisioning is fenced as well as same-tab writes:
the seed writer publishes a durable same-origin terminal identity transition as
an owner-tagged, revisioned `changing` lease before touching IndexedDB, then
`changed` only after the transaction commits or rolls back. Capture and pending
resolution compare both generation and phase synchronously, so a stale host
produces pending, non-drainable rows and cannot read the old seed under the new
generation while a write is paused. Seed reprovision and clearing hold a named
Web Lock from exact lease publication through the IndexedDB transaction and
conditional generation/revision/owner settlement. If cross-document locking is
unavailable or lock acquisition rejects, the business mutation still commits
without inventing localStorage exclusivity. Instead, an `uncoordinated` shared
marker fences telemetry attribution and draining; occurrence rows retain their
closed route pair but no store, terminal, or fingerprint evidence. A later real
lock acquisition reads the authoritative seed and creates a fresh durable
generation. If the lock is acquired but exact lease publication fails, the
business callback executes once inside that lock under the same uncoordinated
fence; callback failures propagate and are never replayed. The fence is written
as `in_flight` before the callback and rewritten with a settlement timestamp in
`finally`. With locking continuously unavailable, the host may stabilize only
that exact settled marker after 30 seconds of quiescence and an authoritative
seed read. Only active in-flight or unpublished settled local state may
reassert. Exact durable verification ends that authority: alternating tab
refreshes adopt the newest durable marker without changing its original
settlement timestamp, then stale tabs adopt the eventual stabilized `changed`
revision. Pre-settlement markers never promote, and events from the old
generation remain quarantined after best-effort stabilization. Memory-only
adapters use an in-process queue. A fresh lease always
fences. Once its 30-second bound expires,
a host takes the same lock, reads the authoritative seed, publishes and verifies
`changed` for that exact generation, and resumes; this recovers both a writer
crash and a denied post-commit marker without racing a live writer or guessing
terminal identity. An old writer cannot settle over a recovered newer revision.
The host adopts the generation as route/store-only even after an initial seed
failure, then enriches it when a later `changed` read succeeds. Same-document
transition state fences synchronously while storage is unavailable, and the
event detail carries that private generation. It is never promoted after
storage recovers: any durable transition wins, private-generation rows remain
unclaimable, and the next locked mutation rebases from the durable revision.
Focus, storage, polling, and ordinary capture retry durable reads; published
records compare monotonic revision/timestamps with a deterministic tie-break
(`changed` wins over `changing` for the same generation) and adopt later
cross-document reprovisioning.

Fingerprint creation uses the same owner-specific transition contract. The
settings surface starts a lease before removing or replacing the browser
fingerprint and settles only that exact lease in `finally`; if exact lease
publication fails it uses the shared uncoordinated fence. This closes the
same-document storage-event gap and prevents one settings tab from settling a
newer tab's in-flight fingerprint transition.

The previous array key is a non-promotable quarantine for pre-v2, unscoped rows.
An upgraded client decodes only valid rows, strips all dynamic fields, and
writes each row into an immutable quarantine namespace distinct from deliverable
v2 event shards. Current clients do not perform ring mutations through a shared
array snapshot. Every read recomputes deterministic mixed ordering and 200-row
pressure, so even a stale tab restoring an evicted quarantine shard cannot
displace a newer row; the restored oldest row is evicted again. Quarantined rows
share gauges and the exact 30-day retention boundary with v2 rows. If safe
quarantine persistence cannot be verified, the unsafe raw array is physically
deleted. Removal retries its tombstone after deleting the shard (when quota has
been freed), rechecks deletion, and quarantine promotion checks the fence both
before and after writing. A stale promotion therefore remains suppressed even
after newer rows drain below capacity. Expired v2 and quarantine shards are
physically deleted during the next buffer lifecycle, not merely hidden from
reads.

### Make privacy structural

`shared/posDiagnosticRedaction.ts` defines closed classifications, operations,
route IDs, standard/DOM error names, source assets, metadata keys, and display
copy. New v2 events cannot carry a client message, dynamic route path, thrown
message or stack header, arbitrary error name, business payload, receipt text,
staff proof, token, credential, query, or fragment.

Legacy behavior is explicit rather than guessed:

- Unscoped local v1 rows remain in sanitized bounded quarantine and never upload.
- Old wire clients still receive auth and dedupe, but unsafe legacy fields are
  discarded and persisted as `legacy_client_event`; legacy projection also
  suppresses raw build and correlation strings that never passed the v2
  envelope.
- Existing classification-less server rows project derived copy while raw
  historical message, error, stack, and metadata fields stay suppressed.

Producer-side privacy is the first boundary; server validation and redaction are
defense in depth. Do not return to a free-form-text sink merely because a
redactor exists. The server rejects non-finite occurrence times and malformed
v2 terminal fingerprints rather than persisting them for later cleanup.

### Capture typed unexpected seams only

`posLocalStore.ts` classifies native IndexedDB failures at the storage-engine
boundary and reports only finite context such as engine, access mode, and error
code. `reportPosHandledException` reconnects named handled infrastructure seams,
while `isExpectedPosTelemetryOutcome` keeps validation, authorization, conflict,
offline, provisioning, and ordinary command-result outcomes local. The general
logger remains a console logger, not a remote exception gateway.

Telemetry remains best effort and never changes cashier or manager authority.
Client-reported terminal and fingerprint fields are correlation evidence, not
proof of authorship.

### Reuse Terminal Health and the heartbeat rail

The existing authorized query supports error-first store and terminal views
through indexed level/terminal reads. Terminal Health opens the same sheet from
the store summary and from a terminal-scoped Client diagnostics section. The
sheet derives restrained copy from classifications, exposes Warnings as a
secondary filter, preserves an open sheet while filters change, and renders
only finite context. A localized query error boundary makes dependency failures
visible as unavailable diagnostics without taking down Terminal Health. The
live terminal-detail container supplies already-authorized typed store and
terminal IDs rather than relying on fields present only in fixtures.

Heartbeat counters distinguish healthy empty evidence, degraded storage/upload,
pending scope, legacy quarantine, drops, and not-reported state. These facts are
diagnostic; a single exception does not independently change terminal health.
The rail writes an explicit initialization counter and publishes counter
revisions to React, so a missing rail is not mistaken for a healthy zero-value
snapshot and later failures update the view.

Expected authentication and membership denials still fail closed. Unexpected
authentication dependency failures propagate to the localized query boundary
instead of being converted into an authoritative empty result.

### Bound retention on both sides

Local buffer access drops rows strictly older than 30 days and retains rows
exactly at the boundary. `clientEventRetention.ts` queries the server
`by_receivedAt` index, deletes a bounded batch, and self-continues with one fixed
timestamp. A daily cron starts the cleanup; interruption is safely retried by the
next run.

### Preserve the original write-riding rules

Runtime-status health signals still ride the existing write that already reads
the previous row. Healthy-to-degraded transitions use per-condition cooldown
timestamps on that row instead of a polling or alert-state subsystem. Hot paths
use their existing bounded write context rather than a history-collecting helper
that would amplify reads.

## Why This Matters

Local-first diagnostics are trustworthy only when they describe where and when
the failure occurred. Applying the current store or terminal during reconnect
turns valid evidence into cross-store or cross-terminal misinformation.

A mechanically finite envelope makes privacy enforceable rather than
aspirational. Reusing the existing buffer, ingest, heartbeat, and support UI
preserves offline operation, authorization, replay dedupe, bounded cadence, and
operator familiarity without adding a vendor or parallel operational system.

Typed capture also protects signal quality: remote exceptions remain rare,
unexpected failures rather than a copy of every toast or failed result.

## Prevention

- Keep all `/pos/**` modules beneath the parent route and update the route
  inventory sensor when a child is added.
- Never derive attribution at drain time. Resolve pending events only from the
  exact occurrence-time org/store pair.
- Extend classifications, operations, metadata, and source identifiers through
  the shared finite contract; never add free-form v2 client text.
- Preserve one-scope-per-wakeup, per-scope backoff, full-ack-before-remove, and
  server ID dedupe. Persist backoff per scope so remounting cannot bypass it.
- Treat the local queue as cross-tab shared state: append immutable per-event
  shards rather than read/modify/write a shared array or simulating a lock with
  local storage. Sort merged evidence by occurrence time and client event ID
  before FIFO/ring decisions.
- Hold reload drain until the first terminal-identity read settles. Telemetry-only
  identity refreshes must use a non-reporting storage path and counter-only
  degradation.
- Fence the registered occurrence context synchronously around every terminal
  seed write; polling is refresh backup, not reprovision correctness.
- Verify legacy migration before removing its source, sanitize the fallback
  array if migration cannot complete, and drop unsafe source evidence when no
  safe write is possible. Assert physical expiry/removal in storage tests.
- Report only typed unexpected seams and pair each with a representative
  expected-outcome zero-event assertion.
- Keep exception evidence, aggregate rail health, and cashier/manager authority
  as separate concepts.
- Test retention at the exact cutoff and one millisecond older on both rails.
- Validate component fixtures against real query projections. A fixture can
  contain fields production deliberately omits; the live Terminal Health pass
  caught this when `detail.terminal.storeId` existed only in the test fixture.
- Treat missing heartbeat keys as Not reported, never inferred zero.
- Keep query errors inside a localized diagnostic boundary and keep sheet-open
  state outside keyed filter/query remounts.
- A Convex throw rolls back its transaction; client capture remains the
  observation channel for invariant throws that reach the browser.

## Examples

Occurrence-time attribution happens before buffering:

```ts
enqueuePosClientEvent({
  classification: "local_storage_transaction_failed",
  flow: "register",
  operation: "openDrawer",
  error,
  metadata: { accessMode: "readwrite", storageEngine: "indexeddb" },
});
```

Removal requires a complete acknowledgement:

```ts
const acknowledged =
  result.kind === "ok" &&
  result.data.accepted + result.data.duplicates === batch.events.length;

if (acknowledged) {
  removePosClientEvents(batch.events.map((event) => event.clientEventId));
}
```

The terminal detail boundary receives the already-authorized active store ID
explicitly. Do not assume that a nested terminal projection exposes its store
field merely because a component fixture does.

## Related

- `docs/operations/pos-observability-v1.md`
- `docs/plans/2026-08-27-001-fix-pos-frontend-telemetry-gaps-plan.md`
- `docs/solutions/architecture-patterns/athena-pos-storage-engine-neutral-boundary-2026-07-10.md`
- `docs/solutions/design-patterns/athena-pos-browser-lifecycle-diagnostics-2026-08-08.md`
- `docs/solutions/design-patterns/athena-pos-storage-health-actionability-2026-08-13.md`
- `docs/solutions/architecture/athena-pos-terminal-health-visibility-2026-05-20.md`
- [Linear V26-1403](https://linear.app/v26-labs/issue/V26-1403/epic-pos-frontend-exception-visibility)
