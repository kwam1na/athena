---
title: Refactor POS Cart Latency Foundation
date: 2026-05-05
status: active
type: refactor
depth: deep
---

# Refactor POS Cart Latency Foundation

## Summary

Make POS cart operations feel instant in production while preserving inventory accuracy. The register should not pay full-store catalog reactivity cost when a cashier adds, removes, or changes one cart line. The cart UI remains optimistic, but the POS command boundary remains authoritative for drawer, staff, session, and inventory validation.

## Problem Frame

The current register search work moved lookup to a local catalog index, but the full register catalog snapshot still includes volatile SKU availability fields. POS cart operations acquire and release inventory holds by patching `productSku.quantityAvailable`. Because the active register subscribes to a full-store catalog snapshot built from every `productSku`, each cart operation can invalidate and rerun a large store-wide catalog query in production.

That means one cashier changing one line item can trigger work proportional to the store catalog size, not the cart size. Large SKU catalogs make the server response feel slower even when the actual cart mutation is small.

## Scope

In scope:

- POS register catalog read model and client contract.
- POS inventory hold accounting for sale sessions.
- POS session item lookup for add/update.
- POS cart optimistic UI paths for add, update, direct remove, and clear cart.
- Tests that protect production-scale invalidation and inventory accuracy.

Out of scope:

- Storefront checkout reservation semantics beyond keeping existing behavior compatible.
- Expense-session hold migration unless shared helpers require safe compatibility.
- Visual browser validation; this batch is server/client behavior and repo-sensor driven.
- Session-level operations such as hold, void, checkout completion UX, or drawer closeout responsiveness.

## Requirements

- R1. Cart add/update/remove/clear updates the visible cart immediately in the register UI.
- R2. Cart commands remain authoritative and roll back optimistic UI state on inventory, drawer, staff, or session conflicts.
- R3. POS cart holds do not force full-store register catalog snapshot recomputation for every held quantity change.
- R4. Register catalog search indexes stable metadata separately from volatile availability.
- R5. Exact-match auto-add remains accurate: it may use bounded availability for UX, but command success is the final truth.
- R6. POS add/update finds an existing cart line by `(sessionId, productSkuId)` without scanning paginated cart items.
- R7. Session completion, remove, clear, void, and expiry preserve inventory correctness after the hold model changes.
- R8. Repo sensors catch regressions in catalog volatility, cart optimistic rollback, and inventory hold accounting.

## Current Findings

- `packages/athena-webapp/convex/pos/application/queries/listRegisterCatalog.ts` reads every store SKU and returns `quantityAvailable` / `inStock`.
- `packages/athena-webapp/src/lib/pos/infrastructure/convex/catalogGateway.ts` subscribes the active register to that full catalog query.
- `packages/athena-webapp/convex/inventory/helpers/inventoryHolds.ts` patches `productSku.quantityAvailable` for every acquire/release/adjust.
- `packages/athena-webapp/convex/pos/infrastructure/repositories/sessionCommandRepository.ts` finds existing cart lines by paging through `posSessionItem.by_sessionId`.
- `packages/athena-webapp/src/lib/pos/presentation/register/useRegisterViewModel.ts` now has optimistic add/update/remove/clear overlay work in progress locally.

## Technical Direction

Use two separate contracts:

- Stable catalog metadata: searchable identity and display fields that rarely change during cart operations.
- Bounded availability: scoped reads for the SKUs the register needs to reason about, with command validation as the final authority.

Move POS cart holds away from directly patching full SKU documents during cart editing. Holds should be represented as durable hold/reservation rows keyed by store, SKU, source session, status, quantity, and expiry. Availability for POS commands should be computed from SKU stock minus active holds, while session completion consumes the hold and decrements actual SKU availability/stock exactly once.

## Implementation Units

### U1. Keep Cart UI Optimistic Across Cart-Line Operations

**Outcome:** Product selection, quantity changes, direct remove, and clear-cart all update the cart immediately and roll back on command failure.

**Requirements:** R1, R2.

**Files:**

- `packages/athena-webapp/src/lib/pos/presentation/register/useRegisterViewModel.ts`
- `packages/athena-webapp/src/lib/pos/presentation/register/useRegisterViewModel.test.ts`

**Tests:**

- Product selection adds new optimistic cart lines while add is pending.
- Product selection increments existing cart lines while add is pending.
- Quantity updates and quantity-to-zero remove paths roll back on failure.
- Direct remove and clear-cart paths hide items immediately and roll back on failure.

**Execution posture:** test-first.

**Observability / audit:** Reuse existing POS command/session trace behavior. The UI layer does not create durable records.

### U2. Split Register Catalog Metadata From Availability

**Outcome:** The local register search index is built from stable metadata and does not rebuild because a cart hold changed one SKU availability.

**Requirements:** R3, R4, R5.

**Files:**

- `packages/athena-webapp/convex/pos/application/queries/listRegisterCatalog.ts`
- `packages/athena-webapp/convex/pos/public/catalog.ts`
- `packages/athena-webapp/src/lib/pos/application/dto.ts`
- `packages/athena-webapp/src/lib/pos/infrastructure/convex/catalogGateway.ts`
- `packages/athena-webapp/src/lib/pos/presentation/register/catalogSearch.ts`
- `packages/athena-webapp/src/lib/pos/presentation/register/useRegisterCatalogIndex.ts`
- `packages/athena-webapp/src/lib/pos/presentation/register/useRegisterViewModel.ts`

**Tests:**

- Catalog metadata query excludes volatile availability fields.
- Bounded availability query returns only requested SKU ids.
- Local index preserves exact and fuzzy behavior from metadata-only rows.
- View-model overlays availability for in-stock display and auto-add gating without rebuilding search identity.
- Missing availability does not auto-add, but still shows the exact metadata result.

**Execution posture:** test-first.

**Observability / audit:** None -- read model split only.

### U3. Add POS Hold Ledger And Scoped Availability

**Outcome:** POS cart holds no longer patch `productSku.quantityAvailable` during cart editing. Availability is computed from SKU stock minus active holds at the command boundary.

**Requirements:** R2, R3, R5, R7.

**Files:**

- `packages/athena-webapp/convex/schema.ts`
- `packages/athena-webapp/convex/inventory/helpers/inventoryHolds.ts`
- `packages/athena-webapp/convex/pos/infrastructure/integrations/inventoryHoldGateway.ts`
- `packages/athena-webapp/convex/pos/application/commands/sessionCommands.ts`
- `packages/athena-webapp/convex/pos/application/commands/completeTransaction.ts`
- `packages/athena-webapp/convex/inventory/posSessions.ts`

**Tests:**

- Acquire/adjust/release creates or updates hold rows without patching `productSku`.
- Availability ignores released/expired holds and accounts for active holds.
- Same-session quantity adjustments do not double-count the existing hold.
- Remove, clear, void, and expiry release hold rows.
- Completion decrements SKU inventory/availability once and consumes the session hold rows.

**Execution posture:** characterization-first for current hold semantics, then test-first for ledger behavior.

**Observability / audit:** Reuse session traces for cart/session lifecycle. Inventory movement audit remains at completion, not transient cart holds.

### U4. Index Existing Cart-Line Lookup

**Outcome:** POS add/update can find an existing line for a SKU through a compound index instead of paging through all session items.

**Requirements:** R6.

**Files:**

- `packages/athena-webapp/convex/schema.ts`
- `packages/athena-webapp/convex/pos/infrastructure/repositories/sessionCommandRepository.ts`
- `packages/athena-webapp/convex/pos/infrastructure/repositories/sessionCommandRepository.test.ts`
- `packages/athena-webapp/convex/inventory/sessionQueryIndexes.test.ts`

**Tests:**

- Repository uses `posSessionItem.by_sessionId_productSkuId`.
- Schema guard asserts the compound index exists.
- Existing add/update command tests still pass.

**Execution posture:** test-first.

**Observability / audit:** None -- lookup optimization only.

### U5. Refresh Durable Documentation

**Outcome:** The repo records the production-scale lesson: full-store reactive catalog snapshots must not include fields mutated by hot cart operations.

**Requirements:** R8.

**Files:**

- `docs/solutions/logic-errors/athena-pos-register-local-catalog-search-2026-05-04.md`
- `docs/solutions/performance/athena-pos-cart-latency-foundation-2026-05-05.md`

**Tests:**

- Sensor-only: docs reviewed against implementation and graphify rebuilt.

**Execution posture:** sensor-only.

**Observability / audit:** None -- documentation only.

## Integration Strategy

Use a coordinated batch and one integration PR. The units touch generated Convex API output and graphify artifacts, so separate PRs would mostly fight over derived files. Implementation can still proceed in isolated branches or subagents with disjoint ownership:

- UI optimistic and client catalog split.
- Server hold ledger and command semantics.
- Index/sensor/documentation cleanup.

## Expected Sensors

- `bun run --filter '@athena/webapp' test -- src/lib/pos/presentation/register/useRegisterViewModel.test.ts`
- `bun run --filter '@athena/webapp' test -- src/lib/pos/presentation/register/catalogSearch.test.ts`
- `bun run --filter '@athena/webapp' test -- convex/pos/application/queries/listRegisterCatalog.test.ts`
- `bun run --filter '@athena/webapp' test -- convex/pos/application/sessionCommands.test.ts`
- `bun run --filter '@athena/webapp' test -- convex/pos/application/commands/completeTransaction.test.ts`
- `bun run --filter '@athena/webapp' test -- convex/pos/infrastructure/repositories/sessionCommandRepository.test.ts convex/inventory/sessionQueryIndexes.test.ts`
- `bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json`
- `bun run graphify:rebuild`
- Merge-level repo validation before PR merge.

## Risks

- Existing active POS sessions may have already decremented `quantityAvailable`. The migration should avoid double-releasing or double-consuming those holds.
- Storefront checkout still uses SKU availability directly. This plan keeps the first hold-ledger migration scoped to POS sale sessions; a future storefront reservation migration may be warranted.
- Metadata and availability can be temporarily inconsistent. The UI must treat command failure as authoritative and roll back.
- Price freshness remains outside this plan unless command-side price validation is added later.
