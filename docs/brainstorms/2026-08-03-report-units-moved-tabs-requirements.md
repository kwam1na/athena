---
date: 2026-08-03
topic: report-units-moved-tabs
---

# Report Units Moved Tabs

## Summary

The Units moved sheet will become a two-tab analysis surface: a concise view of the period's top movers and a complete paginated view of every SKU that moved.

---

## Problem Frame

The granular Units moved sheet works for short periods but rejects a valid trailing-30-day range when more than 100 SKUs moved. That failure prevents an administrator from answering the common overview question—what changed most—while also blocking access to the individual SKU evidence already available for smaller ranges.

The sheet currently treats a quick visual summary and exhaustive browsing as one workload. Large ranges expose the tension: rendering every SKU as one chart is not useful, but silently omitting SKUs would undermine reporting trust.

---

## Actors

- A1. Full administrator: Reviews item movement for the active report period and drills into material or unusual SKUs.
- A2. Athena Reports: Ranks movement truthfully, preserves signed values, bounds large result sets, and keeps navigation context intact.

---

## Key Flows

- F1. Review top movers
  - **Trigger:** A1 opens Units moved from a report period.
  - **Actors:** A1, A2
  - **Steps:** A2 opens the sheet on Top movers, ranks the period's SKUs by absolute net movement, and presents the first 20 while preserving each signed value. A1 can open any SKU for detail.
  - **Outcome:** A1 quickly identifies the SKUs with the greatest inventory movement without scanning the full catalog.
  - **Covered by:** R1, R3, R4, R5, R9
- F2. Browse granular movement
  - **Trigger:** A1 switches from Top movers to the granular tab.
  - **Actors:** A1, A2
  - **Steps:** A2 presents individual SKU rows in bounded pages of 20. A1 pages through the full period result and may open a SKU for detail.
  - **Outcome:** Every moving SKU remains inspectable without loading the entire result into the browser at once.
  - **Covered by:** R2, R6, R7, R8, R9
- F3. Return to analysis context
  - **Trigger:** A1 returns from a SKU drill-down.
  - **Actors:** A1, A2
  - **Steps:** A2 reopens the Units moved sheet with the same report period, selected tab, and granular page.
  - **Outcome:** A1 continues the investigation without reconstructing prior navigation state.
  - **Covered by:** R10, R11

---

## Requirements

**Sheet structure**

- R1. The Units moved sheet must provide a Top movers tab and a granular tab for the same active date range or selected operating day.
- R2. Top movers must be the default tab when no prior sheet state exists.
- R3. Top movers must show at most 20 individual SKUs.
- R4. Top movers must rank SKUs by the absolute value of net units moved.
- R5. Top movers must preserve the signed net movement so net outbound and net returned movement remain distinguishable rather than being treated as the same direction.

**Granular browsing**

- R6. The granular tab must make every SKU with movement in the selected period available through pagination, including a SKU whose sold and returned units cancel to zero net movement.
- R7. Each granular page must contain at most 20 individual SKU rows.
- R8. The granular view must default to the same absolute-net-movement ordering as Top movers so switching tabs does not change the meaning of rank.
- R9. Every visible SKU in either tab must retain its existing route to period-scoped SKU detail.

**Continuity and trust**

- R10. The sheet's open state, selected tab, and granular page must be restorable from navigation state.
- R11. Returning from SKU detail must restore the originating report period and sheet context.
- R12. A valid report period must not fail solely because more than 100 distinct SKUs moved.
- R13. The interface must disclose the total number of moving SKUs and whether Top movers is showing only a subset.
- R14. Once a date range accepted by the current Units moved surfaces is admitted for processing, SKU count, batch size, and queue execution capacity must remain bounded resumable work rather than terminal unavailable reasons. Unexpected defects may require a new attempt but must never publish a partial result.

---

## Acceptance Examples

- AE1. **Covers R1–R5, R13.** Given a trailing-30-day period with 146 moving SKUs, when the administrator opens Units moved, Top movers opens with 20 SKUs ranked by absolute net movement and states that the period contains 146 moving SKUs.
- AE2. **Covers R4, R5.** Given one SKU at +18 net units and another at −24 net units, Top movers ranks the −24 SKU ahead of the +18 SKU while displaying their opposite directions.
- AE3. **Covers R6–R8, R12.** Given 146 moving SKUs, when the administrator opens the granular tab, the first 20 ordered rows appear and the remaining rows are reachable through bounded pagination without a range-size error caused by the SKU count.
- AE4. **Covers R9–R11.** Given the administrator is on granular page 4 and opens a SKU, when they return to Reports, the sheet reopens on the granular tab at page 4 for the same period.
- AE5. **Covers R12, R14.** Given a valid selected period exceeds the capacity of one backend read, when either tab requests movement data, Athena completes the work across bounded resumable batches and eventually presents the complete result without a SKU-count or read-budget failure.

---

## Success Criteria

- Administrators can identify the 20 most significant net movers for a trailing-30-day period without encountering the current 100-SKU error.
- Administrators can reach every moving SKU through pagination and retain their analysis context across drill-down navigation.
- Every date range already accepted by Reports can produce complete Units moved data without a capacity-based unavailable state.
- Planning can implement the behavior without inventing ranking semantics, page size, tab defaults, disclosure rules, or navigation continuity.

---

## Scope Boundaries

- Do not combine remaining SKUs into an Other segment; positive and negative net movement could cancel misleadingly.
- Do not load every moving SKU into the browser at once.
- Do not add search, advanced filters, or alternate sort controls inside the sheet in this iteration.
- Do not replace the existing Items workspace as Athena's richer item-analysis surface.

---

## Key Decisions

- Separate overview from exhaustive browsing: tabs let each mode optimize for its own operator task without sacrificing access to detail.
- Rank by absolute net movement: large returns are operationally significant even though their signed value is negative.
- Preserve signed presentation: ranking magnitude must not erase movement direction.
- Paginate the granular view: completeness remains available without an unbounded browser payload or an arbitrary all-or-nothing SKU cap.
- Materialize large range results through bounded resumable backend work: backend limits may make the result temporarily pending, but they must not turn a valid period into an unavailable result.
- Persist tab and page context: drill-down navigation should not make the administrator reconstruct their place.

---

## Dependencies / Assumptions

- The existing report period selection remains authoritative for both tabs.
- Existing SKU detail routes continue to accept the selected day or date range as investigation context.
- The reporting layer can determine the complete count and stable ordering of moving SKUs while serving bounded granular pages.
