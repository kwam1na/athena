---
title: "refactor: Bounded, read-efficient reports pipeline"
type: refactor
status: ready
date: 2026-08-29
---

# Bounded, read-efficient reports pipeline

## Requested outcome and finish line

Reduce recurring reports database reads after PR #811, take the best long-term approach, and close the correctness/liveness gaps exposed by the investigation. Work is isolated in `codex/reports-pipeline-read-optimization`. The user selected `plan-work` with independent subagents and unanimous reviewer alignment, then `track`, then `execute-work`.

The authorized implementation finish line is a reviewed, locally merge-ready integration candidate: all units below implemented, characterization and regression sensors passing, additive migration/cutover controls tested, operational runbook complete, and repository gates passing. Creating/merging a PR, deploying, mutating production for backfill/cutover, and declaring production savings require a subsequent explicit approval. Production acceptance criteria are specified below; they remain pending until that approval and evidence exist. Do not call a local test result a production read measurement.

Execution posture: **characterization-first**. Capture the existing financial, lifecycle, retry, and completeness contracts before replacing their implementation. New queue/digest/delta behavior then receives failing regression tests before implementation. Documentation-only work uses sensor-only posture at ticket level.

## Evidence and problem frame

PR #811 (`09bbc74d`, V26-1444) removed overview's up-to-30 full `dailyClose` hydrations by reading settled transaction counts from `reportDay`. It did not change weekly or rollup work.

Read-only production logs on 2026-08-29 showed:

| Execution | Documents read | Bytes read | Writes | Outcome |
| --- | ---: | ---: | ---: | --- |
| Before #811 | 3,743 | approximately 17.216 MB | rolled back | read-limit failure |
| 20:26 EDT, after #811 | 3,743 | 14,338,589 | 73 | success, high-read warning |
| 20:31 EDT, after #811 | 473 | 8,780,976 | 2 | success |
| Later idle ticks | 0 | 0 | 0 | success |

The pre-fix breakdown included 76 `dailyClose` documents consuming approximately 13.788 MB, versus 298 Open Work documents at 0.804 MB, 1,678 SKU-day rows at 0.851 MB, 720 period-SKU rows at 0.363 MB, and 665 facts at 0.452 MB. These are point-in-time samples, not production maxima or billing forecasts. The low-document/high-byte follow-up and source trace identify full-close weekly hydration as the first bandwidth target.

Three independent planning investigations agreed on the major causes and target architecture. Source evidence:

- `reports/sweeper.ts:634-813`: one mutation owns day folds, period rollups, overview, legacy ranges, current/accepted weeks, expiry, backstop and cleanup. A platform-limit failure rolls back unrelated work.
- `reports/weekly.ts:2151-2225`: every weekly mark pays a recent-close census plus accepted-history refresh, then the sweep refreshes exact folded dates again.
- `reports/weekly.ts:1338-1478`: one weekly marker per store holds one acceptance intent and only 16 folded dates. Distinct historical work can be overwritten/dropped.
- `reports/weekly.ts:850-875`, `:1861-1925`: weekly evidence and close posture hydrate large source documents for a small subset of fields.
- `reports/rollups.ts:186-257`: each affected period rereads all SKU-day and existing rollup rows; `take(4000)` lacks an overflow sentinel.
- `reports/sweeper.ts:638-680`, `:755-762`: old marks for blocked stores can fill global scans and starve allowed stores.
- `reports/sweeper.ts:560-595`, `:731-745`: legacy range work depends on another day fold and can be hidden behind kinded requests.
- `reports/weekly.ts:1235-1251`: financial refresh scans up to 500 full Open Work rows and 100 repairs; Open Work-only changes do not independently refresh weekly attention.

## Scope and non-goals

In scope: bounded isolated derived workers; compact close evidence; exact weekly handoffs; separate compact inventory-attention inputs; incremental period rollups with authoritative repair; independent legacy-range liveness; fair allowlisted dispatch; migration/reseed/deletion compatibility; observable recovery; verification deferral parity; tests and operational documentation.

Out of scope: changing report metric definitions, UI redesign, source transaction/stock authority, new public admin APIs, automatic financial correction, rewriting the independent verifier, notification product behavior, a repository-wide job framework, or unrelated performance work. Source financial/inventory commands remain one transaction. Existing accepted financial baselines are never rewritten by this migration.

## Requirements

- R1. The cron is a lightweight dispatcher/backstop. Each heavy unit commits independently; one poison unit cannot roll back or monopolize other units, stores, or lanes.
- R2. Downstream fold/weekly/rollup workers do not read full `dailyClose` or `operationalWorkItem` documents after cutover. A named close-evidence materializer reads each newly completed frozen close once per generation; source hydration otherwise belongs only to explicit repair/backfill and independent verification.
- R3. Exact durable identities preserve every acceptance and historical refresh; no last-N truncation substitutes for a queue. Current-week and overview refreshes may coalesce by store.
- R4. Accepted financial baselines retain immutable close/cutoff identity, matching-fold admission, notification dedupe, and orthogonal reopen/successor/amendment posture.
- R5. Missing, malformed, stale, capped, or partially materialized evidence is unavailable/incomplete, never a zero or a silently truncated total.
- R6. Ordinary rollup work is proportional to the changed day's SKU set, not the whole week/month; retries, deletes, corrections, and unknown-profit transitions are exactly invertible.
- R7. Range requests and Open Work-only changes make progress without unrelated report facts. Allowlisted work cannot be starved by blocked-store rows.
- R8. Additive migration, resume, parity verification, activation, rollback, reseed, purge and store deletion are explicit and bounded.
- R9. Lane-level outcome/backlog evidence uses existing rails; platform bytes/docs are measured separately and never inferred from application counters.
- R10. All named scenarios and repository sensors pass, all selected plan/code reviewers align, and production acceptance remains visibly pending until authorized and observed.

## Architecture decisions

### A. One dispatcher, domain-specific work, independent commits

Keep the existing reports cron and cadence. It dispatches independently budgeted lane backstops, which scan store-scoped eligibility indexes and schedule one bounded unit per worker execution. A durable work row is authority; scheduling is a fast path. A missed schedule is recovered by the next backstop. Use the existing range lifecycle's identity/fence/cursor/eligibility principles, not its range-specific API and not a generic jobs framework.

Keep `reportDirtyDay` as the source-to-fold handoff and add its store/markedAt index. New reports-local work rows use a closed discriminated kind and deterministic structural key: `close-evidence(store, closeId)`, `resolve-week-date(store, operatingDate)`, `current(store)`, `accept(store, cycleStart, closeId)`, `refresh(store, cycleStart)`, `rollup(store, operatingDate)`, `overview(store)`, and `inventory(store)`. Acceptance cutoff is write-once. Refresh rows retain the exact cycle identity; no unbounded date array. Rows have generation/eligibility and bounded failure metadata. Different kinds get separate function names and budgets even if they share a reports-local queue table.

Workers acknowledge only the generation they completed. Output/checkpoint and work advancement commit together. Unexpected failure rolls back the unit; an action wrapper records failure/backoff in a separate mutation. Known capacity refusals commit a typed blocked result without publishing partial output. Eligibility advances when dispatching, and a durable cursor rotates allowlisted stores so poison rows and large stores cannot monopolize a scan. Reseeding stores are deferred without deleting their work. Each fold handles one store-day, not ten days plus every downstream projection.

Successful fold atomically replaces day/SKU-day, captures bounded immutable rollup-input chunks from its in-memory result, and enqueues downstream work before acknowledging its dirty mark. It enqueues the operating date without requiring schedule resolution. Overview/current-week remain eventually consistent derived projections, as they already are; queries and verification must honor pending work instead of presenting it as certified fresh.

### B. Compact close companion, outside `reportDay`

Introduce a Reports-owned compact close-evidence header keyed by close ID/version with store/date indexes. It carries lifecycle identity, completed/reopened/superseded timestamps/links, expected evidence generation, published generation, validated cash/transaction/tender summary, and completeness per evidence lane. Dynamic expense-product and frozen inventory-group inputs are normalized into child rows with store, parent-header and generation ownership. Publication validates the authoritative source close's store against the work context; consumers validate header store against target report/work store, and every child against that same store/parent/generation. Foreign identifiers are refused before publication. Do not copy full snapshots, arbitrary source subjects, reviewed work, member IDs or routing payloads. Frozen inventory groups need only key, SKU, member count, minimum/maximum member creation times and completeness. Do not add evidence arrays to `reportDay`, which overview reads across up to 368 dates.

Expense children preserve the complete per-SKU input: weekly top five is selected only after summing across dates. Daily top-five plus remainder is not equivalent. Frozen inventory input preserves the existing accepted-week grouping semantics. Header publication occurs only for a complete generation; incomplete generations cannot be consumed and are cleaned child-first.

Human completion, automated completion, reopen and supersession first commit a small lifecycle/expected-generation header and durable `close-evidence` work through one shared helper using source values already in memory. This mandatory handoff invalidates obsolete lifecycle/evidence before optional materialization; if it cannot be persisted, the source mutation aborts atomically rather than committing an invisible lifecycle change. This is the same fail-closed boundary as exhausted `recordFacts` recovery and the existing uncaught exact-close dirty mark, not a new dependency on weekly freshness. Pure normalization and child-publication failures are contained in the isolated materializer and never roll back a close. The source helper performs bounded scalar writes only, with no source scans or O(products/groups) child writes.

The materializer reads one frozen source close, validates store/lifecycle/generation, normalizes it and publishes bounded child chunks plus the header generation atomically when within the proven write budget. At larger supported payloads it stages bounded generation-owned chunks and publishes only after expected counts/digest match; a stale generation cannot publish. A failed batch leaves the lifecycle header invalidated and exact retry work intact. The ordinary one-close read is paid once per new generation, not once per weekly sweep. Repair/backfill uses the same materializer. U2 proves maximum-supported source and child payload budgets and tests failures before invalidation, mid-materialization and immediately before publication.

The day fold selects close authority through the companion after activation. Weekly evidence and lifecycle posture read compact headers/children only. Missing coverage blocks the affected evidence lane and enqueues repair; normal workers never silently fall back to full close hydration. Existing source-backed code remains an explicit repair/shadow path during rollout.

Reopen semantics are explicit: active accepted-close eligibility is `completed` and neither `reopened` nor `superseded`; legacy absent lifecycle remains eligible. A refold clears active close fields until a valid successor completes. Apply this rule to day selection, new acceptance, recovery, successor selection and reseed; the independent verifier keeps its own implementation of the same semantic predicate. Accepted historical baseline values and append-only close facts remain intact with reopened/superseded posture. U1 characterizes the current selector discrepancy and U2/U4 add the narrowly scoped correction rather than preserving an accidental mismatch.

### C. Exact normal weekly work; rotating recovery

The normal current-week worker rebuilds only current financial/evidence state. Acceptance uses exact `(store, cycle, close)` work and the original `completedAt` cutoff. Historical refresh resolves one exact cycle and updates only allowed lifecycle/amendment fields. `resolve-week-date` first finds existing accepted frames by their stored bounds, then resolves schedule-based new work in its own transaction; enqueueing the date never blocks a valid fold. It atomically enqueues exact acceptance/refresh work before acknowledgement. Multiple dates in a cycle coalesce, multiple cycles never overwrite each other. Missing timezone and capped schedule history remain typed retryable blocked work; dates outside available schedule coverage are recorded terminal-ineligible, with schedule-change recovery able to re-enqueue them. Unexpected errors never acknowledge work. Schedule changes cannot reinterpret an already accepted baseline's identity.

Acceptance work has explicit terminal dispositions: accepted, already-accepted-same-identity, obsolete-reopened/superseded-close, or cycle-already-owned-by-another-immutable-baseline. Obsolete work queues any required posture/successor refresh before completion and does not defer verification forever. Missing evidence, matching-fold lag and temporary schedule unavailability remain retryable. Original close/cutoff identity survives resolution retries and is never replaced by `updatedAt` or retry time.

Remove recent-close/recent-accepted census from normal weekly processing only after exact handoffs and migration parity pass. Recovery runs on a lower cadence through a persistent rotating cursor, covers all allowlisted history eventually, and enqueues exact missing work rather than materializing many weeks inline. Source lifecycle recovery also repairs missing compact evidence. A 16-row newest-only window is not the final recovery contract.

Update verification's deferral predicate from the singleton weekly marker to pending exact work relevant to its cycle, plus existing dirty-day/reseed checks. Preserve immutable acceptance, cutoff bounded facts, final-day matching, incomplete/missing-day refusal, email timing/dedupe, and late-fact amendment behavior.

### D. Operations publishes compact inventory-attention input

Add a compact Operations-owned contribution projection updated through the existing centralized Open Work/repair mutation helpers. It contains only reporting group identity, SKU identity, member contribution, first/latest activity and evidence/repair completeness. It is not command authority and carries no customer/staff/detail payload. Reports aggregates compact contributions in a separately dirty inventory lane; financial folds do not rescan full Open Work.

Every relevant Open Work create/update/resolve/delete and oversized repair transition updates the compact contribution and marks inventory work atomically. A source-domain bounded rebuild repairs coverage. The inventory worker owns a separate current-inventory companion keyed by store and frame identity; the financial worker never patches it. Publishing a changed financial frame atomically enqueues inventory work for that frame, including calendar rollover and timezone/schedule-driven changes even when Open Work is unchanged. Inventory publication is fenced against the current frame; a frame change during work replaces/retains the new obligation rather than allowing an old worker to acknowledge it. Weekly queries remain read-only: compose inventory only when its frame matches the financial frame, otherwise return the existing unavailable attention shape. Accepted-week inventory still comes from the final close's frozen evidence. Existing public weekly response shape and route authorization stay unchanged.

### E. Incremental period rollups with checkpoints

Retain the canonical fold as input authority, but do not read mutable `reportSkuDay` metrics across rollup batches: open-day ingestion changes those metrics without advancing `certifiedFoldRevision`. During each successful fold, capture its exact SKU contributions into immutable, bounded input chunks keyed by store/day/fold revision/chunk ordinal, generated from the already-computed fold result. A complete input header records row/chunk counts and digest. Chunking adds bounded fold writes, not source reads or one extra write per SKU. Live ingestion never mutates these chunks. Historical seeding uses a canonical refold, not an arbitrary snapshot of provisional SKU rows.

A per-epoch/day/SKU applied checkpoint records the last applied contribution. The worker merges the captured input generation with prior checkpoints, updates only affected daily/weekly/monthly SKU totals, and advances checkpoints in the same transaction. A deletion phase walks prior checkpoints to subtract SKUs absent from the captured generation. Corrections/deletes subtract old contributions before adding new ones; unchanged input generation is a no-op. Track known-profit sum and unknown-profit contributor count explicitly so removing the last unknown contributor restores numeric profit. Work is cursor-batched and generation-fenced. If a newer fold supersedes an in-progress generation, the next worker reconciles from the actual checkpoints to the new immutable input; it cannot double-apply. Obsolete input chunks are deleted only after no worker can reference them.

Choose a period-level publication gate, not a full copy of every period per update. Each affected period has epoch-scoped readiness and exact outstanding day-generation obligations, created atomically with fold handoff before any delta write. The period is pending while any apply/repair is incomplete; readiness and a monotonically increasing publication revision advance atomically only when all obligations are satisfied. `listPeriodSkus` gains an explicit `ready | pending | blocked` result: pending/blocked has no financial rows or manufactured zero totals. Ready pagination binds the cursor to epoch/publication revision; a changed revision returns a typed restart result and the consumer resets pagination. Update `ReportsItemsView`, `ReportsItemsTable`, shared-demo fixtures and focused consumer tests; this is necessary status rendering, not UI redesign. Existing live-day preview remains independently available.

Authoritative full rebuild remains an explicit bounded, resumable repair/verification path within an isolated target epoch. Its source/existing reads use pagination or limit+1 refusal, never silent `take(4000)` truncation. Active-generation repair sets period pending before changing rows. A source ingestion between pages cannot contaminate captured fold input; a new canonical fold creates a new obligation.

### F. Legacy ranges use independent resumable scheduling

Keep range request identity, ownership, response shape, expiry and child-first cleanup. Give legacy summary work the same unconditional eligibility/backstop posture as kinded ranges, with a selective status/kind index and its own budget. Move its day/SKU aggregation to bounded resumable batches; do not require a touched store or allow kinded pending rows to consume its entire selection budget. Reuse existing range lifecycle fences/continuations where the semantics match. Cleanup remains a separate bounded lane.

## Implementation units and dependencies

All units form one coordinated integration batch because schema/codegen, Graphify and harness docs overlap. Tickets remain atomic; shared generated artifacts are regenerated once at integration. No separate PR is required per unit.

### U1. Characterization and read-cost contract

- Outcome: reproducible fixtures and assertions for financial/lifecycle/retry semantics and each discovered starvation/cap gap; record current source query counts and serialized fixture sizes as test proxies, explicitly not Convex billing bytes.
- Dependencies: none.
- Surfaces: `reports/sweeper.test.ts`, `weekly.test.ts`, `weeklyScale.test.ts`, `weeklyCloseEvidence.test.ts`, `rollups.test.ts`, `verificationSweep.test.ts`; a small test-only read recorder if existing mocks cannot assert source hydration.
- Scenarios: two acceptance cycles; more than 16 historical dates; reopen/successor; immutable cutoff; duplicate delivery; blocked stores saturating 60/10 global windows; cap+1 rollups; cross-day expense winner absent from daily top five; quiet-store legacy range; Open Work-only freshness.
- Sensors: focused Vitest tests on these surfaces. Capture before/after query-shape evidence for identical fixtures. No production mutations.

### U2. Compact close evidence and source lifecycle handoff

- Outcome: additive header/child schema, mandatory bounded lifecycle handoff, isolated generation-safe materializer/repair helper, all lifecycle call sites, and close-selection correction.
- Dependencies: U1.
- Surfaces: `schemas/reports`, `schema.ts`, new `reports/closeEvidence.ts` and tests, `operations/dailyClose.ts` and tests, `reports/sweeper.ts`; shared pure evidence types only if required.
- Scenarios: human/automated complete, actual source reopen → dirty fold → weekly refresh, successor then second reopen, invalid/missing evidence, repeated generation, failed publication, exact expense/group parity, write-budget refusal, materializer failure does not roll back source command, exhausted mandatory handoff failure aborts atomically, cross-store close ID/foreign-parent child/mismatched repair context refusal.
- Observability: existing reporting failure/operational event rail plus durable repair state; no per-success logs.

### U3. Isolated dispatcher and durable projection work

- Outcome: lightweight cron, fair store/lane dispatch, one-day fold workers, exact work identities, fences/backoff, independent overview and cleanup lanes, and pending-work-aware freshness.
- Dependencies: U1; integrate U2 before digest-backed fold activation.
- Surfaces: `reports/sweeper.ts`, new reports-local work/worker modules, `schemas/reports`, `schema.ts`, `crons.ts`, `crons.test.ts`, scheduled-run ledger integration where needed.
- Scenarios: dropped schedule, duplicate/stale fence, newer work while an older unit runs, failure in one lane/store, reseed deferral, saturated blocked-store rows, bounded rotating fairness, atomic fold-to-downstream handoff.
- Observability: per-lane processed/failed/blocked/backlog-oldest-age/saturation outcomes using existing scheduled-run evidence and bounded operational failure events. Platform function names provide read attribution.

### U4. Exact weekly workers and independent recovery

- Outcome: current, acceptance and refresh workers consume exact work; compact close reads; no normal census; cursor-based recovery; verification defers only relevant pending cycles.
- Dependencies: U2, U3.
- Surfaces: `reports/weekly.ts`, `weeklyCloseEvidence.ts`, new weekly worker/recovery modules, `verificationSweep.ts`, related tests, notification integration tests where acceptance is touched.
- Scenarios: all U1 weekly characterizations; multiple old cycles; backlog beyond 16; missing/capped schedules and schedule change during retry; matching final fold gate; original cutoff survives retry; late facts amend but do not rewrite baseline; reopen/reclose/successor and obsolete acceptance disposition; dropped handoff recovered; missing compact coverage is incomplete; no full close reads in downstream workers; verifier independently agrees on active-close semantics.

### U5. Compact live inventory-attention projection

- Outcome: centralized Operations contribution writes and a reports inventory worker; live attention refreshes on its own source changes and financial refresh avoids full Open Work hydration.
- Dependencies: U1, U3; U4 integrates the separate current attention result.
- Surfaces: `operations/operationalWorkItems.ts`, centralized oversized repair helpers and their callers identified by a write-site audit, new compact schema/helpers, `reports/weeklyInventory.ts`, `weekly.ts`, tests.
- Scenarios: create/merge/resolve/delete, group identity changes, repair begin/complete/failure, incomplete grouping, source-only changes, duplicate transitions, unchanged Open Work with no pending inventory work across calendar/timezone/schedule frame rollover, frame change during inventory work, frozen accepted inventory unchanged, source command authority unaffected.
- Observability: durable dirty/coverage state and existing failure events. A write-site coverage test prevents an unprojected mutation path.

### U6. Checkpointed incremental rollups and safe repair

- Outcome: immutable fold-input chunks, changed-day proportional d/w/m updates, idempotent applied checkpoints, explicit period pending/publication gate and cursor contract, bounded full-rebuild repair with no silent cap truncation.
- Dependencies: U1, U3.
- Surfaces: `reports/rollups.ts`, immutable input/worker/checkpoint/readiness schema, `reports/queries.ts`, `ReportsItemsView.tsx`, `ReportsItemsTable.tsx`, shared-demo fixtures, rollup/sweeper/reseed/query/consumer tests and admission sensor.
- Scenarios: no-op retry, new/changed/deleted SKU, zero totals, known-to-unknown-to-known profit, day/month boundary, live ingestion and refold between pages, crash after partial apply, stale worker, cursor revision restart, pending/blocked never renders partial totals, >4000 source/existing rows, repair parity with canonical full rebuild.
- Observability: exact generation/checkpoint/blocked status; no per-row success audit. Never publish a partially applied period as complete.

### U7. Independent legacy range scheduling and bounded maintenance

- Outcome: summary ranges progress in quiet stores, cannot be starved by kinded work, aggregate in bounded continuations and retain lifecycle/ownership/cleanup semantics.
- Dependencies: U1, U3.
- Surfaces: `reports/customRange.ts`, `rangeSnapshotLifecycle.ts`, `sweeper.ts`, schema indexes, range tests.
- Scenarios: quiet store; three older kinded headers; dropped/stale continuation; range expiry mid-work; large SKU range; duplicate request; owner/store isolation; child-first cleanup.

### U8. Migration, parity, activation and lifecycle maintenance

- Outcome: additive per-store pipeline capability/control, dry-run and bounded resumable close/inventory/checkpoint/work backfills, coverage/parity queries, guarded activation/rollback, reseed/purge/store deletion support.
- Dependencies: U2-U7. Backfill helper development may proceed after the associated schema contract is fixed; activation waits for all consumers and parity.
- Surfaces: reports migration/repair modules, `reseed.ts`, existing deletion/shared-demo table registries, tests and rollout runbook.
- Scenarios: quiet history; interrupted page; rerun idempotence; source changes during backfill; checkpoint seeded at 10 while legacy output advances to 20; incomplete child generation; missing exact acceptance work; legacy singleton conversion preserving intent; zero-difference shadow comparison; activation refusal on incomplete coverage; rollback and reactivation without double deltas or duplicate notifications; store deletion and reseed fence old workers.
- Existing accepted financial baselines are compared, never overwritten. Any pre-existing discrepancy is classified and blocks activation until explicitly resolved through existing repair authority.

### U9. Documentation, compounding and integration evidence

- Outcome: architecture/testing docs describe new ownership and liveness, reusable solution note captures the read-amplification lesson, operational runbook records budgets/coverage/rollback, and integration evidence is complete.
- Dependencies: U2-U8.
- Surfaces: package agent architecture/testing docs as required by harness, `docs/solutions`, `docs/operations`, plan review record, generated artifacts.
- Posture: sensor-only for documentation; integration runs all required behavior sensors.
- Sensors: focused affected Vitest tests, webapp typecheck, package `audit:convex` and `lint:convex:changed`, generated Convex refresh via `bunx convex dev --once` when schema/exports change, `graphify:rebuild`, then root `bun run pr:athena` as the final merge-ready authority. Run operation-admission check if a public wrapper/route changes; run `harness:test` if scripts change. Do not substitute an assembled broad suite for `pr:athena`.

Dependency graph: U1 → {U2, U3}; {U2, U3} → U4; U3 → {U5, U6, U7}; U2-U7 → U8 → U9. U4/U5 integrate through the fixed weekly response contract. Generated output ownership stays with the integrating agent.

## Rollout and performance acceptance

Use additive schema/writers with the existing pipeline active first. New consumers remain gated per store. Backfill compact evidence and contribution projections through bounded repair workers; dual handoffs preserve new work while the old pipeline remains authoritative. For rollups, create a separate target epoch: its output rows, checkpoints, immutable input generations and retained work are one coherent state, built from zero by applying canonical fold inputs. Never seed checkpoints against whichever legacy totals happen to be current. Legacy rows use the legacy epoch; new indexes/readers include epoch identity.

Coverage/parity compares the target epoch to the same captured fold basis and proves every later fold generation remains queued. Activation is an atomic per-store epoch/control switch guarded by complete coverage, zero outstanding target obligations, and the captured source-generation watermark; every canonical fold advances that watermark in the same transaction as its input/work, so concurrent changes conflict/retry the switch. Shadow writes never touch published legacy outputs or accepted baseline values. New acceptance notifications remain suppressed in shadow and use existing structural dedupe at activation. Activate the coherent new pipeline per store, fence old workers, and retain explicit source-backed repair for one observation window. Never run legacy wholesale rollup writes and new deltas against the same epoch.

Rollback disables new consumption, fences in-flight generations, and rebuilds an isolated legacy-compatible target from canonical input before an atomic switch; it must not expose stale legacy rows as fresh merely by toggling a flag. Pending posture remains visible during recovery. Durable exact work remains for replay, and reactivation builds/verifies a fresh coherent epoch rather than attaching old checkpoints to rebuilt totals. The runbook must state the compatibility window; removing old schemas/read paths is a later approved narrowing step only after coverage and rollback-window expiry, not an unverified cleanup in this candidate.

Initial engineering budgets to prove with fixtures and then validate against production: dispatcher ≤256 KiB and no source hydration; cursor-batched downstream workers ≤4 MiB estimated read payload and ≤2,000 documents; atomic day fold ≤4 MiB and a separate 4,100-document target covering both existing 2,000-row fact/SKU caps plus bounded metadata/handoffs; close materializer/recovery/backfill batches ≤8 MiB with one full close maximum. Every cardinality bound uses a sentinel or cursor. These are conservative design targets, not observed maxima. Maximum-supported-day and chunk-write fixtures must prove the fold budget without lowering existing supported cardinalities. If proof exceeds a target, revisit the explicit budget/architecture with reviewers before activation; do not silently reduce correctness or increase normal limits. If one source close exceeds the repair budget, record capacity-blocked and require explicit repair sizing.

Implementation budget amendment: atomic accepted-week publication and one-frame historical accepted-baseline parity have a named **4,500-document / 4 MiB** target instead of the general 2,000-document target. They retain the existing 4,000-fact limit. The fixture with 4,000 facts and seven closes, each with 200 expense-product inputs and 1,000 frozen groups, measured publication at 4,097 returned documents / 3,683,817 serialized bytes and parity at 4,088 / 3,900,858. Request-local reuse of already validated compact snapshots removed duplicate child hydration. These are maximum-cardinality fixtures for their specific payload shape, not universal bounds for arbitrary-sized strings or Convex billed/index bytes. The production headroom gate is unchanged. Feasibility and coherence/API reviewers explicitly aligned with this exception; other worker budgets remain unchanged.

Migration proof now includes all authoritative close dates, distinct fact dates, canonical-day/input coverage, source-close/compact parity, immutable accepted-baseline cutoff replay, and epoch/checkpoint/output parity. Source and accepted-baseline watermarks plus the control fence bind paged proof to activation. A retained reseed replay floor blocks old accepted cutoffs whose observation history was destroyed; unsupported legacy/correction evidence blocks rather than rewriting frozen baselines. Explicit `restartProof` restarts a repaired proof, never manufactures a passing result.

After authorized deployment, capture matched workload windows and per-function Convex Usage/insights: total Database I/O, calls, bytes/call, p95/max bytes where available, warnings/failures, oldest eligible work age, blocked reasons, and projection parity. Record 24h and 72h comparisons; normalize for folds/accepted cycles/SKU cardinality. Whole-pipeline recurring read bytes must decrease against a matched post-#811 baseline, including dispatch, downstream workers, one-time-per-close materialization, steady-state recovery, retries, maintenance and added source-side projection reads. Report migration/backfill bytes separately. Failure of this aggregate gate leaves the optimization unaccepted even when every individual function is below budget. Fixture replays must also show lower total reads/bytes for the representative large-close and repeated-period workloads, not merely redistribution between functions.

Acceptance additionally requires no downstream full-close/full-Open-Work reads, no read-limit warnings in representative busy runs, target headroom, zero unexplained parity differences, idle dispatcher bounded by small queue/control reads, and backlog drains without starvation. Do not wait 72 hours inside a blocking turn; use an approved monitoring mechanism when rollout is authorized.

Local fixture evidence distinguishes bandwidth from query volume: three busy weekly refreshes measured 8,489,472 → 307,073 serialized bytes (96.4% reduction), while returned documents increased 171 → 484 and calls 195 → 657. Three period changes measured 344,228 → 128,481 bytes (62.7% reduction), documents 1,008 → 384, and calls 18 → 450. Initial publication including conservative source rereads and materialization measured 2,467,917 bytes versus one warmed legacy sweep's 2,829,824; that is not an equivalent cold-start comparison or a 60% setup saving. The target is recurring read bandwidth, not fewer calls in every lane. Increased metadata I/O, writes, scheduling and latency must remain visible in production acceptance; per-function improvements alone cannot satisfy it.

## Approval and review record

- Planning authority: the user's requested sequence permits tracking and implementation after unanimous plan alignment.
- Required plan reviewers: coherence, feasibility, product, security/data handling, scope, and adversarial architecture. All must explicitly align with the same final revision; a failed/unavailable reviewer is not unanimous approval.
- Required implementation review: correctness, maintainability/project standards, tests, adversarial reliability/data integrity, and API contract if public types change. Findings are work; rerun affected sensors and reviewers.
- Production deploy/backfill/activation/rollback mutations and PR/merge are not authorized by this plan alone. Pause at that handoff with concrete evidence and commands/targets described in the runbook.
- Round 1: coherence and scope aligned; product required aggregate read reduction; security required tenant/child ownership checks; feasibility/adversarial required unresolved-date work, explicit rollup input/publication, coherent cutover epochs, bounded close lifecycle/materialization and an honest atomic-fold budget. These substantive fixes are incorporated above. Coherence's requirements-grouping suggestion was advisory and did not change scope.
- Round 2: coherence, product, security, scope and feasibility aligned. Adversarial review found the newly separated inventory companion needed an explicit financial-frame-change producer. Added atomic frame-change enqueueing, publication fencing and unchanged-Open-Work rollover scenarios; all Round 1 findings remain resolved.
- Round 3: unanimous alignment with zero blocking findings. Independent reviewers: `plan_feasibility` (feasibility), `pipeline_read_map` acting as adversarial reviewer, and `plan_coherence` across coherence/product/security/scope lenses. Each reread the complete final behavioral revision and explicitly aligned. Production metrics remain proof obligations, not established savings.

## Sources and reusable patterns

- PR #811 and read-only production function logs captured during this investigation.
- `reports/rangeSnapshotLifecycle.ts`: durable identity, generation fences, atomic cursor advancement, separate failure bookkeeping, eligibleAt backstop, child-first cleanup.
- `notifications/sweeper.ts` and `dispatch.ts`: independent lane budgets, durable pending state plus prompt scheduling.
- `reports/verificationSweep.ts`: independent subject executions and honest outcome evidence.
- `migrations/backfillReportFactObservedAt.ts`: dry-run, bounded resumable backfill and verified activation.
- `reports/reseed.ts`: retry-exact-page and lifecycle maintenance.
- `docs/solutions/performance/athena-convex-read-amplification-2026-06-29.md`: compact posture versus detail, completeness signals, matched production measurement.
- `docs/solutions/architecture/athena-reporting-fact-projection-boundary-2026-07-09.md`: source authority and degraded reporting.
- `docs/solutions/architecture/athena-reporting-read-optimized-redesign-2026-07-28.md`: deterministic folds, declarative liveness and independent verification.
- `docs/solutions/logic-errors/reports-fold-fields-need-an-explicit-write-and-a-version-nobody-has-seen-2026-08-05.md`: quiet historical coverage must be explicit, not assumed from future writes.

## Tracking handoff

Resolved from PR #811's V26-1444 and validated against repository context: Linear team `yaegars` (V26), project `athena`. Epic: [V26-1452](https://linear.app/v26-labs/issue/V26-1452/epic-reports-pipeline-read-efficiency).

| Unit | Ticket | Blocking units |
| --- | --- | --- |
| U1 | V26-1453 | None |
| U2 | V26-1454 | U1 |
| U3 | V26-1455 | U1 |
| U4 | V26-1456 | U2, U3 |
| U5 | V26-1457 | U3 |
| U6 | V26-1458 | U3 |
| U7 | V26-1459 | U3 |
| U8 | V26-1460 | U2-U7 |
| U9 | V26-1461 | U8 |

All nine tickets were verified parented to the epic with required posture, observability, scenario and sensor sections. Nearby active V26-1144, V26-1193, V26-1202, V26-1289 and V26-1170 cover foundational weekly work, verifier execution/alerts or presentation/warming, not this optimization; retain them as separate related work. No unrelated issue status was changed. Execute with `execute-work` against this bounded finish line.

## Prepared-candidate review refinements

The first independent prepared-candidate review found a deleted-epoch pointer after active-store reseed (P1) and a latest-only refresh lookup for overlapping accepted frames (P2). The reseed design check additionally required prior activation to survive a second purge during reconstruction (P2). Preserve monotonic control `hasActivated` history separately from the live active epoch and the migration's per-attempt `resumeActivePipeline` policy. Clear purged epoch pointers atomically when starting the replacement target, keep formerly active readers pending, and require proof before reactivation. Resolve exact date work against all accepted starts in the preceding seven-day interval, using an eight-row overflow sentinel before any partial enqueue. These refinements remain inside R3/R4/R8 and require full regression and prepared-candidate re-review; they do not authorize production activation.

The complete second prepared-candidate review confirmed all three first-round fixes and found two remaining recovery-reader gaps: formerly active shadow stores without an active epoch fell through to legacy-ready period results (P1), and paused/shadow weekly readers lost active-only pending overlays (P2). A shared recovery predicate must keep period results unavailable, current weekly completeness pending, and accepted amendment posture `pending_recompute` without altering frozen financial baselines. Never-activated shadow stores retain legacy compatibility. Registered public-query regressions must cover these transitions, including cursor recovery; a complete third review and the canonical final gate remain required.
