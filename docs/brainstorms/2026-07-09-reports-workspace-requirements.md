---
date: 2026-07-09
topic: reports-workspace
---

# Reports Workspace

## Summary

Athena should add a store-scoped Reports workspace for full administrators. The workspace should provide a balanced, week-to-date view of business performance across POS products, POS services, storefront orders, and service cases, with SKU-first inventory and item analysis beneath the business totals.

Reports should explain what changed, disclose when data is incomplete, and route the administrator to the existing Athena workflow that owns corrective action. It should not become another work queue, a general ledger, or an accounting system.

---

## Problem Frame

Athena already records meaningful business and operational facts, but they are distributed across Store Pulse, Daily Operations, Cash Controls, Procurement, SKU Activity, Transactions, Services, online orders, and storefront analytics. A full administrator can inspect those workspaces individually, but Athena does not yet provide one coherent view of how money, item movement, inventory position, and operational exceptions relate over time.

The current Analytics route is narrower than its name suggests. It communicates storefront engagement such as known shoppers, product views, active checkouts, and recent activity. Store Pulse and Daily Operations carry stronger sales and operational reporting, while Procurement and SKU Activity carry inventory pressure and evidence. Reports must compose those existing truths through a canonical reporting contract rather than treating storefront analytics as the financial source of truth.

The product must also avoid presenting false precision. SKU cost is optional today, POS and storefront sale lines do not preserve an immutable cost basis, receiving does not calculate moving weighted-average cost, ordinary trusted SKU sale history lacks the dedicated lookup path already available for provisional SKU evidence, and inventory movement history is not yet complete enough for every historical valuation claim. These are requirements-level foundations, not details that planning may silently omit.

---

## Current Athena Grounding

| Capability                 | Current Athena support                                                                                                                                                                                           | Reports implication                                                                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Storefront engagement      | `packages/athena-webapp/src/components/analytics/AnalyticsView.tsx` shows shoppers, product views, active checkouts, recent activity, and product/customer detail.                                               | Preserve as a secondary Storefront view inside Reports; do not use it as the financial source of truth.                                                      |
| POS pulse                  | `packages/athena-webapp/convex/pos/application/queries/storePulse.ts` calculates completed POS sales, transaction count, average transaction, units sold, payment mix, trends, and top items.                    | Reuse the established operator-facing pulse concepts inside a broader cross-channel contract.                                                                |
| Daily financial operations | `packages/athena-webapp/convex/operations/dailyOperations.ts` composes POS sales, applied adjustments, refunds, inventory expense totals, payment totals, cash movement, and register variance.                  | Reuse close-aware operational evidence and source completeness instead of recomputing unrelated totals with different semantics.                             |
| Current inventory          | `productSku` stores on-hand inventory, sellable availability, price, and optional unit cost.                                                                                                                     | Current units and partial current valuation are available; cost coverage must remain explicit.                                                               |
| SKU evidence               | SKU Activity records inventory and reservation activity. Provisional and pending-checkout evidence includes completed transaction history.                                                                       | Extend equivalent transaction-backed evidence to trusted SKUs while leaving complete non-sale history in SKU Activity.                                       |
| Procurement                | Purchase orders and receiving preserve ordered quantity, received quantity, unit cost, value, vendor, expected date, and lifecycle state. Current replenishment uses fixed stock thresholds and PO-cover states. | Reports can show commitments and incoming cover now; velocity-based cover requires the reporting sales foundation.                                           |
| Inventory movements        | Inventory movements preserve quantity delta, source, SKU, actor, and related operational references for many flows.                                                                                              | Complete all stock-changing paths and add reporting-grade time and cost evidence before claiming historical inventory value or full movement reconciliation. |
| Online commerce            | Online orders preserve amounts, items, completion state, discounts, refund timestamps, and restock disposition.                                                                                                  | Normalize completed revenue and refund events into the unified reporting contract.                                                                           |
| Services                   | Service cases preserve total amount, payment status, allocations, assigned staff, service lines, and consumed inventory.                                                                                         | Include service revenue, but do not claim service profit until service-delivery cost exists.                                                                 |
| Data integrity             | Daily Close preserves source completeness; POS runtime and terminal state expose delayed or uncertain synchronization.                                                                                           | Every report must expose freshness, completeness, and omitted-value reasons.                                                                                 |
| Expense data               | Expense transactions represent inventory items consumed at recorded item cost.                                                                                                                                   | Label this as inventory expense or inventory consumed, not general operating expense.                                                                        |

---

## Actors

- A1. Full administrator: Reviews store performance, understands changes, investigates item and money movement, and follows attention signals into the owning workflow.
- A2. Athena: Normalizes cross-channel business facts, computes reports, discloses completeness, and preserves links to source evidence.
- A3. Operational workflow: Procurement, Cash Controls, Transactions, Product editing, SKU Activity, Daily Operations, or Terminal health owns any corrective action reached from Reports.

---

## Key Flows

- F1. Review the balanced store pulse
  - **Trigger:** A full administrator opens Reports for the active store.
  - **Actors:** A1, A2
  - **Steps:** Athena loads the current week through the current elapsed time, compares it with the same elapsed portion of the prior week, and shows unified net sales, merchandise gross profit with coverage, units sold, current inventory value with coverage, and prioritized attention signals.
  - **Outcome:** The administrator understands current business direction without reconstructing it across operational workspaces.
  - **Covered by:** R1-R12, R42-R46

- F2. Investigate SKU performance
  - **Trigger:** A SKU contributes materially to sales, margin, stock risk, or an attention signal.
  - **Actors:** A1, A2
  - **Steps:** The administrator opens the SKU detail, reviews sales, returns, cost, profit, stock, velocity, cover, and comparison metrics, then inspects every attached transaction in the selected period.
  - **Outcome:** Aggregate performance remains connected to source transactions and full SKU activity evidence.
  - **Covered by:** R13-R22, R39-R41

- F3. Understand inventory movement and capital exposure
  - **Trigger:** The administrator opens Inventory or follows an inventory attention signal.
  - **Actors:** A1, A2
  - **Steps:** Athena shows current stock and value, receipts, sales, returns, inventory consumed, adjustments, purchase commitments, and incoming cover while disclosing any movement or cost gaps.
  - **Outcome:** The administrator can distinguish healthy movement, stockout risk, and capital tied up in slow inventory.
  - **Covered by:** R23-R30, R42-R46

- F4. Follow an attention signal
  - **Trigger:** Athena identifies a deterministic integrity, money, inventory, or operational exception.
  - **Actors:** A1, A2, A3
  - **Steps:** Reports explains the affected amount or units, the rule that raised the signal, relevant completeness context, and one clear destination in the workflow that owns resolution.
  - **Outcome:** Reports shortens investigation without duplicating operational mutation behavior.
  - **Covered by:** R31-R38

- F5. Reconcile a refund across operational and item views
  - **Trigger:** A refund or return occurs in a different period from the original sale.
  - **Actors:** A1, A2
  - **Steps:** Athena recognizes the financial refund when it occurs, attributes adjusted SKU performance to the original sale, distinguishes money returned from inventory restored, and preserves links between both events and the original transaction.
  - **Outcome:** Weekly money movement stays stable and reconcilable while item performance reflects the sale's final outcome.
  - **Covered by:** R47-R52

---

## Requirements

### Workspace and Access

- R1. Reports must be scoped to the currently selected store.
- R2. Reports must require full-admin access at both the route and backend read boundaries.
- R3. Manager elevation and `pos_only` access must not expose Reports totals, costs, margins, inventory valuation, or drill-down evidence.
- R4. The default reporting window must be week to date in the store's operating timezone.
- R5. The default comparison must use the same elapsed portion of the prior week, not the full prior week.
- R6. Reports must also support today, prior week, trailing 30 days, and a custom date range.
- R7. Reports must show the selected period, comparison period, refresh time, and whether the current period contains partial operating days.
- R8. The overview must present a balanced pulse rather than privileging financial or inventory reporting alone.
- R9. The overview must lead with unified net sales, merchandise gross profit, units sold, current inventory value, and active attention signals.
- R10. Existing storefront engagement analytics must become a secondary Storefront view inside Reports.
- R11. Reports must use shared Athena workspace metric and drill-down presentation patterns rather than introducing a disconnected dashboard language.
- R12. All displayed amounts must use the active store's currency and stored minor-unit formatting conventions.

### Unified Revenue and Profitability

- R13. Unified revenue must include completed POS product sales, POS service sales, completed storefront orders, and recognized service-case revenue.
- R14. Revenue normalization must prevent the same service or order payment from being counted through more than one source record.
- R15. Reports must distinguish product, service, POS, and storefront contributions beneath the unified total.
- R16. Gross sales, discounts, refunds, and net sales must have one documented meaning across the workspace.
- R17. Merchandise cost of goods sold must use the immutable cost captured for each recognized merchandise sale line.
- R18. Merchandise gross profit must equal merchandise net sales less recognized merchandise cost of goods sold.
- R19. Merchandise gross margin must be based only on merchandise revenue with a known cost basis.
- R20. Every profit or margin view must show cost coverage as both affected revenue and percentage of eligible merchandise revenue.
- R21. Service revenue must remain separate from merchandise gross profit until Athena records trustworthy service-delivery cost.
- R22. Reports must not present a combined product-and-service gross-profit figure while service labor or delivery cost is unknown.

### SKU-First Item Performance

- R23. SKU must be the authoritative item-performance level because stock, sellable availability, cost, and replenishment vary by SKU.
- R24. Product and category performance must be rollups of SKU facts rather than independently calculated totals.
- R25. Each SKU row must show units sold, units returned, net units moved, net sales, known cost of goods sold, merchandise gross profit, margin, current stock, current inventory value, sales velocity, estimated days of cover, and prior-period change where trustworthy.
- R26. SKU lists must support finding fast movers, slow or nonmoving inventory, low-cover winners, high-revenue low-margin items, and inventory value concentrated in weak performers.
- R27. Reports must distinguish on-hand inventory from sellable availability when reservations or holds make them different.
- R28. Sell-through, turnover, and other period inventory metrics must not be shown unless opening stock, inbound stock, and outbound movement for the period are complete enough to support the calculation.
- R29. Estimated days of cover must disclose the velocity window and must not be shown as a forecast when sales history is insufficient.
- R30. Reports must not label time since last movement or time since last sale as true inventory age.

### Highlight and Route

- R31. Reports must highlight deterministic integrity, money, inventory, and operational exceptions.
- R32. Every attention signal must state what changed, the affected amount or units, why Athena raised it, and any relevant data-completeness limitation.
- R33. Every attention signal must provide one clear route to the existing workflow that owns resolution.
- R34. Low cover, missing inbound cover, late purchase orders, and short receipts must route to Procurement.
- R35. Cash and register variance must route to Cash Controls or the relevant register-session evidence.
- R36. Refund, discount, void, or transaction-adjustment signals must route to the relevant transaction evidence.
- R37. Missing cost must route to the relevant product or SKU editing workflow without blocking sale activity.
- R38. Delayed or uncertain POS synchronization must route to Terminal health or the existing runtime evidence surface.

### Evidence and Drill-Down

- R39. Every aggregate must preserve a path to the source transactions, SKU activity, inventory movements, payments, purchase orders, or service records that support it.
- R40. A trusted SKU detail must expose all attached completed transactions in the selected reporting period, including transaction identity, time, channel, quantity, net sale value, snapshotted cost, profit, refund state, and applied adjustments.
- R41. SKU detail must route to full SKU Activity for receipts, reservations, adjustments, provisional lineage, service consumption, and other non-sale movement evidence.
- R42. Reports must state when a source result is truncated, omitted, stale, or still awaiting synchronized POS activity.
- R43. Missing cost must remain distinct from a legitimate zero cost.
- R44. Missing cost must not block checkout, service work, online ordering, or inventory movement.
- R45. Reports must not silently substitute current SKU cost for an unknown historical sale cost.
- R46. Completed Daily Close source-completeness evidence should inform report trust for closed operating days rather than being discarded.

### Cost and Inventory Valuation

- R47. Athena must maintain moving weighted-average cost at the SKU level for costed inventory.
- R48. A costed receipt must update future weighted-average cost using the eligible on-hand cost basis and received cost.
- R49. Each product sale line must snapshot the applicable weighted-average unit cost when the sale is recognized.
- R50. Sellable returned inventory must re-enter valuation using the original sale's snapshotted unit cost when that cost is known.
- R51. Manual cost correction must affect future valuation and sales unless an explicit, auditable historical backfill is performed.
- R52. Existing or new inventory with unknown cost must remain visibly uncosted until a trustworthy cost basis is established.

### Refund and Return Semantics

- R53. Net sales must recognize a financial refund in the period when the refund occurs.
- R54. Refund activity must remain visible in the refund period even when the original sale occurred earlier.
- R55. Adjusted SKU performance must attribute the refund or returned quantity to the original SKU sale.
- R56. Reports must distinguish financial refund, physical return, restock, exchange, void, and transaction correction.
- R57. Cost of goods sold must reverse only when inventory is restored to sellable stock or another explicit cost disposition requires reversal.
- R58. Damaged, missing, or non-restocked returned merchandise must remain represented as loss, expense, or adjustment rather than silently returning to sellable inventory.

### Expense and Service Boundaries

- R59. Existing expense transactions must be labeled as inventory expense or inventory consumed because they represent SKU quantities at recorded item cost.
- R60. Reports must not describe Athena's current inventory expense transactions as complete operating expenses.
- R61. Reports must not claim accounting net profit, cash flow, payroll cost, rent, utilities, or other overhead that Athena does not record.
- R62. Service profitability may be added later without changing the original merchandise metric definitions.
- R63. Historical service cost must remain unknown unless it is explicitly and audibly backfilled; future labor or service cost must not be applied retroactively by default.

---

## Metric Contract

| Metric                   | Required meaning                                                                                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unified net sales        | Recognized product and service sales across POS and storefront, less financial refunds recognized during the selected period, without cross-source duplication. |
| Merchandise net sales    | Recognized product-sale value after merchandise discounts and current-period financial refunds.                                                                 |
| Merchandise COGS         | Sum of immutable recognized unit-cost snapshots for merchandise quantities whose cost is known, adjusted only by explicit inventory disposition.                |
| Merchandise gross profit | Merchandise net sales with known cost basis less merchandise COGS.                                                                                              |
| Merchandise gross margin | Merchandise gross profit divided by the merchandise net sales eligible for that profit calculation.                                                             |
| Cost coverage            | Merchandise revenue with known immutable cost divided by total eligible merchandise revenue, shown with the uncovered amount.                                   |
| Units sold               | Recognized merchandise quantity sold in the selected period before later-period return attribution.                                                             |
| Net units moved          | Sold quantity less returned or corrected quantity under the selected analytical view.                                                                           |
| Current inventory value  | Current on-hand quantity multiplied by current trustworthy weighted-average unit cost, with uncosted units and value coverage disclosed.                        |
| Sales velocity           | Net recognized units per active day over a disclosed lookback window.                                                                                           |
| Estimated days of cover  | Current sellable units divided by disclosed daily sales velocity; unavailable when velocity evidence is insufficient.                                           |
| Inventory consumed       | SKU quantity and snapshotted item cost recorded through Athena expense or service-consumption workflows; not general operating expense.                         |
| Purchase commitment      | Remaining ordered quantity and value for purchase orders that have not been fully received or cancelled, separated by planned versus inbound state.             |
| Refund activity          | Financial refund value processed during the selected period, regardless of original sale date.                                                                  |
| Adjusted SKU performance | SKU outcome with later refunds, returns, and applied corrections attributed to the original sale for product-performance analysis.                              |

---

## Acceptance Examples

- AE1. **Covers R4, R5, R7, R9.** Given the administrator opens Reports on Wednesday afternoon, Athena compares Monday-through-Wednesday-at-the-current-time with the equivalent elapsed period of the prior week and clearly marks Wednesday as partial.
- AE2. **Covers R13-R16.** Given one POS transaction contains products and services, one service case is paid through that transaction, and one storefront order completes, Reports includes each recognized amount once and shows the correct channel and revenue-type contribution.
- AE3. **Covers R17-R20, R43-R45.** Given 90% of merchandise revenue has known snapshotted cost, Reports shows merchandise profit only for eligible revenue, shows 90% cost coverage and the uncovered amount, and does not apply today's SKU cost to earlier unknown sales.
- AE4. **Covers R23-R30.** Given two variants of one product have different stock, cost, and sales velocity, Reports shows separate SKU performance and a product rollup whose totals equal the SKU facts.
- AE5. **Covers R39-R42.** Given a trusted SKU has POS and storefront sales in the selected period, opening the SKU shows every attached transaction with source evidence and provides a route to its complete SKU Activity history.
- AE6. **Covers R47-R52.** Given a SKU has 10 units at GHS 20 and receives 10 units at GHS 30, its future weighted-average cost becomes GHS 25; a subsequent sale snapshots GHS 25 without rewriting earlier sale costs.
- AE7. **Covers R53-R58.** Given an item sold in Week 1 is refunded but not restocked in Week 2, Week 2 shows refund activity, adjusted SKU performance attributes the return outcome to the Week 1 sale, and inventory value does not increase.
- AE8. **Covers R31-R38.** Given a fast-moving SKU has low cover and no inbound purchase order, Reports explains the units and cover behind the signal and links to Procurement without creating or applying a purchase order itself.
- AE9. **Covers R42, R46.** Given a local POS terminal has not finished syncing, Reports identifies the affected period or metrics as incomplete and links to terminal evidence rather than presenting the totals as final.
- AE10. **Covers R59-R63.** Given Athena records SKU inventory consumed as an expense but has no rent or payroll records, Reports labels the amount as inventory consumed and does not present operating profit or net profit.

---

## Success Criteria

- A full administrator can understand current store direction from one balanced week-to-date overview.
- Unified totals reconcile to POS, storefront, service, payment, and refund source evidence without duplication.
- Every SKU aggregate can be investigated through attached transactions and full SKU Activity evidence.
- Missing cost, delayed synchronization, and incomplete movement history reduce or withhold affected metrics instead of creating false precision.
- Reports reliably routes attention to existing operational workspaces and does not duplicate their mutation behavior.
- The metric contract is stable enough for later service-cost and organization-rollup work without changing the meaning of the initial merchandise metrics.
- Planning can proceed without inventing access, time-window, cost, refund, evidence, or workflow-ownership semantics.

---

## Scope Boundaries

- Reports is store scoped; organization-wide rollups and cross-store comparison are deferred.
- Reports is full-admin only; manager elevation and `pos_only` access are excluded.
- Reports highlights and routes; it does not create purchase orders, change prices, adjust stock, apply refunds, or resolve cash variance.
- General accounting, chart of accounts, bank reconciliation, payroll, rent, utilities, tax filing, and accounting net profit are outside this product's identity.
- Service labor and service-delivery costing are deferred, while service revenue is included from the first release.
- True stock age and FIFO lot analysis are excluded from the moving weighted-average model.
- Forecasting beyond transparent sales velocity and estimated days of cover is deferred.
- Operator-configurable goals and thresholds are deferred; initial attention signals are deterministic and grounded in existing Athena facts or explicitly defined report rules.
- Implementation-level schemas, indexes, query decomposition, backfill mechanics, component structure, and deployment sequencing belong to planning.

---

## Key Decisions

- Balanced over one-dimensional: Money and inventory share the overview because administrators need to understand sales and the stock that produced them together.
- Week to date by default: Daily Operations already owns today's operating workflow, so Reports starts at a management cadence while retaining shorter and longer presets.
- Store scoped and full-admin only: This matches Athena's current protected Analytics and Procurement posture and keeps cost and margin evidence restricted.
- Unified revenue, explicit profitability lanes: Product and service revenue combine at the business top line, while merchandise profit remains separate until service cost exists.
- SKU first: SKU is the authoritative performance level; product and category views are rollups.
- Moving weighted average: Receipts update future SKU cost, and each sale preserves the cost that applied when it occurred.
- Missing cost never blocks trade: Unknown cost is a prominent data-quality state, not a checkout gate or a reason to fabricate profit.
- Dual-basis refunds: Refund-period money movement and original-sale product performance answer different questions and remain separately named.
- Evidence before abstraction: Every aggregate preserves a path to the underlying operational record.
- Highlight and route: Reports interprets and prioritizes signals while existing workspaces retain action ownership.
- Storefront Analytics becomes subordinate: Engagement remains useful context but no longer occupies the top-level business-reporting identity.

---

## Dependencies / Assumptions

- POS, storefront, service, payment, refund, and inventory facts can be normalized without changing the owning workflows' business behavior.
- Every stock-changing workflow can eventually emit complete inventory movement and cost evidence.
- Existing Daily Close source-completeness and POS runtime signals can identify report periods affected by incomplete data.
- Current store currency and operating-timezone rules remain authoritative for report formatting and period boundaries.
- Historical data without a trustworthy cost basis will remain visibly incomplete rather than being silently estimated.
- Product and category rollups can be derived from stable SKU identity even when display names or merchandising attributes change later.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R13-R16][Technical] Define the canonical recognition and deduplication boundary across POS transactions, service-case allocations, and online orders.
- [Affects R17-R20, R47-R52][Technical] Define moving weighted-average behavior for legacy on-hand units with unknown cost, mixed-cost returns, and explicit historical backfills.
- [Affects R23-R30][Technical] Define bounded aggregation and retention behavior for long custom ranges without weakening evidence completeness.
- [Affects R31-R38][Product/technical] Define the initial deterministic signal thresholds and precedence when multiple signals apply to one SKU.
- [Affects R39-R42][Technical] Define the durable trusted-SKU transaction lookup across POS and storefront sale lines.
- [Affects R42, R46][Technical] Define how live partial-day facts and completed Daily Close snapshots combine without double counting or silently rewriting a closed day.

---

## Companion Artifact

- `docs/brainstorms/2026-07-09-reports-workspace-requirements.html`

---

## Next Steps

-> /ce-plan for structured implementation planning
