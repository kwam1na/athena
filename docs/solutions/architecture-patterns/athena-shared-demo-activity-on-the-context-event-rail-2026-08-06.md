---
title: Shared-demo visitor activity rides the context event rail, with denials observed from the browser
date: 2026-08-06
category: architecture-patterns
module: packages/athena-webapp shared demo and context tracking
problem_type: architecture_pattern
component: assistant
resolution_type: code_fix
severity: medium
applies_when:
  - Adding a new surface or event family to the context event rail
  - Capturing what a shared-demo visitor did, tried, or was refused
  - "Recording anything about a caller whose write was denied inside a Convex mutation"
tags: [shared-demo, context-events, telemetry, operation-admission, convex-transactions]
delivery_diff_fingerprint: 57612c56f24cc3ba3be665256238a7e4632c5d75bd78c67f7f826db7ebc925a6
---

# Shared-demo visitor activity rides the context event rail, with denials observed from the browser

## Problem

The shared demo had no visibility into visitor behavior. Nothing recorded which
surfaces visitors reached, what they completed, or where the demo refused them,
so there was no evidence for which parts of the demo work and which parts turn
people away.

The obvious design — capture everything server-side at the operation-admission
boundary — is half impossible, and the second-most-obvious design — reuse the
`athena_webapp` surface and its `store_admin` visibility — leaks one visitor's
behavior to the next.

## Solution

Three decisions carry the design.

**A denied action cannot be recorded by the server that denies it.** A denied
shared-demo admission throws, and a Convex mutation throw rolls back every write
in its transaction — including a context-event insert and including anything
handed to `ctx.scheduler`. So capture splits by outcome:

- `shared_demo.action_admitted` is written server-side in
  `convex/operationAdmission/publicMutation.ts`, sharing the operation's
  transaction. That sharing is the feature: if the handler throws, the
  observation rolls back with it, so a surviving row means the action really
  happened.
- `shared_demo.action_denied` is emitted from the browser. `runCommand` is the
  one place every command failure passes through, but it must stay browser-safe
  and free of Convex imports, so it notifies a one-slot observer
  (`src/lib/errors/sharedDemoDenialObserver.ts`) that the demo runtime
  registers. The browser only learns *that* the demo refused — the denial error
  carries no capability or admission reason — so the event records the surface
  the visitor was on, not the operation they attempted.

**Demo visitors are store admins of the shared store.** Every demo principal
points at the same `athenaUser` and the same `storeId`. Anything written at
`store_admin` visibility would be readable by the next visitor. Every
`shared_demo.*` event is therefore registered `visibilityMode: "support"` and
appended `nonCompilable: true`, and the rollup is an `internalQuery`.

**The per-visitor identity is the auth user, not the athena user.** Each
admission mints its own `users` row and `sharedDemoPrincipal`, but they all
share one `athenaUserId`. Grouping by `athenaUser` collapses every visitor into
one. Both capture paths stamp `actorRef: { kind: "guest", id: authUserId }`,
resolved server-side, so a browser cannot claim to be another visitor.

Two smaller rules that fall out of the rail's own validation:

- Payload values are scanned for sensitive free text, which rejects legitimate
  catalog identifiers such as `payments.refund`. `operationId`, `capability`,
  and `surfaceKey` are validated as *closed identifiers* — a strict shape, no
  text scan — because they come from a compile-time catalog rather than a
  visitor.
- Navigation records the catalog's **route template**, never the visited
  pathname, so no org slug, store slug, product slug, or record id is captured.
  `resolveAthenaViewRoute` in the surface catalog returns the matched template
  alongside the surface for exactly this.

## Why This Matters

Getting either half of the capture wrong fails quietly. A denial event written
server-side never appears and looks like "visitors never hit a wall." A
`store_admin` visibility class works perfectly in tests and exposes visitor
behavior in production. Neither failure surfaces as an error.

## Prevention

- Before recording anything about a rejected call inside a Convex mutation, ask
  where the transaction boundary is. If the call throws, the record is gone.
- When adding a context event surface, decide visibility from *who can read the
  store*, not from who the event is about.
- Keep telemetry non-blocking: `captureSharedDemoAdmittedActionWithCtx` swallows
  its own failures, and the client reporter drops errors, so observation never
  decides whether an operation succeeds.
- New public Convex mutations need a capability-catalog classification, a
  migration-inventory entry, and an `assertConformsToExportedReturns` contract
  test. All three are enforced by existing sensors and will fail the focused
  suite, not the merge gate.

## Examples

Capture at the admission boundary, inside the operation's own transaction:

```ts
const operationAdmission = await resolveAdmission(ctx, args, definition);
// Rolls back with the handler if it throws — recorded actions really happened.
await captureSharedDemoAdmittedActionWithCtx(ctx, operationAdmission);
return handler(ctxWithAdmission, args);
```

Denials travel the other way, browser to server:

```ts
// runCommand.ts — browser-safe, no Convex import
if (!isSharedDemoActionDeniedData(error.data)) return null;
notifySharedDemoDenial();
```

## Related

- [Shared demo backend coverage](../../../packages/athena-webapp/docs/shared-demo-backend-coverage.md)
- [Intelligence context tracking](../../intelligence-context-tracking.md)
- [Shared demo read admission rail](athena-shared-demo-read-admission-rail-2026-07-22.md)
- [Operation admission rail](athena-operation-admission-rail-2026-07-21.md)
