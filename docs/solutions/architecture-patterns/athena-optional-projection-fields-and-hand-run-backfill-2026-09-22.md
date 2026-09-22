---
title: Optional projection fields plus a hand-run backfill for productSkuSearch
date: 2026-09-22
category: architecture-patterns
module: athena-webapp/convex/inventory
problem_type: architecture_pattern
component: database
resolution_type: migration
severity: medium
applies_when:
  - Adding a field to a derived projection table such as productSkuSearch
  - A new Convex search index must exclude rows an existing index deliberately includes
  - A schema change has to deploy before every existing document carries the new field
related_components:
  - assistant
  - tooling
tags: [convex, projection, search-index, backfill, storefront-visibility, schema-evolution]
delivery_diff_fingerprint: 41b5d971698f2f2abcddec7f3c62d40555c5947b5877fe64e607a5d7b97d09ba
---

# Optional projection fields plus a hand-run backfill for productSkuSearch

## Problem

The Hey Lobby assistant needs a catalogue search that never sees barcodes or
non-visible SKUs — not in the results, and not in ranking, `hasMore` or
`exhaustive` either. The operator-facing `productSkuSearch` projection is the
opposite: it indexes the barcode on purpose and holds draft and hidden rows so
the POS can scan them. Filtering after the fact does not work, because Convex
text search ranks and truncates before any predicate the caller applies.

## Solution

Two new projected fields, a second search index over them, and a migration run
by hand after deploy.

- `assistantSearchText` is `buildSearchText` with `includeBarcode: false`. The
  catalogue importer defaults a missing SKU code to the barcode
  (`catalogImport.ts:4193`), so dropping the barcode token alone leaves the
  same digits behind under a different key; the builder also drops `sku.sku`
  when its normalized value equals the normalized barcode.
- `assistantVisible` is composite storefront visibility read off the projection
  (`isProjectionAssistantVisible` in `convex/inventory/skuSearch.ts`), the
  storefront twin of `isProjectionProductPosCatalogVisible`. The reserved slug
  sets and the `showOnStorefront` rule stay in `shared/storefrontVisibility.ts`,
  so the field cannot drift from what a customer actually sees.
- `productSkuSearch.assistant_search` indexes `assistantSearchText` with
  `filterFields: ["storeId", "assistantVisible"]`, the table's second of the
  four search indexes Convex allows.
- Both fields are `v.optional` in `convex/schemas/inventory/productSkuSearch.ts`,
  so the schema pushes against rows that do not carry them yet.
- `convex/migrations/backfillProductSkuSearchAssistantFields.ts` paginates
  `productSku` by `by_storeId` (not the projection table, so a SKU that never
  got a projection row gains one) and calls
  `upsertProductSkuSearchProjection(ctx, id, { advanceRevision: false })`.

Run it by hand after the deploy, before anything reads the new index:

```bash
# 1. Preview: counts the SKUs whose projection row is missing or lacks the field.
bunx convex run internal.migrations.backfillProductSkuSearchAssistantFields.backfillProductSkuSearchAssistantFields '{"storeId":"<storeId>","dryRun":true,"limit":100}'

# 2. Apply, one page at a time, feeding back `continueCursor` until `isDone` is true.
bunx convex run internal.migrations.backfillProductSkuSearchAssistantFields.backfillProductSkuSearchAssistantFields '{"storeId":"<storeId>","dryRun":false,"limit":100}'
bunx convex run internal.migrations.backfillProductSkuSearchAssistantFields.backfillProductSkuSearchAssistantFields '{"storeId":"<storeId>","dryRun":false,"limit":100,"cursor":"<continueCursor>"}'

# 3. Confirm coverage: `isComplete` must be true.
bunx convex run internal.migrations.backfillProductSkuSearchAssistantFields.countProductSkuSearchAssistantFields '{"storeId":"<storeId>"}'
```

`dryRun` defaults to `true`, so an argument typo previews rather than writes.

## Why This Matters

- **Key order in the projection literal is load-bearing.** `projectionsEqual`
  compares `JSON.stringify` of the stored document — whose keys Convex returns
  sorted — against the freshly built literal. A key written out of alphabetical
  position makes every unchanged SKU compare as changed forever, so every
  refresh rewrites every row. `assistantSearchText` and `assistantVisible` sort
  before `attributes`, and a test pins that a second sync of an unchanged SKU
  reports `unchanged`.
- **A missing key already counts as changed**, which is exactly what makes the
  optional-field pattern safe: every existing refresh path (product, SKU,
  category, subcategory, colour) starts maintaining the new fields the moment
  the code deploys, with no staleness window. The backfill only has to reach
  the SKUs nothing happens to touch.
- **The POS register revision must not move.** `registerCatalogProjectionsEqual`
  compares an explicit allowlist of effective fields, so new keys are ignored
  by construction and no terminal re-syncs the catalogue for a change it cannot
  see. The backfill passes `advanceRevision: false` on top of that.
- **Between deploy and backfill the index is incomplete**, so any consumer's
  "I searched everything" signal is unreliable until the count query reports
  `isComplete: true`. Order the release so nothing reads the index first.

## Prevention

- When adding a key to `buildProductSkuSearchProjection`, insert it in
  alphabetical position and re-run the unchanged-on-second-sync test.
- Declare new projection fields `v.optional` and ship the backfill separately;
  a required field cannot be pushed against existing documents at all.
- Paginate the source table, not the projection table, whenever the migration
  must also repair rows that are missing entirely.
- Keep visibility predicates in `shared/`, and pin the projected boolean
  against the shared helpers in a test rather than re-deriving the rule.
- Verify the push with `bunx convex dev --once` from `packages/athena-webapp`;
  Convex validates every existing document against the schema at push time.

## Examples

Barcode-free text, taken from the projection tests:

```ts
// sku.sku = "BW-18", sku.barcode = "ABC-123"
row.searchText;           // contains "ABC-123" and "BW-18"
row.assistantSearchText;  // contains "BW-18", never "ABC-123"

// sku.sku = " abc-123 " (the importer's barcode default)
row.assistantSearchText;  // contains neither, in any case
```

## Related

- `docs/solutions/performance/athena-generic-product-sku-search-sidecar-2026-06-25.md`
  — the original projection and its refresh helpers.
- `docs/solutions/logic-errors/athena-legacy-import-onboarding-pos-visibility-2026-07-08.md`
  — the hand-run dry-run-then-apply convention this migration follows.
