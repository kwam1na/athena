---
title: Athena POS Local Staff Authority Uses Terminal-Scoped Verifiers
date: 2026-05-14
category: architecture
module: athena-webapp
problem_type: offline_pos_staff_authority
component: pos
symptoms:
  - "Offline POS sign-in can block the register even when the terminal is otherwise ready"
  - "Staff PIN hashes are tempting to reuse as offline credentials"
  - "Local sync proofs can outlive a staff credential reset without explicit drift evidence"
root_cause: offline_staff_authority_was_not_a_first_class_terminal_snapshot
resolution_type: authority_snapshot_and_versioned_proof
severity: high
tags:
  - pos
  - staff
  - local-first
  - offline
  - security
---

# Athena POS Local Staff Authority Uses Terminal-Scoped Verifiers

## Problem

The POS register can be local-first for sale commands while still depending on
Convex for cashier sign-in. That leaves a freshly provisioned terminal unable to
operate offline unless a cashier was already authenticated, and it creates
pressure to reuse the online `pinHash` as the local credential.

That is the wrong boundary. The online PIN hash is compatibility data for server
authentication. Offline login needs a terminal-scoped authority snapshot with a
local verifier that can be checked without exposing broader staff credential
state.

## Solution

When a staff PIN is created or reset, Athena stores versioned
`PBKDF2-SHA256` verifier metadata alongside the server credential. A registered
terminal can refresh its local staff authority snapshot while online. The
snapshot is scoped to the store and terminal, contains only active cashier or
manager credentials with local verifiers, and is stored in the POS IndexedDB
local store.

Offline cashier sign-in reads that local snapshot by normalized username,
rejects expired or revoked records, verifies the raw PIN against the local
verifier, unwraps that staff member's previously issued local sync proof, and
returns the matching staff profile plus the unwrapped proof. Missing, malformed,
or still-locked authority fails closed with operator-facing copy instead of
falling back to server auth.

## Proof Boundary

The local staff authority verifier proves a human can sign in to the terminal
while offline. The `posLocalStaffProof` token proves that local events emitted by
that staff member may be accepted by the server during sync. They are related,
but they are not interchangeable.

The authority snapshot must not store plaintext proof tokens for the roster.
Proof tokens are issued by the server after online staff authentication and
stored locally only as PIN-wrapped ciphertext for that specific staff member.
Offline sign-in therefore needs both the verifier check and the same PIN-derived
unwrap step before any sync bearer token can be used.

Server sync checks the proof token, terminal scope, store scope, expiry, staff
credential, staff profile state, role eligibility, and credential version. A PIN
reset increments the local verifier version, and older local proofs stop
validating once that credential version drifts.

Manager elevation and command approval proofs remain separate server-side
approval boundaries. Local cashier authority should not be treated as approval
for manager-only commands.

## Prevention

- Do not use online `pinHash` as an offline verifier.
- Do not persist plaintext `posLocalStaffProof` tokens in local staff authority.
- Keep local staff authority snapshots scoped to store and terminal ids.
- Include credential-version evidence in local sync proofs.
- Refresh local staff authority after online cashier authentication and during
  terminal-ready POS startup paths.
- Surface local staff authority readiness in POS diagnostics so offline gaps are
  visible before they block checkout.

## Related

- [Athena POS Local-First Sync Uses Event Logs](./athena-pos-local-first-sync-2026-05-13.md)
- [Athena POS Register Commands Are Always Local First](./athena-pos-always-local-first-register-2026-05-14.md)
