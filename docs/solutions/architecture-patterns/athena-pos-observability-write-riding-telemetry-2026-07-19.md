---
title: POS Observability via Write-Riding Telemetry and Edge-Triggered Alerts
date: 2026-07-19
category: architecture-patterns
module: pos
problem_type: observability_gap
component: convex-backend, pos-client
resolution_type: feature_delivery
severity: high
applies_when:
  - Adding telemetry, health signals, or alerting to a local-first client
  - Any Convex feature that must not increase database read volume
  - Detecting state transitions (healthy→degraded) without an alert-state table
  - Deduplicating batched client uploads without per-item index reads
tags: [pos, observability, telemetry, alerts, convex, read-amplification, local-first]
delivery_diff_fingerprint: 4adcfd354d3b18dbf3e695cc846fe1ef1d53e2b35d5127e7a931ab71b12ea11f
---

# POS Observability via Write-Riding Telemetry and Edge-Triggered Alerts

## Problem

The POS app had strong local observability (toasts, typed results, sync-status
UI) and zero remote observability: client errors died at the terminal console,
`mapThrownError` flattened backend detail into one generic message, storage
degradation was silently swallowed by design, and no alert reached anyone
unless store staff called. Meanwhile the Convex deployment was under an active
database-IO containment effort, so the obvious fixes — error-tracking SDKs
that fire per event, polling crons, read-checked dedupe — were off the table.

## Solution

Three patterns, all committed on `codex/pos-telemetry-phase1` and documented
operationally in `docs/operations/pos-observability-v1.md`:

**1. Offline-durable client telemetry through a prefix-replay dedupe.** Client
errors buffer in a localStorage ring (never throws, survives reloads) and
drain in FIFO-prefix batches. Because the client only removes events after an
acked commit, a replayed batch always starts with the same first event — so
the server dedupes an entire batch with ONE index read on the first event's
client-minted id, falling back to per-event reads only when that read detects
a replay. Convex OCC serializes concurrent tab drains into the same guarantee.

**2. Reconnect before you build.** The terminal heartbeat pipeline already
carried storage-health telemetry end-to-end — client built it, schema stored
it, UI rendered it — but `stripRuntimeStatusInput` dropped every field at the
server boundary, leaving dead UI branches. Most of "phase 2" was deleting the
strip, not adding a system. Audit the seam before designing a new pipeline.

**3. Edge-triggered alerts riding an existing write.** The runtime-status
upsert already reads the previous row; returning it from the repository makes
healthy→degraded transition detection free. Per-condition alert timestamps
live on the runtime row itself (`healthAlerts`, carried forward by the merge)
instead of an alert-state table, and a 6h cooldown kills flapping. An alert
edge pays one patch + one raw `operationalEvent` insert + one scheduled email
action. Crucially, use `buildOperationalEvent` + raw insert on hot-adjacent
paths — `recordOperationalEventWithCtx` collects the full subject history per
write as its dedupe, which is read amplification; edge-triggering already
provides the dedupe.

## Prevention

- A Convex `throw` rolls back the transaction, so server-side capture of
  invariant violations is impossible in-band — but the error reaches the
  client, so client telemetry IS the invariant-throw channel.
- Absence detection (offline terminals) inherently requires polling; when
  reads are constrained, surface staleness on demand in an operator view
  instead of alerting on it.
- Don't duplicate persisted outcomes into an event log for observability's
  sake: held/conflicted sync events already live in
  `posRegisterSessionActivity` and are queryable there.
- Cooldown logic: treat "never alerted" as alert-eligible, not as
  "alerted at epoch 0" — `(carried[c] ?? 0)` inverted the first-alert case
  and unit tests caught it pre-commit.
- Any ingest of free-form terminal error text must redact secrets/PII
  before persisting. The runtime-status path already scrubbed via
  `SENSITIVE_DIAGNOSTIC_PATTERNS`; the new client-event ingest initially
  did not — an independent diff review caught the asymmetry, now fixed by
  the shared `pos/application/diagnosticRedaction` module. Reuse it for
  any future diagnostic-text sink.
