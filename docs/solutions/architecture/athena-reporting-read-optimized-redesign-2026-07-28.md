---
title: "Athena Reporting: Read-Optimized Redesign"
date: 2026-07-28
last_updated: 2026-07-29
category: architecture
module: athena-webapp
problem_type: reporting_read_cost
component: reports
resolution_type: architecture_replacement
severity: high
delivery_diff_fingerprint: 2b49136ad8285f1855470f22175362a760340b5924d5d4562803553e2a9e0950
tags:
  - reporting
  - read-cost
  - fact-ledger
  - day-fold
---

# Athena reporting: read-optimized redesign

**Date:** 2026-07-28
**Status:** Proposal — to be proven on the wigclub store in dev before prod.
**Driving constraint:** minimize DB read cost (document reads per query execution, reactive re-executions, OCC retry re-reads) while keeping operator-facing numbers correct and trusted.

## Problem

Reporting read cost was unbounded and invisible. On the wigclub dev store,
1,284 canonical facts over 64 operating days had fanned out into roughly
35,800 derived and audit rows — about 28 rows per fact, with
`reportingProjectionEvidence` alone at 21,546. Because projections stored one
row per `(generation, date, metric)`, a trailing-30 overview read touched
~340–440 documents, and it re-ran on every applied fact: on the order of
6,000–19,000 reads per day for a single dashboard subscriber.

The design underneath it was built for a scale and failure model Athena does
not have. Generations, activation compare-and-swap, read bundles, coverage
gates and census contracts are warehouse machinery; a store produces a few
hundred facts a day. Worse, the verification half of that machinery never
ran — the activation gate required zero reconciliation differences while no
reconciliation job existed, and the coverage gate passed vacuously for three
of seven projection kinds. The system carried the cost of a sophisticated
design without its benefits.

## Solution

Keep the append-only fact ledger; replace everything downstream with a
deterministic day fold.

- **Metric-as-field, not metric-as-row.** One document per `(store,
  operating day)` and one sparse document per `(store, SKU, day)`.
- **The fold is the authority.** A pure function from a day's facts to that
  day's totals. It is simultaneously the rebuild, the reconciliation, and the
  backfill apply step, which is what removes whole bug classes: idempotency,
  drift, and ordering stop being separate problems.
- **Incremental is only a preview.** The open day is patched cheaply as facts
  land and labelled `open`; the close-time fold replaces it wholesale.
- **One singleton overview document** per store for the dashboard, so the
  most-subscribed query reads one document.
- **One sweeper cron** draining declarative dirty marks, so liveness never
  depends on best-effort scheduling chains.
- **Structural fact identity** — `(storeId, sourceDomain, sourceId, lineId,
  factKind)` — designing out the escaping and forgery failures that
  concatenated string keys invited.

## Prevention

- **Make the vocabulary a typed contract.** `shared/reportsContract.ts` is
  imported by both the backend and the UI, with a parity test against the
  Convex validators. The legacy layer's most user-visible failure was the
  backend materializing keys the UI never read; that is now a compile error.
- **Verify against sources, not against the pipeline.** `verify.ts`
  recomputes each day directly from domain tables through deliberately
  separate code. It caught two real defects on first contact with real data
  (currency normalization, till-billed service revenue) that every unit test
  had missed.
- **Prefer recomputation to reconciliation.** If a derived value can be
  rebuilt cheaply from its source, rebuild it rather than maintaining
  machinery to detect when it has drifted.
- **Never let a gate pass vacuously.** A check that cannot fail — an
  `.every()` over an empty list, a threshold nothing computes — is worse than
  no check, because it reads as safety.

## Measured baseline (wigclub, dev deployment `jovial-wildebeest-179`)

Store `m1773nc3djfy0qg7m0wp4v1bn9786n2y` ("Wigclub", GHS). All reporting rows in dev belong to this store. Snapshot taken 2026-07-28.

| Quantity | Value |
| --- | --- |
| Canonical facts | 1,284 over 64 operating days (2026-05-08 → 2026-07-24) |
| Facts per day | min 1 / median 15 / p90 45 / max 93 |
| Facts by source | pos 1,157 · payments 99 · inventory 13 · daily_close 12 · storefront 3 |
| Product SKUs | 1,261 total; 248 ever transacted; 774 active (sku, day) pairs (~12/day) |
| `reportingStoreDayProjection` rows | 700 (61 dates × 6–18 metric rows/date) |
| `reportingSkuDayProjection` rows | 5,616 (771 sku-days × ~7.3 metric rows) |
| `reportingProjectionEvidence` rows | 21,546 = **16.8× fact count** (6 generations × ~3.9–4.8k rows each — every rebuild re-copies evidence) |
| `reportingRunEvent` rows | 7,525 (5.9× fact count) |
| Total derived + audit rows | ~35,800 ≈ **28 rows per fact** |

The store-day table is metric-per-row (~11 rows/date), so a trailing-30 overview read touches ~330 projection docs plus ~8 docs of bundle/generation/activation resolution and up to 100 trust rows per execution — and, because today's rows change on every applied fact, the subscribed overview re-executes ~15×/day (median) to ~45×/day (p90) per subscriber: **~6,000–19,000 reads/day/subscriber** for one dashboard. Writes fan out too: each fact produces ~3.4 evidence rows, patches the hot generation doc (OCC contention), and triggers coverage/health/sku-insight cascades — ~15–25 ops per fact.

## Design summary

Keep the ingress → canonical fact ledger (hardened). Replace generations, activation, read bundles, evidence rows, coverage rows, workspace epochs, and metric-per-row projections with four small tables and one cron:

1. **One doc per (store, operating day)** — all metrics as fields, plus a trust status.
2. **One sparse doc per (store, SKU, operating day)** — only days with activity.
3. **One overview doc per store** — the dashboard subscribes to exactly this.
4. **Materialized per-SKU period rollups** for calendar periods, with sort-key columns for indexed top-N pages.

Write path: incremental patch of the open day's docs (O(1) per fact). Correctness authority: a **deterministic day fold** — pure function `facts[] → day result` — run once when the day closes and whenever a closed day is dirtied by a late fact. The fold *is* the rebuild, the reconciliation, and the backfill apply step; there is no separate machinery for any of them.

## Schema

```ts
// convex/schemas/reporting/readOptimized.ts

export const reportDaySchema = v.object({
  storeId: v.id("store"),
  operatingDate: v.string(), // "YYYY-MM-DD" in store-local operating calendar
  currency: v.string(),

  // Trust status — the operator-facing semantics:
  //   open        — day in progress; metrics maintained incrementally (provisional)
  //   provisional — day ended, no accepted close yet; folded once at day end
  //   reconciled  — folded and matches the accepted daily close
  //   amended     — post-close facts arrived and were folded in; deltas below
  status: v.union(
    v.literal("open"), v.literal("provisional"),
    v.literal("reconciled"), v.literal("amended"),
  ),

  // Metrics — one field per metric, never one row per metric.
  grossSalesMinor: v.number(),
  netSalesMinor: v.number(),
  refundsMinor: v.number(),
  unitsSold: v.number(),
  unitsReturned: v.number(),
  uncostedRevenueMinor: v.number(),      // revenue with no known cost basis
  grossProfitMinor: v.union(v.number(), v.null()), // null = not computable (uncosted)
  paymentsCollectedMinor: v.number(),
  paymentsRefundedMinor: v.number(),
  paymentAllocatedMinor: v.number(),

  // Close reconciliation
  closeId: v.optional(v.id("dailyClose")),
  closeAcceptedAt: v.optional(v.number()),
  closeVarianceMinor: v.optional(v.number()), // folded net sales − close net sales
  postCloseNetSalesDeltaMinor: v.optional(v.number()), // populated when amended

  // Fold provenance
  foldedAt: v.optional(v.number()),   // undefined while open (incremental only)
  foldVersion: v.number(),            // bump when fold logic changes → refold all
  factCount: v.number(),
  lastFactAcceptedAt: v.number(),
  flags: v.object({
    mixedCurrency: v.boolean(),
    hasUncostedRevenue: v.boolean(),
  }),
});
// .index("by_storeId_operatingDate", ["storeId", "operatingDate"])  // unique
```

```ts
export const reportSkuDaySchema = v.object({
  storeId: v.id("store"),
  productSkuId: v.id("productSku"),
  operatingDate: v.string(),
  unitsSold: v.number(),
  unitsReturned: v.number(),
  grossSalesMinor: v.number(),
  netSalesMinor: v.number(),
  refundsMinor: v.number(),
  uncostedRevenueMinor: v.number(),
  grossProfitMinor: v.union(v.number(), v.null()),
  foldedAt: v.optional(v.number()),
});
// .index("by_storeId_operatingDate_productSkuId", ["storeId","operatingDate","productSkuId"])
// .index("by_storeId_productSkuId_operatingDate", ["storeId","productSkuId","operatingDate"])
```

Sparse: rows exist only for (sku, day) pairs with activity. Wigclub: 774 rows over 2.5 months, not 1,261 × 78 = 98k.

```ts
export const reportOverviewSchema = v.object({
  storeId: v.id("store"),
  updatedAt: v.number(),
  // Denormalized snapshots — the dashboard reads THIS DOC ONLY.
  today: reportPeriodSnapshot,        // same metric fields as reportDay + status
  weekToDate: reportPeriodSnapshot,
  trailing30: reportPeriodSnapshot,
  priorWeek: reportPeriodSnapshot,
  comparisons: v.object({             // computed at write time, once
    netSalesVsPriorWeekBp: v.union(v.number(), v.null()),
    unitsSoldVsPriorWeekBp: v.union(v.number(), v.null()),
  }),
  dailyTrend: v.array(v.object({      // last 30 days inline — the sparkline/chart
    operatingDate: v.string(),
    netSalesMinor: v.number(),
    status: v.string(),
  })),
  trust: v.object({
    reconciledDays: v.number(),       // of last 30
    provisionalDays: v.number(),
    amendedDays: v.number(),
    oldestUnreconciledDate: v.optional(v.string()),
  }),
});
// .index("by_storeId", ["storeId"])  // singleton per store
```

```ts
export const reportPeriodSkuRollupSchema = v.object({
  storeId: v.id("store"),
  // Calendar periods only: "d:2026-07-28", "w:2026-W31", "m:2026-07".
  // Rolling windows (trailing-30) live on the overview doc; custom ranges are on-demand.
  periodKey: v.string(),
  productSkuId: v.id("productSku"),
  unitsSold: v.number(),
  netSalesMinor: v.number(),
  grossProfitMinor: v.union(v.number(), v.null()),
  // Convex indexes are ascending — store negated sort keys for descending top-N pages.
  revenueSortKey: v.number(),         // -netSalesMinor
  unitsSortKey: v.number(),           // -unitsSold
});
// .index("by_storeId_periodKey_revenueSortKey", ["storeId","periodKey","revenueSortKey"])
// .index("by_storeId_periodKey_unitsSortKey", ["storeId","periodKey","unitsSortKey"])
// .index("by_storeId_periodKey_productSkuId", ["storeId","periodKey","productSkuId"])
```

```ts
export const reportDirtyDaySchema = v.object({
  storeId: v.id("store"),
  operatingDate: v.string(),
  reason: v.union(
    v.literal("day_open"),            // standing mark for the open day
    v.literal("late_fact"),
    v.literal("close_accepted"),
    v.literal("fold_version_bump"),
    v.literal("backfill"),
  ),
  markedAt: v.number(),
});
// .index("by_storeId_operatingDate", ["storeId","operatingDate"])  // upsert, one per day
// .index("by_markedAt", ["markedAt"])                              // sweeper scan order
```

Dirty marks are a **separate table** deliberately: marking a day dirty must not invalidate subscriptions on `reportDay`/`reportOverview` docs.

Custom ranges keep the current request-key dedupe idea, reduced: `reportRangeResult(storeId, requestKey, range, status, summary, skuPage chunks, expiresAt)` with `by_storeId_requestKey` and `by_expiresAt`; computed once by the sweeper from `reportDay`/`reportSkuDay` rows (never from raw facts), served as stored docs, expired after 7 days.

## Write paths

**Fact arrival (open day)** — inside the existing ingress transaction: patch `reportDay` (additive), upsert touched `reportSkuDay` rows. ~3–5 reads+writes per fact. No evidence rows, no generation patch, no cascades. Imperfect idempotency here is *accepted*: the open day is labeled provisional, and the close-time fold replaces every incremental number.

**Fact arrival (closed day)** — do not touch the day doc; upsert a `reportDirtyDay(late_fact)` mark. One write.

**Daily close accepted** — upsert `reportDirtyDay(close_accepted)`. One write.

**The fold** (pure function, unit-testable):
`foldDay(facts: ReportingFact[], close?: DailyCloseRef) → { day: DayResult, skuDays: Map<skuId, SkuDayResult> }`
Sorts facts by `(occurredAt, factId)`, folds deterministically, derives status (`provisional` | `reconciled` | `amended` + deltas/variance vs close). Reads for one fold: the day's facts via `by_storeId_operatingDate` — wigclub median 15, max 93 docs — once per day per store in steady state.

**The sweeper** (the ONE reporting cron, every 5 min):
1. Take dirty days in `markedAt` order (bounded batch, e.g. 10).
2. Refold each: replace `reportDay`, replace that day's `reportSkuDay` rows, upsert affected calendar `reportPeriodSkuRollup` rows (from sku-day docs, not facts).
3. Rebuild the store's `reportOverview` doc (reads ≤ ~65 docs: 30 day docs + prior-week days + today).
4. Clear the marks it processed; re-mark the still-open day.
5. Expire old `reportRangeResult` rows; enforce retention.

Liveness is declarative: work is a dirty mark, the sweeper is the only consumer, a crashed sweep leaves marks in place for the next tick. No best-effort scheduling chains, no wedged states.

## Read paths and cost

Measured/derived for wigclub (per subscriber where reactive):

| Surface | Current design | This design |
| --- | --- | --- |
| Dashboard overview | ~340–440 docs/execution × ~15–45 re-runs/day ≈ **6k–19k reads/day** | **1 doc** × ≤ sweep cadence (~145 re-runs/day if store active all day) ≈ **≤145 reads/day** |
| 30-day trend chart | included above (metric-per-row scan) | inline on the overview doc: **0 extra** |
| Items top-25 (period) | 25 summary + facets + rollups + bundle ≈ ~40 docs; epoch rebuild behind it re-reads ~6,300 projection rows + ~2,500 bundle re-resolutions | **25 rollup docs** per page; invalidated only when the sweeper touches that period (≤ sweep cadence for current period, ~once/day for closed) |
| SKU detail (90 days) | sku-day metric rows ~7.3×days + evidence lookups | ≤ 90 `reportSkuDay` docs via index prefix, immutable once reconciled |
| Custom range | run + generation + paged fact walk at 20/page, re-validating authority per page | computed once from day/sku-day docs (~range-length + active sku-days), served as **1–2 stored docs**, cached by requestKey |
| Write amplification | ~15–25 ops/fact + OCC contention on generation doc | ~3–5 ops/fact, no shared hot doc |
| Steady-state storage | ~28 derived/audit rows per fact (and growing per rebuild) | ~0.9 docs per fact, flat; rebuild rewrites in place |

Two structural properties do most of the work: **metric-as-field** (≈11× fewer docs per day read) and **closed-day immutability** (historical docs never change, so Convex subscriptions on ranges are invalidated only by the sweep of the current day — reactive re-runs collapse from per-fact to per-sweep).

## What is deliberately given up

- **Intraday precision:** open-day numbers are best-effort until the fold; a replayed fact can transiently double-count *today only*, self-healing at close. Accepted per product direction (intraday latency/precision explicitly not a concern; read cost is).
- **Generation time travel:** no as-of-generation reads. Day status history covers the operator need.
- **Per-fact audit on the projection side:** the fact ledger remains the audit trail; projections are disposable derivations of it, so evidence rows are unnecessary.

## Fact ledger (rebuilt clean — rev 2, no backward compatibility)

Per direction on 2026-07-28, the ledger is not "hardened in place" — it is rebuilt without legacy constraints (see the implementation plan for the schema):

- **Structural identity:** uniqueness on indexed fields `(storeId, sourceDomain, sourceId, lineId, factKind)` — no concatenated string keys, so the escaping/forgery bug class is designed out.
- `factKind` is a closed enum (no substring classification); fingerprints are versioned JSON built by a single module; line-level tax is captured.
- `occurredAt` is business time on every source (POS offline sync passes the original sale timestamp); `recordedAt` is arrival metadata.
- No ingress staging tables: emitters write facts inside the domain transaction (Convex mutations are transactional). Replay is an identity no-op; content conflict parks a quarantine marker and dirties the day.

## Proving it on wigclub (dev), then prod (rev 2 — clean cutover)

1. **Replace, don't build beside.** New `convex/reports/` namespace; legacy `convex/reporting/` code and tables are deleted at cutover. Legacy reporting data is abandoned, not migrated.
2. **Reseed from sources.** `reseedStoreReporting(wigclub)` re-derives all facts by running the same emitter code over historical domain rows (POS transactions, orders, closes, payments, stock ops), then the sweeper folds all days. One path serves backfill, prod bootstrap, and disaster recovery.
3. **Verify against truth.** An independent verifier recomputes day totals directly from domain tables and diffs the folds. Legacy projections (known double-count/truncation bugs) are not a reference.
4. **Measure.** A week of Convex dashboard read/bandwidth metrics on the report functions against the budgets above.
5. **Prod:** same sequence — deploy (drops legacy tables), reseed from prod domain data, verify, enable. Rollback is trivial: the layer is fully derived and never writes domain tables.

## Open questions

- Gross profit needs a cost basis; the current inventory-valuation machinery is the heaviest subsystem. Near-term: fold `gross_profit` only from facts carrying a cost snapshot (as today's `snapshottedGrossProfit` does) and report `uncostedRevenueMinor` honestly. Inventory valuation redesign is out of scope here.
- Sweep cadence (5 min proposed) trades overview freshness against re-run cost linearly; tune on wigclub.
- Whether `reportRangeResult` needs chunking for very wide SKU results (>1 MiB doc limit) — decide when the first real custom range exceeds a single doc.
