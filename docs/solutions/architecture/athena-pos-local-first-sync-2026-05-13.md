---
title: Athena POS Local-First Sync Uses Event Logs
date: 2026-05-13
category: architecture
module: athena-webapp
problem_type: offline_pos_sync
component: pos
symptoms:
  - "Provisioned POS terminals need to keep selling when Convex is unavailable"
  - "Offline sales must later update cash controls, inventory, transactions, payments, and traces without duplicate projection"
  - "Disconnected terminals can oversell inventory or carry staff permission drift that needs manager review"
root_cause: online_mutation_replay_is_not_durable_offline_state
resolution_type: architecture_pattern
severity: high
tags:
  - pos
  - local-first
  - offline
  - sync
  - reconciliation
---

# Athena POS Local-First Sync Uses Event Logs

## Problem

Athena POS can no longer treat Convex mutations as the first durable write for every register action. A provisioned terminal must be able to open a register, build a cart, complete payments, create receipts, close out, and reopen for permitted corrections while the network is absent or unreliable.

Replaying browser mutations later is not safe enough. Normal POS commands assume live Convex ids, current permissions, and current stock state. Offline work needs a durable local timeline first, then an idempotent cloud projection path that can preserve completed sales while surfacing conflicts for review.

## Solution

Use POS-only local-first infrastructure:

- Store the terminal seed, catalog snapshot, local register state, append-only POS events, sync cursor, and local-to-cloud mappings in POS local infrastructure.
- Record local register actions before returning success to the cashier.
- Generate terminal-scoped local receipt numbers and keep them as searchable transaction context after sync.
- Upload local events in strict register-session sequence through the POS sync boundary.
- Accept each local event once, record local-to-cloud mappings, and return stable outcomes when the same event is retried.
- Project accepted events into existing Athena records: register sessions, POS sessions, transactions, transaction items, payment allocations, inventory changes, cash controls, and workflow/audit surfaces.
- Preserve completed local sales when inventory, payment, or permission drift appears. Create manager-review reconciliation records instead of rewriting or hiding local history.

## Boundaries

POS is the only offline-first workflow in this release. Non-POS Athena workspaces may remain online, stale, unavailable, or read-only while offline. Do not generalize POS local state into a product-wide offline platform until a separate requirements document does that deliberately.

The local browser event log is not a replacement for Convex. It is the first durable record for field POS operation. Convex remains the cloud source of truth after events are accepted and projected.

## Payment And Cash Controls

Offline checkout preserves the existing POS payment model: method, amount, timestamp, staff context, and mixed-payment payloads. It does not add new cashier confirmation states for card or mobile money just because the terminal is offline.

Cash payments update expected cash when projected, and locally closed register sessions remain visible as pending cloud settlement until the full event history syncs. Closeout and reopen events are timeline checkpoints: sales after local closeout are blocked until a permitted reopen event is recorded and later projected in order.

## Inventory

Local selling uses last-known SKU availability. Cross-terminal oversells are expected in disconnected operation. Sync should preserve the completed sale and create an inventory reconciliation record when cloud stock cannot satisfy the local sale exactly.

Do not silently rewrite receipt totals or remove sale items during projection. Reconciliation is manager work; the customer-facing receipt and completed-sale timeline remain intact.

## Prevention

- Do not use `localStorage` for the core POS event ledger.
- Keep local ids distinct from Convex ids until mappings are returned by sync.
- Make retry idempotency explicit for both event acceptance and projection side effects.
- Keep pending sync copy separate from needs-review conflict copy.
- Add validation-map coverage whenever new local POS infrastructure or sync projection files are added.
- Run graphify after changing these POS local/sync boundaries.

## Related Issues

- Linear: V26-549, V26-550, V26-551, V26-552, V26-553, V26-554, V26-555, V26-556, V26-557, V26-558.
