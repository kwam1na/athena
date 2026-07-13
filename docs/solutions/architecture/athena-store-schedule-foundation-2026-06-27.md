---
title: "Athena Store Schedule owns reusable store-local business time"
date: 2026-06-27
last_updated: 2026-07-12
category: architecture
module: athena-webapp
problem_type: architecture_pattern
component: daily-operations
resolution_type: foundational_store_schedule
severity: high
tags:
  - store-schedule
  - daily-operations
  - automation
  - store-configuration
  - timezone
delivery_diff_fingerprint: 8f0b81d6dcaff204b644404cf2a31b4a027041fc8521e94b45e7e296073ef3c9
---

## Problem

Daily Operations automation exposed a broader missing primitive: Athena had no
canonical model for store-local business time. Automation policy carried local
minute and timezone-offset fields, so routine pre-window scheduler checks could
look like meaningful operator-facing EOD decisions.

That was too narrow a foundation. Store hours are not an automation setting;
they are cross-domain business truth that future workflows can reuse for POS,
storefront display, appointments, analytics, intelligence context, support
diagnostics, and Daily Operations.

## Solution

Keep Store Schedule as a first-class, effective-dated domain:

- `storeSchedule` stores store-scoped schedule versions with IANA timezone,
  weekly windows, closed days, date exceptions, effective ranges, source, and
  status.
- The resolver returns consumer-neutral store-day context: operating date,
  phase, open/closed state, current/next window, schedule version, and derived
  UTC timestamps.
- Store Hours administration writes schedule data through schedule-specific
  commands, not `store.config` or automation policy patching.
- Consumers adapt schedule context to their own workflow windows. Daily
  Operations automation is the first adapter, not the owner of the model.

Automation policy remains judgment: mode, thresholds, blocker handling, pause
state, rollout notes, and action-specific grace. It must not become the source
of store hours.

## Safety Boundary

Core schedule code must stay consumer-neutral. Do not put EOD, Opening,
automation, grace, threshold, blocker, or policy vocabulary in the schedule
schema or resolver output. Those concepts belong in consumer adapters.

When automation consumes canonical schedule context, persist the resolved
schedule version and derived timestamps in automation/Daily Close evidence so
later schedule edits do not reinterpret historical closes or ledger rows.

Migration from legacy policy timing should seed only candidate schedules unless
a trustworthy IANA timezone and admin confirmation exist. Static timezone
offsets are compatibility hints, not canonical timezones. EOD completion window
metadata remains automation compatibility data; it is not store close time.

Financial reporting is an explicit exception to schedule ownership. Reports
uses a separate effective-dated `storeTimezoneVersion` authority to convert a
source occurrence into a local calendar date. It may attach the resolved Store
Schedule as expected-hours context, but schedule absence, closed state, or an
outside-hours occurrence cannot reject a completed sale. This separation exists
because real transactions may occur outside configured operating windows.

## Prevention

- Add future store-local-time use cases through the Store Schedule context APIs
  instead of reading automation policy fields.
- Keep Store Hours UI framed as foundational store configuration with derived
  consumer readouts.
- Suppress routine pre-window automation checks from broad Daily Operations
  status; expose them only as quiet timing context when useful.
- Add return-validator contract tests when new public Convex schedule functions
  expose explicit `returns` validators.
- Never use Store Schedule existence as a prerequisite for financial fact
  eligibility or report materialization. Persist schedule lineage only as
  optional context when it resolves.
- Regenerate Convex refs and Graphify when schedule schema, functions, or
  read-model consumers change.
