---
date: 2026-05-08
topic: daily-operations-overview
---

# Daily Operations Overview

## Summary

Define Athena's Daily Operations Overview as the store-day command center for operators. The overview should show the current operating state, the highest-priority next action, unresolved attention items, domain lane health, and a business-readable store-day timeline without replacing the workflows that own those actions.

---

## Problem Frame

Athena now has strong pieces of the store-day lifecycle: Daily Opening establishes whether the store can start trading, Daily Close determines whether the day can be trusted and completed, and operational work, approvals, cash controls, POS, stock, services, and orders each expose their own workflow surfaces. The problem is that operators still have to assemble the active-day picture by visiting separate areas.

That fragmentation creates a practical gap during store operations. A manager may know a day has been opened, but still not know whether the current blockers are in Cash Controls, POS, approvals, stock work, or open carry-forward items. An end-of-day operator may know Daily Close exists, but still need one place that says whether close is ready, blocked, or merely needs review. The overview needs to collapse that orientation cost without becoming a second implementation of each workflow.

---

## Actors

- A1. Store operator: Starts the store day, monitors active work, and prepares the store for close.
- A2. Store manager or lead: Handles exceptions, approvals, blocked readiness, and operational escalation.
- A3. Domain owner: Resolves work in the owning workflow, such as POS, Cash Controls, Services, Stock, Procurement, Orders, Open Work, or Approvals.
- A4. Owner or back-office reviewer: Reviews completed or past store-day posture without being the primary active-day user.
- A5. Athena: Composes store-day state, ranks attention, explains blockers, and routes operators to owning workflows.

---

## Key Flows

- F1. Store-day orientation
  - **Trigger:** An operator opens the Operations area for the current store.
  - **Actors:** A1, A5
  - **Steps:** Athena determines the selected store day, reads the persisted Opening and Close posture, composes active-day signals, assigns one store-day state, and shows the primary next action.
  - **Outcome:** The operator can tell whether the store has not opened, is operating, needs attention, is ready to close, is blocked for close, or is already closed.
  - **Covered by:** R1, R2, R3, R4, R5

- F2. Attention triage
  - **Trigger:** One or more unresolved items exist across source workflows.
  - **Actors:** A1, A2, A3, A5
  - **Steps:** Athena aggregates blockers, review items, carry-forward work, and notable exceptions into an urgency-ranked attention queue; each item preserves source owner, status, severity, and resolution path; the operator follows the owning workflow to resolve it.
  - **Outcome:** Attention is prioritized by operational impact rather than hidden inside separate navigation sections.
  - **Covered by:** R6, R7, R8, R9, R10

- F3. Domain lane review
  - **Trigger:** The operator wants to understand what each operating area needs today.
  - **Actors:** A1, A2, A5
  - **Steps:** The overview shows compact lanes for the relevant store domains, including readiness signal, counts, short explanation, and owning workspace link; healthy or not-applicable lanes remain explicit enough to avoid false alarms.
  - **Outcome:** The operator can scan operational posture without entering each workflow.
  - **Covered by:** R11, R12, R13, R14

- F4. Close readiness handoff
  - **Trigger:** The store approaches end of day or the operator wants to know whether close can start.
  - **Actors:** A1, A2, A5
  - **Steps:** Athena surfaces close readiness from the store-day facts and Daily Close posture; if close is blocked, the overview explains the blocker and routes to the owner; if ready, Daily Close becomes the primary next action.
  - **Outcome:** The operator knows whether to resolve blockers, review remaining items, or move into Daily Close.
  - **Covered by:** R2, R4, R7, R15, R16

- F5. Store-day review
  - **Trigger:** A manager or owner reviews a closed or prior store day.
  - **Actors:** A2, A4, A5
  - **Steps:** The overview presents the persisted lifecycle state, summary posture, carry-forward items, and business-readable timeline for the selected operating date.
  - **Outcome:** Past-day review is possible without implying live urgency or mutating closed workflow state.
  - **Covered by:** R17, R18, R19

---

## Requirements

**Store-day posture**
- R1. The overview must present one clear store-day state for the selected store and operating date.
- R2. The state model must distinguish at least: not opened, opening in progress or blocked, operating, attention needed, ready to close, close blocked, and closed.
- R3. The overview must use the same store-local operating date or range as Daily Opening and Daily Close, so prior-day handoff, active-day signals, and close readiness do not mix calendar-day and operating-day boundaries.
- R4. The overview must derive lifecycle posture from persisted Daily Opening and Daily Close state where those records exist, rather than independently relabeling those lifecycle decisions.
- R5. The overview must show one primary next action based on the current store-day state.

**Attention and severity**
- R6. The overview must aggregate unresolved items from source domains into a single attention queue ranked by operational severity.
- R7. Attention items must distinguish blocking, needs-attention, carry-forward, and informational conditions.
- R8. Every blocker must identify its source domain, why it matters, and the resolution path in operator-facing language.
- R9. The attention queue must preserve source ownership and must not create a parallel approval queue, open-work status model, or subsystem task state.
- R10. Empty attention states must be explicit and useful, so operators can tell the difference between healthy state, not-applicable domains, and unloaded data.

**Domain lanes**
- R11. The overview must include compact domain lanes for the operating areas that affect store-day posture.
- R12. Initial lanes should cover Cash Controls, POS, Approvals, Open Work, Stock or Procurement, Services, Orders, and Operational Events when those domains are available for the store.
- R13. Each lane must show a readiness signal, relevant count or summary, short explanation, and route to the owning workspace.
- R14. A lane may be healthy, warning, critical, informational, or not applicable independently of the overall store-day state.

**Opening and close relationship**
- R15. The overview must show current Daily Opening and Daily Close state without replacing those dedicated flows.
- R16. Daily Opening acknowledgement and Daily Close completion must remain in their dedicated workflows.
- R17. When close readiness is blocked, the overview must avoid presenting Close as the primary action and instead explain what must be resolved first.
- R18. When close readiness is clear, the overview must make Daily Close the primary next action while still showing relevant informational context.

**Timeline and history**
- R19. The overview must include a store-day timeline assembled from lifecycle records and operational events.
- R20. Timeline entries must be business-readable and must not expose raw backend wording as operator copy.
- R21. The timeline must not become a second source of truth for domain history; it narrates events owned by source domains.
- R22. Closed and past store days must render as reviewable summaries, not as live urgent workspaces.

**Workflow boundaries**
- R23. The overview may surface status, next actions, and navigation targets for subsystem work, but must not execute POS, Cash Controls, Services, Procurement, Orders, Stock, Open Work, or Approval domain mutations.
- R24. Next actions are routing and prioritization prompts, except for navigation into overview-owned lifecycle entry points such as Daily Opening and Daily Close.
- R25. Domain lanes must remain read-oriented unless a source domain later exposes an explicitly approved overview-safe action.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R5, R15.** Given the store has no completed Daily Opening for the selected operating date, when the operator opens the overview, Athena shows the store as not opened or opening blocked and makes Daily Opening the primary next action.
- AE2. **Covers R3, R4, R19.** Given events occur across multiple domains during one store-local operating date, when the overview renders the timeline, it includes events inside that operating range and excludes events outside that range.
- AE3. **Covers R6, R7, R8, R9.** Given a pending approval and an open work item both exist, when the overview renders the attention queue, each item shows severity, source owner, status, and owning workspace link without becoming a new approval or open-work queue.
- AE4. **Covers R11, R12, R13, R14.** Given the store has no service appointments today but does have open POS sessions and pending stock work, when the overview renders lanes, Services is calm or not applicable, while POS and Stock explain their active conditions.
- AE5. **Covers R16, R17, R23.** Given a register session is still open near the end of day, when the overview evaluates close readiness, it shows close blocked, links to Cash Controls, and does not create or close a register session inline.
- AE6. **Covers R5, R18.** Given Daily Opening is complete and Daily Close has no blockers, when the operator opens the overview late in the day, Daily Close becomes the primary next action.
- AE7. **Covers R10.** Given no activity exists for the operating date, when the overview loads successfully, it explicitly presents a zero-activity or calm day state rather than implying data failed to load.
- AE8. **Covers R20, R21.** Given POS, approval, and stock events happened today, when the store-day timeline renders, it summarizes those events in operator-facing language and preserves source-domain ownership.
- AE9. **Covers R22.** Given Daily Close is completed for a prior operating date, when a manager reviews that date, the overview shows a read-only completed summary and carry-forward context without live urgency or inline subsystem actions.

---

## Success Criteria

- Operators can answer "where is the store day right now?" within one scan of the Operations overview.
- Managers can see the highest-priority unresolved work without visiting every subsystem first.
- Daily Opening and Daily Close feel like lifecycle steps inside a larger daily operations system rather than disconnected pages.
- Source workflows remain authoritative; the overview improves orientation and routing without creating duplicate task, approval, drawer, POS, stock, service, or order state.
- Planning can proceed without inventing the product relationship between store-day state, next action, attention queue, domain lanes, and timeline.

---

## Scope Boundaries

- The overview is not a replacement for Daily Opening or Daily Close.
- The overview does not open drawers, start or close register sessions, void POS sessions, complete approvals, receive stock, complete service work, fulfill orders, or mutate source workflow state.
- The overview does not create a second approval queue, open-work queue, workflow trace system, or operational event log.
- The overview is not a generic analytics dashboard; trend analysis, forecasting, executive reporting, and cross-store performance comparison are outside this scope.
- The overview does not define every future store-day rule. It should start with the policies already proven by Daily Opening, Daily Close, and existing source workflows.
- Reopening or correcting a closed day is outside the first overview scope unless it is presented only as a routed follow-up to a dedicated correction workflow.

---

## Key Decisions

- The overview is the parent orientation surface: It shows the store-day state and next responsible action, while Daily Opening and Daily Close remain the lifecycle actions.
- Severity is cross-domain, ownership is not: The overview may rank items together, but resolution remains with the source workflow.
- Store-day state is more specific than red/yellow/green: Operators need lifecycle language such as not opened, operating, close blocked, or closed.
- Domain lanes are scan surfaces, not mini workspaces: They show posture, counts, and navigation rather than recreating subsystem tools.
- The timeline is narrative, not authority: It helps operators understand what happened today, but source domains remain the record owners.
- Closed days are review surfaces: Once Daily Close is completed, the overview should not behave like a live command center for that date.

---

## Dependencies / Assumptions

- Daily Opening and Daily Close provide reliable store-day lifecycle posture for the selected operating date.
- Operational events are available or can be composed into a business-readable timeline without becoming a new event source.
- Source domains can provide enough summary signal for lanes, even if some lanes start as limited or not applicable.
- Store-day operating date and range behavior follows the same boundary contract already used by Daily Opening and Daily Close.
- The first version can prioritize Cash Controls, POS, Approvals, Open Work, and existing close/opening signals, then add richer Services, Orders, Stock, and Procurement signals as those domain policies mature.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R2, R5][Product and technical] What exact precedence rules choose the single store-day state when multiple lifecycle and domain conditions are present?
- [Affects R6, R7, R8][Product and technical] Which source-domain conditions are blocking versus needs-attention in the first overview slice?
- [Affects R11, R12, R13][Product and technical] Which domain lanes have enough existing signal for v1, and which should render as limited or not applicable until their source policies mature?
- [Affects R19, R20, R21][Technical] Which operational events and lifecycle records should feed the first store-day timeline?
- [Affects R3][Technical] How should the overview handle skipped trading days, holidays, or stores that do not operate every calendar day?
