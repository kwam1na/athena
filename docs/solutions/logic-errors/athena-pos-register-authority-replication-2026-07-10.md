---
title: Athena POS Register Authority Replication
date: 2026-07-10
category: logic-errors
module: athena-webapp
problem_type: logic_error
component: database
symptoms:
  - "A cloud-closed register could show the drawer gate while the local command gateway reused the old drawer"
  - "Paused terminal heartbeat could prevent remote register closure from reaching IndexedDB"
  - "Presentation and cashier commands could make drawer decisions from different authority sources"
  - "A wedged IndexedDB read could leave POS visibly stuck on register readiness"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags:
  - pos
  - local-first
  - drawer-authority
  - indexeddb
  - convex
  - reconciliation
delivery_diff_fingerprint: d0092bd6fc5b6625cca578a2214d584436307f365f8beeff5ab92f196b783d12
---

# Athena POS Register Authority Replication

## Problem

POS drawer commands were local-first, but remote register lifecycle changes did
not have a dedicated local-first replication lane. The view model could react
directly to a closed Convex session while IndexedDB still considered the mapped
local drawer usable, so submitting the displayed gate reused the old drawer.

## Symptoms

- Cash Controls closed a cloud register session, but its POS terminal still
  lacked matching `cloud_closed` authority in IndexedDB.
- The register displayed an opening gate because a reactive Convex query saw
  the closure, yet gate submission selected the same closed drawer again.
- Pausing runtime heartbeat also paused the only ordinary server-to-local drawer
  directive path.

## What Didn't Work

- Reading Convex directly in the view model fixed presentation only; the local
  command gateway still made decisions from durable IndexedDB state.
- Asking the drawer command to consult Convex would have made the cashier write
  path cloud-first and broken offline continuity.
- Keeping closure on runtime-status responses coupled correctness to an optional
  diagnostics heartbeat.

## Solution

Replicate exact register lifecycle authority into IndexedDB independently of
heartbeat, cashier presence, and outbound event upload:

- A terminal sync-secret-authenticated query accepts at most 16 locally known
  drawer candidates and validates exact store, terminal, local, mapping, cloud,
  and register scope. Invalid or foreign subjects return redacted repair state.
- Register lifecycle transitions and mapping repairs carry separate monotonic
  revisions. Mapping authority is the primary epoch; lifecycle revision is
  compared only within the same mapping epoch and exact cloud subject.
- IndexedDB applies observations transactionally across mapping and authority
  records. It revalidates the complete mapping fingerprint before commit and
  rejects stale, duplicate, lower-confidence, conflicting, or invalidated
  observations without changing local authority.
- Dedicated server authority and local sync-review authority remain independent
  channels in the existing authority record. Settlement or terminal recovery
  cannot clear versioned server evidence.
- The inbound runtime remains mounted while POS is open even when heartbeat is
  paused or no cashier is signed in. Loading and transport absence preserve the
  last durable local state.
- Local POS readiness has a bounded IndexedDB read timeout. A wedged browser
  store now becomes an actionable local-store repair state instead of an
  indefinite checking screen.
- The runtime keys reconciliation effects by semantic snapshot and candidate
  content rather than object identity. Fresh-but-equivalent Convex results or
  local projections therefore cannot create an apply-refresh render loop.
- The register view model uses the refreshed local projection as its sole drawer
  decision source. Convex register state remains passive enrichment.

Remote closure is authority evidence only. It does not synthesize a local
closeout, cash count, variance, approval, or financial event. With an old draft,
the cart stays visible and read-only until the cashier explicitly records
`cart.cleared`; only then may the register open a distinct replacement drawer.

## Why This Works

Presentation and commands now consume the same durable local projection. The
two-part cursor prevents both stale lifecycle responses and repaired mapping
subjects from regressing authority, while full mapping revalidation closes the
race between candidate selection and IndexedDB commit. Legacy runtime directives
remain compatible but cannot outrank versioned dedicated observations.

Snapshot application also requires a complete one-to-one match with requested
candidates before applying anything. Replication acknowledgements are
terminal-scoped, cursor-validated, redacted, coalesced, and advisory; they never
authorize cashier commands or retire compatibility by themselves.

## Prevention

- Do not put correctness-bearing server directives exclusively on heartbeat,
  runtime-status, terminal-health, or recovery-command paths.
- Do not let a reactive cloud query directly gate a local-first cashier command.
- Preserve exact local/cloud identity and compare the full mapping fingerprint
  atomically before accepting inbound authority.
- Distinguish a local-only unmapped drawer from an orphaned cloud-backed
  drawer. A candidate without a cloud claim remains locally usable and eligible
  for upload; a candidate that names a missing cloud session may accept an
  exact-subject tombstone at the current mapping epoch. Do not apply that
  tombstone to a different cloud subject or use it to replace generic
  `repair_required` evidence.
- Preserve that distinction in the local authority reason and replacement-open
  policy. A proven missing cloud session should route to the new-drawer gate;
  converting it to generic `authority_unknown` creates a repair loop because
  retrying cannot make an authoritatively deleted session reappear.
- Treat a server bootstrap identity as a distinct legacy authority shape. When
  the server issued the same ID for both local and cloud session identity, the
  exact store, terminal, register, and lifecycle match can remain authoritative
  without a sync-mapping row. A different local ID claiming that cloud session
  must still resolve to repair.
- When an older redacted repair observation must converge back to that verified
  subject, restore its subject only inside the atomic local mapping check. Do
  not relax same-epoch subject comparison in the general reconciler.
- Keep server lifecycle authority separate from local reconciliation review so
  either channel can be resolved without erasing the other.
- Test both delivery orders for mapping and lifecycle revisions, heartbeat-off
  mounting, partial snapshots, mapping races, old-cart clearing, and distinct
  replacement drawer identity. Force fresh object identities for unchanged
  snapshots and candidates so semantic effect stability is covered explicitly.
- Live-test both closure origins: closeout from the register and closeout from
  Cash Controls. In both cases POS must observe the cloud closure, show the
  replacement-drawer gate, and create a distinct replacement session instead of
  reusing the closed session.
- Keep legacy delivery until build adoption and live canary evidence prove the
  dedicated channel; remove it only in a separately planned follow-up.

## Live Verification Notes

- In-app browser on the fresh local origin `127.0.0.1:5702` loaded POS without
  the stuck checking state after terminal provisioning.
- Register 9 completed a real dev cash sale for `Oshe` at GH₵5,500,
  transaction `#089899`, then closed cleanly with counted cash GH₵5,500.
- Cash Controls closed replacement session `8A8HSF` with counted cash GH₵0.
  Returning to POS showed the replacement-drawer gate.
- Opening from that gate created a distinct session `8A9Y7V`, proving the
  closed Cash Controls session was not reused. `8A9Y7V` was then closed from
  Cash Controls and POS returned to the closed-drawer gate.
- The reload, sale, register closeout, Cash Controls closeout, replacement
  open, and cleanup return checks emitted no fresh `Maximum update depth
  exceeded` logs.

## Related Issues

- [Athena POS Register Commands Are Always Local First](../architecture/athena-pos-always-local-first-register-2026-05-14.md)
- [Athena POS Drawer Sync Contract](./athena-pos-drawer-sync-contract-2026-06-27.md)
- [Athena POS Runtime Decoupling Boundaries](../architecture/athena-pos-runtime-decoupling-boundaries-2026-06-15.md)
- [Athena POS Register Lifecycle Policy](../architecture/athena-pos-register-lifecycle-policy-2026-06-23.md)
