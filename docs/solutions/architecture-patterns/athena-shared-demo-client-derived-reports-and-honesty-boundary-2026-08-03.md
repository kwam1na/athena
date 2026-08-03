---
title: A Client-Side Demo Read Model Must Derive Everything and Assert Only What It Can Earn
date: 2026-08-03
category: architecture-patterns
module: Athena Shared Demo / Reports
problem_type: architecture_pattern
component: frontend_stimulus
resolution_type: code_fix
severity: medium
applies_when:
  - "A public demo renders a data-heavy workspace against a store with almost no real data"
  - "Live subscriptions are being replaced by client-side fixtures on a read-only surface"
  - "A fixture must reproduce a server read model that other surfaces already render"
  - "A demo surface would have to mint lifecycle state that only a server can earn"
  - "Route search params or cursors reach a fixture that throws on unknown ids"
related_components:
  - "shared-demo-fixtures"
  - "reports-workspace"
  - "weekly-briefing"
  - "reports-catalog-lookup"
  - "browser-server-boundary"
tags:
  - shared-demo
  - client-fixtures
  - read-amplification
  - derived-not-invented
  - honesty-boundary
  - browser-boundary
  - cursor-validation
  - weekday-sweep
delivery_diff_fingerprint: bb3d49823c89bd1c4366b93b047b6c70fd67110d4e3fd991f362b5ae0d573f0d
---

# A Client-Side Demo Read Model Must Derive Everything and Assert Only What It Can Earn

## Problem

Athena's shared demo let a visitor open the Reports workspace, and the workspace
ran the real Convex reads against the demo store. The store has almost no
reporting data, so two things were true at once: the visitor saw a near-empty
workspace, and Athena paid real database reads to render that emptiness. The
cost was not one-off. `ReportsLayout` mounts `ReportsCatalogLookup` on all three
tabs, and it subscribes to `inventory.skuSearch.searchProductSkus`, so every
debounced search keystroke on any tab opened a read. Overview held four
subscriptions, Weekly one to two, Items and SKU detail one to two, and each
period change re-issued them.

The obvious fix — serve the workspace from browser fixtures — is where the real
design problem starts. A reporting surface is not a marketing screenshot. It
makes claims about money, and it sits beside Transactions and Operations
surfaces that make claims about the same money on the same dates. A fixture that
invents plausible numbers produces a demo that contradicts itself in front of a
prospect the moment they compare two tabs. And a fixture rendering a *lifecycle*
surface — Athena's weekly briefing, whose whole point is that an accepted
baseline is earned from a register close and an observed-at cutoff — can trivially
mint state that no server ever produced, which is not a rendering shortcut but a
misrepresentation of the product.

## Solution

Two client-side fixtures plus a three-state gating hook, under two rules:
**derive, never invent**, and **assert only what a client can honestly earn**.

### 1. The three-state gate

`src/components/reports/useReportsSharedDemoMode.ts` is thirty-five lines and is
the load-bearing piece:

```ts
const sharedDemoContext = useSharedDemoContext();
const isSharedDemo = sharedDemoContext?.kind === "shared_demo";
const isContextPending = sharedDemoContext === undefined;

return { isSharedDemo, isContextPending, useLiveQuery: !isSharedDemo && !isContextPending };
```

`useSharedDemoContext` has **three** states, and treating it as a boolean is the
non-obvious bug. `undefined` means the context read has not settled;
`null` means a real store; `{ kind: "shared_demo" }` means the demo. If
`useLiveQuery` were merely `!isSharedDemo`, then on every Reports mount the
pending tick would open a live subscription that the next tick discards — the
exact read this change exists to remove, paid once per mount instead of once per
visit. So `useLiveQuery` is false for **both** the demo and the pending state,
and `isSharedDemo` (not `!useLiveQuery`) selects the fixture branch. Every call
site follows the same shape: `useQuery(..., storeId && useLiveQuery ? args : "skip")`
next to a `useMemo` fixture branch, then `isSharedDemo ? demo : live`.

### 2. Derive, never invent

`src/components/shared-demo/sharedDemoReportsFixture.ts` computes every figure by
folding the transaction fixture that already drives Transactions and Operations:

```
sharedDemoOperationsFixture (getSharedDemoHistoricalDayFixture)
  -> sharedDemoTransactionsFixture (createSharedDemoTransactionFixtures)
    -> sharedDemoReportsFixture
```

There is deliberately no second sales table. It exports
`createSharedDemoReportsOverview`, `createSharedDemoReportDays`,
`createSharedDemoReportSkuMix`, `createSharedDemoPeriodSkus`,
`createSharedDemoSkuDetail`, `createSharedDemoSkuDayTransactions`,
`createSharedDemoWeeklyBriefing`, and `isSharedDemoReportsSkuId`. The whole model
is built once per `today` and cached, the same idiom the transactions fixture
uses, because views re-render on every search-param change and the fold covers 21
days by 8 SKUs.

**Voids are evidence, not revenue.** The day fold counts a non-completed
transaction toward `factCount` and then `continue`s — it contributes no sales, no
units, and no payment:

```ts
if (transaction.status !== "completed") {
  factCount += 1;
  continue;
}
```

That is the rule the real day fold applies, and it is precisely what keeps demo
net sales equal to the Operations `salesTotal` for the same date.

**Margin nulls out rather than zeroing out.** Cost basis is `unitCost` from
`shared/sharedDemoStory.ts` in minor units. An unresolvable cost sets
`uncostedRevenueMinor` and forces the profit to `null`, and that null poisons
every aggregate above it rather than silently reading as break-even:

```ts
if (lineCostMinor === null) {
  metrics.uncostedRevenueMinor += item.totalPrice;
  costMinor = null;            // day-level poison
} else if (costMinor !== null) {
  costMinor += lineCostMinor;
}
// ...
metrics.grossProfitMinor = costMinor === null ? null : metrics.netSalesMinor - costMinor;
```

The `else if (costMinor !== null)` shape matters: once poisoned, a later costed
line cannot un-poison the total. The same guard runs per SKU, at the day → period
snapshot (`grossProfitMinor === null || day.metrics.grossProfitMinor === null`),
at SKU aggregation, and on evidence rows — so a partial sum can never read as a
real margin. Every demo SKU currently carries a unit cost, so the null branch is
a guard, not a live path — which is exactly why it needs a test rather than a
comment.

### 3. The honesty boundary

`createSharedDemoWeeklyBriefing` returns
`{ status: "available", current: {...}, acceptedBaseline: null }` with
`lifecyclePosture: "live"` and `amendmentPosture: "none"`. It populates
everything a client can honestly derive from the shared history: both lanes and
their summaries, `scheduleLineage`, `completeness`, `inventoryAttention`,
`priorPeriod`, `variancePosture`, and `ownerRoutes`.

It never emits `acceptedBaseline`, `acceptedAt`, `cutoffObservedAt`, `closeId`,
`reportId`, `closePosture`, or `amendment`. Those are earned server-side from an
accepted register close and an observed-at cutoff. A browser has no close to
accept and no cutoff to observe, so minting them would show an operator an
"accepted baseline" that no close ever produced. This was an explicit product
decision taken over the alternative of staging a full accepted-week narrative,
and it is enforced rather than documented — a seven-weekday sweep asserts
`field in briefing.current` is `false` for each of the six accepted-only fields,
so any of them reappearing fails the build. The assertion tests *key presence*,
not value: re-adding a field as `undefined` still fails. That is the difference
between a boundary and a convention.

Sunday is `included: false` — **outside-schedule, not a scheduled zero day** —
because the demo store trades Monday to Saturday and is genuinely shut. Reporting
Sunday as a scheduled day that happened to sell nothing would be a different and
false claim about the business.

### 4. Untrusted input at every client entry point

Route search and route params reach these fixtures unvalidated, and the story
lookups `sharedDemoProductBySku`/`BySlug` **throw** on a miss.

- `isSharedDemoReportsSkuId` is the prefix gate (`shared-demo-sku-`), and
  `demoProductForSkuId` is the non-throwing resolver behind it. A foreign
  `productSkuId` in the URL resolves to `null`, the same "no activity" state the
  live query produces.
- An unparseable `periodKey` yields an empty period, not a throw.
- Items paging and weekly history put cursors in the URL, so cursors are
  base64 JSON validated against `v`, `periodKey`, `sortBy`, and
  `typeof afterSkuId === "string"`, all inside a `try`. Anything stale, foreign,
  or malformed returns `null`, which falls back to page one.
- A pasted `reportId` on Weekly settles to `null` (absent) rather than
  `undefined` (pending), so the route renders its unavailable state instead of
  waiting forever on a read that was never opened. Weekly history is a frozen
  `{ page: [], isDone: true, continueCursor: "" }` for the same reason.

### 5. Local catalog search

`sharedDemoCatalogSearchFixture.ts` filters the eight demo products
case-insensitively over the same field set the server indexes (name, sku, slug,
category, subcategory), ranking an exact SKU hit ahead of substring hits. It
mirrors the server's `DEFAULT_LIMIT`/`MAX_LIMIT` and reports
`candidateOverflow: false` always, because the demo catalog is enumerated in
full — there is no unread candidate page behind a search index.

## Why This Matters

The demo is a sales surface with the credibility profile of a product. Two
figures that disagree across tabs cost more than an empty workspace ever did, so
deriving from the single shared transaction fixture is not tidiness — it is the
only structure in which the demo *cannot* contradict itself. And the honesty
boundary is what keeps a demo from becoming a claim: Athena's weekly lifecycle is
a real guarantee about accepted closes, and a client-side "accepted baseline"
would quietly turn that guarantee into decoration.

**The trade, recorded honestly.** `requireReportsStoreAccess` already calls
`requireSharedDemoStoreCapabilityIfApplicable(ctx, "reports.read", storeId)`
(`convex/reports/access.ts`), so the backend gates demo reports reads today.
Going client-only in demo mode bypasses a check the platform performs. That is
acceptable here — the surface is read-only and observational, and the fixture is
static data compiled into the bundle, so there is no authority to escalate — but
it is a real trade, not a free win. A future demo surface that *writes* cannot
reuse this shape.

## Prevention

- Treat a three-state context (`undefined` / `null` / value) as three states.
  Gating a live query on `!isDemo` still opens and discards a subscription on
  every mount while the context settles; gate on `!isDemo && !isPending` and
  select the fixture branch on `isDemo`.
- Derive demo figures from the one fixture that already feeds the adjacent
  surfaces. A second seeded table is a guaranteed future contradiction between
  two tabs showing the same date.
- Apply the real recognition rules in the fixture, not just the real shapes.
  Voids must be disclosed as evidence and recognise nothing, or reconciliation
  with the operations figure silently breaks.
- Make an unresolvable cost basis `null`, never `0`, and let the null poison the
  aggregates above it. `0` is a claim of break-even; `null` is the truth.
- Never let a client mint lifecycle state a server earns. If a field requires an
  accepted close, an observed-at cutoff, or a server clock, a fixture must omit
  it — and a test must fail if it reappears, because the next person to "fill in
  the gaps" will not read the comment.
- Model a closed trading day as outside-schedule, not as a scheduled zero.
- Sweep every weekday. A date-relative fixture pinned to one weekday tests one
  seventh of its behaviour; the Monday-only `history.at(-2)!` crash in
  `sharedDemoOperationsFixture` is the precedent. Reports has period selectors
  and a weekly tab — the same shape — so its tests sweep Mon–Sun (2026-08-03 to
  2026-08-09) across all seven surfaces, and no code path indexes `.at(-2)!`.
- Guard every ratio. A zero-sales day makes each share and each change a
  divide-by-zero: `changeBasisPoints` returns `null` when the prior period is
  zero, `shareBasisPoints` returns `0` when the total is zero, and a sweep
  assertion walks every returned number checking `Number.isFinite`.
- Validate URL-borne cursors against the query they were minted for — version,
  period key, and sort — and fall back to page one on anything stale or foreign.
  Never throw on a value a user can paste.
- When a browser boundary test fails on a fixture import, fix the import, do not
  extend the allowlist. The allowlist is for provably pure modules; a module that
  imports `MutationCtx` from `_generated/server` is a genuine server module.

## Examples

**A live query opened and discarded on every mount (the pending-state trap):**

```ts
// Wrong: during the pending tick this is a real subscription.
const overview = useQuery(api.reports.queries.getOverview,
  storeId && !isSharedDemo ? { storeId } : "skip");

// Right: pending is not "live".
const { isSharedDemo, useLiveQuery } = useReportsSharedDemoMode();
const liveOverview = useQuery(api.reports.queries.getOverview,
  storeId && useLiveQuery ? { storeId } : "skip");
const demoOverview = useMemo(
  () => (isSharedDemo ? createSharedDemoReportsOverview() : undefined),
  [isSharedDemo],
);
const overview = isSharedDemo ? demoOverview : liveOverview;
```

**A boundary violation caught mid-flight.** The fixture first imported
`~/convex/reports/rollups` to reuse its aggregation helpers, and
`src/routeTree.browser-boundary.test.ts` failed. That module imports
`MutationCtx` from `_generated/server`, so it is a genuine server module and not
an allowlist candidate — pulling it in would have dragged Convex server code into
the browser route tree. The helpers were reimplemented locally instead. The
general rule: **the allowlist exists for provably pure modules, not for silencing
the check.**

## Related

- [Shared demo operational fixtures need server continuity and client overlays](../design-patterns/athena-shared-demo-operational-fixtures-2026-07-21.md) — establishes the demo fixture pattern and the operations/transactions fixtures this Reports fixture folds from.
- [A declared fold version with no producer made every report change non-retroactive](../logic-errors/athena-reports-fold-version-refold-and-store-currency-source-2026-08-02.md) — records the Monday-only `history.at(-2)!` crash in the same fixture family that motivated this branch's weekday sweeps.
- [Athena weekly reports use a schedule-day-driven projection lifecycle](./athena-schedule-day-driven-weekly-report-projection-lifecycle-2026-08-01.md) — the accepted-baseline, acceptance-cutoff, and amendment semantics the weekly fixture deliberately refuses to assert.
- [Athena reports workspace read-model boundary](./athena-reports-workspace-read-model-boundary-2026-07-11.md) — the server-shaped read models the fixtures must reproduce field for field.
- [Athena shared demo read admission rail](./athena-shared-demo-read-admission-rail-2026-07-22.md) — the server-side `reports.read` capability gate that client-only demo rendering now bypasses.
