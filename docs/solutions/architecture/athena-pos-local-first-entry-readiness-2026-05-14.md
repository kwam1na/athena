---
title: Athena POS Entry And Readiness Are Local First
date: 2026-05-14
category: architecture
module: athena-webapp
problem_type: offline_pos_entry_readiness
component: pos
symptoms:
  - "The POS landing route can blank while analytics or active store reads are unresolved"
  - "The register guard can wait for live daily-operation snapshots even when local POS state can safely decide"
root_cause: route_entry_and_store_day_readiness_were_tied_to_live_reads
resolution_type: architecture_pattern
severity: high
tags:
  - pos
  - local-first
  - offline
  - readiness
---

# Athena POS Entry And Readiness Are Local First

## Problem

The POS local command gateway and register read model can keep cashier work
durable locally, but they cannot help if the app blanks before the cashier gets
to the register. `/pos` was treating analytics, summaries, active store, and
organization reads as a page-level gate. `POSRegisterOpeningGuard` was also
waiting for live Daily Opening and Daily Close snapshots before rendering.

That made a provisioned terminal depend on Convex reads before it could enter
the local-first cashier path.

## Solution

Keep POS entry, store-day readiness, register/drawer state, and cashier
commands as separate layers:

- POS launcher entry uses route slugs plus the provisioned terminal seed to
  build local authority. Live store and organization reads can enrich the route,
  but unresolved analytics or summaries do not suppress POS entry.
- Store-day readiness is cached as POS-local daily-opening/daily-close posture,
  scoped by store and operating date. Live snapshots refresh that cache when
  available.
- Register and drawer state still comes from the local register read model.
  Local closeout blocks selling until a reopen event is recorded; it is not the
  same thing as a completed store day.
- Cashier commands remain local-first. Browser connectivity can trigger sync,
  but it does not decide whether cashier work is first recorded locally.

Live daily-operation snapshots are authoritative once present: a not-started
Opening Handoff blocks POS, and a completed Daily Close blocks POS unless that
close lifecycle has been reopened. While those live snapshots are unresolved, a
valid local readiness record can allow entry.

## Prevention

- Do not put analytics, summary, or admin-card data in the `/pos` render gate.
- Do not use `navigator.onLine` as POS entry authority.
- Do not encode daily-opening or daily-close state as register events.
- Keep local drawer closeout separate from store-day close. Drawer closeout is
  register state; Daily Close is a store-day boundary.
- Add validation-map coverage for new POS local entry/readiness files and run
  the POS local/register slice when these files or the launcher/guard change.

## Related

- [Athena POS Local-First Sync Uses Event Logs](./athena-pos-local-first-sync-2026-05-13.md)
- [Athena POS Register Commands Are Always Local First](./athena-pos-always-local-first-register-2026-05-14.md)
- [Athena Daily Close Is A Store-Day Boundary](../logic-errors/athena-daily-close-store-day-boundary-2026-05-07.md)
