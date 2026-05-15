---
title: Athena Staff PIN Length Changes Need Server Throttling
date: 2026-05-15
category: logic-errors
module: athena-webapp
problem_type: staff_pin_authentication_policy
component: staff-auth
symptoms:
  - "A shorter staff PIN policy increases brute-force risk"
  - "Client-side PIN length validation can be mistaken for an authentication control"
  - "Manager approval proof minting can inherit staff-auth brute-force exposure"
root_cause: staff_pin_length_changed_without_server_side_attempt_control
resolution_type: credential_level_lockout
severity: high
tags:
  - staff-auth
  - manager-approval
  - security
---

# Athena Staff PIN Length Changes Need Server Throttling

## Problem

Staff PIN entry is a UI workflow, but staff PIN verification is a server
authentication boundary. When the PIN policy gets shorter, the server-side
credential path must absorb the increased guessing risk. A four-digit PIN has
only 10,000 combinations, so relying on client validation or deterministic hash
comparison alone leaves cashier sign-in and manager approval proof minting too
easy to brute-force.

## Solution

Keep the reusable PIN input as the client policy boundary, but enforce failed
attempt tracking on the server credential record. The shared
`authenticateStaffCredentialWithCtx` path should count bad PIN hashes, lock the
matching active credential after repeated failures, return `rate_limited` while
locked, and reset the counter on successful authentication or authorized PIN
reset.

That placement protects every caller that goes through the staff credential
boundary, including terminal authentication and manager approval proof minting.
The public staff credential mutation must also require full-admin organization
access; otherwise an attacker could reset the PIN and clear lockout state.
Browser-facing staff authentication mutations must require an authenticated
account with store access before comparing PIN hashes; otherwise unauthenticated
callers can trigger lockouts or mint approval proofs through public mutations.

## Prevention

- Treat staff PIN length reductions as security-sensitive, even when the UI
  change looks small.
- Put throttling at `authenticateStaffCredentialWithCtx`, not in individual
  React dialogs.
- Guard public credential create/update mutations with full-admin organization
  membership before they can reset PINs or clear lockout state.
- Guard public staff authentication and approval-proof mutations with
  authenticated store access before they can mutate lockout state or create
  approval proofs.
- Include approval proof authentication in the test matrix, because manager
  approval has higher blast radius than cashier sign-in.
- Reset lockout state only on successful authentication or authorized PIN reset.
- Keep tests for wrong attempts, active lockout, success reset, reset clear,
  unauthorized reset, and approval proof lockout.

## Related

- [Athena POS Local Staff Authority Uses Terminal-Scoped Verifiers](../architecture/athena-pos-local-staff-authority-2026-05-14.md)
- [Athena command approval manager fast path](./athena-command-approval-manager-fast-path-2026-05-02.md)
