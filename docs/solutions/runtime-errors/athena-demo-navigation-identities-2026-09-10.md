---
title: Demo navigation must respect query admission and SKU identity boundaries
date: 2026-09-10
category: runtime-errors
module: athena-webapp
problem_type: runtime_error
component: authentication
symptoms:
  - "Shared demo product detail shows Something went wrong"
  - "Stock adjustment links send fixture SKU IDs to ID-validated queries"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [shared-demo, product-detail, query-admission, sku-identity]
delivery_diff_fingerprint: d2a94cb4ce3fc105a177abc6cc8732e9713685f77268f56ce0b039098b5e9e2e
---

# Demo navigation must respect query admission and SKU identity boundaries

## Problem
Product detail mounted storefront analytics even though the shared demo intentionally denies that read. Separately, Reports linked a fixture SKU ID into the live stock workspace, whose inventory query requires a real database ID.

## Symptoms
The in-app browser reproduced `shared_demo_action_denied` from `storeFront/analytics:getAll` and an argument validation error from `stockOps/adjustments:listInventorySnapshotForProductSkus` receiving `shared-demo-sku-demo-black-soap`.

## What Didn't Work
The analytics condition checked only the active store. The stock link treated every report identity as a database ID. Type casts did not convert the fixture ID into a real catalog row.

## Solution
`AnalyticsInsights` subscribes only when demo context resolves to `null` and both store and product IDs exist. Loading or demo context skips the query; the demo shows an unavailable notice.

Report stock links use the SKU code as the stock workspace search query in demo mode. Existing bookmarked fixture links are translated at route search validation: story IDs resolve to catalog codes, live demo IDs unwrap to the underlying ID, and unknown fixture references become text searches instead of ID query arguments.

The application sweep also found legacy dashboard, asset, bag, log, and product-edit pages marked visible despite their intentionally denied reads. Those surfaces and the customer profile now use the existing restricted-surface screen before mounting queries. Product editing was already disabled in demo product details; direct edit URLs now preserve that boundary too. Inventory review now distinguishes a skipped demo read from a pending normal-operator read, showing its empty state instead of waiting forever.

## Why This Works
Demo context has three states: loading, normal operator, and shared demo. Waiting for explicit normal context avoids cold-load admission races. Report fixture identity and live inventory identity are separate namespaces; crossing from Reports to stock needs an explicit translation.

## Prevention
Test demo and cold-load query suppression, preserved normal operator reads, all eight story SKU translations, live IDs, unknown fixture references, and actual report link arguments. Browser navigation proves the real route transitions; mocked tests alone do not.

Keep the visible-surface catalog aligned with backend admission. A page containing a forbidden read needs either a deliberately scoped admission change or an explicit unavailable state before subscription. A skipped query must not drive a perpetual loading state.

`src/tests/demo/navigationCases.test.ts` now requires a reviewed expectation for every static application route and detects unintended restriction changes. `navigation.live.ts` checks real page content and error signals across the route catalog, eight report/transaction/product/stock journeys, old bookmarks, available operational records, and protected detail return paths. Run it with an explicit `ATHENA_DEMO_URL` using `playwright.demo.config.ts`. The QA smoke workflow runs it after successful QA deployment and on its existing schedule, retaining failure traces and screenshots. Keep live SKU assertions exact while tolerating harmless product-name capitalization differences. Do not count recovery/login redirects as success or mask them with automatic retries.

## Related Issues
- V26-2023
- [Demo-reachable reads need their own sensor](../architecture-patterns/athena-demo-reachable-reads-need-their-own-sensor-2026-08-24.md)

Record-detail sensors must assert the settled destination path and the identity selected from the list. A heading alone also matches a recovery page. Keep a negative control that presents the owner recovery page to those same destination assertions.
