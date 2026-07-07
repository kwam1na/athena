---
title: Athena POS Runtime Status Check-In Storm
date: 2026-07-02
last_updated: 2026-07-06
category: performance
module: athena-webapp
problem_type: performance_issue
component: service_object
symptoms:
  - "Convex production logs showed repeated POS runtime check-ins from the local runtime"
  - "reportTerminalRuntimeStatus calls clustered around the same terminal and produced optimistic concurrency retries"
  - "Remote Assist and terminal recovery queries were repeatedly invalidated by redundant runtime-status writes"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags:
  - convex
  - pos
  - runtime-status
  - remote-assist
  - terminal-health
---

# Athena POS Runtime Status Check-In Storm

## Problem

The POS local runtime can have more than one browser-side publisher active for a
terminal. When those publishers report the same terminal state independently,
they can repeatedly call `reportTerminalRuntimeStatus`, patch the latest
`posTerminalRuntimeStatus` row, and fan out Remote Assist and recovery-query
invalidations.

This is production-sensitive because the runtime status row is a shared latest
state boundary. Multiple near-identical mutations against that row create both
write load and optimistic concurrency retries.

## Symptoms

- `convex logs` showed repeated `pos/public/terminals:reportTerminalRuntimeStatus`
  calls from POS terminals.
- The same log window also showed repeated
  `pos/public/terminals:getRuntimeRemoteAssistSession`,
  `pos/public/terminals:listTerminalRecoveryCommands`,
  `remoteAssist/public:getClientByRuntime`, and
  `remoteAssist/public:getCurrentSessionByClient` reads.
- Earlier samples had `occInfo` / `willRetry` on runtime-status writes.
- After the first throttle, calls still clustered because alternating publishers
  sometimes omitted staff identity or reported sync-only churn.
- A server duplicate window equal to the client heartbeat can still skip a
  freshness write when the prior request had more network delay than the next
  request.

## What Didn't Work

- A hook-local in-flight guard is not enough. It only serializes a single hook
  instance, so a second runtime host in the same browser can still publish for
  the same terminal.
- Server idempotency that compares every runtime field is too strict. Sync
  counters, observed timestamps, and omitted staff identity can make the same
  effective state look different.
- Sampling logs before the terminals reload to the deployed build can make the
  fix look ineffective because old-client traffic dominates the window.

## Solution

Use both client and server guardrails.

On the client, keep a module-level per-terminal publish state in
`usePosLocalSyncRuntime.ts`. The state coalesces duplicate publishers for the
same `storeId` and `terminalId`, tracks one in-flight publish, and queues only
the latest signature for replay.

Keep the runtime publish material signature focused on operationally meaningful
state. `runtimeStatusPublisher.ts` excludes volatile fields such as
`reportedAt`, snapshot ages, observation timestamps, and sync-only status churn
from the material comparison so routine local-sync bookkeeping waits for the
normal heartbeat.

On the server, make
`convex/pos/infrastructure/repositories/terminalRepository.ts` return a write
outcome from the latest-status upsert. Fast duplicate reports within a server
coalescing window return `didWrite: false`; the public mutation strips that
internal flag from the response and skips Remote Assist / recovery side effects
for redundant reports.

Keep the server duplicate window shorter than the client freshness cadence. A
110-second client heartbeat with a 90-second server no-write window leaves room
for request timing jitter, so a successful client-cadence heartbeat still
refreshes terminal health before the two-minute online threshold. The no-write
path should be reserved for real fast duplicates.

Do not treat every `materialChanged: false` write as disposable. A
freshness-only write with `didWrite: true` must still build runtime directives
and run side-effect freshness for recovery and Remote Assist. Only
`didWrite: false` duplicates should skip those reads and return
`acceptedForSideEffects: false`.

Also preserve same-status staff identity during server merges. If one runtime
publisher reports `staffProfileId` and another same-status publisher omits it,
the repository keeps the richer identity instead of flipping the latest row
back and forth.

## Why This Works

The latest runtime status row should change when terminal posture changes, not
when equivalent publishers report the same posture with different volatile
metadata. Coalescing at the browser boundary reduces needless calls from the
new build, and server-side idempotency protects production from older tabs,
multiple publishers, or duplicate devices.

Skipping side effects when `didWrite` is false avoids invalidating Remote Assist
and recovery subscriptions for reports that did not change terminal state.

## Prevention

- Treat `posTerminalRuntimeStatus` as a latest-state aggregate. Do not patch it
  for every diagnostic heartbeat if material state did not change.
- Keep volatile fields out of publish signatures and server duplicate
  comparison: timestamps, snapshot ages, sync trigger labels, and sync-only
  counters.
- Keep operational sync posture in publish signatures when the server treats it
  as side-effect material. For example, `sync.status` and review-event evidence
  should not be erased from the client material signature if the server uses
  them to decide whether side effects should run.
- Keep the server duplicate window lower than the client heartbeat cadence, and
  add a regression where the prior server `receivedAt` lagged the prior client
  attempt but the next client-cadence heartbeat still writes.
- Preserve richer known identity when a duplicate same-status report omits
  optional staff fields.
- After production deploys, first verify active terminal `appVersion` /
  `buildSha`, then sample `convex logs --deployment colorless-cardinal-870`.
- Regression coverage should include duplicate publishers, fast duplicate
  server writes, omitted app-update evidence, omitted staff identity, and the
  heartbeat-boundary duplicate window.

## Related

- `packages/athena-webapp/src/lib/pos/infrastructure/local/usePosLocalSyncRuntime.ts`
- `packages/athena-webapp/src/lib/pos/infrastructure/local/runtimeStatusPublisher.ts`
- `packages/athena-webapp/convex/pos/infrastructure/repositories/terminalRepository.ts`
- `packages/athena-webapp/convex/pos/public/terminals.ts`
- `docs/solutions/performance/athena-convex-read-amplification-2026-06-29.md`
