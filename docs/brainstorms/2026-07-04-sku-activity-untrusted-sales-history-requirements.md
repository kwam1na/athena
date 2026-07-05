---
date: 2026-07-04
topic: sku-activity-untrusted-sales-history
---

# SKU Activity Untrusted Sales History

## Summary

SKU Activity will become the operator's evidence workspace for untrusted SKU sales. It will proactively surface legacy import provisional SKUs and pending checkout items with completed sales, show the full transaction history behind each item, and route operators toward the appropriate trust or review workflow without converting sale evidence into trusted inventory by itself.

---

## Problem Frame

Operators currently have to know which SKU to inspect before SKU Activity can help them. That works for one-off support, but it misses the operational moment that prompted this work: untrusted products are already circulating through completed sales, and operators need a way to see that circulation before they know exactly what to search for.

Legacy import provisional SKUs and POS pending checkout items are both real sale evidence before they are trusted catalog inventory. The operator needs visibility into every completed sale connected to those untrusted items so they can judge urgency, reconcile context, and move through the existing review or trust path with confidence.

---

## Actors

- A1. Store operator: Reviews untrusted SKU activity and decides which product needs trust or catalog review next.
- A2. Manager or admin reviewer: Completes the appropriate trust, finalization, or pending checkout review workflow.
- A3. POS cashier: Creates completed-sale evidence by selling provisional or pending checkout items during normal checkout.

---

## Key Flows

- F1. Untrusted sales triage
  - **Trigger:** The operator opens SKU Activity without a specific SKU selected.
  - **Actors:** A1
  - **Steps:** The workspace lists untrusted SKU sources with completed sales, shows enough summary context to compare circulation, lets the operator filter by source type, and lets the operator open one item for transaction evidence.
  - **Outcome:** The operator can identify which untrusted products are actively circulating and choose a next review target.
  - **Covered by:** R1, R2, R3, R6

- F2. Transaction evidence review
  - **Trigger:** The operator opens an untrusted item from the proactive list.
  - **Actors:** A1
  - **Steps:** The workspace shows every completed sale tied to the selected untrusted item, including sale identity, timing, quantity, source context, and safe operator/customer context when available.
  - **Outcome:** The operator understands the sales history behind the untrusted item without relying only on aggregate counters.
  - **Covered by:** R4, R5, R7

- F3. Review handoff
  - **Trigger:** The operator decides an untrusted item should be trusted, finalized, linked, or otherwise reviewed.
  - **Actors:** A1, A2
  - **Steps:** The workspace preserves the item source type, shows the correct next action, and routes to the existing source-owned review or trust workflow.
  - **Outcome:** The operator leaves SKU Activity with the right context and without SKU Activity directly mutating trusted stock.
  - **Covered by:** R8, R9, R10

---

## Requirements

**Proactive untrusted activity**
- R1. SKU Activity must provide a default proactive view when no SKU is selected, focused on untrusted SKU sources that have completed sales.
- R2. The proactive view must include both legacy import provisional SKUs and POS pending checkout items.
- R3. The proactive view must make circulation scannable with source type, product/SKU identity, total sold quantity, completed sale count, last sold time, and current review or trust state.
- R4. Operators must be able to filter or narrow the proactive view by untrusted source type.

**Transaction evidence**
- R5. Each listed untrusted item must expose full completed-sale transaction history associated with that item, not only aggregate sale evidence.
- R6. Transaction history must show operator-useful evidence such as sale identity, sale time, quantity sold, register or session context when available, and safe customer or staff context when available.
- R7. Transaction history must distinguish completed-sale evidence from active holds, open carts, reservations, or unresolved draft activity.

**Review and trust handoff**
- R8. Legacy import provisional SKUs and pending checkout items must remain visibly distinct because their trust and review paths are different.
- R9. SKU Activity must route each untrusted source toward the existing appropriate review, linking, or trusted-inventory workflow rather than introducing a new direct stock mutation path.
- R10. The workspace must preserve the current manual SKU lookup and SKU activity timeline behavior for arbitrary SKU inspection.

**Trust boundary and copy**
- R11. The feature must not automatically convert provisional or pending checkout sale evidence into trusted inventory movement.
- R12. Operator-facing language must be calm, clear, restrained, and operational, using plain source labels and next-action copy rather than raw backend enum language.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3.** Given active legacy import and pending checkout items with completed sales, when an operator opens SKU Activity with no SKU selected, then both source types appear in a proactive untrusted-sales view with circulation summaries.
- AE2. **Covers R4, R8.** Given the proactive view includes both source types, when the operator filters to pending checkout, then legacy import rows are hidden and pending checkout rows keep pending-checkout-specific labels and next actions.
- AE3. **Covers R5, R6, R7.** Given an untrusted item has multiple completed sales and one active reservation, when the operator opens its history, then completed sales are shown in the transaction history and the active reservation is not counted as a completed transaction.
- AE4. **Covers R9, R11.** Given an operator opens the next action for a legacy import provisional SKU, when they proceed from SKU Activity, then they are routed to the existing trusted-inventory review path and SKU Activity does not directly mutate trusted stock.
- AE5. **Covers R10.** Given the operator searches a normal trusted SKU, when the search completes, then the existing SKU activity inspector behavior remains available.

---

## Success Criteria

- Operators can discover untrusted products with completed sales without already knowing the SKU.
- Operators can inspect the complete completed-sale history behind a provisional or pending checkout item before deciding what to review.
- Planning and implementation preserve the trust boundary between sale evidence, review workflows, and trusted inventory movement.
- Downstream implementers can distinguish proactive untrusted-sales work from general sales analytics or stock adjustment work.

---

## Scope Boundaries

- This does not introduce one-click trust finalization from the transaction-history list.
- This does not automatically convert historical provisional or pending checkout sales into trusted inventory movements.
- This does not replace existing product edit, inventory import, or pending checkout review workflows.
- This does not build broad sales analytics, forecasting, or product performance reporting.
- This does not require changing cashier checkout behavior.

---

## Key Decisions

- Unified untrusted-sales evidence view: Legacy import provisional SKUs and pending checkout items belong in one SKU Activity workspace because the operator question is the same: which untrusted products are circulating?
- Source-specific rows and actions: The two sources must remain visually and behaviorally distinct so the workspace does not imply a single trust path.
- Full history over summary-only evidence: Aggregate sale counters are useful for triage, but the confirmed scope requires every completed transaction behind the untrusted item to be inspectable.
- Review handoff over mutation: SKU Activity should make the right work visible and route operators to existing ownership boundaries rather than becoming a stock-authority surface.

---

## Dependencies / Assumptions

- Completed-sale evidence for both source types exists, but planning must verify the right durable read path for full transaction history.
- The existing SKU Activity route remains the destination for this workspace rather than creating a new top-level Operations route.
- Existing trust, finalization, and pending checkout review workflows remain the authority for changing catalog trust state.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R5, R6][Technical] What is the safest durable read path for full completed-sale history across both legacy import provisional SKUs and pending checkout items?
- [Affects R9][Technical] Which exact destination should each source's review action use when there are multiple possible existing review paths?
