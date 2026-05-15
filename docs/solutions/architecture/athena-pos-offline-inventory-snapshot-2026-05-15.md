---
title: Athena POS Offline Inventory Uses A Separate Availability Snapshot
date: 2026-05-15
category: architecture
module: athena-webapp
problem_type: offline_pos_inventory
component: pos
symptoms:
  - "Offline POS catalog rows can be visible while availability is unknown"
  - "A partial cache of recently looked-up SKU availability can make offline stock look trustworthy"
  - "Terminal-local selling can repeatedly consume the same last-known unit without a local decrement"
root_cause: catalog_metadata_and_volatile_availability_were_not_separate_offline_contracts
resolution_type: architecture_pattern
severity: high
tags:
  - pos
  - local-first
  - offline
  - inventory
  - readiness
---

# Athena POS Offline Inventory Uses A Separate Availability Snapshot

## Problem

The POS register keeps catalog metadata locally so provisioned terminals can search while offline. Availability is different from metadata: it changes when carts reserve items, sessions expire, and cloud stock moves. Treating a metadata row as proof of sellable stock, or caching only the SKUs a cashier recently searched, creates fake offline availability.

## Solution

Keep three inventory concepts separate:

- Catalog metadata snapshot: local searchable product/SKU rows. This answers "what can this register sell?"
- Bounded live availability: online overlay for displayed or exact-match rows. This keeps active search/cart work fresh without subscribing to full-catalog stock.
- Full local availability snapshot: store-scoped, hold-aware availability for every sellable SKU in the register catalog scope. This answers "what did this terminal last know it could sell offline?"

When POS is online, refresh the full local availability snapshot separately from the bounded live overlay. When POS is offline, join local catalog rows with the full local availability snapshot. Missing or unreadable availability is an offline readiness gap, not zero stock and not proof of stock.

## Terminal-Local Consumption

Within one terminal, subtract active local cart quantity from the trusted local availability before presenting or selecting products. That prevents the same terminal from selling the same last-known unit repeatedly while disconnected.

Clearing or removing an uncompleted cart line restores that terminal-local availability because the cart no longer intends to consume it. Completing a local sale preserves the sale fact; later cloud sync validates current cloud stock and routes oversells to manager review instead of rewriting the receipt.

## Anti-Patterns

- Do not put `quantityAvailable` back into the full register catalog metadata snapshot.
- Do not default missing local availability to `1`, `true`, or any other selectable value.
- Do not treat a cache of only looked-up rows as complete offline readiness.
- Do not let local terminal availability override cloud truth during sync projection.
- Do not expand this contract to expense, procurement, inventory adjustment, or analytics workflows.

## Prevention

Keep tests at the boundaries where this contract can drift:

- Server query tests must prove the full snapshot uses the same register catalog scope as metadata and subtracts active inventory holds.
- Local store tests must keep catalog metadata and availability snapshots in separate tables so metadata never becomes accidental stock proof.
- Gateway tests must cover online live-overlay precedence, offline full-snapshot fallback, and missing snapshot rows remaining unselectable.
- Register view-model tests must cover terminal-local cart decrements, readiness messaging, and barcode/direct-add rejection for unknown availability.
- Sync tests must continue treating terminal-local stock evidence as receipt context, not as an instruction to project local availability over cloud inventory truth.

## Source Pointers

- Server full snapshot query: `packages/athena-webapp/convex/pos/application/queries/listRegisterCatalog.ts`
- Local snapshot persistence: `packages/athena-webapp/src/lib/pos/infrastructure/local/posLocalStore.ts`
- Snapshot readiness helper: `packages/athena-webapp/src/lib/pos/infrastructure/local/registerAvailabilitySnapshot.ts`
- Gateway live/local overlay: `packages/athena-webapp/src/lib/pos/infrastructure/convex/catalogGateway.ts`
- Register presentation and terminal-local decrement: `packages/athena-webapp/src/lib/pos/presentation/register/useRegisterViewModel.ts`

## Related

- [Athena POS Local-First Sync Uses Event Logs](./athena-pos-local-first-sync-2026-05-13.md)
- [Athena POS Entry And Readiness Are Local First](./athena-pos-local-first-entry-readiness-2026-05-14.md)
- Plan: `docs/plans/2026-05-15-001-feat-pos-offline-inventory-snapshot-plan.md`
- Linear: V26-588, V26-589, V26-590, V26-591, V26-592, V26-593
