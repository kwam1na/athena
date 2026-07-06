# POS Sync Finalized-Lineage Remediation

Use this runbook after deploying the finalized-lineage POS projection policy.
It corrects existing `posLocalSyncEvent` rows that were already conflicted by
the old inline policy:

- conflict summary: `Provisional import row changed before this offline sale synced.`
- event type: `sale_completed`
- event status: `conflicted`
- sale payload contains `inventoryImportProvisionalSkuId`
- referenced provisional import row is finalized, or closed with `finalizedAt`

The remediation does not go through Cash Controls manager approval. It replays
the stored POS sync event with the same projection machinery used by terminal
retry, resolves the old conflict only when replay projects cleanly, and creates
`synced_sale_inventory_review` when trusted inventory preconditions still fail.

## Preconditions

- The finalized-lineage policy deploy is live in production.
- Candidate event ids are collected from the affected store and checked against
  the conflict summary above.
- Candidate event ids are scoped to one `localRegisterSessionId` per run.
- The product/SKU referenced by each finalized row is store-owned and still
  matches the sale line.
- A unique `repairRunId` is chosen before execution, for example
  `pos-finalized-lineage-2026-07-06-001`.

## Dry Run

Run the internal mutation with explicit event ids:

```bash
bunx convex run --prod \
  pos/application/sync/finalizedLineageRemediation:repairFinalizedLineageConflictedSales \
  '{"dryRun":true,"storeId":"<store_id>","localRegisterSessionId":"<local_register_session_id>","eventIds":["<pos_local_sync_event_id>"]}'
```

Expected dry-run output:

- `candidates` contains the event ids that still match finalized lineage.
- `skipped` explains any row that no longer matches the repair scope.
- `failed` and `repaired` are empty.

Do not execute against rows that are only skipped. Investigate the skip reason
first; common reasons are `event_not_conflicted`,
`missing_finalized_lineage_repair_conflict`, and
`no_repairable_finalized_lineage`. A row with
`event_has_unrelated_open_conflicts` still has another manager-review blocker
and must not be repaired by this command until that blocker is resolved through
its owning workflow.

## Execute

Execute only the candidate ids returned by dry run:

```bash
bunx convex run --prod \
  pos/application/sync/finalizedLineageRemediation:repairFinalizedLineageConflictedSales \
  '{"dryRun":false,"repairRunId":"pos-finalized-lineage-2026-07-06-001","storeId":"<store_id>","localRegisterSessionId":"<local_register_session_id>","eventIds":["<pos_local_sync_event_id>"]}'
```

Expected execution output:

- `repaired` contains the remediated event ids.
- `failed` is empty.
- `skipped` is empty or contains only rows that drifted after dry run.

If `failed` is non-empty, do not retry blindly. Inspect the event's new conflicts
and verify whether the row still satisfies the finalized-lineage preconditions.

## Verification

For each repaired event:

- `posLocalSyncEvent.status` is `projected`.
- Old row-changed `posLocalSyncConflict` records for the event are resolved.
- A `posTransaction` mapping exists for the sale's `localTransactionId`.
- Persisted POS session and transaction items still include the original
  `inventoryImportProvisionalSkuId`.
- If stock was safe, a trusted inventory movement exists and the SKU stock was
  decremented once.
- If stock was unsafe, an Operations work item exists with local id
  `<localTransactionId>:inventory-review` and type
  `synced_sale_inventory_review`.
- An operational event with type
  `pos_local_sync.finalized_lineage_repaired` records the `repairRunId`.
- Cash Controls register review no longer shows the sale as an apply/reject
  blocker; any remaining inventory decision appears in Operations.

## Rollback

Do not manually set repaired events back to `conflicted`. The replay writes sale
records, mappings, inventory movement evidence, and possibly Operations work.
If a repaired event needs correction, use the domain correction or inventory
review workflow that owns the affected durable record.

If execution created unexpected conflicts, leave the event in its current state,
record the `repairRunId`, and investigate the projection failure before another
run.
