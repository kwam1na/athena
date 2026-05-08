---
title: Refactor Expense Register Local Index Parity
type: refactor
status: active
date: 2026-05-08
---

# Refactor Expense Register Local Index Parity

## Summary

Align the expense register product-entry path with the POS register local catalog index where the two workflows share the register shell. Expense should reuse the same store-scoped catalog snapshot, exact identifier resolution, bounded availability overlay, and local text ranking while keeping expense-specific session and cart mutations as the durable write boundary.

---

## Problem Frame

The POS register now avoids per-keystroke product search by loading a compact catalog snapshot and searching it locally. Expense still uses the older debounced `usePOSProductSearch` and `usePOSBarcodeSearch` hooks even though it renders through the same `POSRegisterView` and `ProductEntry` contract, so the overlapping product-entry surface has slower and less consistent behavior.

---

## Assumptions

*This plan was authored without synchronous user confirmation. The items below are agent inferences that fill gaps in the input; review them before implementation proceeds.*

- Expense exact-match parity should include the same identifiers as POS: barcode, SKU, product SKU id, product id, and product URL inputs.
- Expense should keep quick-add disabled for now because the current expense view-model already sets `canQuickAddProduct: false`.
- Expense remains drawerless in this scope; sharing POS search must not reintroduce POS drawer gates or register-session requirements.

---

## Requirements

- R1. Expense product entry no longer runs active-entry search through `usePOSProductSearch` or `usePOSBarcodeSearch`.
- R2. Expense uses the existing POS register catalog snapshot and browser-local catalog index for text search and exact identifier resolution.
- R3. Single available exact matches auto-add once through expense cart/session operations and clear the query.
- R4. Ambiguous exact matches and unavailable exact matches remain visible for operator selection or explanation, without auto-add.
- R5. Expense keeps its existing workflow boundary: no POS session, drawer gate, customer attribution, checkout payment, or register-session mutation is introduced.
- R6. Tests cover the expense local-index behavior and guard against regression to the older server-search hooks.

---

## Scope Boundaries

- Do not change the POS sale/session mutation path.
- Do not make expense sessions require drawers or register sessions.
- Do not enable expense quick-add.
- Do not redesign `ProductEntry` or `POSRegisterView`; the existing shared contract should be sufficient.
- Do not change catalog snapshot shape unless implementation finds a real missing field.

---

## Context & Research

### Relevant Code and Patterns

- `packages/athena-webapp/src/lib/pos/presentation/register/useRegisterViewModel.ts` already loads `useConvexRegisterCatalog`, builds `useRegisterCatalogIndex`, searches with `searchRegisterCatalog`, overlays availability for displayed rows, and exposes `searchResults`, `isSearchLoading`, and `isSearchReady` to `ProductEntry`.
- `packages/athena-webapp/src/lib/pos/presentation/register/catalogSearch.ts` is the pure local-index seam for barcode, SKU, product SKU id, product id, product URL, and ranked text search.
- `packages/athena-webapp/src/lib/pos/infrastructure/convex/catalogGateway.ts` exposes `useConvexRegisterCatalog` and `useConvexRegisterCatalogAvailability`.
- `packages/athena-webapp/src/lib/pos/presentation/expense/useExpenseRegisterViewModel.ts` is the main expense adapter seam and still imports `useDebounce`, `usePOSProductSearch`, `usePOSBarcodeSearch`, and POS search delay constants.
- `packages/athena-webapp/src/components/pos/ProductEntry.tsx` and `packages/athena-webapp/src/components/pos/SearchResultsSection.tsx` already consume view-model state rather than owning workflow-specific search internals.

### Institutional Learnings

- `docs/solutions/logic-errors/athena-pos-register-local-catalog-search-2026-05-04.md`: active register search should use a compact store-scoped snapshot plus browser-local exact/text index, while add-item commands remain the durable authority.
- `docs/solutions/performance/athena-pos-cart-latency-foundation-2026-05-05.md`: stable catalog metadata should stay separate from volatile availability; availability should be overlaid for bounded displayed or exact rows.
- `docs/plans/2026-05-04-002-refactor-pos-register-catalog-search-plan.md`: the original POS local-index plan explicitly left expense parity out of scope, making this a follow-up rather than a correction to that plan.
- `docs/plans/2026-04-28-003-test-expense-session-workflow-hardening-spec.md`: expense coverage should remain characterization-first where legacy behavior is unclear, but older drawer-hardening assumptions are stale against the current drawerless baseline.

### External References

- None. The repo already has the relevant local pattern and tests.

---

## Key Technical Decisions

- Reuse the existing register catalog snapshot and local index instead of creating an expense-specific search model: the search domain is shared catalog lookup, while the write boundary remains workflow-specific.
- Keep availability as a bounded overlay: this follows the POS latency foundation and avoids invalidating a full-store catalog snapshot on cart mutations.
- Implement at the expense view-model seam first: `POSRegisterView`, `ProductEntry`, and `SearchResultsSection` already receive enough state through `RegisterViewModel`.
- Extract only the mapping/helpers needed to prevent duplication: if expense needs POS-only private helpers such as catalog-row-to-product mapping, move the minimal shared helper into the register presentation area instead of coupling expense to POS view-model internals.

---

## Open Questions

### Resolved During Planning

- Should expense inherit POS drawer/session gates while aligning shared surfaces? No. Current repo behavior and prior direction say expense sessions are drawerless, so this plan shares search only.
- Should expense quick-add be enabled as part of parity? No. Quick-add is currently disabled for expense and is not required to replace the search backend.

### Deferred to Implementation

- Whether a shared helper extraction is cleaner than a small expense-local adapter: decide after adding failing expense tests and seeing the duplication shape.
- Exact validation command list: use the focused package tests first, then the repo PR-equivalent validation surfaced by the harness.

---

## Implementation Units

- U1. **Characterize Expense Search Contract**

**Goal:** Lock the current overlap expectations before changing the implementation: expense uses the shared register product-entry state, but should not use POS server-search hooks or POS drawer/session mutations.

**Requirements:** R1, R5, R6

**Dependencies:** None

**Files:**
- Modify: `packages/athena-webapp/src/lib/pos/presentation/expense/useExpenseRegisterViewModel.test.ts`
- Read: `packages/athena-webapp/src/components/pos/register/POSRegisterView.tsx`
- Read: `packages/athena-webapp/src/components/pos/ProductEntry.tsx`

**Approach:**
- Replace the existing test that expects `usePOSProductSearch` and `usePOSBarcodeSearch` calls with tests that assert the expense view-model provides search state through the local catalog path.
- Keep tests focused on the view-model contract rather than shell rendering unless the component contract changes.

**Execution note:** Characterization-first for current expense boundaries; the first failing tests should prove the server-search dependency and desired local-index contract.

**Patterns to follow:**
- `packages/athena-webapp/src/lib/pos/presentation/register/useRegisterViewModel.test.ts`
- `packages/athena-webapp/src/lib/pos/presentation/register/catalogSearch.test.ts`

**Test scenarios:**
- Happy path: text query with loaded catalog rows returns locally ranked expense search results.
- Happy path: barcode/SKU/product URL exact match is surfaced through `productEntry.searchResults`.
- Edge case: ambiguous product id returns multiple selectable variants and does not auto-add.
- Edge case: unavailable exact match remains visible and does not auto-add.
- Integration: expense keeps `drawerGate: null` and routes manual add through `useExpenseOperations.addProduct`.
- Regression: expense active product entry does not import or call `usePOSProductSearch` or `usePOSBarcodeSearch`.

**Verification:**
- Expense view-model tests fail against the current server-search implementation and encode the intended local-index behavior.

- U2. **Reuse Register Catalog Index In Expense View Model**

**Goal:** Replace the expense debounced server-search path with the existing local catalog snapshot, local index, and bounded availability overlay.

**Requirements:** R1, R2, R4, R5

**Dependencies:** U1

**Files:**
- Modify: `packages/athena-webapp/src/lib/pos/presentation/expense/useExpenseRegisterViewModel.ts`
- Modify if needed: `packages/athena-webapp/src/lib/pos/presentation/register/useRegisterViewModel.ts`
- Create or modify if needed: `packages/athena-webapp/src/lib/pos/presentation/register/catalogSearchPresentation.ts`
- Test: `packages/athena-webapp/src/lib/pos/presentation/expense/useExpenseRegisterViewModel.test.ts`

**Approach:**
- Import the existing catalog gateway and local index utilities into the expense view-model.
- Search local metadata from `store.ui.productSearchQuery`, request availability only for returned rows, and map rows to the product shape expected by `ProductEntry` and `useExpenseOperations`.
- Remove expense use of `useDebounce`, `POS_SEARCH_DEBOUNCE_MS`, `POS_AUTO_ADD_DELAY_MS`, `usePOSProductSearch`, and `usePOSBarcodeSearch` when they are no longer needed.
- Keep expense session creation, completion, voiding, and cart mutation paths unchanged.

**Execution note:** Test-first after U1; prefer a narrow shared helper only if it removes real duplication with POS.

**Patterns to follow:**
- `packages/athena-webapp/src/lib/pos/presentation/register/useRegisterViewModel.ts`
- `packages/athena-webapp/src/lib/pos/infrastructure/convex/catalogGateway.ts`

**Test scenarios:**
- Happy path: local text search returns product rows with availability overlay.
- Happy path: local exact search uses catalog snapshot data without a per-input server search.
- Edge case: catalog snapshot is undefined while query is non-empty, so expense reports loading and not ready.
- Edge case: empty query returns no results and no loading state.
- Integration: changing active store rebuilds catalog search from the store-scoped snapshot.

**Verification:**
- Expense search state is derived from the local catalog index and no active-entry server search imports remain.

- U3. **Align Exact-Match Auto-Add Semantics**

**Goal:** Make expense exact matches behave like POS on overlapping product-entry semantics: one available exact match adds once, ambiguity or unavailable stock does not auto-add.

**Requirements:** R3, R4, R5, R6

**Dependencies:** U2

**Files:**
- Modify: `packages/athena-webapp/src/lib/pos/presentation/expense/useExpenseRegisterViewModel.ts`
- Test: `packages/athena-webapp/src/lib/pos/presentation/expense/useExpenseRegisterViewModel.test.ts`

**Approach:**
- Add an expense exact-add guard keyed by query and product SKU so rerenders cannot duplicate adds.
- Route the add through `useExpenseOperations.addProduct` and keep the expense session command boundary authoritative.
- Clear the query only after a successful add path.

**Execution note:** Test-first; duplicate-add prevention is the core behavioral risk.

**Patterns to follow:**
- POS exact add guard in `packages/athena-webapp/src/lib/pos/presentation/register/useRegisterViewModel.ts`
- Existing expense cart add behavior in `packages/athena-webapp/src/hooks/useExpenseOperations.ts`

**Test scenarios:**
- Happy path: single available barcode match auto-adds exactly once and clears the query.
- Happy path: Enter on a single available exact SKU/product URL adds exactly once and clears the query.
- Edge case: rerendering with the same exact query does not call add twice.
- Edge case: unavailable exact match renders as a result and does not call add.
- Edge case: ambiguous exact match renders multiple results and does not call add.
- Error path: add failure leaves the query available for correction or retry.

**Verification:**
- Exact-match expense behavior matches POS where the product-entry surface overlaps, while all writes still go through expense operations.

- U4. **Refresh Tracking, Docs, And Validation Surface**

**Goal:** Keep repo and Linear tracking accurate for the newly shared search behavior and the expense-specific boundaries.

**Requirements:** R5, R6

**Dependencies:** U1, U2, U3

**Files:**
- Modify: `packages/athena-webapp/docs/agent/testing.md` if the focused expense validation slice needs search parity coverage.
- Modify: `docs/solutions/logic-errors/athena-pos-register-local-catalog-search-2026-05-04.md` or create a new solution note only if implementation reveals a reusable lesson beyond the existing POS local-index note.
- Generated: `graphify-out/GRAPH_REPORT.md`
- Generated: `graphify-out/graph.json`
- Generated: `graphify-out/wiki/index.md`
- Generated: `graphify-out/wiki/packages/athena-webapp.md`

**Approach:**
- Update focused validation docs only if the executor adds durable new test expectations that future agents should run for expense search parity.
- Run graphify rebuild after code changes because repo instructions require graph freshness.
- Avoid documenting agent workflow inside repo docs; only document repo behavior and sensors.

**Execution note:** Sensor-only unless documentation changes become behavior-bearing.

**Patterns to follow:**
- `packages/athena-webapp/docs/agent/testing.md`
- Existing `docs/solutions/logic-errors/athena-pos-register-local-catalog-search-2026-05-04.md`

**Test scenarios:**
- Test expectation: none for generated graph artifacts and documentation-only updates; validation is through doc diff review and graphify freshness.

**Verification:**
- Tracking, validation docs, and graphify artifacts match the final implementation without expanding product scope.

---

## System-Wide Impact

- **Interaction graph:** Expense route and `ExpenseView` continue to inject `useExpenseRegisterViewModel` into the shared `POSRegisterView`; the shell contract remains unchanged.
- **Error propagation:** Product add failures continue through expense operations and existing toast/command handling; local search itself should not introduce new backend error paths.
- **State lifecycle risks:** Local catalog readiness must distinguish loading from no-results, and exact-add guards must prevent duplicate expense cart mutations.
- **API surface parity:** Existing POS catalog public queries become shared POS/expense register-read surfaces; no new public Convex mutation is required.
- **Integration coverage:** View-model tests should prove the local-index path, availability overlay, and expense write boundary together.
- **Unchanged invariants:** POS drawer/session gates remain POS-only, expense remains drawerless, and add-item commands remain the durable inventory authority.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Expense accidentally inherits POS-only workflow behavior | Implement at the expense view-model seam and assert `drawerGate: null` plus expense add operations in tests |
| Availability overlay is skipped, causing unavailable exact matches to auto-add | Mirror POS bounded availability behavior and test unavailable exact matches |
| Local exact auto-add duplicates mutations on rerender | Add an exact-add guard and a rerender test |
| Shared helper extraction grows into a broader refactor | Extract only mapping/search presentation helpers needed by both view-models |

---

## Documentation / Operational Notes

- Linear tickets should be separate but can land in one integration PR because the implementation units touch the same expense view-model and generated graph artifacts.
- No runtime migration is expected.
- The repo requires `bun run graphify:rebuild` after code changes.

---

## Sources & References

- Related plan: `docs/plans/2026-05-04-002-refactor-pos-register-catalog-search-plan.md`
- Related learning: `docs/solutions/logic-errors/athena-pos-register-local-catalog-search-2026-05-04.md`
- Related learning: `docs/solutions/performance/athena-pos-cart-latency-foundation-2026-05-05.md`
- Expense view-model: `packages/athena-webapp/src/lib/pos/presentation/expense/useExpenseRegisterViewModel.ts`
- POS view-model local-index pattern: `packages/athena-webapp/src/lib/pos/presentation/register/useRegisterViewModel.ts`
- Local index helper: `packages/athena-webapp/src/lib/pos/presentation/register/catalogSearch.ts`
