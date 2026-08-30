# Reports pipeline read efficiency

Owner: Reports. Tracking: [V26-1452](https://linear.app/v26-labs/issue/V26-1452). Design: [reviewed plan](../plans/2026-08-29-001-refactor-reports-pipeline-read-containment-plan.md).

This candidate changes development only. Production deployment, backfill, activation, rollback and PR/merge require explicit approval. Local fixture evidence is not a production savings claim. Run Convex commands from `packages/athena-webapp`, verify the deployment before every command, and add `--prod` only for an explicitly approved production operation. Never invoke reseed merely to repair a projection.

## Ownership and liveness

The existing reports cron dispatches 14 independent lanes: day folds, legacy stores, compact close evidence, overview, maintenance, weekly date resolution/current/accept/refresh, inventory companion, rollups, weekly recovery, summary ranges and retention. Store admission uses `REPORTS_SWEEP_STORE_ALLOWLIST`; unset/empty admits nothing. Store-scoped lanes rotate through at most four stores; maintenance performs global bounded expiry. Exact work is durable before dispatch, and leases recover dropped continuations. A failed data mutation rolls back; a separate mutation records bounded retry evidence.

| Source / output | Owner and boundary |
| --- | --- |
| Facts, stock and cash | Existing source transaction; no new financial eventual-consistency boundary |
| Canonical day + SKU-day | One atomic fold, immutable input capture and downstream handoff before dirty acknowledgement |
| Frozen close evidence | Scalar source invalidation, then one full close per independent materialization |
| Weekly financial frame | Exact date/current/accept/refresh work; frozen accepted values never overwritten |
| Live inventory attention | Operations compact contributions; Reports companion bound to weekly frame and freshness |
| Period SKU totals | Fresh epoch, day/SKU checkpoints, reversible unknown-profit delta, pending gate until all obligations drain |
| Custom summary | One day or 100 compact SKU rows per transaction; private partial totals; source-basis check before publication |
| Recovery / expiry | Independent cursors; child-first deletion; corrupt ownership retained and surfaced, not silently deleted |

Normal downstream work must not read full `dailyClose` or full `operationalWorkItem` payloads. Full source hydration is confined to the explicitly bounded materializer/recovery/backfill authority. Compact evidence belongs outside `reportDay` so overview/range reads do not multiply its payload.

## Engineering targets and current fixture evidence

| Execution | Target |
| --- | --- |
| Top-level dispatcher | ≤256 KiB, no source hydration |
| Cursor-batched downstream worker | ≤4 MiB / 2,000 returned documents |
| Atomic day fold | ≤4 MiB / 4,100 documents, preserving 2,000 facts + 2,000 existing SKU rows |
| Atomic acceptance / one-frame accepted parity | ≤4 MiB / 4,500 documents, preserving 4,000 weekly facts |
| Source-close materialization / recovery / backfill | ≤8 MiB, at most one full close |

These are reviewed engineering targets, not universally enforced byte limits. Maximum-cardinality fixtures have specific payload shapes; arbitrary source strings can be larger. UTF-8 serialized returned bytes omit Convex index/billing overhead. Capacity overflow must block with evidence, never truncate financial truth or silently lower existing cardinality support.

`pipelineReadCostOptimized.test.ts` charges actual dispatcher/worker calls, source handoffs, materialization, recovery, retention, failed attempts and completion probes:

| Repeated fixture | Legacy → optimized returned bytes | Documents | Query calls |
| --- | --- | --- | --- |
| Three busy weekly refreshes | 8,489,472 → 307,073 (96.4% lower) | 171 → 484 | 195 → 657 |
| Three period changes | 344,228 → 128,481 (62.7% lower) | 1,008 → 384 | 18 → 450 |

This is primarily a bandwidth optimization, not fewer queries everywhere. Initial materialization/publication costs 2,467,917 bytes versus one warmed legacy sweep at 2,829,824; this is a conservative setup comparison, not equivalent cold-start evidence or a 60% setup saving. The period fixture has no source facts/schedule: all lane attempts are charged, but completion is asserted for rollups, not weekly readiness.

The day fixture measured 1,803,397 bytes / 4,007 documents. The 4,000-fact / seven-close fixture (200 expense inputs + 1,000 frozen groups per close) reads compact children once and measures acceptance/parity against the named exception; consult `pipelineWeekly.test.ts` for current exact receipts. No fixture proves production latency or serializability under contention.

## Additive rollout and coverage

1. Preserve old schemas/readers and the existing allowlist. Deploy additive code/schema only after approval and repository gates. Source transactions dual-write compact handoffs; stores without active control continue isolated legacy consumption.
2. Read `reports/pipelineMigration:migrationStatus` for the exact store. Confirm no reseed, current source integrity and the intended deployment. A missing/ambiguous target is a hold.
3. Preview with `reports/pipelineMigration:beginMigration` and `{ "storeId": "<validated-store-id>", "epoch": "<fresh-unique-epoch>" }`. Default `dryRun` is true and writes/schedules nothing.
4. After approval, call the same function with `dryRun:false, autoContinue:true`. Retain its generation. Epoch names permit letters, digits, dot, underscore and dash, maximum 64 characters. Never reuse an old active/retired epoch.
5. Inspect status until `ready` or a typed blocker. The durable cursor walks closes, legacy exact intent, Operations contribution coverage, distinct authoritative fact dates, canonical folds, input seeding, obligation drain, source-close coverage, accepted-cutoff replay, day/input coverage and rollup parity. Quiet historical dates do not depend on surviving dirty markers. Each data page and cursor advance commit together.
6. Accepted replay uses the immutable cutoff and stored schedule lineage. Lost observation history, unverifiable source lineage/corrections, missing compact children or disagreement blocks. Do not repair by overwriting accepted totals or moving the cutoff. Establish the missing historical evidence through an approved source-backed repair, or keep the store on hold.
7. `ready` is not active. After inspecting coverage and recording approval, call `reports/pipelineMigration:activate` with the exact store, epoch and returned generation. Activation atomically checks control fence, source/accepted watermarks, target epoch, inventory coverage, zero dirty/close/period obligations and parity. A concurrent change invalidates the proof; resume and reverify rather than forcing the flag.

Shadow canonical refolds may refresh canonical day data but never write accepted baseline values or the target into published legacy rollup rows. Shadow acceptance workers do not emit new notifications. Structural notification dedupe remains authoritative when exact work is consumed after activation.

## Resume, failure and rollback

Resume the same epoch with `beginMigration` and `dryRun:false, autoContinue:true`; do not copy cursors by hand. To retry proof after an authorized correction at the same source watermark, also pass `restartProof:true`: this removes the stale proof and restarts coverage from drain, not from a manufactured success. Unexpected runner failure records `worker_failed` in the migration and the existing maintenance rail; operator resume is required. A blocked source is not a reason to loop indefinitely.

Rollback is a rebuild, not a legacy-reader toggle: begin a **fresh** epoch with `rollback:true, dryRun:false, autoContinue:true`. This fences old work, moves consumption to shadow/pending, retains prior output only as recovery evidence, and zero-builds the target. Re-run all proof and explicitly activate. This candidate supports rebuilding with the current code; it does not promise that an arbitrary older binary can understand the new state. A binary rollback needs a separately reviewed compatibility plan.

While paused or rebuilding a formerly activated store, period pages contain no financial rows/totals, current weekly completeness stays pending, and accepted history/detail carry `pending_recompute` without changing frozen baseline values. Clearing a purged epoch pointer does not restore legacy authority. Never-activated shadow stores keep the legacy read path until first activation. An old epoch cursor remains pending during recovery and requests a restart after the replacement epoch activates.

Keep legacy schemas/read paths and retired epoch metadata throughout at least the 72-hour observation window and until a reviewed rollback exercise passes. This release does not automatically delete retired epochs. Old checkpoints/proofs conservatively pin immutable inputs; narrowing schemas or removing the compatibility window is later approved work.

## Lifecycle and cleanup

- Reseed pauses/fences work before destructive pages, purges new derived state child-first, and retains `acceptedReplayUnavailableBefore`. Reconstructed observation times cannot certify older accepted cutoffs. Monotonic control `hasActivated` history survives repeated purges; migration `resumeActivePipeline` separately authorizes automatic activation for that attempt. After source replay, allowlisted stores start a fresh shadow migration and clear the purged active-epoch pointer atomically. Only a previously active store can request automatic reactivation, and only after the same proof gates. A blocked old baseline keeps it pending. A second reseed during reconstruction retains eligibility but fences the earlier continuation.
- Demo restore purges at most 100 new rows per transaction before baseline replacement. Leased restore continues until purge is complete, publishes a new control fence, and starts automatic shadow reconstruction without automatic first activation. Direct provisioning refuses an oversized atomic purge rather than committing half a restore.
- Store deletion uses the same bounded new-state purge, then existing owned cleanup. Control is removed only when deletion can complete. Organization removal processes one store per page and retains paused controls for its retained store rows; it cannot leave active workers publishing after organization deletion. Every child deletion validates store ownership.
- Summary expiry deletes at most 100 children before its header. Partially expired headers leave live-work eligibility immediately. Foreign-owned children set `summaryCleanupBlocked`; inspect the exact rows and repair ownership only through an approved targeted transaction before clearing that flag. Never delete foreign rows to unblock cleanup.
- Retention has independent close and input lanes, one header per step, 60-second leases and 15-minute cadence/backoff. It deletes at most 100 obsolete close children or 20 input chunks. A foreign-owned close child marks its header `cleanupBlocked`, records bounded blocked evidence and advances the scan so later healthy closes can clean up; later rotations retry without deleting foreign data. Current, in-flight, parity-pinned, unknown or retired-epoch input references remain retained. This deliberately favors recovery over aggressive storage reclamation.

## Production acceptance — still pending

Capture the post-#811 baseline and candidate in matched 24-hour and 72-hour UTC windows with the same deployment, allowlist and workload normalization (folds, accepted cycles, facts/SKUs). Record total/by-function Database I/O, calls, bytes/call, p95/max bytes where available, warnings, failures, oldest eligible age, blocked reasons and parity. Include all new dispatcher/worker/source-projection/recovery/retry/maintenance costs. Report migration/backfill separately, never subtract normal metadata overhead.

Pass requires lower whole-pipeline recurring read bandwidth, no downstream full-source reads, no representative read-limit warnings, target headroom, no unexplained parity difference, bounded idle cost and backlog drain without starvation. Increased call/write/scheduling cost or latency can invalidate the tradeoff even when bytes fall. Missing comparable windows, unresolved blockers, low exposure or contaminated maintenance windows are **Hold**, not Pass. Use the [existing I/O observation procedure](convex-io-containment-observation.md) for dashboard capture, but this pipeline has its own per-store capability gates. Schedule later observation only after monitoring is explicitly authorized.
