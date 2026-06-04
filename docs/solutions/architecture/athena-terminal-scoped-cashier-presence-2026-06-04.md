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

Register boot should start in a restore-pending state. The PIN form should open
only after the local read reaches a deterministic missing, expired, invalidated,
failed, or validation-needed state. A valid same-terminal record should preserve
operator context and move to validation-pending sign-in guidance; it must not
restore active cashier authority from local serialized proof or role material.
Background checks and non-destructive repair success should stay quiet.

Persist cashier presence as a separate local record keyed by organization,
store, terminal, and operating date. Keep the POS local staff proof wrapped at
rest, and treat the stored record as separate from a sale-authorized proof
token. When proof or freshness is stale or only local continuity evidence is
available, preserve cashier context only for operator guidance and block
sale-affecting commands until sign-in supplies a valid proof.

Operator copy stays calm and action-oriented:

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
no stale local proof trust, and no sale-affecting command while presence is
validation-pending.

## Validation

Warm offline reload validation should use a production build after the app shell
and chunks are already loaded: open `/pos/register`, sign in, verify presence is
written, block network, hard reload, and confirm the register reaches a stable
validation-pending sign-in state without granting cashier authority from local
storage. This does not promise cold offline startup when the app shell or chunks
are not already available.

Run targeted register view-model and register UI tests after restore/copy
changes, then `bun run typecheck` and `bun run graphify:rebuild`.
