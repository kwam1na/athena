---
title: Athena POS Catalog Visibility Policy
date: 2026-07-08
category: logic-errors
module: athena-webapp
problem_type: logic_error
component: service_object
symptoms:
  - "A SKU can need POS checkout availability without becoming visible on the online storefront"
  - "Legacy hidden products with no POS-specific flag can accidentally become sellable when POS filters ignore storefront visibility"
  - "Product-id lookup paths can disagree with register catalog search about whether an online-hidden SKU is POS-saleable"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags:
  - pos
  - inventory
  - catalog-search
  - storefront-visibility
---

# Athena POS Catalog Visibility Policy

## Problem

Athena has two separate catalog visibility questions: whether a SKU should appear on the online storefront, and whether a staff-operated POS terminal may sell it. Reusing `isVisible` for both makes trusted inventory onboarding either expose products online too early or keep sale-ready stock out of POS checkout.

## Symptoms

- Finalizing trusted import stock requires POS availability, but should not automatically publish the product to the storefront.
- A SKU with `isVisible: false` and `posVisible: true` is valid for POS, but can be dropped by product-id lookup paths that prefilter hidden SKUs.
- A legacy SKU with `isVisible: false` and no `posVisible` must remain POS-hidden; otherwise old hidden catalog rows can become saleable by accident.

## What Didn't Work

- Treating `isVisible` as the only catalog gate forced a false choice between online publication and POS checkout availability.
- Adding POS checks in only register search left other checkout paths, pending trusted-catalog matching, and transaction adjustments with different behavior.
- Making new review payload fields required broke older callers that still submit only storefront visibility.

## Solution

Use `posVisible` as the explicit POS saleability flag and keep `isVisible` as the storefront-facing default. Centralize the fallback rule:

```ts
export function isPosCatalogVisible(value: {
  isVisible?: boolean | null;
  posVisible?: boolean | null;
}) {
  return (value.posVisible ?? value.isVisible) !== false;
}
```

Apply the same rule everywhere POS determines saleability:

- register catalog list and search queries;
- trusted pending checkout matching;
- transaction adjustment planning;
- client catalog gateway product-id lookup;
- trusted inventory finalization and repair flows.

When a POS path needs to evaluate an online-hidden SKU, fetch enough data to apply the POS policy locally. For example, product-id lookup can request hidden SKUs with `includeHiddenSkus: true`, then filter with `isPosCatalogVisible` instead of letting the generic product query discard online-hidden rows first.

Keep review APIs backward-compatible while clients roll forward. If `reviewedPosVisible` is omitted, normalize it from the submitted `reviewedIsVisible` before validation, hash comparison, and payload matching.

## Why This Works

`posVisible` makes POS checkout eligibility an explicit operational decision instead of a side effect of storefront publication. The legacy fallback preserves old hidden rows: missing `posVisible` follows `isVisible`, so historical hidden SKUs do not suddenly become sellable.

Centralizing the predicate prevents register search, direct barcode/product lookup, pending review, and adjustment flows from drifting into subtly different catalog policies.

## Prevention

- Test explicit `posVisible: true` with `isVisible: false` in every POS saleability path that can find catalog SKUs.
- Test explicit `posVisible: false` and legacy `isVisible: false` with missing `posVisible` as separate hidden cases.
- Keep product-level and SKU-level projection helpers together so queries that use denormalized search rows share the same fallback semantics.
- Preserve optional review payload fields until all clients are known to send the POS-specific value.

## Related Issues

- [Athena Legacy Import Onboarding POS Visibility](./athena-legacy-import-onboarding-pos-visibility-2026-07-08.md)
- [V26-983: Split POS checkout visibility from online storefront visibility](https://linear.app/v26-labs/issue/V26-983/split-pos-checkout-visibility-from-online-storefront-visibility)
