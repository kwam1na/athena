---
title: "Athena Reporting Separates Atomic Source Effects from Asynchronous Projections"
date: 2026-07-09
category: architecture
module: athena-webapp
problem_type: architecture_pattern
component: service_object
resolution_type: code_fix
severity: high
applies_when:
  - "A source command begins emitting reporting facts or inventory effects"
  - "A reporting projection, rebuild, or activation workflow is added"
  - "Projection freshness is being considered as an operational command gate"
tags:
  - reporting
  - canonical-facts
  - inventory-valuation
  - projections
  - activation
delivery_diff_fingerprint: ff11bcbed1d63a91c479a19fa2c2c254befa7882945bf6464b0cfef693a3902f
---

# Athena Reporting Separates Atomic Source Effects from Asynchronous Projections

## Problem

Reports needs durable facts, inventory valuation, and bounded projections without
making checkout, storefront, service, receiving, refunds, or Daily Close wait
for report aggregation. Treating every reporting step as synchronous expands
operational failure boundaries, while making inventory effects asynchronous can
leave source state, stock, movement evidence, and valuation in disagreement.

## Solution

Use two coupled consistency boundaries.

The owning Convex mutation commits the accepted source transition, minimal typed
reporting ingress in a durable pending state, and any inline inventory effect
atomically. Scheduling the reporting continuation is best effort after that
durable write; scheduler unavailability must not roll back the owning money,
inventory, or Daily Close command. A stock-changing command must also commit physical quantity,
sellable availability, movement evidence, SKU Activity evidence, and the
costed/uncosted/deficit valuation position as one outcome. If that authoritative
inventory effect fails, the owning command rolls back.

Canonical commerce facts and report projections derive asynchronously from the
durable ingress. Processing must be idempotent, bounded, observable, and
replayable. Canonicalization or projection failure marks reporting health stale
or failed and retains repair evidence, but it does not reverse an already
accepted operational command.

The implementation ownership is:

- `shared/reportingContract.ts` owns browser-safe contract versions, source
  domains, completeness, and limiting-reason vocabulary.
- `convex/reporting/ingress.ts` owns typed idempotent append, sanitized conflict
  evidence, and durable pending work that can be scheduled or resumed.
- `convex/reporting/inventory` owns valuation arithmetic and immutable outbound
  basis; the owning source command remains responsible for applying the effect
  inline.
- `convex/reporting/facts.ts` and `convex/reporting/sourceAdapters` own canonical
  recognition from durable source events.
- `convex/reporting/projections` owns bounded materialized report results and
  reconciliation.
- `convex/reporting/activation.ts` owns verified-generation activation and
  rollback. `convex/reporting/public.ts` reads the active compatible generation;
  it does not recompute business meaning from mutable source rows.

## Why This Matters

Inventory correctness and report freshness have different failure semantics.
Stock, availability, movement, and valuation must never partially diverge after
a source command succeeds. A projection can lag and be repaired because its
durable ingress and canonical facts remain replayable.

The separation also keeps rollout reversible. Candidate facts and projections
can run in shadow while existing operational behavior stays authoritative. The
last verified generation remains readable until a replacement proves required
coverage, a stable watermark, compatible versions, and zero unexplained
reconciliation difference.

## Prevention

- Never call expensive aggregation or custom-range work inside checkout,
  storefront, service, receiving, refund, or Daily Close mutations.
- Never defer physical inventory, movement, or valuation effects to an
  asynchronous reporting worker.
- Give every ingress and effect a stable business identity. Exact replay is a
  no-op; conflicting reuse is quarantined with sanitized evidence.
- Route live ingestion and historical backfill through the same canonical
  identity policy, and compare fingerprints before accepting overlap as replay.
- Keep known and unknown cost portions separate. Partial cost coverage publishes
  the trustworthy known COGS while withholding unsupported profit.
- Keep revenue and valuation currencies separate. Missing or cross-currency
  evidence degrades completeness instead of inheriting today's store currency.
- Keep source adapters pure and versioned so live ingress and historical
  backfill share recognition policy without letting backfill mutate operational
  state.
- Preserve occurrence, acceptance, synchronization, and recording times as
  separate fields. A late event must not silently acquire the current cost or
  operating date.
- Preserve unknown cost, pre-cutover history, partial coverage, stale
  processing, and incompatible versions explicitly. Do not convert them to
  zero or generic no data.
- Read reports only from a verified active generation. A completed build is
  still a candidate until reconciliation and activation pass.
- Run the `convex/reporting` focused suite plus the owning source-domain tests
  whenever a command emits or changes ingress or inventory effects.

## Examples

For a merchandise sale, the owning mutation commits the sale record, stable
reporting ingress, inventory movement, and immutable valuation basis together.
It attempts to schedule canonical fact processing after the durable pending row
exists. If valuation cannot apply,
the sale mutation fails. If the projection worker later fails, the sale remains
accepted and reporting health becomes stale until pending work is resumed.

For a projection rebuild, Athena freezes a source watermark, processes bounded
batches, catches up the tail, and reconciles the candidate. Readers continue to
use the prior verified generation. Only a compatible candidate with complete
required coverage and zero unexplained difference can replace the active
generation; rollback uses the same verification boundary.

## Related

- [Athena POS Sync Projection Policy Boundary](./athena-pos-sync-projection-policy-boundary-2026-07-06.md)
- [Athena Analytics Workspace Snapshot](../performance/athena-analytics-workspace-snapshot-2026-05-08.md)
- [Athena Foundation SKU Search Catalog Summary](../logic-errors/athena-foundation-sku-search-catalog-summary-2026-06-25.md)
