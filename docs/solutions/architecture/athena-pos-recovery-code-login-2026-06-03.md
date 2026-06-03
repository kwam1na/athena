---
title: Athena POS Recovery-Code Login Keeps App Account And Staff Authority Separate
date: 2026-06-03
category: architecture
module: athena-webapp
problem_type: pos_recovery_code_login
component: pos
symptoms:
  - "Field operators need fresh-browser POS app login without inbox access"
  - "A shared POS app credential can be mistaken for staff proof"
  - "Recovery-code rotation can leak plaintext if status views expose too much"
root_cause: pos_app_account_recovery_needed_a_server_hashed_credential_boundary_separate_from_staff_actor_authority
resolution_type: scoped_credentials_provider_and_staff_authority_boundary
severity: high
tags:
  - pos
  - auth
  - recovery-code
  - staff-authority
  - audit
---

# Athena POS Recovery-Code Login Keeps App Account And Staff Authority Separate

## Problem

The shared `pos@wigclub.store` app account sometimes needs to sign in from a
fresh browser, but field operators do not have inbox access for the normal OTP
flow. A static operational recovery code solves that availability problem only
if it stays tightly scoped: it must sign in the POS app account, not identify a
cashier, unlock a drawer, or authorize a sale-affecting command.

## Solution

Keep POS recovery-code login inside Convex Auth and keep the credential state on
the server:

- Store a per-store POS recovery credential as hash plus salt/version metadata,
  status, failure counters, lockout timestamps, last-used, rotation, and actor
  fields. Never store or return plaintext outside the create/rotate response.
- Use a dedicated Convex Auth credentials provider for the recovery path. The
  provider validates the configured POS account, store scope, `pos_only`
  organization membership, credential status, lockout, and hash match before it
  returns the real Convex Auth `users` id.
- Let the browser reuse the existing Athena pending-auth-sync handoff after
  provider success. Do not write the recovery code to local storage, session
  storage, query params, logs, or runtime diagnostics.
- Put create/rotate/unlock/revoke behind full-admin POS Settings controls.
  Plaintext appears only immediately after create or rotate.
- Emit operational events for create, rotate, revoke, unlock, failed attempts,
  lockout, and successful use. Event metadata may include status, reason,
  failed-attempt count, and POS account id, but not raw code, hash, salt, or
  pepper material.

## Staff Authority Boundary

Recovery-code login answers which app account loaded Athena. It does not answer
who performed POS work.

After recovery-code login, existing POS gates still apply:

- staff PIN and staff proof for cashier/operator identity;
- manager proof when a command requires manager approval;
- terminal integrity for the provisioned register;
- drawer lifecycle authority before sale-affecting commands;
- POS command invariants and audit attribution for sale, cash, and correction
  workflows.

POS action audit events should continue to use staff actor fields when staff
proof is required. Recovery-login audit events are separate app-account events.

## Regression Targets

- `convex/pos/public/posRecoveryCodes.test.ts` proves hash-only storage,
  rotation invalidation, generic failed attempts, lockout, successful use, and
  secret-safe audit metadata.
- `src/components/auth/Login/PosRecoveryCodeForm.test.tsx` proves the recovery
  form uses the dedicated provider, starts the same pending-auth-sync handoff as
  OTP, shows generic failure copy, and does not persist the submitted code.
- `src/components/pos/settings/POSSettingsView.test.tsx` proves full-admin
  management can rotate the code and hides the panel from non-full-admin
  accounts.
- `convex/operations/staffCredentials.test.ts`,
  `src/components/pos/CashierAuthDialog.test.tsx`,
  `src/components/pos/register/POSRegisterView.test.tsx`, and
  `src/lib/pos/presentation/register/useRegisterViewModel.test.ts` prove staff
  proof, drawer gates, and register view-model boundaries remain separate from
  app login.

## Prevention

- Do not accept admin-supplied memorable codes for this shared credential.
  Generate high-entropy codes server-side.
- Do not broaden the credentials provider to arbitrary accounts, admin
  accounts, or non-`pos_only` memberships without a new security review.
- Do not expose raw backend failure reasons in the login form. Keep failure copy
  generic so account existence, membership, lockout, and code validity are not
  distinguishable.
- Do not use app-account identity as `actorStaffProfileId` or as a substitute
  for staff proof.

## Related

- [Athena POS Hub App-Session Continuity Is Route Scoped](./athena-pos-hub-app-session-continuity-2026-06-02.md)
- [Athena POS Stale Terminal Sale Blocks](../logic-errors/athena-pos-stale-terminal-sale-block-2026-05-29.md)
