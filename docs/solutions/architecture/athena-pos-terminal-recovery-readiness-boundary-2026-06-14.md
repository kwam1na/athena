---
title: Athena POS Terminal Recovery Readiness Boundary
date: 2026-06-14
category: architecture
module: athena-webapp
problem_type: pos_terminal_recovery_readiness_boundary
component: pos
symptoms:
  - "Terminal Health can label a terminal healthy while Support Recovery still shows a repair state from an older command"
  - "Staff authority expiry and cleanly closed drawers can be presented as support blockers even though normal cashier action resolves them"
  - "Terminal roster and terminal detail can disagree because they derive recovery state from different evidence"
  - "Register-session review actions can toast success while older review evidence remains visible"
root_cause: terminal_health_mixed_sales_readiness_support_recovery_and_historical_command_status
resolution_type: readiness_boundary_and_recovery_preview_alignment
severity: high
tags:
  - pos
  - terminal-health
  - support-recovery
  - cash-controls
  - local-first
  - remote-commands
---

# Athena POS Terminal Recovery Readiness Boundary

## Problem

Terminal Health is a support surface, but it consumes evidence from several
different domains:

- live terminal runtime check-ins,
- cloud sync cursors and conflicts,
- local drawer and staff authority,
- register-session state,
- remote recovery command acknowledgements, and
- Cash Controls review evidence.

When those domains are collapsed into a single "healthy" or "blocked" posture,
the UI becomes contradictory. A terminal can be healthy for support purposes
while still needing a cashier to sign in. A drawer can be cleanly closed in the
cloud while stale local drawer-authority evidence still says `cloud_closed`.
A remote repair command can fail its precondition because the terminal evidence
already changed, but the old command can continue to read as the current problem.

The result is especially confusing on production terminals after support sends
remote commands: the terminal may be able to proceed through the normal POS
lifecycle while Support Recovery still foregrounds the last command outcome.

## Decision

Keep three concepts separate and derive each one from the right source:

1. **Sales readiness** answers whether the checkout station is ready for the
   next POS action. It can include normal operator next steps such as opening a
   drawer or signing in.
2. **Support recovery** answers whether support has current repair or review
   work to do. Historical command status is not current work once no blocker or
   safe action remains.
3. **Diagnostic evidence** explains what the latest terminal check-in reported.
   It is useful for support but should not automatically become a sales blocker.

The terminal roster and terminal detail must use the same recovery preview and
presentation helpers. The list card is not allowed to re-derive a weaker
readiness state from partial evidence when the detail query has already
normalized the recovery state.

## Solution

Align the backend preview, frontend presentation, and local runtime reporting
around the same readiness boundary:

- Build terminal roster rows with the same recovery preview used by terminal
  detail.
- Normalize support runtime evidence before deriving attention reasons, so a
  cleanly closed drawer does not keep a stale drawer-authority repair alive.
- Publish app-shell and active register-session evidence in terminal runtime
  check-ins.
- Hide verified terminal repair actions from the current support work queue.
- Show command failure reasons and next steps only while current support work is
  still present.
- Classify register-session review items with structured review kind and action
  policy, while preserving compatibility for older summary-only conflicts.
- Scope closeout review actions to the visible conflict ids so success reflects
  a real mutation of the intended review evidence.
- Render initial roster metrics as `-` until data arrives.

## Source Of Truth

The cloud query builds a `TerminalRecoveryPreview` from:

- the latest terminal runtime status,
- cloud sync evidence,
- active register-session lookup,
- current attention reasons,
- safe cloud repair candidates, and
- the latest terminal recovery command.

The frontend then passes that preview through
`buildTerminalRecoveryPresentation`. UI components should not infer support
recovery groups directly from raw attention reasons unless no preview exists.

Runtime check-in remains the verification source. A command acknowledgement says
the terminal ran a local helper; a fresh runtime check-in says whether the
expected evidence actually changed.

## State Rules

Use these rules when changing Terminal Health or POS runtime reporting:

- `able_to_transact_now` requires fresh runtime evidence, active register
  session evidence, and sale authority.
- `drawer_open` is an operational state, not a support repair state. It means
  the drawer is open and the next POS step is a cashier sign-in or sale action.
- `healthy_idle` means no current support blocker is visible. It does not mean a
  drawer is already open or a cashier is already signed in.
- `needs_terminal_action` is only for terminal-side repair commands that are
  still relevant. Do not use it for normal cashier sign-in.
- `needs_cloud_repair` is only for cloud-safe conflicts that can be repaired
  without touching sales, payments, inventory, closeouts, variances, or manager
  review facts.
- `needs_manual_review` is for business-fact review that belongs in Cash
  Controls or Operations.

Staff authority deserves special handling. `ready` is displayed with a check.
`expired` is displayed as expired evidence, but it should not create Support
Recovery work by itself because a cashier signing in at the terminal refreshes
it through the normal POS lifecycle.

Drawer authority also deserves special handling. A `blocked` drawer authority
with reason `cloud_closed` should not be treated as support-blocked when the
matching cloud register session is closed for the same store and terminal. That
is a clean drawer lifecycle, so support should not offer drawer repair.

## Local Register Recovery

The POS register has a second recovery boundary inside the browser. A terminal
can need local IndexedDB reprovisioning when the cached setup state is stale or
corrupt, but the same database also contains protected local business records.
The register UI must not collapse those into one destructive repair action.

Before clearing local POS state, inspect the record stores that can contain
operator-owned work:

- local sale/register events,
- drawer or terminal authority records, and
- active cashier presence records.

If any of those records exist, block the clear action and route the operator to
Terminal Health or support recovery. Missing object stores are different from
protected records; they indicate a broken or old local schema and should remain
clearable so the terminal can be reprovisioned.

The register should also keep normal cashier readiness separate from repair
readiness. Cashier-presence restore may briefly settle so the sign-in gate does
not flicker, but that settling window must be bounded. If the local read stalls,
fall through to the cashier sign-in gate instead of leaving an empty register
workspace or showing terminal repair copy. Show the repair/readiness guard only
after the register setup condition remains visible past the grace period.

Regression coverage should prove:

- clear succeeds for missing local record stores,
- clear is blocked by unsynced local events,
- clear is blocked by authority records,
- clear is blocked by active cashier presence,
- clear is blocked when the preflight inspection itself fails, and
- stalled cashier-presence restore eventually renders the cashier sign-in path.

## Remote Command Outcomes

Remote commands are scoped, allow-listed, and verified by later terminal
evidence. The UI should present command state only while it helps the operator
or support user act.

Current command states:

- `pending` means the command is queued for the checkout station.
- `claimed` means the checkout station is running it.
- `completed` means the station finished the local helper.
- `runtime_verification_ready` means the local helper completed and the next
  check-in should verify the evidence.
- `verified` means the next check-in matched the expected evidence.
- `precondition_failed` means the command expected a stale blocker that was no
  longer present or no longer matched safely.

Do not use an old `precondition_failed` command as the headline if the latest
runtime evidence has no current blocker. If current support work exists, show the
failure reason and the next safe action. If no current support work exists, show
that no support action is needed.

### Update App Command Outcomes

`update_app` uses the same audited command lane, but its result must stay
separate from terminal repair readiness. Sending Update app says support asked
the checkout station to evaluate its app-update coordinator. It does not mean
the terminal was outdated, and it does not mean the terminal refreshed.

Terminal Health derives app-update state from fresh runtime `appUpdate`
evidence, not from command history. The canonical states are:

- `current`: no pending update, or the terminal is already on the latest known
  build.
- `update_ready`: a pending update exists and the coordinator says refresh is
  safe.
- `update_ready_unstaged`: an update exists, but static assets are not ready or
  the coordinator cannot apply for staging reasons.
- `blocked`: active local work or cross-tab blocker prevents refresh.
- `applying`: the command acknowledged before reload and is waiting for a fresh
  post-reload check-in.
- `detector_failed`, `stale`, or `unknown`: Terminal Health should avoid live
  certainty and keep copy operational.

`update_app` is available as an active-terminal support action even when update
readiness is unknown, but duplicate active update commands should disable the
same action. Command verification requires a fresh runtime check-in correlated
to the command execution id or nonce; stale pre-command evidence cannot verify a
new command.

## Register Session Review Compatibility

Older review records were created before review items carried structured
`reviewKind` and `actionPolicy` metadata. The resolution path must classify both
old and new evidence, then choose behavior by review kind:

- `register_closeout_variance` can be approved or rejected.
- `duplicate_register_closeout` is reject-only because the register is already
  closed; applying it would double-apply closeout facts.
- `register_not_open_sale` can be approved or rejected when the local register
  session matches.
- `staff_access` can be approved or rejected when it is the only automatic staff
  access review.
- `service_customer_attribution` remains reject-only until the missing business
  attribution is repaired elsewhere.
- `server_rejected` can be overridden or rejected through manager review.
- `unknown` is reject-only.

Actioning a review must mutate the underlying conflict records, not only show a
toast. When the UI scopes an action to one visible closeout review item, it
passes the target conflict ids so duplicate or stale review evidence cannot be
mistaken for the item the user approved or rejected.

## App Shell And Local Diagnostics

App shell readiness is diagnostic evidence. The terminal should report whether
the app shell is ready in runtime status, but missing app-shell evidence should
not outrank drawer, cashier, sync, and register-session readiness.

The roster should show `-` for aggregate metric cards until data arrives. A
temporary zero implies there are truly zero terminals, zero pending sync events,
or zero review items, which is not true during the initial query gap.

## UI Rules

- The roster and detail pages must use shared recovery preview semantics.
- "Support recovery" should mean support work, not normal cashier action.
- Do not surface raw backend conflict ids in operator-facing copy.
- Show only the active register session for a terminal, and link it to Cash
  Controls with the app's link-out affordance.
- Keep local data copy operational. Prefer labels like "Products and stock" and
  "Register details" over internal terms like "availability snapshot" or
  "register read model".
- Avoid showing verified terminal actions as available actions. Verification
  should remove the action from the support work queue.

## Prevention

- Do not add support recovery copy by reading raw command status alone. First
  decide whether current blockers or safe actions still exist.
- Do not classify an available app update as support recovery work by itself.
  Show app-update state in its own lane and keep sales/support readiness derived
  from their existing evidence.
- Do not verify `update_app` from command acknowledgement or stale runtime
  evidence. Require fresh command-correlated app-update evidence.
- Do not let staff authority expiry create a support repair action unless there
  is separate evidence that a terminal-side refresh command is actually needed.
- Do not treat `cloud_closed` drawer authority as blocked when the matching
  cloud register session is cleanly closed for the same terminal.
- Do not add a roster-only readiness derivation that bypasses
  `TerminalRecoveryPreview`.
- Do not action register-session review items by summary text alone when a
  structured `reviewKind` or target conflict id is available.
- Do not expose backend identifiers or raw conflict text in operator-facing
  copy.

## Validation

When this boundary changes, cover both the server preview and the UI
presentation. The durable test set should include:

- `convex/pos/application/queries/terminals.test.ts`
- `convex/pos/application/commands/terminals.test.ts`
- `convex/pos/application/terminals.test.ts`
- `convex/pos/infrastructure/repositories/terminalRepository.test.ts`
- `src/components/pos/terminals/terminalHealthPresentation.test.ts`
- `src/components/pos/terminals/POSTerminalDetailView.test.tsx`
- `src/components/pos/terminals/POSTerminalHealthView.test.tsx`
- `src/lib/pos/infrastructure/local/terminalRuntimeStatus.test.ts`
- `src/lib/pos/infrastructure/local/usePosLocalSyncRuntime.test.ts`
- `src/lib/pos/infrastructure/local/terminalRecoveryCommands.test.ts`
- `src/offline/posAppShellReadiness.test.ts`
- `convex/cashControls/deposits.test.ts`
- `convex/pos/application/sync/registerSessionSyncReview` coverage through
  deposits and register-session view tests
- `src/components/cash-controls/RegisterSessionView.test.tsx`

Run `bun run graphify:rebuild` after code or solution-doc changes, then run the
focused tests and `bun run pr:athena` before merging.

## Related

- [Athena POS Remote Terminal Health Recovery](./athena-pos-remote-terminal-health-recovery-2026-06-11.md)
- [Athena POS Local Staff Authority](./athena-pos-local-staff-authority-2026-05-14.md)
- [Athena POS Drawer Authority Replacement Recovery](../logic-errors/athena-pos-drawer-authority-replacement-recovery-2026-06-06.md)
- [Athena POS Register Sync Closeout Review Recovery](../logic-errors/athena-pos-register-sync-closeout-review-recovery-2026-05-23.md)
