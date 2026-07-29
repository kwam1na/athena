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
  channels, urgency, dedupe recipe, and `prepareEmail` — which loads FRESH
  payload data via the kind's existing internal query and renders the existing
  React Email template at send time. Null/throw means "no longer sendable" and
  suppresses instead of sending stale content. Adding a communication = one
  registry entry + one template; call sites never change again.
- **Audience as data** (`notificationSubscription`): org × optional store ×
  category × channel rows resolved at dispatch, with `ADMIN_EMAILS` as the
  fallback when no rows exist, so seeding is not deploy-order-sensitive.
- **Delivery ledger** (`notificationDelivery`): one row per intent × recipient
  × channel. Reserving IS leasing — rows are born `in_flight` with a lease
  token; completion is token-guarded; retries use exponential backoff with an
  attempt cap; the MailerSend call is idempotency-keyed by delivery id so
  ambiguous outcomes are safe to retry (timeouts classify retryable, not
  `outcome_unknown`).
- **Hybrid dispatch**: immediate kinds get a `runAfter(0)` dispatch at emit;
  one 5-minute sweeper cron recovers expired leases, due retries, and intents
  whose scheduled dispatch never landed.
- **Transport owns the environment gate** (`transport.ts`): prod sends
  normally; non-prod redirects to `NOTIFICATIONS_DEV_RECIPIENT` or reports
  sent-suppressed without calling the provider — the full pipeline runs in
  every environment.
- **Terminal failures are operational events**: a delivery that permanently
  fails records a `notification_delivery_failed` operational event, because an
  admin alert that could not be sent is itself an operational moment.

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

Related: [Athena EOD Automation Manager Report Emails](athena-eod-automation-manager-report-emails-2026-07-04.md)
(superseded delivery mechanics; payload assembly guidance still applies).
