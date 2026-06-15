---
title: Athena POS Runtime Decoupling Boundaries
date: 2026-06-15
category: architecture
module: athena-webapp
problem_type: pos_runtime_decoupling
component: pos
symptoms:
  - "POS runtime changes in one concern can accidentally affect local sync, recovery commands, runtime check-ins, staff authority, or Terminal Health"
  - "Runtime check-in side effects can make accepted status look failed if Remote Assist work throws"
  - "Generic staff-authority refresh failures can wipe local staff authority and block offline cashier continuity"
  - "Terminal Health list and detail can drift when roster code re-derives recovery state from raw evidence"
root_cause: pos_runtime_facade_owned_too_many_runtime_support_and_authority_responsibilities
resolution_type: runtime_boundary_refactor
severity: high
tags:
  - pos
  - local-first
  - runtime-status
  - terminal-health
  - remote-assist
  - staff-authority
---

# Athena POS Runtime Decoupling Boundaries

## Problem

`usePosLocalSyncRuntimeStatus` became the integration point for too many
separate responsibilities:

- local readiness sensing,
- drawer-authority reconciliation,
- local sync drain scheduling,
- runtime status signature and publish serialization,
- terminal recovery command execution,
- staff-authority refresh,
- terminal integrity repair evidence, and
- support-facing Terminal Health diagnostics.

That coupling made production fixes risky. A small change to status-only route
behavior could start upload drains. A command-refresh change could wipe cached
staff authority. A Remote Assist presence failure could make an accepted runtime
status look failed. A Terminal Health list optimization could accidentally
contradict the detail view.

## Decision

Keep the POS runtime facade, but move responsibility-specific logic behind
focused modules. The facade remains the consumer contract for register and
Remote Assist hosts; helper modules own the actual boundaries.

The important boundaries are:

1. **Readiness sensing is not publishing or draining.** Reading terminal seed,
   local register state, drawer authority, staff authority readiness, snapshots,
   terminal integrity, and app-shell readiness should be a local observation.
2. **Drawer-authority reconciliation is sync-owned.** Recoverable drawer blocks
   can be written or cleared as part of sync/retry outcomes, but completed local
   events and review evidence must not be deleted to force a healthy state.
3. **Runtime status publishing is latest-wins serialized.** Overlapping
   `reportTerminalRuntimeStatus` calls must not race Convex writes. Changed
   payloads queue behind the in-flight publish and collapse to the latest
   changed payload.
4. **Staff-authority refresh failures preserve local continuity.** A successful
   empty authoritative refresh can clear local authority. Caller/session,
   authorization, precondition, transport, and runtime failures are diagnostics
   and must not wipe cached offline sign-in authority.
5. **Recovery acknowledgement is not verification.** A command acknowledgement
   says the terminal ran a helper. Fresh runtime status says whether the
   expected evidence changed.
6. **Post-status side effects are isolated.** Accepted runtime status remains
   accepted if Remote Assist presence/session work fails, and command
   verification still runs from the accepted evidence.
7. **Terminal Health is preview-first.** Roster and detail must use the same
   `TerminalRecoveryPreview` semantics. Raw blockers are compatibility fallback,
   not stronger truth than a structured preview.

## Solution

Split the runtime into named modules that each own one durable boundary, then
keep the existing hook as a facade over those modules. The implementation does
not introduce a new POS runtime API for callers; it makes the existing runtime
behavior easier to test and safer to change.

The solution has five parts:

1. Extract local readiness and drawer reconciliation out of the hook so runtime
   evidence and sync-owned authority repair are not hidden inside one effect.
2. Extract status-only trigger/debug helpers and runtime status publisher
   helpers so upload ownership and check-in serialization can be tested without
   rewriting consumers.
3. Centralize staff-authority refresh persistence so refused or failed refreshes
   preserve cached local authority instead of wiping offline cashier continuity.
4. Move accepted runtime-status side effects behind a server helper that isolates
   Remote Assist failures while still running command verification from accepted
   evidence.
5. Make Terminal Health presentation prefer structured recovery preview data and
   keep roster/detail recovery parity covered by tests.

## Implementation Pattern

Use focused POS local/runtime modules rather than adding more nested effects to
the facade:

- `runtimeReadiness.ts` for local runtime readiness observation.
- `drawerAuthorityReconciliation.ts` for recoverable drawer authority write and
  clear behavior.
- `localSyncDrainCoordinator.ts` for status-only triggers, upload trigger
  classification, and sync debug assembly.
- `runtimeStatusPublisher.ts` for status signatures, not-ready classification,
  publisher debug patching, and browser runtime metadata.
- `terminalStaffAuthorityRefresh.ts` for refresh result classification and
  local snapshot persistence.
- `postRuntimeStatusSideEffects.ts` for accepted runtime-status server
  side effects.

Keep the public hook as the adapter. Components and higher-level presentation
code should not need to know which helper owns a sub-responsibility.

## Staff Authority Rules

Do not clear local staff authority for generic refresh failure. That converts a
cloud/server/support condition into a cashier blocker and breaks POS continuity.

Use this taxonomy:

- `ok` with records: replace the local snapshot.
- `ok` with no records: authoritative empty state; clear the local snapshot.
- `user_error`, authorization failure, precondition failure, thrown exception,
  or transport/runtime failure: preserve the local snapshot and surface safe
  diagnostics.

Only cashier-auth flows may wrap proof material. Background refresh and terminal
recovery command refresh must not invent or carry PIN/proof payloads.

## Runtime Status Rules

Runtime status is evidence. It is not a control channel and does not grant POS
authority.

When changing the publisher or server status endpoint:

- preserve latest-wins client-side publish serialization,
- keep status publish failures best-effort from the cashier's point of view,
- persist terminal authorization failure only from explicit authorization
  responses,
- clear local terminal integrity only after accepted runtime status, and
- isolate Remote Assist side-effect failures from command verification and the
  accepted status response.

Remote Assist receives a minimized presence projection only. Do not forward
staff proof, PIN/verifier material, sync secrets, raw local events,
customer/payment payloads, or raw browser fingerprints.

## Terminal Health Rules

Terminal Health is a support surface. It should help support decide what to do
without overstating cashier blockers.

Roster and detail must agree on:

- terminal identity and store scope,
- runtime freshness,
- recovery readiness,
- current safe action category,
- duplicate-disable command state,
- verification state,
- latest command state, and
- sync classification.

Detail can include expected evidence, raw command context, raw action targets,
and full lifecycle detail. Roster rows should keep only the fields needed for
triage and duplicate-action safety.

If `TerminalRecoveryPreview` is present, presentation uses it first. Raw
attention reasons and legacy blockers are fallback only when no structured
preview exists.

## Validation

Use focused characterization tests around the facade before extracting behavior,
then add unit tests for the helper boundary that changed.

Minimum useful sensors:

- `usePosLocalSyncRuntime.test.ts` for facade continuity, status-only behavior,
  publish serialization, recovery command execution, and sale-continuity
  diagnostics.
- `terminalStaffAuthorityRefresh.test.ts`, `CashierAuthDialog.test.tsx`, and
  `POSRegisterOpeningGuard.test.tsx` for staff authority preservation.
- `convex/pos/public/terminals.test.ts` for accepted-status side effects and
  command verification.
- `terminalHealthPresentation.test.ts` and terminal health query tests for
  preview-first roster/detail parity.
- `bun run graphify:rebuild` after POS runtime/source-boundary changes.
- `bun run pr:athena` before merge.

## Prevention

- Do not add another responsibility directly to `usePosLocalSyncRuntime.ts`
  without first asking whether it belongs in an existing helper module.
- Do not collapse sales readiness, support recovery, diagnostic evidence,
  staff authority, drawer authority, Remote Assist presence, and runtime status
  into one generic "terminal healthy" value.
- Do not treat a command acknowledgement as a terminal-health verdict.
- Do not treat Remote Assist presence as POS sale/drawer/staff authority.
- Do not optimize Terminal Health list rows by dropping the fields needed to
  disable duplicate safe actions.

## Related Issues

- Linear: V26-744, V26-745, V26-746, V26-747, V26-748.
