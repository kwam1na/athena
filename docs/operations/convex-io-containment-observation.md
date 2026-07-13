# Convex I/O containment observation

This runbook is the operator-facing surface for the U1-U7 containment release. It uses Convex's Usage dashboard and bounded CLI snapshots; it does not add an Athena route, database table, telemetry write, or continuous log collector.

## Scope and interpretation

- Release surfaces: the production Convex deployment and the Athena web/POS client.
- Delivered families: shell catalog summary (U1), Daily Operations (U2), Daily Close gate (U3), terminal recovery verification (U4), runtime publisher coordination (U5), public homepage (U6), and POS catalog refresh coordination (U7).
- Deferred: V26-1047/U8. The Dev backfill has already run, so maintenance reservation work is a future safeguard and contributes no savings to this release.
- Production terminal evidence is longitudinal: M Supplies is the only production terminal sending heartbeats. It can prove before/after behavior for that terminal, but not fleet or multi-context concurrency. Deterministic tests and Dev own concurrency proof.
- A missing comparable baseline, incomplete target-build adoption, low exposure, or maintenance-contaminated window is `Hold`, never `Pass`.

## Before deployment

1. Record the UTC timestamp, production Convex deployment, commit SHA, Athena build SHA/version, current billed Database I/O, and whether any maintenance function ran in the intended comparison window.
2. In the Convex dashboard, open **Usage** and capture **Database I/O** and **Function Calls** with the same deployment and time range. Save the total and by-function breakdowns.
3. Record active callers for each family. For U3-U5, do not interpret production heartbeat results until M Supplies reports the target `appVersion` or `buildSha`.
4. Copy the checkpoint template at `docs/operations/templates/convex-io-containment-checkpoint.md` to `docs/reports/convex-io-containment/<window-id>.md`.
5. If the dashboard range or deploy/build boundary cannot be reproduced, record the baseline as `Hold` and use the first clean post-deploy window only as a new reference for later windows. Do not manufacture a before/after percentage.

The July 13 screenshots show 29.4 GB of 50 GB billed and identify the largest function families, but they do not record a reproducible start/end range or build boundary. The initial checkpoint is therefore recorded as `Hold` in `docs/reports/convex-io-containment/2026-07-13-predeploy-baseline.md`.

## Deploy

After the branch is reviewed, merged, and local root `main` is clean and aligned with `origin/main`:

```bash
scripts/deploy-vps.sh convex-prod
scripts/deploy-vps.sh athena-local
scripts/deploy-vps.sh status
```

U1-U7 ship together. There are no per-family feature flags or sequential canary progression gates.

## Point-in-time CLI evidence

Run from `packages/athena-webapp` immediately after deployment and at the 24-hour and 72-hour boundaries:

```bash
bunx convex insights --prod --details --json
```

Save the JSON outside the repository, for example under `/tmp/convex-io-containment/<window-id>/`. Insights are diagnostic: absence of an Insight is not proof of savings, and the command is not a continuous monitor.

Do not tail Convex logs. A bounded log sample may be taken only to diagnose a specific failed correctness check; raw production logs are not committed and are not required for a checkpoint to pass.

## 24-hour and 72-hour checkpoints

For each checkpoint:

1. Select the exact same production deployment and exact UTC start/end range in both **Database I/O** and **Function Calls**.
2. Record total Database I/O, billed delta when a boundary total is available, and the by-function I/O and call counts for every delivered family with traffic.
3. Derive `average bytes/call = family Database I/O bytes / family calls`. Do not compare families using bytes alone when traffic differs.
4. Classify maintenance. Exclude a contaminated range or report it separately; never credit historical or unrelated maintenance savings.
5. Record build adoption and exposure. For U3-U5, record the M Supplies target build and accepted heartbeat cycles. Use tests/Dev evidence for cross-context election, takeover, and fallback behavior.
6. Check correctness: authorization/store isolation, selected-day and week behavior, POS readiness and freshness, recovery backlog, homepage DTO/visibility/money/expiry behavior, and offline catalog readiness/retry.
7. Record each family as `Pass`, `Hold`, or `Rollback`, then record one release decision.

The 24-hour checkpoint is an early decision. Only a clean 72-hour checkpoint may claim the result is on track. If a family has insufficient traffic, keep it `Hold`; do not extend continuous observation processes.

## Decision and rollback

- `Pass`: comparable evidence exists, correctness is preserved, and the recurring I/O rate is both at least 60% below its comparable baseline and within the stricter remaining-period budget ceiling.
- `Hold`: evidence is incomplete or incomparable, exposure/build adoption is insufficient, or maintenance contaminated the window. Keep the release only when correctness is healthy and the absolute billing trajectory remains safe.
- `Rollback`: any authorization/store leak, POS readiness regression, false-offline event, recovery correctness regression/backlog growth, public merchandising contract error, loss of offline catalog readiness, or material I/O/latency regression.

Rollback is whole-surface because U1-U7 ship together and have no selective release flags: revert the release commit, redeploy the prior Convex functions, and redeploy the prior Athena client. Compatible additive indexes may remain. Record the rollback SHA, timestamps, and reason in the checkpoint report.

## Evidence storage

- Commit only the operator summary under `docs/reports/convex-io-containment/`.
- Store dashboard images/exports and Insights JSON outside the application database and repository, or in an approved CI artifact.
- Reference evidence with timestamps, filenames, and checksums or durable artifact links.
- Never add continuous logs, an in-app monitoring surface, or a recurring observation write solely for this release.
