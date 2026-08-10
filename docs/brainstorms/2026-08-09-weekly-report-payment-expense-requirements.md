---
date: 2026-08-09
topic: weekly-report-payment-expense-evidence
---

# Weekly Report Payment and Expense Evidence

## Summary

Extend Athena's weekly report with value-first payment mix, two expense-product rankings, corrected close status, and cash-count variance across email and Reports. Preserve accepted-history integrity by freezing daily evidence, repair the Aug 3-9 Wigclub baseline for preview, and require explicit approval before any corrected email is sent.

---

## Problem Frame

Wigclub's first production weekly report described Aug 3-9 but showed zero scheduled days closed even though six Daily Closes existed, and it declared closing cash matched despite daily cash-count variances. The accepted weekly baseline had frozen schedule lineage from a fact-only fold that could not know close state, while the displayed variance represented sales-fold reconciliation rather than counted-versus-expected cash.

The report also summarizes payment accountability and total expenses without explaining how customers paid or which inventory products were consumed as expenses. Managers therefore cannot use the weekly report to understand tender concentration or the products driving operating consumption, and accepted history lacks the product-level evidence needed to render those answers immutably.

---

## Actors

- A1. Store manager or owner: Reviews the live and accepted weekly report, including the emailed summary, to understand the store's operating week.
- A2. Athena reporting system: Freezes Daily Close evidence, aggregates the reporting week, renders consistent surfaces, and prevents incomplete data from appearing complete.
- A3. Authorized operator: Repairs the already accepted Aug 3-9 baseline, reviews the corrected report, and controls whether a corrected email is sent.

---

## Key Flows

- F1. Live weekly review
  - **Trigger:** A manager opens the current week in Reports before weekly acceptance.
  - **Actors:** A1, A2
  - **Steps:** Athena aggregates only completed Daily Close evidence, renders payment mix and expense rankings for covered scheduled days, and labels exact coverage when the week is incomplete.
  - **Outcome:** The manager sees a useful week-to-date view without unclosed activity or missing days being treated as complete.
  - **Covered by:** R1, R2, R3, R6, R7, R8
- F2. Weekly acceptance and delivery
  - **Trigger:** The final scheduled Daily Close causes the reporting week to be accepted.
  - **Actors:** A1, A2
  - **Steps:** Athena freezes the resolved close lineage, cash variance, payment mix, and expense rankings into the accepted week, then renders the same evidence in Reports and the manager email.
  - **Outcome:** Accepted history and email agree and remain stable across later catalog or transaction changes.
  - **Covered by:** R1, R2, R3, R4, R5, R6, R9
- F3. Aug 3-9 correction preview
  - **Trigger:** The corrected reporting implementation is deployed to production.
  - **Actors:** A2, A3
  - **Steps:** Athena reconstructs and reconciles the retained evidence for the accepted Wigclub week, updates the accepted baseline through an auditable repair path, and renders both report surfaces without dispatching email.
  - **Outcome:** The corrected report can be reviewed and tweaked before the operator separately approves any resend.
  - **Covered by:** R10, R11, R12

---

## Requirements

**Close and variance correctness**

- R1. Weekly scheduled-day status must come from the resolved Daily Close lineage for the reported week, not from an adjacent week or a fact-only fold that lacks close state.
- R2. The weekly report must distinguish sales-fold close variance from counted-versus-expected cash variance and surface actual weekly cash-count variance with scheduled-day coverage.

**Payment mix**

- R3. Payment mix must aggregate the frozen payment-method totals from covered Daily Closes and rank every method by tender value.
- R4. Each payment method must show tender value, percentage of covered tender value, and tender-use count; the presentation must not describe tender uses as distinct sales.
- R5. Payment mix must use covered tender value as its denominator and remain distinct from weekly net sales, refunds, and later reporting adjustments.

**Expense products**

- R6. Each completed Daily Close must freeze the identity, quantity, and spend of inventory products consumed through completed expense reports.
- R7. The weekly report must show two expense-product rankings: the five highest-spend products with quantity, and the five most-consumed products with spend.
- R8. Each ranking must aggregate matching products across covered days by stable SKU identity, use deterministic tie-breaking, and summarize all products outside the top five as a remainder that preserves the covered total.

**Lifecycle, parity, and coverage**

- R9. The weekly email, accepted Reports history, and live week-to-date Reports view must render from the same weekly evidence contract; accepted rendering must not query mutable POS, expense, or catalog records.
- R10. When at least one scheduled day has usable evidence, the relevant section must show partial results with exact covered-versus-scheduled-day counts; when no day has usable evidence, it must show unavailable rather than zero.
- R11. The accepted Aug 3-9 Wigclub baseline must be repaired from retained production evidence, with product spend reconciled to the covered weekly expense total and the corrected email and Reports rendering made available for review.
- R12. Repairing or previewing the Aug 3-9 report must not dispatch an email. A corrected send requires separate, explicit operator approval.
- R13. Implementation must proceed test-first, address every issue surfaced by the Athena merge gate, pass multi-lens review unanimously, merge, and deploy the affected production surfaces.

---

## Acceptance Examples

- AE1. **Covers R1, R2.** Given six scheduled days with six completed Daily Closes and four non-zero daily cash variances, when the week is accepted, the report states six of six scheduled days closed and shows the net counted-cash variance with six-day coverage.
- AE2. **Covers R3, R4, R5.** Given a split-tender sale and additional single-tender sales, when payment mix is rendered, each method receives its allocated value and one tender use for its participation, percentages divide by total covered tender value, and the copy does not call those counts sales.
- AE3. **Covers R6, R7, R8.** Given the same SKU is consumed on multiple days, when the week is aggregated, its quantity and spend are combined before both rankings; each top-five list uses its own ordering and its remainder reconciles to the covered product total.
- AE4. **Covers R9, R10.** Given three of six scheduled days are closed, when the live weekly report is opened, payment mix and expense rankings use only those three closes and state three-of-six coverage without treating the remaining days as zero.
- AE5. **Covers R9, R10.** Given an accepted historical week whose Daily Closes contain no product-level expense evidence, when the report is rendered without repair evidence, the expense-product section is unavailable or explicitly partial rather than reconstructed from mutable live records.
- AE6. **Covers R11, R12.** Given the accepted Aug 3-9 Wigclub report, when the production repair is run, the corrected accepted page and exact email preview become reviewable and no delivery attempt is created until an operator explicitly approves the resend.

---

## Success Criteria

- Managers can tell how the week was paid, which consumed products drove expense spend and quantity, how many scheduled days support each figure, and whether cash counts varied.
- Weekly email, live Reports, and accepted history agree for the same accepted evidence and remain stable when source records or product names later change.
- The Aug 3-9 Wigclub report can be reviewed with corrected close, cash, payment, and expense evidence before any resend decision.
- An implementer can trace each behavioral requirement to a frozen evidence boundary, an explicit test scenario, and a production verification outcome without inventing product behavior.

---

## Scope Boundaries

- No week-over-week comparison for payment mix or expense-product rankings.
- No expense categories, vendor analysis, staff rankings, or report-level expense detail.
- No redesign of payment capture, split-tender allocation, expense entry, or inventory consumption workflows.
- No accepted-report rendering from mutable live POS, expense, or catalog data.
- No automatic resend of the corrected Aug 3-9 email.

---

## Key Decisions

- Payment mix is value-first because tender value answers where the week's money came from; tender-use count remains supporting evidence of method participation.
- Expense products receive separate spend and quantity rankings because the two measures answer different operating questions.
- Both rankings cap at five and include a remainder so the email stays scannable without losing reconciliation.
- Daily Close owns frozen expense-product evidence because weekly acceptance must aggregate what each close certified, not whatever mutable source records contain later.
- Live weekly sections use completed closes only and disclose coverage; unclosed activity is never blended into close-backed evidence.
- Existing Aug 3-9 evidence is repaired for review, while email delivery remains a separately authorized action.

---

## Dependencies / Assumptions

- Frozen Daily Close payment totals remain the canonical tender-method allocation, including split tender and cash net of change.
- Expense-line spend is the frozen per-unit expense cost multiplied by consumed quantity and must reconcile to the expense total for covered closes.
- Stable SKU identity is available for aggregation, while frozen display identity protects historical rendering from later catalog changes.
- Retained Aug 3-9 production expense transactions and items are sufficient to reconstruct the missing product evidence and verify reconciliation.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R10][Technical] Define the shared coverage contract so payment and expense sections distinguish complete, partial, and unavailable evidence consistently across live and accepted projections.
- [Affects R11, R12][Technical] Select the narrowest auditable production repair and preview path that updates the accepted baseline without entering the notification delivery path.
