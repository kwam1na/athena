---
title: "Athena Reporting Separates Atomic Source Effects from Asynchronous Projections"
date: 2026-07-09
last_updated: 2026-07-11
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
  - "Historical sources predate canonical period or currency evidence"
tags:
  - reporting
  - canonical-facts
  - inventory-valuation
  - projections
  - activation
delivery_diff_fingerprint: edf512b9092649516fc1dae747efc2fbbdc152d64c409f73ab7d24baf7ae23ef
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
- `convex/reporting/maintenance/backfill.ts` and
  `convex/reporting/maintenance/legacyCompatibility.ts` own governed historical
  interpretation, sealed apply manifests, durable provenance, and bounded
  retention. They never rewrite operational source records.

### Govern incomplete historical evidence explicitly

Historical compatibility is a reporting interpretation, not a source repair.
Use an immutable policy version scoped to one organization, store, and bounded
interval. One authenticated full admin creates the draft and a different full
admin approves it; actor identity comes from server authentication, never from
caller-supplied ids or automation labels. The approved hash binds the reviewed
period definition, GHS revenue-currency evidence, creator, and approver.

Do not backdate shared Store Schedule rows for reporting. Compatibility periods
remain reporting-owned and use an exactly-one lineage contract: ordinary facts
and projections reference a Store Schedule, while compatibility facts and
projections reference the approved reporting policy and hash. Lineage kind and
identity are material in fingerprints, projection aggregation keys,
reconciliation, and browser-safe results, so different interpretations cannot
silently coalesce.

Infer only the evidence the policy authorizes. Missing GHS revenue currency may
be supplied for covered POS, storefront, service, and payment events. Present
conflicting currency remains a conflict. Revenue currency never supplies
valuation denomination; absent or undenominated cost remains partial and cannot
produce known COGS or profit.

### Seal meaning before incremental apply

A paginated Convex backfill cannot hold a transaction across its full source
scan. Preflight therefore materializes sanitized canonical candidate semantics,
resolved operating date and lineage, expected outcome, fingerprint, and
inference markers into reporting-owned manifest rows. It compares the complete
manifest with the approved preview and seals an ordered digest only after exact
candidate and per-domain parity.

The write pass consumes only sealed manifest rows. It does not re-read mutable
operational records or re-resolve period meaning. A post-seal source change is a
later event or repair input; it cannot mix a new interpretation into the
approved apply. Failed or cancelled manifests become eligible for bounded
cleanup after seven days, and completed manifests after ninety days once
activation evidence is finalized. Fact-linked provenance and summarized audits
remain durable after transient manifest cleanup.

Historical apply is incremental and idempotent, not transactionally undoable.
Rollback switches only to the immediately prior compatible verified projection
generation. A fact compensation or destructive undo requires a separate design.

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
  A bounded dual-approved compatibility policy may supply missing historical
  revenue currency when its evidence explicitly establishes that denomination;
  it must never infer valuation currency or cost.
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
- Make historical policy fields widen-first in Convex schemas. Preserve old
  schedule-backed documents, enforce exactly-one lineage in new write paths,
  regenerate Convex API types, and deploy schema/functions before invoking new
  maintenance functions or indexes.
- Freeze complete candidate semantics before apply. A digest plus live source
  re-reads is not a consistency boundary.
- Keep raw manifests and fact evidence internal-only, store-scoped, indexed,
  sanitized, and lifecycle-governed.
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
generation; rollback uses the same verification boundary and changes projection
selection only.

For a missing-currency historical payment, normalize the candidate to GHS only
under its approved store/interval policy before canonical overlap comparison.
An exact GHS match records separate interpretation evidence and remains one
fact; a USD, amount, occurrence, reversal, store, or lineage mismatch remains a
conflict. The payment allocation and any existing canonical fact are never
patched.

## Related

- [Athena POS Sync Projection Policy Boundary](./athena-pos-sync-projection-policy-boundary-2026-07-06.md)
- [Athena Analytics Workspace Snapshot](../performance/athena-analytics-workspace-snapshot-2026-05-08.md)
- [Athena Foundation SKU Search Catalog Summary](../logic-errors/athena-foundation-sku-search-catalog-summary-2026-06-25.md)
- [Athena Store Schedule Foundation](./athena-store-schedule-foundation-2026-06-27.md)
