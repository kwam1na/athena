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
delivery_diff_fingerprint: d72e41e59e9074eae482e1a915c898fd98a595348f1ca3b6a1c0299c6780625c
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

## Why This Works
Demo context has three states: loading, normal operator, and shared demo. Waiting for explicit normal context avoids cold-load admission races. Report fixture identity and live inventory identity are separate namespaces; crossing from Reports to stock needs an explicit translation.

## Prevention
Test demo and cold-load query suppression, preserved normal operator reads, all eight story SKU translations, live IDs, unknown fixture references, and actual report link arguments. Browser navigation proves the real route transitions; mocked tests alone do not.

## Related Issues
- V26-2023
- [Demo-reachable reads need their own sensor](../architecture-patterns/athena-demo-reachable-reads-need-their-own-sensor-2026-08-24.md)
