---
date: 2026-05-08
topic: opening-mvp-store-readiness-gate
---

# Opening MVP / Store Readiness Gate

## Summary

Define Athena's Opening MVP as a store readiness gate for the start of the operating day. Opening consumes the prior Daily Close status and carry-forward work, then answers whether the store can responsibly start trading today without recreating POS drawer opening or Cash Controls.

---

## Problem Frame

Daily Close now creates a durable store-day record: what was completed, what needed review, and what unresolved work carried forward. Without an Opening workflow, that close outcome can still be operationally passive. The next day's operator may start trading without seeing unresolved work, missed close state, or prior-day exceptions that should shape the morning decision.

Opening should not become another drawer-opening screen. Drawer opening, opening float entry, register session control, and closeout correction already belong to POS and Cash Controls. The missing product layer is store-level readiness: a calm operational checkpoint that uses the prior day's truth to decide whether today's trading can begin cleanly, with attention, or only after blocking work is handled.

---

## Assumptions

*This requirements doc was authored from the current conversation without a separate confirmation turn. The items below are agent inferences that should be reviewed before planning or execution treats them as final product policy.*

- Opening can complete in a ready-with-attention state when unresolved work is acknowledged and non-blocking.
- Missing or incomplete prior close should not silently pass; the exact blocker policy can be finalized during planning.
- The MVP should record an opening outcome, but the implementation shape of that record belongs in planning.

---

## Actors

- A1. Opening operator: Starts the store day and reviews whether trading can begin.
- A2. Owner or manager: Handles blocked readiness, accepts non-blocking risk where policy allows, and owns unresolved carry-forward work.
- A3. Staff member: May be assigned carry-forward work or responsible for resolving readiness items.
- A4. Athena: Reads prior Daily Close outcomes, classifies store readiness, and preserves the opening decision.

---

## Key Flows

- F1. Store readiness review
  - **Trigger:** An opening operator starts Opening for today's operating date.
  - **Actors:** A1, A4
  - **Steps:** Athena loads the most recent relevant Daily Close for the store, checks whether the prior store day was completed, surfaces any carry-forward work, and classifies today's readiness as ready, needs attention, or blocked.
  - **Outcome:** The operator can see whether the store can start trading today and why.
  - **Covered by:** R1, R2, R3, R4, R5

- F2. Carry-forward triage
  - **Trigger:** Prior Daily Close left unresolved work or open operational work items.
  - **Actors:** A1, A2, A3, A4
  - **Steps:** Athena lists carry-forward items with business context; the operator marks items as acknowledged, resolved, assigned, or left open according to policy; items remain traceable to the prior close.
  - **Outcome:** Prior-day work is no longer hidden, and today's opening decision records what was accepted.
  - **Covered by:** R6, R7, R8, R9

- F3. Opening completion
  - **Trigger:** Required readiness checks are complete or accepted.
  - **Actors:** A1, A2, A4
  - **Steps:** Athena records the opening outcome, including readiness status, reviewed carry-forward items, unresolved work, and actor attribution; the operator proceeds to existing POS or Cash Controls workflows when they need to open a drawer or start selling.
  - **Outcome:** The store day has an opening record that establishes operational readiness without replacing register-specific workflows.
  - **Covered by:** R10, R11, R12, R13

- F4. Blocked opening
  - **Trigger:** Athena finds a missing, incomplete, or blocked prior-close condition that makes today's readiness unreliable.
  - **Actors:** A1, A2, A4
  - **Steps:** Athena explains the blocking condition; the operator cannot mark the store as ready; a manager resolves the blocking issue, accepts it where policy allows, or leaves the store in a blocked readiness state.
  - **Outcome:** Athena does not imply the store is ready when prior-day operational truth is unresolved.
  - **Covered by:** R3, R4, R5, R14

---

## Requirements

**Lifecycle position**
- R1. Opening must be modeled as the start-of-day step in the same daily operations lifecycle as Daily Close.
- R2. Opening must operate at the store-day level, not at the drawer, terminal, or individual register session level.
- R3. Opening must consume the prior Daily Close outcome for the same store when determining today's readiness.

**Readiness classification**
- R4. Opening must classify readiness into at least three operator-facing states: ready, needs attention, and blocked.
- R5. Opening must distinguish hard blockers from non-blocking carry-forward work so unresolved work does not automatically stop trading unless policy says it should.
- R6. Opening must explain each readiness issue in operational language, including the state, why it matters, and the next action when known.

**Carry-forward handling**
- R7. Opening must surface open carry-forward work from prior Daily Close with enough context for an operator or manager to act.
- R8. Opening must allow carry-forward items to be acknowledged for today's opening without losing their unresolved status.
- R9. Opening must preserve traceability from today's opening decision back to the Daily Close or operational work item that created the carry-forward item.

**Opening completion**
- R10. Opening must record who completed or acknowledged the opening readiness gate and when.
- R11. Opening must preserve the final readiness outcome for the store day, including any unresolved carry-forward work accepted at opening.
- R12. Opening must make it clear when the store is ready to trade, ready with attention required, or not ready.

**Boundaries with POS and Cash Controls**
- R13. Opening must not duplicate POS drawer opening, opening float entry, register session start, closeout correction, or Cash Controls workflows.
- R14. When readiness depends on drawer or register state, Opening must point operators to the existing POS or Cash Controls action rather than reimplementing that action.
- R15. Opening must not create a second source of truth for cash state, drawer state, register closeouts, or payment totals.

---

## Acceptance Examples

- AE1. **Covers R3, R4, R12.** Given yesterday's Daily Close was completed with no carry-forward work, when the operator starts Opening today, Athena shows the store as ready to trade.
- AE2. **Covers R5, R7, R8, R9, R11.** Given yesterday's Daily Close created a non-blocking carry-forward item, when the operator starts Opening today and acknowledges it, Athena records the store as ready with attention required and keeps the item open.
- AE3. **Covers R3, R4, R14.** Given the prior store day has an incomplete Daily Close because a register session still needs closeout, when the operator starts Opening today, Athena shows Opening as blocked and directs the operator to the existing closeout path.
- AE4. **Covers R13, R15.** Given the store is ready but no drawer is open for the register, when the operator completes Opening, Athena does not collect an opening float; the operator still opens the drawer through POS or Cash Controls.
- AE5. **Covers R6, R10, R11.** Given a manager accepts a non-blocking readiness concern during Opening, when Opening is completed, Athena records the actor, timestamp, readiness outcome, and unresolved concern in the store-day opening record.
- AE6. **Covers R4, R5, R12.** Given prior Daily Close is missing for a date where Athena expects one, when the operator starts Opening, Athena does not silently mark the store ready; it shows a needs-attention or blocked state according to policy.

---

## Success Criteria

- Opening gives operators a clear answer to: "Can we responsibly start trading today?"
- Prior Daily Close outcomes and carry-forward work are visible at the start of the next store day.
- Owners and managers can tell which unresolved work was accepted at opening and who accepted it.
- POS drawer opening and Cash Controls remain the source of truth for register and cash-specific actions.
- Planning can proceed without inventing the relationship between Opening, Daily Close, carry-forward work, and drawer workflows.

---

## Scope Boundaries

- Opening MVP is not a drawer-opening workflow.
- Opening MVP does not collect opening float, correct opening float, open or close register sessions, reconcile drawers, or replace closeouts.
- Opening MVP does not introduce a new cash ledger or duplicate Cash Controls totals.
- Opening MVP does not attempt to build a full morning checklist for staffing, merchandising, inventory, cleaning, procurement, or scheduling.
- Opening MVP does not require all carry-forward work to be resolved before trading unless the item is classified as a hard blocker.
- Opening MVP does not provide analytics about store performance trends.
- Opening MVP does not define every future phase of the daily operations lifecycle beyond the handoff from prior close into today's readiness.

---

## Key Decisions

- Opening is a readiness gate: The core job is to answer whether the store can start trading responsibly, not to start every operational subsystem.
- Daily Close is the source of prior-day truth: Opening should consume close status and carry-forward work instead of recomputing the prior day from raw activity.
- Carry-forward work can be accepted without being resolved: The MVP should preserve unresolved work while allowing the store to trade when policy permits.
- Drawer workflows stay where they are: POS and Cash Controls remain responsible for drawer state, opening float, register sessions, and closeouts.
- Store-day scope is required: Opening should produce a store-level readiness outcome that can later support the broader daily operations lifecycle.

---

## Dependencies / Assumptions

- Daily Close persists completed store-day close records, readiness status, summary data, and carry-forward work items.
- Athena can identify the relevant prior Daily Close for a store and today's operating date.
- Carry-forward work items have enough context to show title, status, priority, assignment, and origin.
- The MVP can start with policy-defined readiness categories rather than a fully configurable rules engine.
- Manager acceptance may be required for some readiness issues, but the first planning pass must decide which issues need approval.
- Existing POS and Cash Controls workflows remain available for drawer-specific remediation.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R4, R5, R6][Product and technical] Which prior-close conditions are hard Opening blockers in the MVP versus needs-attention warnings?
- [Affects R6, R12][Product] What exact operator-facing labels should Athena use for the readiness states?
- [Affects R5, R10, R11][Product and technical] Which needs-attention items require manager acceptance before Opening can be completed?
- [Affects R3][Technical] How should Athena choose the relevant prior Daily Close when there are skipped days, holidays, or stores that do not trade every calendar day?
- [Affects R7, R9][Technical] What carry-forward metadata is already available versus what needs to be added for a useful opening handoff?
- [Affects R10, R11][Technical] Should Opening completion create a durable opening record immediately, or can it initially be represented as store-day lifecycle state?
- [Affects R14][Technical] Which existing POS or Cash Controls destinations should readiness issues link to for remediation?
