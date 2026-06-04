---
title: Athena Terminal-Scoped Cashier Presence
date: 2026-06-04
category: architecture
module: athena-webapp
component: pos-register
problem_type: local_first_cashier_presence
symptoms:
  - "Reloading the POS register can force another cashier PIN prompt during the same store day"
  - "A restored cashier identity can be confused with sale-authorized proof, drawer authority, or manager approval"
  - "Local diagnostics can accidentally expose staff proof or credential material when persistence is added"
root_cause: cashier_identity_was_react_state_without_a_terminal_store_day_presence_boundary
resolution_type: terminal_scoped_local_presence
severity: high
tags:
  - pos
  - register
  - cashier-presence
  - local-first
---

# Athena Terminal-Scoped Cashier Presence

## Problem

The POS register can reload while a cashier has a same-terminal, same-store-day
presence record. If the register opens the PIN dialog before the local read
finishes, operators can see a sign-in flicker even though the durable state has
not reached a deterministic missing, expired, invalidated, or validation-needed
outcome.

## Boundary

Cashier presence is terminal, store, and operating-date scoped. It identifies
the cashier currently signed in on this browser. It is not drawer authority,
terminal integrity, staff-authority roster data, or manager approval.

- Staff authority says which cashier or manager credentials may sign in on this
  terminal.
- Cashier presence says which staff identity was most recently signed in on this
  terminal and store day.
- Sale-authorized proof gates sale-affecting commands. Persisted cashier
  presence is continuity evidence, not authority; a reload must not reauthorize
  staff from IndexedDB proof or role fields.
- Drawer authority and terminal integrity remain independent sale gates.
- Manager approval remains action scoped. A restored manager cashier does not
  replace manager approval proof for manager-only commands.

## Solution

Register boot should start in a restore-pending state. Sign-in UI should open
only after the local read reaches a deterministic missing, expired, invalidated,
failed, or validation-needed state. A valid same-terminal record should preserve
operator context and move to a returning-cashier unlock flow: show the restored
cashier identity, hide the username field, ask only for the PIN needed to unwrap
the local staff proof, and keep a footer action to sign in as a different
cashier. It must not restore active cashier authority from local serialized role
material alone. Background checks and non-destructive repair success should stay
quiet.

Persist cashier presence as a separate local record keyed by organization,
store, terminal, and operating date. Keep the POS local staff proof wrapped at
rest, and treat the stored record as separate from a sale-authorized proof
token. When proof or freshness is stale or only local continuity evidence is
available, preserve cashier context only for operator guidance and block
sale-affecting commands until sign-in supplies a valid proof.

Do not render generic username/PIN sign-in as the first reload state for a valid
presence record. Generic sign-in erases the operator's mental model that the
same cashier is still associated with the terminal. Prefer a PIN-only unlock
that uses the persisted username internally. The alternate-cashier path should
be explicit and placed with the submit action, not inside the cashier identity
field.

Operator copy stays calm and action-oriented:

- `Unlock cashier session`
- `Enter the cashier PIN to continue on this register`
- `Sign in as a different cashier`
- `Checking cashier access before new sales.`
- `Cashier sign-in expired. Sign in to continue.`
- `This terminal needs an online staff refresh before offline sign-in. Reconnect, then sign in once.`

Diagnostics may expose redacted state such as `cashierPresence:
validation_pending`, `expired`, or `invalidated`, but must not include PINs, proof tokens, verifier
material, credentials, sync secrets, or fleet-level cashier reporting.

## Prevention

Before adding POS local-first cashier or authority behavior, identify which
boundary owns the state:

- Staff-authority records are for offline username/PIN eligibility.
- Cashier-presence records are for same-terminal, same-store-day continuity
  evidence.
- Drawer authority and terminal integrity decide whether sale commands may run.
- Manager approval remains a separate command proof for protected actions.

Tests should prove no PIN-dialog flicker while restore is pending, no
cross-terminal or cross-store authorization, no plaintext proof serialization,
no stale local proof trust, no sale-affecting command while presence is
validation-pending, PIN-only unlock for the restored cashier, and the ability to
switch to a different cashier sign-in.

## Validation

Warm offline reload validation should use a production build after the app shell
and chunks are already loaded: open `/pos/register`, sign in, verify presence is
written, block network, hard reload, and confirm the register reaches a stable
PIN-only unlock state for the restored cashier without granting cashier
authority until the PIN unwraps proof. This does not promise cold offline
startup when the app shell or chunks are not already available.

Run targeted register view-model and register UI tests after restore/copy
changes. Include `CashierAuthDialog` coverage for PIN-only unlock and switching
to a different cashier, then run `bun run typecheck` and `bun run
graphify:rebuild`.
