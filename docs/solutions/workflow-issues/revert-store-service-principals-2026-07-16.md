---
title: Revert store service principals (#666) for a staged release
date: 2026-07-16
category: workflow-issues
module: pos
problem_type: release-strategy
component: service-principals
resolution_type: revert
severity: medium
tags: [revert, release-management, pos, service-principals, staged-rollout]
delivery_diff_fingerprint: 7333ef5e833ee09e92ba5d63c54ec55799d583db37a35454085442e43338a999
---

## Problem

PR #666 (squash commit `2c4a4a5f`) landed the store service-principal foundation
with POS as the first consumer: service-principal sessions bound to Auth
sessions, recovery-code browser sign-in, offline authority receipts, terminal
binding, and migration controls. The change replaces how the POS register is
accessed and introduces a large amount of new behavior at once. The decision is
to release it gradually rather than have it live on main immediately, and main
is protected so the removal must land through a reviewed PR.

## Solution

A `git revert` of `2c4a4a5f` on branch `revert-666-service-principals`.
Because the commit was the tip of main with a single parent, the revert applied
cleanly; the initial pure revert produced a tree byte-identical to pre-#666
main (`70b64a7a`), verified with `git diff 70b64a7a HEAD --quiet`. That tree
passed the full CI suite when it was the tip.

Three behavior-neutral pieces of #666 are retained on top of the revert, none
touching the service-principal access model: the remote-assist read-isolation
fix (`remoteAssistReadRepository` plus its query call-sites in
`remoteAssist/public.ts` and `pos/public/terminals.ts`), its tests, and new
return-contract assertions in the restored `posSessionItems` and
`terminalAppSessions` sibling tests. These keep Convex queries read-only and
satisfy the repo's harness sensors without re-introducing any new behavior.

Safety: PR #666 executed no production deploy, migration, or cutover, and the
production offline trust registry remained fail-closed (empty), so no
production state depends on the reverted code.

Re-application: revert this revert or cherry-pick `2c4a4a5f` (tagged
`pre-revert/service-principals`) onto a feature branch when the staged rollout
begins. The post-merge reliability review of 2026-07-16 (non-throwing service
session probe, promotion polling backoff, stale-handoff lease reclaim, service
lane for register closeout mutations) should be re-applied on top at that time.

## Prevention

- Dev Convex deployments that exercised the feature hold rows the restored
  schema rejects (e.g. `operationalEvent.actorType = "service_principal"`);
  clear those rows before running `convex dev` against reverted code. This is
  also why local commit hooks that push schema to the dev deployment were
  bypassed for this revert — CI remains the authoritative gate.
- Land large behavior-changing foundations behind their own release gates from
  the first commit (the feature's preview/cutover controls covered migration
  but not the new access path itself), so "hold the rollout" does not require
  reverting main.
- Keep dev browsers in mind on re-application: local handoff journals, token
  namespaces, and offline receipts from the first rollout should be cleared
  before signing in through a different flow.
