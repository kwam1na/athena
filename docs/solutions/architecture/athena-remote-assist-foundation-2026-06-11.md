---
title: Athena Remote Assist Is A Generic Browser-Client Foundation
date: 2026-06-11
category: architecture
module: athena-webapp
problem_type: remote_assist_foundation
component: remote-assist
symptoms:
  - "Support needs to view and guide an enrolled Athena browser session without gaining device-wide administration"
  - "POS terminal recovery needs remote help but must not own the platform remote-assist abstraction"
  - "Unattended support cannot depend on browser screen-capture permission prompts"
root_cause: remote_support_needed_a_browser_client_boundary_separate_from_pos_terminal_authority
resolution_type: provider_neutral_remote_assist_foundation
severity: high
tags:
  - remote-assist
  - browser-client
  - co-browsing
  - pos
  - terminal-health
  - redaction
---

# Athena Remote Assist Is A Generic Browser-Client Foundation

## Problem

Remote Assist starts with POS terminal recovery, but the durable primitive is an
enrolled Athena browser client. If the foundation is built as a terminal-only
tool, future browser runtimes will inherit POS assumptions, and support control
can drift toward an unsafe terminal-management bypass.

The first implementation must also respect browser platform limits. Unattended
sessions cannot rely on `getDisplayMedia` screen capture because the local
browser must grant that permission. Athena needs an in-app co-browsing path that
is safe for enrolled clients even when no local operator is present.

## Boundary

- Remote Assist owns enrollment, policy, session lifecycle, transport token
  issuance, audit, and control limits for generic Athena browser clients.
- Runtime adapters own surface-specific identity, capability reporting,
  sensitive-region marking, safe local actions, and integration context.
- POS terminals are the first adapter, not the owner of Remote Assist.
- Transport is provider-neutral. LiveKit-style rooms/data packets, Twilio-style
  room tokens/data tracks, or an rrweb-shaped DOM event stream can satisfy the
  contract, but provider details stay behind an adapter.
- Unattended mode uses sanitized in-app co-browsing/session-replay data plus
  bounded control events. Attended mode may upgrade to browser screen share only
  after the local browser grants capture permission.

## Solution

Model Remote Assist around a browser-client session contract:

- Enroll remote-assistable clients with organization, optional store, runtime
  type, runtime identity, display name, capabilities, enrollment state, policy
  posture, and last presence.
- Start sessions only after role, policy, enrollment, runtime presence, reason,
  TTL, and mode checks pass. Tokens must be short-lived and scoped to a session,
  client, provider room, and participant role.
- Stream an unattended-safe app representation rather than raw desktop access.
  A DOM/session-replay approach should redact or omit sensitive nodes before
  transport and should send compact input events instead of arbitrary commands.
- Keep sensitive control restrictions in the runtime adapter. Staff PINs,
  recovery codes, payment credentials, sync secrets, staff proof material, raw
  customer/payment payloads, local storage editing, IndexedDB mutation,
  devtools-style access, and unrestricted file/device access are blocked or
  masked.
- Record structured audit events for policy decisions, start/end, joins/leaves,
  transport room identity, mode changes, sensitive-mode state, local disconnect,
  and privileged adapter actions. Do not persist provider secrets, screen media,
  raw keystroke logs, PINs, proofs, sync secrets, or raw payload bodies.

## POS Invariants

Remote Assist can help support operate the visible Athena UI and trigger
explicit, audited recovery actions. It must not grant sale authority.

Preserve these POS gates:

- terminal integrity for the provisioned runtime;
- drawer authority and register-session lifecycle;
- staff authority and manager proof requirements;
- local command invariants for cart, payment, completion, closeout, reopen, and
  recovery;
- Cash Controls and Operations ownership of review, reconciliation, variance,
  closeout, inventory, and payment facts;
- runtime check-in as the verification source for browser-local repair.

Support can inspect and guide a M Supplies-shaped terminal recovery, but a
fresh runtime check-in remains the proof that terminal-local blockers cleared.

## Validation

Keep the validation map targeted to the whole foundation boundary:

- Remote Assist schema, repository, policy, session lifecycle, public API, and
  transport adapter contract tests.
- Client runtime tests for enrollment/presence, session banner, local
  disconnect, bounded input, co-browsing event redaction, and sensitive-mode
  masking.
- POS adapter tests for Terminal Health launch context, terminal identity,
  recovery action audit, sensitive POS controls, and unchanged sale gates.
- Presentation tests for support-safe copy and normalized provider/runtime
  errors.
- Existing POS terminal-health and POS hub continuity tests where Remote Assist
  touches terminal diagnostics, app-session recovery, or sale authority.

Run changed Convex/frontend lint, typecheck, build, graphify rebuild/check, and
the full `bun run pr:athena` gate before merge. During implementation, run only
the focused Remote Assist and affected POS terminal sensors until approval for
heavier validation.

## Prevention

- Do not couple foundation schemas or transport interfaces to POS terminal
  domain types.
- Do not make unattended mode depend on browser screen capture.
- Do not expose provider credentials, recovery secrets, staff proof, PINs,
  sync secrets, customer data, payment data, or raw local payloads in stream,
  audit, runtime status, or UI copy.
- Do not add direct local storage or IndexedDB editing as a support control.
- Do not treat support presence as drawer, staff, sale, inventory, payment,
  variance, closeout, or manager-review authority.
- Regenerate or refresh agent validation docs whenever Remote Assist file
  surfaces change.

## Related

- [Athena POS Remote Terminal Health Recovery](./athena-pos-remote-terminal-health-recovery-2026-06-11.md)
- [Athena POS Terminal Health Visibility](./athena-pos-terminal-health-visibility-2026-05-20.md)
- [Athena POS Hub App-Session Continuity](./athena-pos-hub-app-session-continuity-2026-06-02.md)
