# POS Observability v1

Delivered 2026-07-19 on `codex/pos-telemetry-phase1`. This documents the POS
observability contract: what signals exist, where they flow, what alerts fire,
and the database-read budget each piece was designed against.

The POS app is local-first, so every telemetry rail here is offline-tolerant:
signals buffer on the terminal and drain when connectivity allows. Nothing in
this system polls the database on a schedule; every server-side signal rides a
write that was already happening. See
[convex-io-containment-observation.md](./convex-io-containment-observation.md)
for the IO constraints this design honors.

## Signal inventory

| Signal | Transport | Storage | Surfaced in |
| --- | --- | --- | --- |
| Unexpected POS client exceptions and reviewed continuity warnings | Durable localStorage ring buffer → scoped 30s/reconnect drain | `posClientEvent` table (30-day retention) | Terminal Health client diagnostics (error-first, terminal- and level-filterable) |
| Terminal storage health (pressure, ledger pressure, persistence, migration, maintenance, engine readiness, quota/usage) | Runtime-status heartbeat (leader-elected tab, ~110s + on material change) | `posTerminalRuntimeStatus.localStore` | Terminal health roster + detail views |
| Sync stall signals (`backoffUntil`, `heldEventCount`, `heldWithoutProgress`) | Same heartbeat | `posTerminalRuntimeStatus.sync` | "Sync stuck" badge, "Sync retry" / "Oldest unsynced" rows |
| Silent-catch counters (storage probe failures, leader-lease write failures) | Same heartbeat | `posTerminalRuntimeStatus.runtimeCounters` | Raw on the runtime row (no dedicated UI yet) |
| Terminal health alerts (edge-triggered) | Stamped during the heartbeat write | `posTerminalRuntimeStatus.healthAlerts` + one `operationalEvent` per edge | Admin email (MailerSend) + operational timeline |

## Client diagnostic pipeline (phase 1)

- Ownership: one pathful POS parent owns the telemetry host and React error
  boundary for every production `/pos/**` route. An idempotent bootstrap
  listener covers POS-path `window.error` and unhandled promise rejections
  before React effects mount. Authored `?fixture=` states remain side-effect
  free; non-POS paths and expected coded outcomes are excluded.
- Capture points: unexpected application, route-render, browser-runtime,
  native-storage, and the deliberately reviewed handled continuity failures
  report through the existing POS telemetry gateway. Validation,
  authorization, sign-in/provisioning, conflict, offline, and ordinary command
  outcomes stay on their typed UI/readiness paths and create no diagnostic
  event. Operator copy remains calm and generic.
- Buffer: `src/lib/pos/infrastructure/telemetry/telemetryBuffer.ts` — one
  versioned 200-event localStorage ring with in-memory fallback and a never-throw
  contract. V2 rows carry occurrence-time scope. Valid pre-v2 local rows remain
  in sanitized, non-deliverable quarantine shards; they are never assigned to
  the current store or migrated into the v2 event namespace. Quarantined and v2
  rows retain stable mixed order and share the same cap and retention boundary.
- Privacy envelope: v2 input has no arbitrary message or stack field. It accepts
  only closed classifications and operations, allowlisted standard/DOM error
  names, closed POS route IDs, recognized build-source coordinates, strict
  correlation identifiers, and source-specific bounded primitive metadata.
  Display copy is derived from the classification. Dynamic paths, query strings,
  URL credentials/fragments, thrown text, business payloads, staff proof, and
  local-ledger records are structurally excluded before local persistence and
  revalidated at ingest.
- Occurrence scope: each event retains its query-free organization/store route
  pair, authorized store when resolved, client-reported terminal/fingerprint,
  local register session when known, online state, build, route ID, flow, and
  operation. A pending event can be released only by the current owner of that
  exact route pair. Its first resolved store/terminal context is stored in a
  separate one-way occurrence binding. The immutable shard also carries the
  capture generation that alone may establish that binding; a failed binding
  write therefore remains unattributed instead of being claimed by a later
  terminal generation. Seed writes publish a durable same-origin transition as
  a revisioned `changing` lease before IndexedDB work and `changed` only after
  commit or rollback. Reprovision and identity-clearing writes hold one named
  Web Lock across lease publication, the IndexedDB transaction, and exact
  generation/revision/owner settlement. If that primitive is unavailable or
  rejects, the terminal business write still commits, but the client publishes
  only an `uncoordinated` telemetry fence: events retain their closed route
  context without store/terminal attribution and cannot drain as coordinated
  evidence. A later successful lock acquisition reads the durable seed and
  mints a fresh coordinated generation. The same fallback applies if the lock
  is acquired but lease publication fails: the callback runs once under that
  lock and callback failures still propagate. Lockless markers are `in_flight`
  until the callback settles, then carry a completion timestamp. If locking
  remains unavailable, active in-flight or not-yet-published settled markers
  may reassert. Once a settled marker is verified durable, it relinquishes
  local priority: forced reads adopt a newer durable uncoordinated or changed
  revision without rewriting the original settlement timestamp. Multiple tabs
  therefore converge on one marker and one quiescence deadline. After
  convergence, only a settled marker quiet for 30 seconds may be
  stabilized from an authoritative seed read into a fresh best-effort
  generation; an in-flight marker is never promoted. A fresh lease fences capture and drain.
  After 30 seconds, a host
  acquires the same lock, reads the authoritative seed, and settles that exact
  generation before reopening the drain. Transition reads retry after storage
  failures. Durable state always supersedes unpublished private revisions, so
  temporary denial cannot promote speculative generations or make a document
  permanently blind to later reprovisioning.
  Another tab therefore synchronously captures pending scope and cannot adopt
  the old seed or drain during the transaction. Navigation, reload, reconnect,
  or later terminal reprovisioning cannot relabel it. Pre-host capture carries a
  stable per-document bootstrap
  generation that only that document's host adopts; another document cannot
  compete for the claim.
- Drain: every 30s and on reconnect, one wakeup attempts at most the oldest
  eligible recorded scope and sends at most 50 events to
  `pos/public/telemetry.recordClientEvents`. Backoff is per scope. The client
  removes only submitted IDs after a full accepted-or-duplicate acknowledgement;
  rejected, partial, thrown, or acknowledgement-loss outcomes retain the full
  submitted prefix for replay.
- Read budget: a fresh batch costs **one** dedupe index read (FIFO-prefix
  replay detection on the first event); only a detected replay pays per-event
  reads. An empty buffer costs zero requests.

The server preserves a bounded compatibility branch for older clients. It
authenticates and deduplicates the batch but discards all legacy free-text,
stack, metadata, and dynamic-path fields before persisting the derived
`legacy_client_event` classification. Reads suppress raw historical diagnostic
fields, so legacy rows remain schema-compatible without exposing them while
they age out.

## Terminal heartbeat (phase 2)

The pre-existing runtime-status pipeline, reconnected and extended: the server
previously stripped every storage-health field the client sent. Storage
degradation and held-progress changes are "material," so they publish promptly
instead of waiting for the freshness window. Alert-relevant fields ride the
row: `healthAlerts` timestamps are carried forward by the repository merge so
heartbeats cannot erase them.

The same heartbeat carries aggregate client-diagnostic rail facts without
recursively reporting telemetry failures as client events:

- `telemetry.bufferDepth`
- `telemetry.pendingScopeCount`
- `telemetry.legacyQuarantineCount`
- `telemetry.droppedCount`
- `telemetry.storageFallbackCount`
- `telemetry.uploadFailureCount`
- `telemetry.lastAcceptedAt`
- `telemetry.lastFailureAt`

Missing keys mean **Not reported**, not zero. Pending or degraded telemetry is
support evidence only; it never changes terminal authority, drawer authority,
cashier commands, local append, sync, checkout, closeout, or recovery decisions.

## Terminal Health support workflow

Authorized `full_admin` and `pos_only` users inspect client diagnostics through
the existing Terminal Health hierarchy. The store view starts with Errors;
Warnings are an explicit secondary filter and cannot displace the initial error
window. Terminal detail applies an indexed store + client-reported terminal +
level read and places Client diagnostics after Attention/Conflict evidence.

Rows and detail expose only structurally safe support context: derived
classification copy, severity, closed route ID, build, flow/operation,
allowlisted error name, safe source coordinates, occurred/received times, and
clearly labelled client-reported terminal/fingerprint/session correlation.
Historical rows render as legacy diagnostics with their original raw fields
suppressed. Loading, query failure, empty, and Not reported remain distinct
states. This surface is diagnostic evidence; it does not prove terminal
authorship or create a new permission, alert, grouping, or recovery workflow.

## Retention

Client diagnostics are retained for 30 days. The local buffer removes rows
strictly older than the boundary during load, enqueue, and drain while keeping a
row exactly 30 days old. The server uses one received-time index and the existing
Convex cron rail for a capped, self-continuing cleanup with one fixed `now`
across the chain. A failed or interrupted continuation leaves remaining rows for
the next scheduled pass; cleanup never gates POS work or deletes business data.

## Alerts (phase 3)

Conditions, classified in
`convex/pos/application/terminalRuntime/terminalHealthAlerts.ts`:

- `storage_critical` — store unavailable, engine unavailable, critical
  pressure or ledger pressure, failed migration, or blocked maintenance.
- `sync_stuck` — the drain scheduler reported held events making no progress.

Semantics: **edge-triggered** (alert on entry into a condition only) with a
**6-hour per-condition cooldown** against flapping. Detection runs on data the
heartbeat upsert already read — zero additional reads per heartbeat. An alert
edge (rare by construction) pays exactly: one patch (stamp `healthAlerts`),
one `operationalEvent` insert (raw `buildOperationalEvent` — deliberately NOT
`recordOperationalEventWithCtx`, whose full-subject-history dedupe read is the
amplification pattern we avoid), and one scheduled MailerSend action to
`ADMIN_EMAILS` (`convex/operations/posTerminalHealthAlertEmail.ts`).

Deliberately absent, and why:

- No `operationalEvent` per held/conflicted sync event — those outcomes are
  already persisted as `posRegisterSessionActivity` rows; duplicating them is
  redundant write volume.
- No server-side invariant-throw capture — a Convex throw rolls back the
  transaction (nothing can be written), and the thrown error reaches the
  client where phase-1 telemetry records it.
- No offline-terminal cron — absence detection requires recurring scans,
  which the IO-containment rules forbid. Staleness is visible on demand in
  the terminal health views ("no check-in for N minutes").

## External monitoring contract (phase 4)

- `/health` (Convex Hono boundary) **stays shallow by contract** — see
  [production-observability-v1.md](./production-observability-v1.md). It does
  no database reads; Cloudflare polls it every minute. Do not deepen it.
- POS hub readiness selector for a Checkly browser journey:
  `data-testid="athena-pos-hub-ready"` in
  `packages/athena-webapp/src/components/pos/PointOfSaleView.tsx`. Suggested
  check: log in (existing `athena-login-ready` journey), navigate to
  `/<org>/store/<store>/pos`, assert the selector renders. Configure in
  Checkly alongside the existing journeys; the repo owns only the selector.

## Configuration

| Variable / constant | Where | Used for |
| --- | --- | --- |
| `MAILERSEND_API_KEY` | Convex deployment env | All alert/report email sends |
| `ATHENA_BASE_URL` / `ATHENA_APP_URL` / `STAGE` | Convex deployment env | Links in alert emails (`resolveAppUrl`) |
| `ADMIN_EMAILS` | `convex/constants/email.ts` | Alert recipients (hard-coded roster) |
| Alert cooldown (6h), drain cadence (30s), buffer cap (200), batch cap (50), client diagnostic retention (30 days) | Code constants in the files above | Tuning knobs; change in code, not env |

## Operational notes

- Console hygiene: POS components no longer call `console.*` directly; stray
  debug logs were removed and error logs routed through `src/lib/logger.ts`.
- Client diagnostics use the existing buffer, ingest, heartbeat, Terminal
  Health, and cron rails. Do not add a second telemetry service, general logger,
  scheduler, dashboard, alert, grouping, or sampling system without observed
  operational evidence that the current rails are insufficient.
- Private source-map symbolication, fleet-level aggregation/alerting/grouping,
  and broader non-POS frontend exception coverage remain follow-up candidates,
  not part of this contract.
