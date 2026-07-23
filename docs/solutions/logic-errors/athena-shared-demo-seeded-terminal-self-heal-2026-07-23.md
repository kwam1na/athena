---
title: The Shared-Demo Seeded Terminal Had No Durable Handle — Self-Heal on Every Provision
date: 2026-07-23
category: logic-errors
module: athena-webapp
problem_type: logic_error
component: shared-demo-provisioning
resolution_type: bug_fix
severity: high
applies_when:
  - A row is excluded from a restore/reset registry but other restored rows reference it
  - A seeded record can be deleted but only recreated on a code path a live store no longer takes
  - A demo/fixture card renders with a blank field that a join is silently dropping
tags: [shared-demo, provisioning, pos-terminal, restore-registry, dangling-reference, self-heal, deploy]
delivery_diff_fingerprint: 70b297ed12ab627deae5d5079734d400f0efa259a2e49c6efca02efab9a3e52c
---

# The Shared-Demo Seeded Terminal Had No Durable Handle — Self-Heal on Every Provision

## Problem

In prod, the shared-demo register card rendered `Register 01 8AX49W` with **no terminal
name** — it should read `Studio Front Counter`. The name is not stored on the session; it
is a join: `listTerminalNames` does `db.get("posTerminal", session.terminalId)` and drops
the entry when the terminal is missing. So the seeded register session's `terminalId`
resolved to nothing.

Reading prod confirmed it: the demo store held exactly one `posTerminal` (`Courtyard Till`,
a real browser terminal), and **no** row with `fingerprintHash: "shared-demo-terminal"`.
The seeded terminal was gone. The register session `ts724fwk…8ax49w` and its captured
`sharedDemoBaselineDocument` both still pointed at the deleted id `rs7agp84…`.

It was self-perpetuating. `posTerminal` is deliberately **excluded** from
`SHARED_DEMO_MUTABLE_TABLES` (durable device registration must survive an hourly restore),
but `registerSession` **is** in the registry — so every hourly restore deleted and
re-inserted the seeded session straight from the frozen baseline document, re-asserting the
dead `terminalId`. And nothing recreated the terminal: at the current baseline version
`provisionSharedDemo` falls through to `kind: "existing"` with no terminal check, and the
continuity-migration branch only *patches* a terminal that already matches the fingerprint
(zero matches → no-op). Only the `reset_operational_state` branch creates a missing
terminal, and a store at the current version never takes it.

## Symptoms

- A demo register card with a blank terminal name where a seeded constant should appear.
- A `registerSession.terminalId` (and the matching captured baseline document) that resolves
  to no live `posTerminal`.
- The condition surviving every hourly restore instead of healing.
- A dev deployment that looks fine because its hourly restore effectively never runs, while
  prod — which restores hourly — reasserts the broken link every hour.

## What Didn't Work

- **Assuming a stale rename.** The first hypothesis was that the terminal carried the old
  display name. A stale rename would show the *old* name, not a blank — and reading the rows
  showed the terminal absent entirely, not misnamed. The symptom shape ruled the theory out
  before any code changed.
- **Trusting `provisionSharedDemo` to fix it on the next run.** It returns `kind: "existing"`
  at the current baseline and never inspects the terminal, so re-running provisioning was a
  no-op for the broken store. (This is the recurring failure mode: a guard that only runs
  behind a version bump that has already passed.)

## Solution

Give the seeded terminal a **durable handle** and heal it on every provisioning pass, not
only during a versioned migration.

Three composable helpers in `convex/sharedDemo/provision.ts`, keyed off two new constants in
`config.ts` (`SHARED_DEMO_TERMINAL_FINGERPRINT_HASH`, `SHARED_DEMO_TERMINAL_SYNC_SECRET_SEED`
— the fingerprint is the only stable way to find the row):

- `ensureSharedDemoSeededTerminalWithCtx` — find the terminal by fingerprint; create it when
  absent, otherwise reconcile `displayName` / `registerNumber` / `status`. This replaced the
  old find/patch/insert block in the reset branch (45 lines → 4), so there is now one
  definition of what the seeded terminal is.
- `repairSharedDemoSeededTerminalBindingWithCtx` — re-point any register-01 session whose
  `terminalId` no longer resolves, **and** the captured `sharedDemoBaselineDocument`. Both
  halves are required: fixing only the live row leaves the frozen document to reinstate the
  dead id on the next restore. Browser registers are skipped — they are transient and the
  restore sweeps them.
- `ensureSharedDemoRegisterFoundationWithCtx` — composes the two, and is called from the
  continuity-migration branch **and** the `kind: "existing"` fall-through. That last call
  site is the fix: losing the terminal is not a versioned change, so healing only reaches an
  already-provisioned store if it runs unconditionally.

A second, related gap was closed in `scripts/deploy-vps.sh`: the prod deploy now runs the
cron's own implementation (`sharedDemo/scheduledRestore:verifyHourlyRestoreNow`) right after
`convex deploy`, so a `SHARED_DEMO_BASELINE_VERSION` bump no longer locks every demo visitor
out until the top of the next UTC hour.

### Verified by running, not asserting

- Three behavioral tests in `provision.test.ts` against a real `convex-test` DB: rename
  reaches an already-provisioned store; **the exact prod shape** (delete the seeded terminal,
  confirm a fresh one is created and both the session and the baseline document are
  re-pointed); healthy bindings and browser registers are left untouched.
- Ran the real mutation against the dev deployment:
  `npx convex run sharedDemo/provision:provisionSharedDemo '{}'` → `kind: "existing"`, and
  dev still has exactly one seeded terminal — proving the new code is reached on the
  `existing` path and is a correct no-op on a healthy store.
- What was **not** verified: the repair firing against a live broken store. The only broken
  store is prod, and reproducing it means deleting a live row; prod heals on the next hourly
  cron once this ships.

## Why This Matters

**A row excluded from a restore registry still needs a durable handle and a validator.**
`registerSession` is restored while `posTerminal` is not, so a captured session can hold a
cross-table reference that nothing ever revalidates. That asymmetry will keep minting stale
links; the fingerprint constant plus the unconditional heal is what makes the reference
recoverable at all.

**Healing must not hide behind a version bump.** A store can only *lose* the seeded terminal,
never regain it, if the only recreation path is a migration the store won't take again.
Running the foundation check on every provision — including `kind: "existing"` — is the
difference between a store that self-heals hourly and one that stays broken forever.

## Prevention

- When a table is excluded from a restore/reset registry but other restored rows reference
  it, give the referenced row a stable lookup key (here, the fingerprint) and add a repair
  that re-points danglers on every provision — not only on migration.
- Repair the captured baseline document alongside the live row. A frozen fixture that
  outlives what it points at will reinstate the broken reference on the next restore.
- Treat a blank joined field as a dangling foreign key first; read the referenced table
  before theorizing about renames or display logic.
- Consider a restore-time assertion that a restored session's `terminalId` resolves — it
  would turn this class of defect into a loud failure instead of a silently nameless card.
  (Deferred here in favor of self-heal so a cosmetic gap does not fail the whole restore.)

## Related Issues

- [Shared Demo Cross-Layer Polish](../workflow-issues/athena-shared-demo-cross-layer-polish-2026-07-22.md)
  — the shared-demo surface this resilience work extends.
- [Instrument the Live State Before Theorizing](../workflow-issues/athena-pos-gate-flash-instrument-before-theorize-2026-07-19.md)
  — reading the prod rows, not the diff, is what settled the diagnosis here too.
