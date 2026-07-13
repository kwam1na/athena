---
title: POS Register Catalog Refresh
date: 2026-07-13
status: active
---

# POS Register Catalog Refresh Requirements

## Summary

Keep an open POS register aware of remotely-created or edited products without restoring a full-catalog live subscription. Athena detects store catalog revisions cheaply, waits until the register is operationally idle, and refreshes the local catalog automatically in the background.

---

## Problem Frame

The POS register searches a local catalog snapshot so product lookup stays fast and available offline. Today that metadata snapshot receives a one-shot refresh when the register mounts, but a register that remains open does not learn that another device added or edited a product. In production this left a remotely-added product unavailable at an already-open terminal until the register route reloaded or remounted.

The gap should close without returning the full catalog to a live Convex subscription, polling on a timer, or changing catalog metadata while a cashier is in the middle of sale work.

---

## Actors

- A1. Catalog operator: creates or edits products and SKU metadata from another device or workspace.
- A2. Cashier: operates an already-open POS register and expects eligible catalog changes to become searchable without manually reloading the route.
- A3. POS terminal: preserves its local-first catalog and applies remote metadata safely when its register is idle.

---

## Key Flows

- F1. Remote catalog change reaches an idle register
  - **Trigger:** A1 creates or changes POS-searchable catalog metadata for the register's store.
  - **Actors:** A1, A2, A3
  - **Steps:** Athena publishes a lightweight store catalog revision; A3 detects the newer revision; the register is already idle; A3 performs one full metadata refresh, replaces its durable local snapshot, and exposes the new catalog state to local search.
  - **Outcome:** The eligible product or edit becomes searchable without route reload and without a persistent full-catalog subscription.
  - **Covered by:** R1, R2, R4, R7, R8

- F2. Remote catalog change waits behind active register work
  - **Trigger:** A3 detects a newer store catalog revision while the register is not idle.
  - **Actors:** A2, A3
  - **Steps:** A3 records that a refresh is pending internally, keeps the current local catalog active, and coalesces later revisions; once every idle blocker clears, A3 refreshes only the latest catalog state in the background.
  - **Outcome:** Active sale work is uninterrupted and the terminal catches up automatically at the first safe boundary.
  - **Covered by:** R3, R5, R6, R9

- F3. Deferred refresh fails safely
  - **Trigger:** The idle register attempts the pending catalog refresh and the server read or local persistence fails.
  - **Actors:** A2, A3
  - **Steps:** A3 retains the previously usable local catalog and retries in the background without requiring cashier action or exposing transient coordination state.
  - **Outcome:** Catalog freshness is delayed, but POS remains usable from its last trusted local metadata snapshot.
  - **Covered by:** R9, R10, R11

---

## Requirements

**Revision detection and read efficiency**

- R1. Athena must maintain a lightweight, store-scoped signal that changes when POS-searchable catalog metadata changes.
- R2. An open register must react to that lightweight signal rather than live-subscribing to the full register catalog or polling on a fixed interval.
- R3. Multiple catalog revisions observed while refresh is blocked must coalesce into one refresh of the latest available catalog state.
- R4. Revision activity must be limited to stable POS catalog metadata changes; ordinary sales, holds, and inventory availability churn must not trigger a full metadata refresh.

**Idle-gated application**

- R5. The register must consider a catalog refresh unsafe while any agreed register-idle blocker is active: product or service lines, customer details, payments, checkout mutation, drawer transition, or local saving risk.
- R6. While blocked, the register must continue searching and selling from its current local catalog snapshot and must not interrupt, clear, reprice, or otherwise alter the active sale.
- R7. When all idle blockers clear, the register must automatically refresh the latest full catalog metadata without cashier action.
- R8. A successful refresh must durably replace the terminal's local catalog snapshot before the new revision is treated as applied.

**Background recovery**

- R9. Waiting, refreshing, offline, transient-failure, and authorization-paused catalog states must remain internal and must not publish app messages or add cashier controls.
- R10. A failed server refresh or local snapshot write must preserve the current usable catalog and retry safely in the background when its recovery condition becomes valid.
- R11. Refresh recovery must not require a route reload or cashier action for transient failures; network and authorization recovery continue when connectivity or access is restored.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R7, R8.** Given an idle register remains open, when another device creates an eligible live, POS-visible, positively-priced product SKU for the same store, the open register refreshes once and can find that SKU without reloading the route.
- AE2. **Covers R3, R5, R6, R9.** Given a cashier has active product lines in a sale, when several remote catalog edits occur, the register keeps the existing catalog and sale unchanged without publishing catalog-refresh messaging, then performs one latest-state refresh after the sale is finished, held, or cleared and all other idle blockers are gone.
- AE3. **Covers R5, R7.** Given the cart is empty but a payment, checkout mutation, drawer transition, customer-only draft, service draft, or local saving risk remains, the catalog refresh continues waiting until that blocker clears.
- AE4. **Covers R4.** Given an open register receives stock or hold changes without stable metadata changes, the metadata revision does not advance and no full catalog refresh is scheduled.
- AE5. **Covers R8, R9, R10, R11.** Given the register becomes idle but its catalog refresh fails, the prior local catalog remains active, no catalog-refresh message is published, and a later successful retry replaces the snapshot.
- AE6. **Covers R3, R7, R9.** Given a newer revision arrives while a refresh is waiting or running, the terminal converges on the latest revision without surfacing coordination state or leaving a known newer revision unapplied.

---

## Success Criteria

- Remotely-added eligible products become searchable on already-open terminals at the first safe idle boundary without requiring a route reload.
- Active sale work is never interrupted or mutated by catalog refresh application.
- Idle terminals incur no repeated full-catalog database reads when catalog metadata has not changed.
- Bursts of product and SKU writes produce one coalesced terminal refresh rather than one full refresh per write.
- Offline and transient-failure behavior preserves the last usable local snapshot and recovers automatically when its prerequisite returns.
- Planning and implementation can trace the revision, idle gate, local persistence, silent background coordination, and failure recovery through explicit tests.

---

## Scope Boundaries

- Do not restore a live subscription to the full register catalog.
- Do not add fixed-interval catalog polling.
- Do not implement per-SKU delta synchronization or a retained catalog change feed.
- Do not change the separate bounded live availability or full offline availability snapshot contracts.
- Do not reprice, remove, or otherwise mutate lines already present in an active sale when catalog metadata changes.
- Do not expose catalog-refresh coordination through app messages, cashier controls, or manual apply/retry actions.

---

## Key Decisions

- Use revision-triggered, one-shot metadata refresh: it closes the stale-open-register gap while retaining the existing bounded-read and local-first architecture.
- Gate both refresh application and expensive full-snapshot work on the established register-idle safety posture: this coalesces changes during active work and avoids unnecessary reads of intermediate revisions.
- Keep coordination silent: catalog freshness is background maintenance and transient waiting or retry states do not require cashier decisions.
- Keep metadata and availability separate: stock churn must not invalidate the stable searchable catalog boundary.
- Apply automatically after blockers clear: freshness recovery should not add another cashier task.

---

## Dependencies / Assumptions

- The existing register view model remains the authority for the agreed idle-safety signals.
- The existing full register catalog query and local snapshot persistence remain the authoritative refresh and durable activation boundaries.
- Catalog projection write paths can expose one centralized revision-maintenance boundary without allowing relevant metadata mutations to bypass it.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R1, R3, R4][Technical] Identify the narrowest centralized projection lifecycle boundary for advancing the store revision across create, update, visibility, archival, taxonomy, import, pending-checkout, and repair paths.
- [Affects R3, R7, R8][Technical] Define revision acknowledgement and in-flight coalescing semantics that cannot lose a newer revision arriving during snapshot persistence.
- [Affects R10, R11][Technical] Choose bounded retry/backoff behavior consistent with existing POS runtime recovery patterns.
