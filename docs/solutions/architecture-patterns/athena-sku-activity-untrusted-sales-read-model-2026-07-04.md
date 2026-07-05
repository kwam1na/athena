---
title: "Athena SKU Activity Untrusted Sales Read Model"
date: 2026-07-04
category: architecture-patterns
module: athena-webapp operations
problem_type: architecture_pattern
component: service_object
resolution_type: code_fix
severity: medium
applies_when:
  - "Building operations evidence views for provisional import or pending checkout sale activity"
  - "Adding source-linked transaction history without making SKU Activity a mutation surface"
  - "Choosing between fresh indexed reads and a materialized projection for operator triage"
tags:
  - sku-activity
  - untrusted-sales
  - provisional-import
  - pending-checkout
  - operations
---

# Athena SKU Activity Untrusted Sales Read Model

## Problem

SKU Activity was originally a manual lookup surface: operators needed to know a
SKU before the workspace could explain stock and reservation activity. That left
legacy import provisional SKUs and POS pending checkout items with completed
sales hard to triage, even though those sources are exactly the untrusted
catalog evidence operators need to review.

The tempting shortcut is to build a materialized SKU Activity projection or to
fold provisional sales into trusted inventory. Both options add drift or blur
ownership. The operator needs fresh evidence and review handoffs, not a new
stock mutation path.

## Solution

Keep SKU Activity read-only and source-aware:

- List untrusted sale sources from source-of-truth rows with sale-evidence
  indexes. Legacy import rows read from `inventoryImportProvisionalSku`, and
  pending checkout rows read from `posPendingCheckoutItem`.
- Authorize the public Convex query before reads. The browser route gate is not
  the security boundary.
- Pass source filters to the backend query before limiting rows. Do not take a
  mixed first page and filter it client-side.
- Load selected-source transaction history only after selection, using narrow
  source-id indexes on `posTransactionItem`.
- Hydrate parent `posTransaction` rows before returning history, verify the
  parent store, sort by `completedAt`, then apply the UI limit.
- Compare aggregate sale evidence with transaction-backed rows. If a source has
  sale evidence but no matching completed transaction lines, render a diagnostic
  instead of pretending the source has no circulation.
- Route each source to its owning review surface. Pending checkout sources go to
  pending checkout review. Linked legacy import sources can go to product SKU
  review. Unlinked legacy import sources need an inventory import review
  fallback.

For v1, prefer fresh indexed reads over a scheduled projection. A projection is
only worth adding after production metrics show the bounded indexed reads are
too expensive and the team has defined freshness, repair, and drift diagnostics.

## Why This Matters

Untrusted sale evidence sits between checkout history and catalog trust. If SKU
Activity mutates stock or hides provenance, operators can accidentally treat
legacy import or pending checkout rows as trusted inventory. If it scans or
projects too much at query time, the workspace becomes expensive or stale.

The read-model pattern keeps the ownership clean:

- Source rows own provisional and pending review state.
- POS transaction items own completed sale facts and source provenance.
- SKU Activity owns authorized inspection, diagnostics, and navigation.
- Product edit, inventory import, and pending checkout workflows own mutation.

The UI should be equally honest about bounds. If transaction history is capped,
show a load-more control while possible. Once the hard cap is reached, show a
bounded-history diagnostic with available review and transaction links. Do not
leave the operator at a passive "latest records" badge with no next step.

## Prevention

- Add or verify source-list indexes before shipping proactive evidence views.
  Querying unsold rows to discover sold rows will not age well.
- Keep source summary pagination and selected-source transaction pagination
  independent. Selecting a source should not require loading every source row.
- Add regression tests for newest transaction ordering when transaction items
  are not naturally returned by parent transaction time.
- Add route tests for default no-SKU workspace behavior, SKU lookup preservation,
  server query args, and mode-specific error copy.
- Run Convex codegen, changed-file lint, typecheck, focused tests, browser
  verification, and graphify rebuild after changing this surface.

## Examples

Backend query shape:

```ts
const untrustedSkuSales = useQuery(
  api.operations.skuActivity.getUntrustedSkuSaleEvidence,
  {
    limit: sourceLimit,
    reviewStatus,
    selectedSource,
    sourceFilter,
    storeId,
    transactionLimit,
  },
);
```

Selected-source history ordering:

```ts
const candidates = [];
for (const item of items) {
  const transaction = await ctx.db.get("posTransaction", item.transactionId);
  if (!transaction || transaction.storeId !== storeId) continue;
  candidates.push({ item, transaction });
}

candidates.sort((left, right) =>
  right.transaction.completedAt - left.transaction.completedAt
);

return candidates.slice(0, transactionLimit);
```

Review handoff rule:

```ts
if (source.sourceType === "posPendingCheckoutItem") {
  return "Review pending checkout";
}

if (source.productId && source.productSkuId) {
  return "Review SKU";
}

return "Review import";
```

## Related

- [Athena SKU Activity Must Explain Reservation Sources](../logic-errors/athena-sku-activity-traceability-2026-05-13.md)
- [Athena POS Provisional Import Trust Boundary](../architecture/athena-pos-provisional-import-trust-boundary-2026-06-10.md)
- [Athena POS Provisional Import Availability](../architecture/athena-pos-provisional-import-availability-2026-06-11.md)
- [Athena POS Pending Checkout SKU Alias](../architecture/athena-pos-pending-checkout-sku-alias-2026-07-03.md)
- [Athena Pending Checkout Archive Work Lifecycle](../logic-errors/athena-pending-checkout-archive-work-lifecycle-2026-07-04.md)
