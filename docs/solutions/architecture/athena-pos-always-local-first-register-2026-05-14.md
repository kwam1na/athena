---
title: Athena POS Register Commands Are Always Local First
date: 2026-05-14
category: architecture
module: athena-webapp
problem_type: offline_pos_command_boundary
component: pos
symptoms:
  - "Online POS cashier commands can accidentally wait for Convex before becoming durable"
  - "Offline fallback paths can diverge from normal online register behavior"
root_cause: cashier_success_was_tied_to_cloud_mutation_acceptance
resolution_type: command_boundary_rule
severity: high
tags:
  - pos
  - local-first
  - offline
  - sync
  - reconciliation
---

# Athena POS Register Commands Are Always Local First

## Problem

If the browser is online, it is easy for the active POS register to drift back
to an online-primary command path: call Convex, wait for mutation success, then
update local state as fallback or sync support. That makes normal online
operation behave differently from offline operation and weakens the POS local
ledger as the first durable cashier record.

The failure mode is subtle because `navigator.onLine` can be true while the
cashier still needs the same local-first guarantees: fast command acceptance,
stable receipt context, reload recovery, and background sync/reconciliation.

## Solution

POS cashier commands append the local register event before returning success to
the cashier, regardless of the browser's current online state. Browser
connectivity can trigger sync, but it must not decide whether opening a drawer,
editing a cart, accepting payment, completing a sale, closing out, or reopening
a register session is first recorded locally.

Convex projection is background acceptance and reconciliation. It accepts local
events, maps local ids to cloud ids, projects Athena records, and reports
conflicts for manager review without rewriting the cashier's completed local
timeline.

## Prevention

- Keep the local command gateway as the cashier-path write boundary.
- Render the active register from the local read model, then let cloud snapshots
  refresh local seed or catalog data opportunistically.
- Do not branch to an online-primary Convex command path just because
  `navigator.onLine` is true.
- Add harness registry coverage for new POS local read-model, command-gateway,
  sync-contract, and projection files before relying on changed-file validation.

## Related

- [Athena POS Local-First Sync Uses Event Logs](./athena-pos-local-first-sync-2026-05-13.md)
