# Convex I/O containment checkpoint: 2026-07-13 predeploy baseline

## Decision

- Status: `Hold`
- Window: `predeploy baseline`
- Production deployment: `production deployment shown in Convex Usage; identifier not captured`
- UTC range: `not captured`
- Release commit: `predeploy`
- Athena build/version: `not captured`
- Recorded by: `Codex delivery operator`
- Recorded at: `2026-07-13`
- Maintenance classification: `unknown`

## Boundary evidence

- Database I/O: `29.4 GB of 50 GB billed at screenshot time`
- Function breakdown: the screenshots identify the major Dev/Prod function families, including terminal runtime status, Daily Operations detail, products.getAll, reporting backfill, homepage, and register catalog queries.
- Missing evidence: the screenshots do not preserve a reproducible UTC range, boundary totals, deployment identifier, build adoption, or maintenance classification. They establish urgency and prioritization, but not a comparable rate baseline.

## Decision rationale

This checkpoint is signed `Hold`. No before/after savings percentage may use it. The first clean, reproducible post-deploy 24-hour window becomes a forward reference, and the 72-hour window may establish whether the new rate persists. V26-1047/U8 is excluded because its Dev backfill already ran and no historical maintenance savings are credited.

## Sign-off

`Codex delivery operator` — `2026-07-13` — `Hold: comparison boundary incomplete`
