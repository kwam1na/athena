---
title: Athena POS Hub App-Session Continuity Is Route Scoped
date: 2026-06-02
category: architecture
module: athena-webapp
problem_type: pos_hub_app_session_continuity
component: pos
symptoms:
  - "A registered POS terminal can be redirected to the generic login flow after recoverable app-session drift"
  - "A POS app-session recovery path can be mistaken for full app access"
  - "App-session recovery can be confused with terminal, drawer, command, or staff sale authority"
root_cause: app_login_recovery_and_pos_sale_authority_were_not_documented_as_separate_route_scoped_boundaries
resolution_type: route_scoped_recovery_boundary
severity: high
tags:
  - pos
  - app-session
  - local-first
  - terminal-authority
  - route-scope
---

# Athena POS Hub App-Session Continuity Is Route Scoped

## Problem

The POS hub can need continuity when the browser is still a provisioned store
terminal but the app-level Athena session drifts into a recoverable signed-out
state. Treating that drift like every other authenticated route sends operators
to generic login even though the terminal may still have local POS context.

The opposite mistake is also risky: a POS recovery assertion must not become a
general Athena login. It is only a route-scoped continuity bridge for the POS
hub. It must not grant Operations, Admin, Cash Controls, Products, Services, or
other protected store surfaces.

## Solution

Keep POS hub continuity as an explicit route-scoped state:

- Only POS hub route intent can enter recoverable app-session continuity. All
  non-POS routes keep the normal signed-out redirect or protected-surface gate.
- Server validation must approve the same store, active terminal, app-session
  account, account capability, route scope, and terminal recovery context before
  returning a recoverable assertion.
- The assertion is support evidence for the POS hub, not a reusable credential.
  Do not store passwords, OTP material, auth tokens, staff PINs, staff verifier
  material, or reusable app credentials in browser storage.
- Runtime status and terminal health can publish support-safe recovery posture,
  but must redact raw assertions, backend failure text, staff proof, sync
  secrets, customer data, and payment data.
- Blocked recovery copy should stay calm and operational: say what the terminal
  needs next, such as signing in again or reconnecting the register from POS
  Settings, without exposing raw backend reasons.

## Sale Authority Boundary

App-session recovery keeps the POS hub mounted. It does not authorize a sale.

Sale-affecting local commands still require the existing POS gates:

- terminal integrity for the provisioned register;
- drawer lifecycle authority for the mapped register session;
- local command invariants for cart, payment, completion, closeout, reopen, and
  drawer reuse;
- staff proof or manager proof when a command requires staff authorization.

Do not clear terminal integrity blocks, drawer authority blocks, local review
state, staff proof requirements, or local command preconditions merely because
app-session recovery succeeds. Recovery failure should block or limit the POS
hub safely; recovery success should only restore the app-session continuity
needed by the route.

## Regression Targets

Guard this boundary with the focused POS hub continuity slice:

- `src/routes/_authed.test.tsx` proves route scope: recoverable app-session
  drift keeps the POS hub shell mounted, while Operations, Admin, Cash Controls,
  Products, and Services keep signed-out redirect behavior.
- `convex/pos/public/terminalAppSessions.test.ts` proves server validation:
  only active same-store terminals and POS-hub route scope receive recoverable
  assertions, and returned diagnostics do not include reusable credentials,
  proofs, tokens, or OTP material.
- `src/lib/pos/infrastructure/terminal/usePosTerminalAppSessionRecovery.test.ts`
  proves recovery retries: validation starts only under POS hub recovery
  preconditions, retries bounded transient failures, waits while offline, and
  rejects stale or wrong-store assertions.
- `convex/pos/application/terminals.test.ts`,
  `convex/pos/public/terminals.test.ts`, and
  `src/lib/pos/infrastructure/local/usePosLocalSyncRuntime.test.ts` prove
  terminal diagnostics: runtime status and terminal health carry support-safe
  app-session posture without leaking raw recovery data.
- `src/components/pos/PointOfSaleView.test.tsx`,
  `src/lib/pos/infrastructure/local/usePosLocalSyncRuntime.test.ts`, and the
  existing POS register/local command tests prove sale-gate invariants remain
  separate from app-session recovery.

## Prevention

- Do not widen POS app-session recovery outside the POS hub without a new
  product and security review.
- Do not use a POS recovery assertion as a full Athena user for app chrome,
  admin navigation, or protected store surfaces.
- Do not collapse terminal integrity, drawer authority, local command
  invariants, or staff proof into app-login state.
- Do not expose raw backend rejection text in operator copy. Normalize it to
  next operational actions and support-safe diagnostics.
- Update the Athena validation map when adding new POS app-session continuity
  files so route scope, server validation, retry behavior, diagnostics, and
  sale gates are tested together.

## Related

- [Athena POS Entry And Readiness Are Local First](./athena-pos-local-first-entry-readiness-2026-05-14.md)
- [Athena POS Terminal Health Visibility](./athena-pos-terminal-health-visibility-2026-05-20.md)
- [Athena POS Stale Terminal Sale Blocks](../logic-errors/athena-pos-stale-terminal-sale-block-2026-05-29.md)
