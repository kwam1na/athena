---
title: Athena POS Offline Sales Continuity Separates Local Authority From Cloud Validation
date: 2026-06-04
category: architecture
module: athena-webapp
problem_type: pos_offline_sales_continuity
component: pos
symptoms:
  - "A returning POS register can look like it needs manager review when only app-session cloud validation is waiting for network"
  - "Support diagnostics can expose app-session recovery posture without needing raw assertions or credentials"
  - "Offline route access coverage can miss whether the register shell stays redacted during no-network sale continuation"
root_cause: app_session_cloud_validation_uncertainty_was_treated_like_sale_authority_failure
resolution_type: local_sale_blocker_policy_with_reconciliation_metadata
severity: high
tags:
  - pos
  - offline
  - app-session
  - reconciliation
  - local-first
---

# Athena POS Offline Sales Continuity Separates Local Authority From Cloud Validation

## Problem

When a provisioned POS register is locally able to sell but cloud app-session
validation is waiting for the network, the cashier flow should remain normal.
That state is not sale authority by itself, and it is not manager review by
itself. It is reconciliation context: local sale history can continue on the
register and upload once cloud validation and sync are available.

## Solution

Keep app-session recovery separate from app-shell readiness, terminal setup,
staff authority, drawer authority, local command invariants, and sync review:

- `saleBlockerPolicy` classifies sale blockers. Terminal integrity failures,
  drawer-authority blocks, missing durable local destinations, missing staff or
  terminal identity, and non-reopenable locally closed drawers stay hard
  blockers.
- Uploaded lifecycle review, pending sync, failed retry, app-session recovery
  `waiting_for_network`, and stale cloud validation are cloud-validation
  uncertainty when local recording remains possible.
- Local sale commands and uploadable drawer lifecycle events carry redacted
  `validationMetadata` flags such as `app-session-unverified` and
  `cloud-validation-uncertain`; they do not store raw assertions, tokens, staff
  proof material, customer details, or payment payloads in the metadata.
- Sync defers app-session-unverified uploads until supported validation returns,
  then uploads idempotently through the normal authenticated terminal sync
  boundary.
- Offline readiness includes an `app_session` signal. `waiting_for_network` is
  presented as local sale continuation, not as cashier-facing review work.
- Register support diagnostics expose only redacted posture copy such as
  `App session unverified; local sales stay on this register until cloud
  validation returns.`
- Terminal health can show `Local continuation` for support while keeping
  review counts tied to actual sync review evidence.
- Browser coverage should hard reload `/pos/register` with no network and
  confirm the shell remains mounted and does not expose assertions, tokens,
  secrets, passwords, OTP material, or sync secrets.

## Prevention

- Do not use app-session recovery as sale authority. Sale commands still depend
  on terminal integrity, drawer authority, local command invariants, staff
  proof, and local recording.
- Do not add a new hard sale blocker for cloud-validation uncertainty without
  adding it to the blocker policy tests and documenting why local recording is
  impossible or locally unsafe.
- Do not turn app-session-unverified local continuation into manager review
  unless sync projection or command validation creates a real review item.
- Do not derive app-shell readiness from app-session recovery status. The app
  shell is a static browser-shell concern; app-session recovery is route-scoped
  continuity evidence.
- Keep diagnostics redacted by construction. Show status labels, counts,
  timestamps, and next steps, not raw assertions or reusable credentials.

## Validation

Use this focused slice when changing POS offline sales-continuity behavior:

- `src/routes/_authed.test.tsx`
- `src/lib/pos/infrastructure/local/saleBlockerPolicy.test.ts`
- `src/lib/pos/infrastructure/local/localCommandGateway.test.ts`
- `src/lib/pos/infrastructure/local/registerReadModel.test.ts`
- `src/lib/pos/infrastructure/local/posLocalStore.test.ts`
- `src/lib/pos/infrastructure/local/syncContract.test.ts`
- `src/lib/pos/infrastructure/local/usePosLocalSyncRuntime.test.ts`
- `src/lib/pos/infrastructure/local/terminalRuntimeStatus.test.ts`
- `src/offline/posOfflineReadiness.test.ts`
- `src/lib/pos/presentation/register/useRegisterViewModel.test.ts`
- `src/components/pos/register/POSRegisterView.test.tsx`
- `src/components/pos/terminals/terminalHealthPresentation.test.ts`
- `src/components/pos/terminals/POSTerminalHealthView.test.tsx`
- `src/tests/pos/offlineSalesContinuity.spec.ts`

The browser specs prove the production app shell remains mounted and redacted
under no-network hard reloads. Local sale evidence, metadata deferral, and
idempotent upload are protected by the command, store, sync-contract, and
runtime tests above.

## Related

- [Athena POS Offline Route Access Uses A Static App Shell](./athena-pos-offline-route-access-2026-06-03.md)
- [Athena POS Hub App-Session Continuity Is Route Scoped](./athena-pos-hub-app-session-continuity-2026-06-02.md)
- [Athena Terminal-Scoped Cashier Presence](./athena-terminal-scoped-cashier-presence-2026-06-04.md)
