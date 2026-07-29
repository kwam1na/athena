---
title: Athena Admin Notifications Rail
date: 2026-07-29
category: architecture-patterns
module: athena-webapp
problem_type: architecture_pattern
component: notifications
resolution_type: platform_foundation
severity: medium
applies_when:
  - "A Convex domain mutation needs to notify admins/managers about an operational moment"
  - "A new outbound communication is being added to the platform"
  - "Email delivery needs dedupe, retry, or audience routing"
tags:
  - notifications
  - intent-ledger
  - delivery-ledger
  - mailersend
  - subscriptions
delivery_diff_fingerprint: PENDING
---

# Athena Admin Notifications Rail

## Problem

Admin emails were bolted onto call sites. Register closeout, EOD daily manager
reports, and POS terminal health each hand-rolled a recipient loop over the
hardcoded `ADMIN_EMAILS` constant, duplicated the MailerSend fetch, and
invented per-flow dedupe by patching marker fields onto domain rows
(`varianceNotificationScheduledAt`, `closeoutNotificationLocalEventId`).
Closeout alerts were lost forever when a send failed inside a fire-and-forget
`runAfter(0)` action, nothing sent outside prod so the pipeline was never
exercised in staging, and there was no store- or role-based routing. Every new
communication repeated all of this.

## Solution

A platform rail in `packages/athena-webapp/convex/notifications/`, mirroring
the two proven internal patterns: the reports layer's emit → queue → single
sweeper architecture, and the walkthrough notification module's lease/backoff
delivery mechanics.

- **Intent ledger** (`notificationIntent`): domain mutations call
  `emitNotificationWithCtx` inside their own transaction with a kind, subject
  refs, and a minimal payload. Emits are idempotent by a kind-specific
  structural dedupe key, which replaced every marker-field hack.
- **Code-owned registry** (`registry.ts`): each kind declares category,
  channels, dedupe recipe, and `prepareEmail` — which loads FRESH payload data
  via the kind's existing internal query and renders the existing React Email
  template at send time. There is no urgency/batched tiering: every kind
  dispatches immediately (`runAfter(0)` at emit), and the sweeper is the only
  backstop. A **null** return from `prepareEmail` means the subject is
  genuinely no longer sendable and suppresses the delivery. A **throw** is
  treated as a transient fault (read limit, OCC, a momentarily missing row)
  and stays retryable with backoff instead — collapsing the two would let one
  flaky query permanently silence an alert. An unknown or renamed kind (a
  later deploy dropped or renamed a registry entry) terminalizes the intent
  (`suppressedReason: "unknown_kind"`) with an operational event, instead of
  throwing on every dispatch and every sweep forever. Adding a communication =
  one registry entry + one template; call sites never change again.
- **Audience as data** (`notificationSubscription`): org × optional store ×
  category × channel rows resolved at dispatch. `ADMIN_EMAILS` is the fallback
  **only** when the org has zero subscription rows for that category — never
  when a filtered match comes up empty. If rows exist but none match (every
  subscription disabled, or all scoped to a different store), the audience is
  an intentional empty set and the intent is suppressed (`no_recipients`),
  not silently re-broadcast to the hardcoded admin list. **Operational
  consequence:** disabling every subscription in a category does silence it —
  there is no implicit fallback once seeding has happened. A delivery whose
  recipient has since dropped out of the audience (unsubscribed, removed from
  `ADMIN_EMAILS`, re-scoped to another store) is terminalized as
  `recipient_unsubscribed` rather than being re-selected by the sweeper on
  every tick forever. Subscription resolution is capped at 200 rows per
  (org, category); exceeding the cap records an operational event
  (`subscription_cap_exceeded`) instead of silently truncating the audience.
- **Delivery ledger** (`notificationDelivery`): one row per intent × recipient
  × channel. Reserving IS leasing — rows are born `in_flight` with a lease
  token; completion is token-guarded; retries use exponential backoff with an
  attempt cap; the MailerSend call is idempotency-keyed by delivery id so
  ambiguous outcomes are safe to retry (timeouts classify retryable, not
  `outcome_unknown`). The backoff formula (60s doubling, capped at 24h) is
  general-purpose, but at `MAX_DELIVERY_ATTEMPTS = 4` only the first three
  values are ever produced in practice — 1m, 2m, 4m; the 24h cap is only
  reachable at attempt ≥ 12, which the attempt cap never lets a real delivery
  reach. The delivery lease duration scales with recipient count (a base plus
  a per-recipient allowance, capped) rather than being fixed, because a
  dispatch sends to its whole leased batch serially — a fixed short lease
  could let the sweeper reclaim a lease mid-flight and re-send to recipients
  who already succeeded. Delivery dedupe keys percent-encode their component
  strings before joining them, so a client-supplied component (POS
  `localEventId`) cannot contain the join separator and forge a collision
  with a different component tuple.
- **Hybrid dispatch**: every kind gets a `runAfter(0)` dispatch at emit; one
  sweeper cron (every 5 minutes in prod, every 60 minutes elsewhere) recovers
  expired leases, due retries, and intents whose scheduled dispatch never
  landed. The sweeper runs its three phases (stale leases, due retries, stale
  pending intents) against independent per-phase budgets, so a backlog in one
  phase can't starve the others, and surfaces a backlog flag per phase in its
  return value when a phase saturates its cap. A pending intent that the
  sweeper picks up repeatedly without it ever reserving (corrupt row,
  unresolvable reference) is abandoned after 5 pickups
  (`suppressedReason: "dispatch_unrecoverable"`) with an operational event,
  instead of sitting at the head of the queue forever and consuming the
  sweeper's budget on every tick.
- **Transport owns the environment gate** (`transport.ts`): prod sends
  normally; non-prod redirects to `NOTIFICATIONS_DEV_RECIPIENT` when set, or
  otherwise records the delivery with status `suppressed` (never a false
  `sent`) without calling the provider — the full pipeline runs in every
  environment and a suppressed send is always distinguishable from a real one.
- **Terminal failures are operational events**: a delivery that permanently
  fails records a `notification_delivery_failed` operational event, because an
  admin alert that could not be sent is itself an operational moment.
- **Cutover guards in POS sync** (`convex/pos/public/sync.ts`): the legacy
  marker fields `varianceNotificationScheduledAt` and
  `closeoutNotificationLocalEventId` are no longer written, but are still
  *read* for one release, to avoid re-notifying closeouts that were already
  notified by the pre-rail implementation and therefore have no
  `notificationIntent` row. These reads are safe to delete once no unnotified
  pre-deploy closeout remains in the data.

Ported callers: POS terminal health (heartbeat command), register closeout
variance/match (POS sync ingestion), EOD daily manager reports (daily
operations automation — outcome policy unchanged: completed-classified skips
emit nothing; action-required stays once per store-day). The legacy
`automationNotificationDelivery` table is retained read-only with no writers.
Manual explicit-recipient report actions deliberately stay outside the rail.
The in-app channel is schema-supported (`channel: "in_app"`, `readAt`) but
stubbed pending an inbox UI.

## Key learnings

- **Marker-field dedupe → intent ledger**: dedupe state patched onto domain
  rows conflates domain data with delivery bookkeeping and silently drops
  failures once the marker is set. A dedupe-keyed append-only intent table
  gives the same idempotence with an audit trail and retry semantics.
- **Render-at-send beats snapshot-at-emit** when payload queries double as
  sendability checks: a retry hours later reflects current truth or suppresses
  cleanly.
- **Put environment gates in the transport, not call sites** — otherwise
  staging never exercises the pipeline and gate logic multiplies per flow.
- **A fault classifier needs two failure shapes, not one**: collapsing
  "temporarily can't render" and "permanently not sendable" into a single
  suppress path is the easy version to ship, but it silences alerts on
  transient faults. Splitting `prepareEmail` throw (retry) from `prepareEmail`
  null (suppress) keeps a flaky read from permanently killing a notification.

## Known follow-ups (deferred, not yet done)

- No retention or cleanup job exists for `notificationIntent` or
  `notificationDelivery` rows; both tables grow unbounded until a follow-up
  adds one.
- `seedAdminSubscriptions` has no cron or migration entry — it must be
  invoked manually from the Convex dashboard. Until it runs for an org, that
  org's audience resolution falls back to `ADMIN_EMAILS` (by design, not a
  bug), but nothing schedules the seed automatically.
- `NOTIFICATIONS_DEV_RECIPIENT` is not present in any `.env` template, so a
  fresh non-prod environment silently runs in suppressed mode until someone
  sets it by hand.

Related: [Athena EOD Automation Manager Report Emails](athena-eod-automation-manager-report-emails-2026-07-04.md)
(superseded delivery mechanics; payload assembly guidance still applies).
