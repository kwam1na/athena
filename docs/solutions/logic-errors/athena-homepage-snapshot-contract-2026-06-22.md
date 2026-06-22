---
title: Athena Homepage Uses A Typed Public Snapshot Contract
date: 2026-06-22
category: logic-errors
module: athena-webapp
problem_type: storefront_homepage_contract_drift
component: storefront-homepage-and-admin-homepage
symptoms:
  - "Storefront homepage sections depended on multiple loosely shaped admin records"
  - "Admin homepage banner queries could crash when generated Convex functions were stale"
  - "Highlighted shop-look content could duplicate instead of behaving like a singleton"
  - "Admin placement order could disagree with storefront order when legacy rows lacked ranks"
  - "Broken product images could leak browser alt text into homepage merchandising slots"
root_cause: homepage_data_was_split_between_admin_mutations_public_bootstrap_and_storefront_mapping
resolution_type: typed_snapshot_contract_plus_admin_integrity_guards
severity: medium
tags:
  - homepage
  - storefront
  - convex
  - admin
  - snapshot
---

# Athena Homepage Uses A Typed Public Snapshot Contract

## Problem

The storefront homepage is the public entry point, but its data was assembled
from several records with surface-specific assumptions. Best sellers,
highlighted content, shop-the-look, banner messages, hero media, and product
prices could drift between admin and storefront code. That made it easy for
minor-unit prices to be formatted incorrectly, for hidden categories or
subcategories to leak into public sections, and for shop-look rows to duplicate
when operators expected one highlighted item.

The admin homepage also had a reliability gap: banner editing queried a public
function path that was not present in generated Convex artifacts, causing the
workspace to crash before operators could edit the landing page.

## Solution

Use one typed public homepage snapshot as the storefront contract:

- Add a public Convex snapshot query that returns `homepage_snapshot.v1` with
  store, hero, banner, best-seller, highlighted, and shop-look DTOs.
- Expose that snapshot through the customer-channel HTTP bootstrap route so the
  storefront gets cookies and page data from one request.
- Keep all price values in minor units in the DTO and format them only in UI
  components through the repo currency formatter.
- Hydrate category and subcategory highlighted content on the server, filtering
  hidden, reserved, cross-store, or non-live products before the storefront sees
  them.
- Treat `shop_look` highlighted content as a store/type singleton in the admin
  mutation layer and present only that singleton in the snapshot.
- Separate public active banner reads from admin draft reads so storefront
  bootstrap never depends on admin-only state.
- Put homepage placement ranking and storefront-visibility predicates in shared
  code that both Convex presenters and React surfaces import. Admin ordering,
  backend inserts, and storefront display should not reimplement rank semantics.
- Present snapshot ranks as contiguous display positions after sorting. Stored
  explicit ranks remain useful for admin edits and appends, but public DTO ranks
  must preserve final order even when production has a mix of ranked and legacy
  unranked rows.
- Render storefront and admin product-image fallbacks through the same UI-owned
  placeholder behavior. Do not let a missing or failed product image show broken
  image chrome or raw alt text in a merchandising section.

The admin side should use shared product/SKU search for homepage add flows.
That keeps product identity, category filters, and SKU details consistent with
other Athena workspaces while giving the homepage modal enough room for scanning
and comparison.

## Prevention

- Add snapshot contract tests whenever homepage DTO fields change. Cover
  visibility filtering, minor-unit values, category/subcategory hydration, and
  shop-look singleton behavior.
- Add rank migration tests with explicit non-zero ranks plus legacy unranked
  rows; then sort the returned snapshot in the storefront test path to prove the
  order cannot flip after client normalization.
- When product/category taxonomy is derived from ids instead of denormalized
  names, test both visible labels and search/filter behavior with queries that
  appear only in the derived taxonomy metadata.
- Render-test image fallback branches, not only URL-selection helpers.
- Test HTTP bootstrap routes separately from Convex presenter queries so cookie
  behavior and missing-store behavior do not regress silently.
- Keep admin homepage mutations behind full-admin guards; public homepage
  routes should only call public-safe reads.
- Do not add new storefront homepage queries that bypass the snapshot contract
  unless the contract is intentionally versioned.
- When react-day-picker or shared date controls change, run the admin TypeScript
  project because promo-code and banner countdown controls share those types.

## Related Validation

- `bun run --filter "@athena/webapp" test convex/storeFront/homepageSnapshot.test.ts convex/http/domains/customerChannel/routes/homepageSnapshot.test.ts convex/http/domains/core/routes/bannerMessage.test.ts convex/inventory/bannerMessage.test.ts convex/inventory/bestSeller.test.ts convex/inventory/featuredItem.test.ts src/components/homepage/HomepageProductPickerDialog.test.tsx`
- `bun run --filter "@athena/storefront-webapp" test src/api/homepageSnapshot.test.ts src/components/HomePage.test.tsx src/routes/-homePageLoader.test.ts src/components/home/homePageContent.test.ts`
- `bun run --filter "@athena/webapp" test shared/homepageRanking.test.ts shared/storefrontVisibility.test.ts src/components/homepage/HomepagePlacementProductImage.test.ts`
- `bun run --filter "@athena/storefront-webapp" test src/components/ProductCard.test.tsx src/components/home/HomeHero.test.tsx`
- `bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json`
- `bunx tsc -p packages/storefront-webapp/tsconfig.json --noEmit`
- `bun run --filter "@athena/storefront-webapp" build`
- `bun run pr:athena`
