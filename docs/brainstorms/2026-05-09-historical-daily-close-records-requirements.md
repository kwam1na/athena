---
date: 2026-05-09
topic: historical-daily-close-records
---

# Historical Daily Close Records

## Summary

Add a read-only history surface where operators can find and review completed Daily Close reports after the store has moved on to a later operating day. V1 is limited to completed End-of-Day Reviews and preserves Daily Close as the source of the historical report.

---

## Problem Frame

Daily Close produces the business-readable end-of-day report for a store day: what happened, what was reviewed, what carried forward, and whether the day can be trusted. Today that report is only practically visible inside the End-of-Day Review workspace. Once a new day starts, the operator has no clear place to return to prior completed reports.

That makes the completed close feel transient even though it represents the store's historical operating record. Operators and owners need a way to retrieve prior completed reports without turning history into a recovery workspace for missed, blocked, or incomplete closes.

---

## Actors

- A1. Operator: Looks up prior completed End-of-Day Reviews during store operations.
- A2. Owner or manager: Reviews historical close reports for oversight, reconciliation, or investigation.
- A3. Athena: Presents completed Daily Close records as historical, read-only store-day reports.

---

## Key Flows

- F1. Browse completed close history
  - **Trigger:** An operator opens the Daily Close history surface from Operations.
  - **Actors:** A1, A3
  - **Steps:** Athena lists completed End-of-Day Reviews for the current store; the operator scans recent operating dates and close summary signals; incomplete, missed, blocked, or active close attempts are not presented as historical records.
  - **Outcome:** The operator can identify a completed store-day report to review.
  - **Covered by:** R1, R2, R3, R4, R5

- F2. Review a historical close report
  - **Trigger:** An operator selects a completed End-of-Day Review from history.
  - **Actors:** A1, A2, A3
  - **Steps:** Athena opens the preserved Daily Close report in a historical read-only mode; the operator reviews close metadata, totals, review items, carry-forward context, notes, attribution, and source evidence links where available.
  - **Outcome:** The operator or manager can understand the completed store-day record after the original close workflow is no longer active.
  - **Covered by:** R6, R7, R8, R9, R10

- F3. Navigate to source evidence
  - **Trigger:** A historical report includes links to source workflows or records.
  - **Actors:** A1, A2, A3
  - **Steps:** The operator follows a source link; Athena navigates to the workflow or record that owns the evidence; the history surface itself does not run commands or mutate the historical report.
  - **Outcome:** Historical review remains trustworthy while operational ownership stays with the source workflows.
  - **Covered by:** R11, R12, R13

---

## Requirements

**History list**
- R1. The history surface must list completed Daily Close records for the selected store.
- R2. Each listed record must be identifiable by operating date.
- R3. Each listed record must expose enough summary information for an operator to choose the right report without opening every record.
- R4. The history list must exclude incomplete, missed, blocked, active, draft, or recoverable store days in V1.
- R5. The history surface must clearly communicate when no completed Daily Close records are available.

**Historical report review**
- R6. The operator must be able to open a completed Daily Close record from history.
- R7. The historical detail view must present the completed End-of-Day Review as read-only.
- R8. The historical detail view must show close metadata, including operating date, completed time, and close actor when available.
- R9. The historical detail view must show the completed report content needed to understand the store-day outcome, including totals, reviewed exceptions, carry-forward context, notes, and attribution where available.
- R10. Historical report copy must make it clear that the operator is viewing a completed past End-of-Day Review, not the active close workflow.

**Workflow boundaries**
- R11. The history surface must not offer actions to start, resume, complete, acknowledge, recover, reopen, repair, edit, or correct a Daily Close.
- R12. Source links from a historical report may navigate to owning workflows or evidence records, but commands must remain owned by those workflows and not by the history surface.
- R13. The history surface must not recompute old reports from current live state in a way that changes the meaning of the completed report.
- R14. Missing prior close behavior and Opening Handoff acknowledgement remain outside this V1 history surface.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3.** Given a store completed End-of-Day Reviews for May 7 and May 8, when an operator opens Daily Close history on May 9, both completed records are available to scan by operating date and close summary.
- AE2. **Covers R4, R11, R14.** Given May 7 has store activity but no completed End-of-Day Review, when an operator opens Daily Close history, May 7 does not appear as a historical close record and the surface does not offer recovery.
- AE3. **Covers R6, R7, R8, R9, R10.** Given a completed End-of-Day Review exists for May 8, when the operator opens that historical record, Athena shows the completed report in read-only historical mode with close metadata and report content.
- AE4. **Covers R11, R12.** Given a historical report includes a source link to carry-forward work or close evidence, when the operator follows the link, Athena navigates to the owning workflow and does not mutate the historical report from the history surface.
- AE5. **Covers R5.** Given the store has no completed End-of-Day Reviews, when the operator opens Daily Close history, Athena shows an empty state that explains completed reviews will appear after store days are closed.
- AE6. **Covers R13.** Given a completed historical report is opened after related source records have changed, when the operator reviews the report, Athena preserves the completed report as the historical record rather than silently changing its meaning.

---

## Success Criteria

- Operators can retrieve completed End-of-Day Reviews after a newer operating day has started.
- Owners and managers can treat Athena as the accessible historical record for completed store days.
- The history surface does not create ambiguity between completed close records and missed-day or incomplete-close recovery work.
- Planning can proceed without inventing whether V1 includes incomplete days, recovery actions, or editable historical reports.

---

## Scope Boundaries

- V1 includes completed Daily Close records only.
- V1 does not show incomplete, missed, blocked, active, draft, or recoverable store days.
- V1 does not start, resume, complete, acknowledge, reopen, edit, repair, or correct Daily Close records.
- V1 does not implement recovery for missed prior closes surfaced by Opening Handoff.
- V1 does not add trend analytics, forecasting, reconciliation exports, or a generic audit-log explorer.
- V1 does not replace Daily Close, Daily Opening, Cash Controls, approvals, POS, or the operations queue as command-owning workflows.
- V1 may link to source evidence, but it does not own the linked workflow's actions.

---

## Key Decisions

- Completed records only: The first version solves report retrieval, not operating-day recovery.
- Read-only history: Historical review must not become a backdoor way to mutate Daily Close.
- Daily Close owns creation: The End-of-Day Review workflow remains the place where close reports are produced.
- History owns retrieval: The new surface makes completed reports accessible after the active close workspace has moved on.
- Opening behavior stays separate: Missing prior close acknowledgement belongs to Opening Handoff, not Daily Close history.

---

## Dependencies / Assumptions

- Daily Close creates durable completed records with enough report content to support historical review.
- The current store context is sufficient to scope which completed records an operator can view.
- Existing source workflow links, where present in a completed report, remain useful as navigation-only evidence.
- Permission rules for viewing completed Daily Close reports should align with the existing Operations and End-of-Day Review access model unless planning finds a reason to narrow them.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R1, R3][Product and technical] Should V1 show all completed records, a recent window, or paginated history from launch?
- [Affects R3][Product] Which summary fields belong on the history list versus only inside the detail report?
- [Affects R6, R7][Product] Should the historical detail view reuse the active Daily Close report layout exactly, or use a lighter historical presentation of the same content?
- [Affects R12][Technical] Which source links are already preserved in completed Daily Close records, and which should be deferred if unavailable?
