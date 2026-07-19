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
| Client errors/warnings (logger tee, `mapThrownError` detail, unhandled window errors) | Durable localStorage ring buffer → 30s/reconnect drain | `posClientEvent` table | `pos/public/telemetry.listClientEvents` (level-filterable) |
| Terminal storage health (pressure, ledger pressure, persistence, migration, maintenance, engine readiness, quota/usage) | Runtime-status heartbeat (leader-elected tab, ~110s + on material change) | `posTerminalRuntimeStatus.localStore` | Terminal health roster + detail views |
| Sync stall signals (`backoffUntil`, `heldEventCount`, `heldWithoutProgress`) | Same heartbeat | `posTerminalRuntimeStatus.sync` | "Sync stuck" badge, "Sync retry" / "Oldest unsynced" rows |
| Silent-catch counters (storage probe failures, leader-lease write failures) | Same heartbeat | `posTerminalRuntimeStatus.runtimeCounters` | Raw on the runtime row (no dedicated UI yet) |
| Terminal health alerts (edge-triggered) | Stamped during the heartbeat write | `posTerminalRuntimeStatus.healthAlerts` + one `operationalEvent` per edge | Admin email (MailerSend) + operational timeline |

## Client error pipeline (phase 1)

- Buffer: `src/lib/pos/infrastructure/telemetry/telemetryBuffer.ts` — 200-event
  localStorage ring, in-memory fallback, never throws. Survives reloads and
  offline periods.
- Capture points: `loggerGateway` tees every POS `warn`/`error`;
  `mapThrownError` reports the raw thrown error (with use-case operation name)
  through `application/errorTelemetry.ts` while users still see the generic
  message; `usePosClientTelemetryDrain` captures `window.onerror` and
  unhandled promise rejections while a POS surface is mounted.
- Drain: every 30s and on reconnect, batches of ≤50 to
  `pos/public/telemetry.recordClientEvents`, 2-minute backoff on failure.
- Read budget: a fresh batch costs **one** dedupe index read (FIFO-prefix
  replay detection on the first event); only a detected replay pays per-event
  reads. An empty buffer costs zero requests.

## Terminal heartbeat (phase 2)

The pre-existing runtime-status pipeline, reconnected and extended: the server
previously stripped every storage-health field the client sent. Storage
degradation and held-progress changes are "material," so they publish promptly
instead of waiting for the freshness window. Alert-relevant fields ride the
row: `healthAlerts` timestamps are carried forward by the repository merge so
heartbeats cannot erase them.

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
| Alert cooldown (6h), drain cadence (30s), buffer cap (200), batch cap (50) | Code constants in the files above | Tuning knobs; change in code, not env |

## Operational notes

- Console hygiene: POS components no longer call `console.*` directly; stray
  debug logs were removed and error logs routed through `src/lib/logger.ts`.
- `posClientEvent` has no retention job yet. If volume grows, add retention to
  an existing daily cleanup cron rather than a new cron.
- Phase-next candidates: fleet-level surfacing of `runtimeCounters`, a
  PostHog consumer over the Convex tables, and per-store alert recipients.
