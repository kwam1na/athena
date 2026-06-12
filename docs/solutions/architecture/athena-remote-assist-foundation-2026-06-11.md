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
resolution_type: livekit_backed_remote_assist_foundation
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
- LiveKit Cloud is the provider of record for live Remote Assist transport, but
  it must be reached through Athena's provider-adapter boundary. New
  implementation should add a LiveKit adapter behind the Remote Assist transport
  contract rather than letting POS, Terminal Health, or session lifecycle code
  call LiveKit SDKs directly.
- Athena owns the co-browse representation. Use an rrweb-shaped sanitized DOM
  event/frame model over the LiveKit data transport for unattended sessions;
  rrweb is a capture/replay library shape, not the Remote Assist provider.
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
- Mint LiveKit room tokens from Athena server code only. Runtime participants
  should receive publish rights for sanitized frames and state, while support
  participants should receive subscribe rights plus narrowly scoped data-packet
  publish rights for bounded control intents.
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

## Live Session Closeout

The first Terminal Health implementation proved support request creation, but a
support request alone is not a live Remote Assist session. The next boundary is
the handoff between support-started session state and runtime-claimed session
state.

Keep that handoff split by authority:

- Support can start, hydrate, and end a session through full-admin scoped
  Remote Assist APIs.
- POS runtimes claim unattended sessions only after the existing terminal
  runtime status submission validates store, terminal, and sync-secret proof.
- Terminal Health hydrates the current non-ended session by Remote Assist
  client so a browser reload does not create a duplicate request or reset the
  visible state.
- The support panel should show `connecting` until the runtime check-in claims
  the session, then show active state and an explicit end action.
- The live assist transport contract should expose sanitized co-browse metadata
  and bounded Athena-surface control intents before any provider-specific
  adapter is introduced. The first provider-specific adapter should be LiveKit.

Do not add a broad support-callable runtime claim mutation. That collapses the
support and runtime authority boundary and makes it too easy to mark a browser
joined without fresh runtime proof.

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

## Provider Decision

Use LiveKit Cloud for Remote Assist transport through the provider-adapter
boundary.

Why:

- The existing Athena schema and session service already default session
  transport to `livekit`, so this is an explicit product decision rather than a
  new architectural direction. Persisting `livekit` is useful operationally: it
  records which provider backed a session for support, audit, and migration.
- LiveKit covers the transport primitives Athena needs: low-latency rooms,
  short-lived role-scoped participant tokens, reliable data packets for session
  state/control intents, lossy packets for high-frequency pointer/viewport
  updates, and native screen-share tracks for attended upgrades.
- Athena still keeps the sensitive part in-house: DOM capture shape, redaction,
  sensitive-region handling, bounded control validation, POS authority checks,
  and audit remain Athena-owned.
- The provider adapter is the implementation boundary, not the persisted
  provider identity. Code should depend on Athena transport operations such as
  room creation, token minting, frame publish, control-intent publish, and
  disconnect handling; only the LiveKit adapter maps those operations to LiveKit
  rooms, grants, packets, and tracks.
- Twilio Video is no longer the right default for this feature. Even with its
  retirement reversal, it adds less value to Athena's unattended co-browse path
  than LiveKit's room/data/media model and would force another provider branch
  without solving POS-specific redaction.
- Generic co-browsing SaaS should stay out of the first provider-backed slice.
  It can be reconsidered only if LiveKit plus Athena-owned co-browse events
  cannot meet support latency or reliability requirements without moving
  sensitive policy outside Athena.

Implementation implication: keep the public contract provider-neutral and route
provider calls through a `LiveKitRemoteAssistTransport` implementation. Treat
`livekit` as the only supported production transport provider for the next
delivery slice. Use `provider_adapter` only as an escape hatch for future
migration work or tests that intentionally exercise the generic boundary, not as
the normal v1 session provider value.

Do not couple Remote Assist to LiveKit outside the transport adapter:

- POS and Terminal Health should consume Athena session state and transport
  capabilities, not LiveKit room objects.
- Convex public functions should mint scoped Athena transport credentials, not
  expose raw provider credentials or grants.
- Runtime and support clients should publish/subscribe through Athena Remote
  Assist transport helpers so a future provider swap changes the adapter, not
  POS authority or session lifecycle code.

## Validation

Keep the validation map targeted to the whole foundation boundary:

- Remote Assist schema, repository, policy, session lifecycle, public API, and
  LiveKit transport adapter contract tests.
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
