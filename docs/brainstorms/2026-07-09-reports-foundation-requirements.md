---
title: Reports Foundation Requirements
date: 2026-07-09
status: aligned
parent: docs/brainstorms/2026-07-09-reports-workspace-requirements.md
---

# Reports Foundation

## Summary

Athena needs a durable reporting foundation before the Reports workspace can safely present unified money, SKU movement, inventory value, and merchandise profitability. Existing operational records remain the source evidence, but they do not yet share one recognition contract, one inventory-and-valuation mutation contract, or one completeness and reconciliation model.

This document defines the foundation that must be true before Reports depends on it. It closes the audited gaps without turning Reports into a general ledger, replacing existing operational workspaces, or blocking trade when cost or synchronization evidence is incomplete.

## Relationship to the Reports Workspace

The approved product requirements remain authoritative for the operator experience:

- `docs/brainstorms/2026-07-09-reports-workspace-requirements.md`

This companion specification supplies the trust layer required by those product requirements. Reports may be designed before every foundation capability is complete, but a metric must not be activated for a store or period until its required facts, coverage, reconciliation, and authorization contracts are satisfied.

| Reports need | Foundation obligation |
| --- | --- |
| Unified revenue without duplication | Canonical recognition facts separate revenue from settlement and identify one owning business event. |
| SKU-first performance | Channel-neutral merchandise-line evidence resolves direct and provisional SKU identity. |
| Merchandise COGS and margin | Moving weighted-average valuation preserves known and unknown cost coverage and immutable sale cost basis. |
| Inventory movement and value | One stock-effect contract keeps balances, movement evidence, availability, and valuation aligned. |
| Week-to-date and comparison periods | Server-owned operating periods use the effective store schedule and preserve historical period assignment. |
| Trustworthy closed and live reporting | Immutable close evidence coexists with versioned post-close reconciliation. |
| Durable performance | Bounded daily and SKU projections replace uncapped history scans and per-parent fan-out. |
| Highlight and route | Every aggregate, limitation, and signal retains a path to its owning operational evidence. |

## Outcomes

- Every amount, quantity, and cost used by Reports has one canonical recognition path and stable source evidence.
- Current on-hand units and inventory value reconcile from an accepted cutover baseline forward.
- Unknown cost, currency, attribution, synchronization, and pre-cutover history remain explicit rather than becoming zero or inferred truth.
- Closed-day evidence remains immutable while current reporting incorporates valid late activity through visible reconciliation.
- Report reads remain bounded as stores accumulate years of transactions and SKU history.
- A full administrator can tell whether a metric is complete, current, stale, partial, unsupported, or still rebuilding.
- New service-cost lanes and organization rollups can be added without changing the original merchandise definitions.

## Grounding in Athena Today

Athena already has foundations worth reusing:

- Daily Close preserves immutable report snapshots and source-completeness evidence: `packages/athena-webapp/convex/schemas/operations/dailyClose.ts:60-126`.
- The store schedule provides effective, IANA-timezone-aware operating windows: `packages/athena-webapp/convex/schemas/inventory/storeSchedule.ts:36-53` and `packages/athena-webapp/convex/lib/storeScheduleTime.ts:614-760`.
- SKU Activity preserves source, actor, occurrence time, source-line identity, and idempotency evidence: `packages/athena-webapp/convex/schemas/operations/skuActivityEvent.ts:3-33`.
- POS adjustments preserve original-line linkage and explicit correction evidence: `packages/athena-webapp/convex/schemas/pos/posTransactionAdjustment.ts:17-47`.
- Purchase-order lines already preserve ordered quantity and unit cost: `packages/athena-webapp/convex/schemas/stockOps/purchaseOrderLineItem.ts:3-13`.
- Existing performance guidance favors bounded server-shaped projections and purpose-specific hydration: `docs/solutions/performance/athena-analytics-workspace-snapshot-2026-05-08.md` and `docs/solutions/performance/athena-convex-read-amplification-2026-06-29.md`.

The audited gaps are concrete:

- Mixed POS service sales can appear in both the POS total and service evidence: `packages/athena-webapp/convex/pos/application/sync/projectLocalEvents.ts:2055-2170` and `:2623-2683`.
- Payment allocation replay currently can rely on matching business values instead of a required event identity: `packages/athena-webapp/convex/operations/paymentAllocations.ts:81-130`.
- Missing SKU cost can collapse to zero and direct edits can change stock or cost without a corresponding correction event: `packages/athena-webapp/src/components/add-product/ProductStockInput.ts:495-519` and `packages/athena-webapp/convex/inventory/products.ts:951-1035`.
- Receiving preserves purchase-order cost upstream but currently applies only quantity and quantity-only movement evidence: `packages/athena-webapp/convex/stockOps/receiving.ts:216-317`.
- Some stock changes bypass movement evidence, while some movement evidence does not change stock: `packages/athena-webapp/convex/inventory/expenseTransactions.ts:96-165` and `packages/athena-webapp/convex/serviceOps/serviceCases.ts:589-656`.
- POS and storefront sale lines do not snapshot cost, currency, or merchandising hierarchy: `packages/athena-webapp/convex/schemas/pos/posTransactionItem.ts:3-20` and `packages/athena-webapp/convex/schemas/storeFront/onlineOrder/onlineOrderItem.ts:3-24`.
- Existing summary queries scan history, fan out into line reads, or silently cap inputs: `packages/athena-webapp/convex/pos/application/queries/storePulse.ts:374-475` and `packages/athena-webapp/convex/storeFront/analytics.ts:10-23`.
- The current storefront Analytics summary lacks a server-side full-admin check: `packages/athena-webapp/convex/storeFront/analytics.ts:373-404`.

## Definitions

- **Business occurrence time:** When the sale, refund, receipt, movement, or other business event occurred, independent of later synchronization or processing.
- **Recognition time:** The time a metric contract assigns an event to financial or operational reporting.
- **Settlement:** Movement of payment value, including collection, deposit, refund, reversal, change, or overpayment. Settlement is evidence about payment, not revenue by itself.
- **Canonical fact:** The single reportable interpretation of an owning business event, retaining source identity and versioned meaning.
- **Known cost pool:** The stored minor-unit value associated with costed on-hand quantity.
- **Uncosted quantity:** On-hand quantity for which Athena does not have a trustworthy valuation basis.
- **Cutover baseline:** The accepted effective-time position from which a store and SKU can be reconciled forward.
- **Verified projection:** A reusable report result whose required source coverage and reconciliation checks have passed.
- **Post-close delta:** Valid activity learned after a Daily Close was completed that affects current reporting without rewriting the accepted close snapshot.

## Foundation Principles

1. Source evidence remains immutable; interpretations evolve through linked, versioned facts.
2. Revenue, settlement, physical stock, availability, and valuation are distinct effects that reconcile but do not substitute for each other.
3. Athena preserves sales continuity. Missing cost or delayed synchronization reduces reporting certainty but does not block selling.
4. Unknown remains unknown. Current catalog state must not be projected backward merely to increase coverage.
5. Every aggregate must reconcile downward to evidence and upward to its published total.
6. Reports consumes verified projections and routes action to existing operational owners.

## Requirements

### Authorization and Store Isolation

- **F-R1.** Every public Reports read, evidence read, export, and operator-triggered foundation maintenance action must independently authenticate the caller and require active `full_admin` membership in the organization that owns the requested store.
- **F-R2.** Route visibility, manager elevation, possession of a source record ID, or membership in another organization must never substitute for F-R1.
- **F-R3.** Every source reference hydrated through Reports must be verified against the requested store before any value or metadata is returned.
- **F-R4.** Authorization and store-mismatch failures must disclose neither report values nor the existence of sensitive source records. Canonical facts, projections, health records, logs, alerts, and exports must contain only fields required by their contract; credentials, authentication secrets, payment instrument data, and unnecessary customer PII must never be copied into reporting or diagnostic records.
- **F-R5.** Every export, backfill, rebuild, reconciliation, repair, or activation must preserve the human actor or automation identity, store, domain, period, contract versions, operation, outcome, timestamps, and run identity. Automated work must remain store scoped and use an explicit internal authority boundary.

### Canonical Commerce Recognition

- **F-R6.** Every recognized sale, discount, refund, void, correction, payment, return, receipt, and stock effect must carry a stable store-scoped business-event identity.
- **F-R7.** Reprocessing the same identity with materially identical content must be a no-op. Reprocessing it with conflicting content must fail closed, preserve canonical source references, safe content fingerprints, sanitized material differences, and conflict evidence needed for diagnosis, and make the affected result uncertified.
- **F-R8.** Two legitimate business events with identical amount, method, quantity, direction, and target must remain distinct.
- **F-R9.** Revenue recognition must remain separate from settlement. Settlement records do not establish or reverse revenue by themselves. A payment refund or reversal affects net sales only when linked to a canonical financial-refund, void, or correction fact.
- **F-R10.** POS merchandise and POS service lines must be recognized at completed-sale occurrence time. A service case represented by a POS service line must remain linked evidence and must not recognize the same service revenue again.
- **F-R11.** A standalone service case must be recognized at service completion. Payments received before completion remain settlement until recognition.
- **F-R12.** A storefront sale must be recognized from the order's completed fulfillment event, not order creation or an intermediate workflow status.
- **F-R13.** Recognized commerce must preserve merchandise, service, discount, tax, delivery, and other non-revenue components separately enough for each lane and the unified total to reconcile.
- **F-R14.** Recognized lines must preserve original quantity, unit price, allocated discount, recognized net value, currency, channel, occurrence time, recognition time, SKU or service identity, and recognition-time merchandising attribution.
- **F-R15.** Completed source evidence must not be destructively rewritten for reporting. Voids, corrections, reclassifications, refunds, and reversals must create linked effects that preserve the earlier state.
- **F-R16.** Financial refunds must be recognized as distinct events in the period when the refund occurred and must retain attribution to the original sale and sale line when known. The canonical financial-refund fact must reduce net sales in its recognition period while preserving the original completed sale.
- **F-R17.** Financial refund, physical return, sellable restock, damaged return, missing return, exchange issue, void, and transaction correction must remain independently observable.
- **F-R18.** An exchange must preserve the returned item's disposition, replacement item's outbound movement, and any additional collection or refund rather than collapsing them into one net amount or quantity.
- **F-R19.** Every financial and valuation effect must preserve its currency and minor-unit convention. Unlike currencies must not be summed, and missing historical currency must not inherit current store or SKU currency without trustworthy evidence.
- **F-R20.** Locally completed POS events must remain attributed to their durable business occurrence time while separately exposing synchronization delay, acceptance time, and unresolved projection conflicts.

### Authoritative Inventory and SKU Evidence

- **F-R21.** Every workflow that changes on-hand stock must produce corresponding source-linked movement evidence as one atomic business outcome.
- **F-R22.** A movement that claims a physical stock change without changing the authoritative balance, or a balance change without matching movement evidence, must create an explicit reconciliation state.
- **F-R23.** Availability-only effects such as holds, reservations, and releases must not change on-hand quantity or inventory value; evidence must state whether on-hand, sellable availability, or both changed.
- **F-R24.** Physical movement evidence must preserve SKU, signed on-hand delta, signed sellable delta, before and after balances, movement and disposition meaning, occurrence and recording times, actor when known, and source workflow, record, and line.
- **F-R25.** Athena must preserve the full physical delta from a completed sale, exchange, consumption, or correction even when it exceeds last-known stock. Outbound quantity beyond available on-hand must create an explicit uncosted deficit with no negative known cost pool. Any later inbound physical movement must first resolve deficit quantity. A costed inbound must apply its confirmed cost to the resolved deficit through a linked valuation adjustment that preserves the original outbound snapshot and exposes the resulting historical or post-close delta under the applicable metric contract; an uncosted inbound resolves quantity without fabricating cost. Only residual inbound quantity enters current costed or uncosted on-hand. The deficit or conflict must remain explicit rather than being clamped or silently discarded.
- **F-R26.** From an accepted cutover baseline forward, baseline on-hand plus committed physical deltas must equal current on-hand for every in-scope SKU, unless an explicit reconciliation discrepancy identifies the difference and owning source.
- **F-R27.** POS and storefront merchandise lines for trusted SKUs must be discoverable by store, canonical SKU, and recognition period with source-linked evidence equivalent to provisional SKU investigation.
- **F-R28.** Provisional or pending SKU evidence later resolved to a trusted SKU must become attributable to the canonical SKU without rewriting the original source line or losing provisional lineage.
- **F-R29.** SKU, product, category, and channel rollups must preserve historical attribution and must not silently change when current catalog relationships change.

### Moving Weighted-Average Valuation

- **F-R30.** Unknown cost and legitimate zero cost must remain distinct through input, storage, movement evidence, sale evidence, projections, and display.
- **F-R31.** Each SKU valuation position must distinguish costed on-hand quantity, uncosted on-hand quantity, unresolved deficit quantity, known cost pool, valuation currency, and current basis status.
- **F-R32.** After F-R25 deficit resolution, only residual receipt quantity with trustworthy unit cost and its proportional extended cost may increase costed on-hand quantity and the known cost pool. Each costed receipt must preserve received quantity, confirmed receipt-time unit cost, currency, source line, and occurrence time. A planned purchase-order cost may be used only when explicitly confirmed as the receipt basis, and later source edits must not rewrite the accepted receipt cost. Moving weighted-average cost must derive from the pool divided by costed quantity using deterministic minor-unit rounding.
- **F-R33.** After F-R25 deficit resolution, only residual receipt quantity without trustworthy cost may increase uncosted on-hand. It must not dilute, replace, or fabricate the known weighted-average cost.
- **F-R34.** When costed and uncosted quantity coexist, outbound quantity must consume uncosted coverage first. A line that crosses the boundary may contain both uncosted and costed portions.
- **F-R35.** Every physical outbound movement must preserve its costed and uncosted quantities and the immutable weighted-average basis applied to its costed quantity. At merchandise sale recognition, Athena must preserve known COGS, valuation currency, basis status, and cost-basis version. Service consumption, inventory expense, damage, writeoff, and other non-customer outbounds must classify known cost under their typed inventory disposition and must not be reported as merchandise COGS. An exchange replacement issue must preserve its known cost as a separately identified merchandise exchange effect linked to the original sale, include that cost in adjusted merchandise COGS and profit, and must not independently create revenue.
- **F-R36.** Later receipts, catalog edits, or cost corrections must not rewrite a recognized sale's cost snapshot.
- **F-R37.** A costed outbound movement must reduce costed quantity and known cost pool by the same immutable cost assigned to that movement. Rounding residue must resolve deterministically when costed quantity reaches zero.
- **F-R38.** A sellable return must first resolve any deficit under F-R25. Residual returned quantity with known original sale cost must re-enter costed stock at that original cost; residual returned quantity with unknown original cost must re-enter uncosted stock.
- **F-R39.** Damaged, missing, non-restocked, or financial-only returns must not increase sellable stock or reverse COGS.
- **F-R40.** Manual valuation corrections must preserve actor, reason, occurrence time, prior basis, and new basis. They are prospective by default and must not silently rewrite earlier sales.
- **F-R41.** A late event must use the valuation state effective at its original occurrence time when that state can be reconstructed. Otherwise its cost remains unknown until explicit, auditable reconciliation.
- **F-R42.** Missing cost must never block POS, storefront, service, receiving, or other operational work; it must prominently reduce cost coverage and withhold unsupported profit claims.

### Operating Time and Closed-Day Reconciliation

- **F-R43.** Every report period must be resolved on the server from the store schedule effective for that period, including IANA timezone, operating windows, closed days, exceptions, and cross-midnight windows.
- **F-R44.** Period boundaries must remain correct across daylight-saving transitions and must not depend on browser timezone or fixed-offset arithmetic.
- **F-R45.** Same-elapsed comparisons must compare equivalent scheduled operating time, exclude future portions of the comparison period, and identify partial operating days.
- **F-R46.** Active-day denominators must derive from the effective schedule and disclose excluded closed, future, or materially incomplete days.
- **F-R47.** Historical facts must retain the operating date and effective schedule version used for assignment so later schedule edits do not move facts silently.
- **F-R48.** A completed Daily Close snapshot must remain immutable evidence of what Athena knew and what an administrator accepted at close time.
- **F-R49.** Current Reports must present the latest reconciled truth while preserving the accepted close value and a separately identified post-close delta with source evidence.
- **F-R50.** Reopened and superseded closes must preserve lineage and clearly identify the current interpretation without deleting earlier accepted evidence.
- **F-R51.** Late activity must follow the owning metric's recognition rule: a late-synchronized original sale belongs to its resolved operating period, while a later refund remains financial activity in the refund period.

### Metric Contracts, Projections, and Evidence

- **F-R52.** Every metric must have one named definition covering inclusion, exclusion, recognition time, sign handling, unknown-data behavior, comparison behavior, evidence, and required source coverage.
- **F-R53.** Metric, fact, and projection contracts must be versioned. Definition changes must not silently alter an existing metric or completed Daily Close evidence.
- **F-R54.** Channel lanes must equal the unified total, SKU facts must equal product and category rollups, and correction effects must reconcile to their original facts with zero tolerance for stored minor-unit money and integer quantities.
- **F-R55.** Overview, trend, ranked-SKU, and current inventory results must come from reusable verified projections rather than independently recomputing business meaning in each workspace.
- **F-R56.** Overview and aggregate reads must remain bounded as source history grows and must not perform one source query per displayed transaction, order, or SKU.
- **F-R57.** Under supported production cardinality, overview reads must meet a two-second p95 target and SKU aggregate reads a three-second p95 target.
- **F-R58.** Evidence lists must use stable pagination, identify the total or continuation state when known, and never present a fixed page limit as complete history.
- **F-R59.** Incremental processing and complete rebuild must produce identical results for the same source facts and contract versions.
- **F-R60.** Projection processing must be retry-safe, resumable, and isolated by store and domain so one failure cannot corrupt or stop unrelated stores. Every rejected, conflicting, or repeatedly failing source event must retain store-scoped source identity, safe failure code, first and latest failure times, attempt count, contract versions, and recovery disposition. It must remain inspectable and retryable until resolved, explicitly waived with actor evidence, or superseded; it must never be silently discarded.
- **F-R61.** Readers must retain the last verified projection while a replacement rebuilds. A replacement may become current only after it reconciles to canonical facts with zero unexplained difference under the candidate contract; expected differences from the prior version must be quantified, attributable to the definition change, and disclosed before activation.
- **F-R62.** Every aggregate and attention signal must link to contributing canonical facts and then to owning Athena records, including exclusions, unknowns, adjustments, and later corrections.
- **F-R63.** Storefront engagement analytics must remain a separate contextual projection. Engagement events must not become financial recognition facts.

### Completeness, Health, and Failure Behavior

- **F-R64.** Completeness and freshness must be reported per metric and source domain, not only as a workspace-wide timestamp.
- **F-R65.** Coverage must identify the relevant period, cutover boundary, latest processed business occurrence, projection update time, known lag, omissions, truncation, failed facts, unresolved POS sync, SKU attribution coverage, cost coverage, and inventory movement coverage.
- **F-R66.** Athena must distinguish unauthorized, cross-store reference, duplicate conflict, source incomplete, source unsynchronized, pre-cutover unknown, uncosted, processing delayed, processing failed, reconciliation drift, rebuild in progress, rebuild failed, version incompatible, projection stale, and evidence truncated. None may collapse into generic no data.
- **F-R67.** A metric with insufficient required evidence must be marked provisional, partial, stale, or unavailable according to its metric contract; Athena must not present an unqualified result that the missing evidence could materially change.
- **F-R68.** Under normal cloud-connected operation, accepted source activity must appear in Reports within five minutes. Unsynchronized local activity must be identified separately and must not be represented as incorporated.
- **F-R69.** Projection health must be observable per store and source domain, including active versions, processing watermark, freshness lag, quarantined count, backfill state, latest successful reconciliation, and current limiting reason.
- **F-R70.** Lag, repeated failure, reconciliation drift, duplicate conflict, stalled backfill, and source-coverage regression must have explicit thresholds and an owned operational response before metric activation.

### Cutover, Backfill, and Release Safety

- **F-R71.** Every in-scope store and SKU must have an effective-time cutover baseline containing on-hand, sellable availability, currency, and either a trustworthy cost basis or explicit uncosted quantity before Athena claims movement-complete inventory reporting.
- **F-R72.** The baseline establishes the earliest movement-reconcilable boundary. Reports must not infer pre-cutover receipts, stock age, turnover, or historical value from current balances.
- **F-R73.** Existing non-null SKU cost may seed current on-hand only through an auditable baseline decision; it must not be applied retroactively to historical sales. Existing null cost remains uncosted.
- **F-R74.** Backfills must support a non-mutating preview by store, period, source, eligible count, omitted count, duplicate count, conflict count, unknown fields, and expected coverage impact.
- **F-R75.** Backfills must be restartable, deterministic, idempotent, and governed by the same recognition, provenance, version, and reconciliation contracts as live processing.
- **F-R76.** Backfill must not manufacture historical cost, currency, classification, SKU attribution, or timestamps. Unsupported history must remain explicitly unknown.
- **F-R77.** New facts and projections must run in shadow and reconcile against source evidence before Reports reads are activated for a store.
- **F-R78.** Activation must be controllable per store and reversible without deleting facts or losing progress. Rollback must restore the last compatible verified read path.
- **F-R79.** Foundation rollout must not change checkout, ordering, service, refund, receiving, stock-continuity, or Daily Close success behavior.
- **F-R80.** Mixed contract versions during staged deployment must be detected and prevented from publishing an uncertified result.

### Verification

- **F-R81.** Contract tests must cover recognition, settlement separation, correction, reversal, currency, store ownership, occurrence time, source lineage, metric versions, and unknown-state preservation for every source lane.
- **F-R82.** Negative authorization tests must cover unauthenticated callers, `pos_only`, manager elevation, full administrators from another organization, mismatched stores, direct source IDs, pagination, exports, and maintenance actions.
- **F-R83.** Replay tests must cover identical duplicates, conflicting duplicates, legitimate same-value events, delayed and out-of-order events, partial retry, and concurrent processing.
- **F-R84.** Inventory tests must prove balance-to-movement parity, on-hand versus availability semantics, unclamped deficits, moving-average pool arithmetic, unknown-first coverage, return disposition, and cutover reconciliation.
- **F-R85.** Projection tests must prove incremental-versus-rebuild parity, channel-to-unified reconciliation, SKU-to-rollup reconciliation, post-close deltas, cutover coverage, and unknown-cost propagation.
- **F-R86.** Scale tests must use at least ten times the largest observed production-store cardinality at planning time and prove bounded reads, latency targets, pagination, and store isolation.
- **F-R87.** Deployment tests must prove preview, partial backfill, pause, resume, retry, activation, rollback, version transition, health alerting, and recovery from a failed build.
- **F-R88.** Athena's merge-grade validation must include the new authorization, contract, reconciliation, migration, and performance coverage before foundation changes can ship.

## Invariants

- A source business event has at most one intended financial recognition effect and one intended physical effect per source line.
- Recognized revenue and settlement reconcile independently; tender totals never substitute for sales totals.
- From cutover forward, current on-hand equals baseline plus committed physical deltas unless a named reconciliation discrepancy exists.
- For nonnegative eligible on-hand, costed quantity plus uncosted quantity equals on-hand quantity.
- Known inventory value equals the known cost pool; weighted-average unit cost is derived from that pool, not catalog price.
- Known COGS never exceeds quantity backed by known cost.
- COGS reverses only when a typed disposition restores known-cost inventory or through an explicit audited valuation correction.
- Current SKU cost, name, category, or currency changes never mutate recognized historical lines.
- Published channel, SKU, product, category, quantity, and value totals reconcile exactly in stored units before display rounding.

## Acceptance Examples

- **F-AE1, covers F-R6-F-R20.** A mixed POS sale contains GHS 80 merchandise and GHS 20 service linked to a service case. Athena recognizes GHS 100 once, preserves both classifications, and treats the service case and payment allocation as linked evidence rather than another GHS 20 of revenue.
- **F-AE2, covers F-R6-F-R9.** Two GHS 50 mobile-money payments are made against one service case. Both remain distinct; replaying either original event creates no third allocation, while conflicting reuse of its identity creates an integrity state.
- **F-AE3, covers F-R21-F-R29.** Service material consumption, inventory expense, receiving, POS sale, and direct stock correction change current stock only when matching source-linked movement evidence succeeds. A reservation release changes sellable availability without creating a physical restock.
- **F-AE4, covers F-R30-F-R42.** Ten units at GHS 20 receive ten units at GHS 30. The cost pool becomes GHS 500 and future weighted-average cost GHS 25. A subsequent sale snapshots that basis without rewriting earlier sales.
- **F-AE5, covers F-R30-F-R42.** A SKU has four uncosted and six costed units at GHS 10. A sale of five records four uncosted units and one costed unit with GHS 10 known COGS; missing cost does not prevent the sale.
- **F-AE6, covers F-R16-F-R18 and F-R35-F-R39.** A Week 1 item costed at GHS 25 is refunded in Week 2 but not restocked. Week 2 records refund activity, original-sale SKU performance reflects the outcome, and inventory value does not increase. A later sellable return restores stock at GHS 25 without creating another refund. If a replacement item is issued, its known cost becomes exchange-related merchandise COGS; the sellable return reverses the original item's COGS, and no additional revenue is recognized except an explicit additional collection.
- **F-AE7, covers F-R20 and F-R41.** An offline sale occurs Monday and syncs Wednesday after a Tuesday receipt changed cost. The sale remains Monday activity; if Monday's basis cannot be reconstructed, its COGS remains unknown rather than using Wednesday's cost.
- **F-AE8, covers F-R43-F-R51.** A sale syncs after its operating day closed. The accepted Daily Close remains unchanged, current reporting includes the sale in its resolved operating period, and Reports exposes a source-linked post-close delta.
- **F-AE9, covers F-R55-F-R70.** POS is current but storefront processing is delayed. Eligible POS metrics remain current, unified net sales is marked stale or partial with the affected source and lag, and the last verified projection remains readable.
- **F-AE10, covers F-R71-F-R80.** A cutover baseline records 12 units with unknown cost. Reports shows 12 uncosted units and no invented historical value. A backfill fails halfway, resumes without duplication, and activates only after zero-delta reconciliation.
- **F-AE11, covers F-R27-F-R29 and F-R62.** A trusted SKU shows direct POS and storefront sales plus earlier provisional sales attributed through canonical identity. Every contributing and excluded line is paginated and linked without rewriting original evidence.
- **F-AE12, covers F-R1-F-R5 and F-R82.** A full administrator for Store A requests a Store B transaction directly. Athena returns no Store B metadata and records the integrity attempt.

## Success Criteria

- Reports can publish unified revenue, SKU movement, inventory value, cost coverage, and merchandise profitability without double counting or fabricated precision.
- Every activated metric declares its versions, recognition rule, source coverage, freshness, cutover boundary, and evidence path.
- All integer quantities and stored minor-unit money reconcile with zero unexplained difference.
- A complete rebuild produces the same results as incremental processing for the same facts and versions, with zero unexplained difference.
- Accepted cloud activity normally becomes reportable within five minutes, while local unsynchronized activity remains clearly excluded.
- High-volume report reads satisfy the declared latency targets without uncapped source scans or per-parent fan-out.
- An administrator can distinguish operational truth, accepted close evidence, post-close changes, and unresolved data limitations.
- Foundation rollout can be paused or reversed without disrupting operational workflows or deleting diagnostic evidence.

## Scope Boundaries

- This foundation does not provide a general ledger, chart of accounts, tax filing, statutory audit, bank reconciliation, payroll, rent, utilities, cash flow, or accounting net income.
- FIFO, LIFO, landed-cost allocation, serial tracking, and true stock-age claims remain outside the moving weighted-average model.
- Service labor, overhead, and delivery-cost valuation are deferred. The contract must allow later cost kinds without redefining original merchandise metrics.
- Store-scoped reporting comes first. Organization rollups and cross-store comparison remain deferred.
- Reports does not replace Daily Close, Terminal Health, SKU Activity, Transactions, Procurement, Cash Controls, Storefront, or Service Operations as action owners.
- Reports and foundation maintenance must not mutate operational source records merely to make reporting reconcile.
- Historical unknowns are not estimated for the purpose of maximizing apparent coverage.
- Exact tables, indexes, schedulers, queue topology, module boundaries, component structure, and rollout batches belong to implementation planning.

## Key Decisions

- **Latest reconciled truth with close evidence:** Reports presents the current reconciled interpretation while preserving immutable Daily Close values and explicit post-close deltas.
- **Recognition basis:** POS product and service lines recognize at completed sale; standalone service recognizes at service completion; storefront recognizes at completed fulfillment.
- **Unknown-first cost coverage:** When costed and uncosted quantity coexist, outbound quantity consumes uncosted coverage first. This is conservative and avoids fractional estimated certainty.
- **No mixed-currency totals:** Unlike currencies are segmented or withheld, never silently combined.
- **Zero-tolerance stored reconciliation:** Integer quantities and minor-unit amounts must match exactly; only display percentages may use documented rounding.
- **Five-minute freshness objective:** Accepted cloud facts normally appear within five minutes. Local unsynchronized activity is a separate completeness state.
- **Shadow before activation:** Facts and projections prove parity and coverage before a store's Reports reads depend on them.
- **Per-store and per-SKU cutover:** Historical movement and valuation claims begin only at an accepted baseline.

## Dependencies and Assumptions

- The effective store schedule remains the authority for store operating periods.
- Existing operational workflows remain the owners of sale, service, payment, refund, receipt, stock, and Daily Close commands.
- The foundation can add evidence and reportable effects to those workflows without changing their operator success boundary.
- Planning will establish observed production cardinality before converting the scale and latency requirements into test fixtures and budgets.
- Planning will map every existing stock and commerce mutation path to the relevant foundation contract before activation.
- Existing history will have uneven coverage; the product accepts explicit partial history instead of estimated completeness.

## Reviewer Alignment

All reviewers returned `ALIGNED` against the same final revision after four review rounds.

- Reporting architecture and projection durability: `ALIGNED`.
- Finance, inventory, and valuation correctness: `ALIGNED`.
- Security, operability, migration, and verification: `ALIGNED`.

Material issues resolved during review included negative-inventory valuation, receipt and return deficit ordering, exchange replacement COGS, refund recognition versus settlement, immutable receipt cost evidence, diagnostic data minimization, failed-event recovery, and candidate-version reconciliation.

## Companion Artifact

- Reviewable HTML: `docs/brainstorms/2026-07-09-reports-foundation-requirements.html`

## Next Step

After alignment, create an implementation plan that sequences the foundation into independently verifiable batches. Reports UI work may proceed in parallel only where it consumes explicit mock contracts and does not establish competing metric logic.
