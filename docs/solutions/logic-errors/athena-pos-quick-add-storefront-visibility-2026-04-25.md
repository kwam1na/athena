---
title: Athena POS Quick-Add Items Must Stay Out of Storefront Catalogs
date: 2026-04-25
category: logic-errors
module: athena-webapp
problem_type: logic_error
component: pos-storefront-catalog
symptoms:
  - "Products created from POS quick add appeared in storefront navigation or product lists"
  - "The reserved POS quick-add category could surface beside merchandised storefront categories"
  - "Uncategorized quick-add subcategories could appear in storefront category menus"
root_cause: visibility_boundary
resolution_type: code_fix
severity: medium
tags:
  - pos
  - quick-add
  - storefront
  - inventory
  - visibility
  - cache
---

# Athena POS Quick-Add Items Must Stay Out of Storefront Catalogs

## Problem

POS quick add is an operational recovery path for checkout: when a cashier scans or searches for an item that is not yet in the catalog, Athena creates enough catalog structure to sell the item immediately. That structure is not merchandising data and should not appear on the customer-facing storefront.

## Symptoms

- A reserved `POS quick add` category appeared in storefront navigation.
- `Uncategorized` subcategories appeared under storefront categories.
- Quick-add products could be visible through storefront product list/detail APIs if they shared normal product visibility flags or stale cached product responses.

## Solution

Keep POS quick-add data hidden at every storefront boundary:

- Create quick-add products and SKUs with `isVisible: false`.
- Filter the reserved `pos-quick-add` category and `uncategorized` subcategory from storefront HTTP category/subcategory routes.
- When storefront product routes request visible products, pass an `excludeStorefrontHidden` flag through the cached product action and product query.
- Include both `isVisible` and `excludeStorefrontHidden` in the product cache key so admin and storefront catalog views cannot share incompatible cached results.

## Prevention

- Treat operational catalog buckets as reserved backend taxonomy, not customer merchandising.
- If a route powers storefront navigation or product pages, filter reserved taxonomy there even when the underlying admin APIs still need access.
- When adding a storefront-only filter behind a cached action, update the cache key in the same change.
- Add focused tests for both the route filter helpers and the cache key so the visibility boundary is explicit.
