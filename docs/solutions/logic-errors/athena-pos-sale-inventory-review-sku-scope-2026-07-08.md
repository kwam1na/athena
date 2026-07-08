---
title: Athena POS Sale Inventory Review SKU Scope
date: 2026-07-08
category: logic-errors
module: athena-webapp
problem_type: logic_error
component: service_object
symptoms:
  - "A synced completed sale with one inventory review SKU can suppress sale inventory movements for unrelated SKUs"
  - "Operators resolve an inventory review for the failed SKU while other valid sale SKU movements never appear"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags:
  - pos
  - local-sync
  - inventory
  - stock-adjustments
---

# Athena POS Sale Inventory Review SKU Scope

## Problem

POS sale projection can preserve a completed transaction while routing some inventory demand to review. That review state is SKU-scoped; it is not the same as a hard projection conflict for the whole sale.

If projection treats any reviewed inventory item as a transaction-level stock mutation blocker, valid SKUs in the same completed sale lose their sale movements and stock decrements. The review work item only asks operators to resolve the failed SKU, so the unrelated skipped movements have no obvious recovery path.

## Symptoms

- A mixed-SKU synced sale creates inventory review work for one SKU.
- Other SKUs in the same sale do not receive sale inventory movements even though they have enough stock.
- Retrying the already-projected sale does not backfill the missing eligible movements.

## What Didn't Work

- Treating reviewed inventory demand as a sale-wide mutation blocker preserved the transaction but skipped unrelated SKU movements.
- Replaying an already-projected sale without movement idempotency risked duplicate stock decrements.
- Revalidating ordinary projected sale retries against current stock could create false review work for sales already applied correctly.

## Solution

Keep hard conflicts and reviewed inventory skips separate:

- Hard inventory conflicts still block all sale inventory mutation for the event.
- Non-blocking reviewed inventory skips are SKU-scoped. Exclude only `skippedMutationItems` from sale movement aggregation.
- Continue creating the `synced_sale_inventory_review` work item for skipped SKU demand.
- Still project sale movements and SKU patches for trusted, eligible SKUs in the same completed transaction.
- On replay of an already-projected sale, only use the reviewed-sale backfill path when the event has a resolved or explicitly reviewed inventory conflict.
- Record sale inventory movements idempotently so a retry that backfills once does not decrement stock again.

## Why This Works

The projection can distinguish between demand that is unsafe to mutate and demand that is still trusted. Keeping that distinction at the SKU level lets Athena preserve the completed sale, keep review work focused on the bad line, and still maintain ledger accuracy for the good lines.

The reviewed replay gate prevents normal retries from creating new operational review work after stock has changed for unrelated reasons. Idempotent sale movement recording lets the same retry safely run again after a successful backfill.

## Prevention

- Test mixed-SKU sales where one SKU creates review work and another SKU should still write a sale inventory movement.
- Assert single-SKU review cases still write no movement for the reviewed SKU.
- Assert hard inventory conflicts still suppress all movement, even if the sale record is preserved for review.
- Test already-projected sale retries both with and without reviewed inventory conflict history.
- Test the second retry after backfill and assert no duplicate movement or stock patch is recorded.

## Related Issues

- [Athena Legacy Import Onboarding POS Visibility](./athena-legacy-import-onboarding-pos-visibility-2026-07-08.md)
