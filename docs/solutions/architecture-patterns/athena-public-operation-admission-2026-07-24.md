---
title: Anonymous Callers Need An Explicit Public Actor In Operation Admission, Not A Bypass
date: 2026-07-24
category: architecture-patterns
module: athena-webapp
problem_type: architecture_pattern
component: authentication
resolution_type: code_fix
severity: medium
applies_when:
  - Adding a public-facing mutation (e.g. register-interest, waitlist, contact) that anonymous visitors must be able to call
  - Deciding whether a Convex mutation should silently allow unauthenticated callers or fail closed
  - Extending operationAdmission actors/adapters for a new caller kind
tags: [operation-admission, convex, authentication, public-actor, register-interest]
delivery_diff_fingerprint: 615f240bea97887757c4fea636eac844f1a40f2f4a516a2cff4d7c4b4275a327
---

# Anonymous Callers Need An Explicit Public Actor In Operation Admission, Not A Bypass

## Problem

Athena's `operationAdmission` module previously recognized two actor kinds: `normal_user` and `shared_demo`. Every mutation resolved through it assumed a signed-in caller and threw "Sign in again to continue." for anonymous callers. The new register-interest public surface needed a mutation anonymous visitors could call, but bypassing admission entirely for that one mutation would have left it unaudited and inconsistent with how every other write is gated.

## Solution

Add a third actor kind, `public`, that is admitted only when a mutation's definition explicitly opts in:

- `actors.public: "admit" | "deny"` is a new required field on operation definitions, alongside the existing `normalUser`/`sharedDemo` fields, so every mutation makes its anonymous-access decision visible at the call site.
- `createPublicOperationAdapter()` only resolves to an admitted actor when `definition.actors.public === "admit"`; otherwise it returns `not_applicable`.
- `resolveOperationAdmission` tries the normal-user adapter first. If that adapter throws (the anonymous-caller case), the error is caught and the public adapter is tried. If the public adapter admits, its outcome is used; otherwise the original sign-in error is rethrown unchanged.
- Downstream code that reads `actor.athenaUserId` was audited and updated to treat `public` as having no user id (`getOperationActorAthenaUserId` returns `undefined`; `requireOperationActorAthenaUserId` throws the same sign-in error for operations that never opted public in but still assume an identified actor).

## Why This Works

The default stays fail-closed: adding a new mutation that forgets to set `actors.public` continues to reject anonymous callers with the existing error, so nothing becomes accidentally public. Only mutations that explicitly declare `public: "admit"` open up, and that declaration lives next to the mutation's other admission rules (capability, scope, readiness) instead of in a one-off auth bypass inside the mutation body. This keeps operation admission the single place that answers "who can call this and how."

## Prevention

- When adding a new anonymous-facing mutation, add `public: "admit"` to its `actors` block rather than skipping `resolveOperationAdmission` or hand-rolling an auth check.
- Any code that reads `actor.athenaUserId` off an `OperationActor` must handle the `public` kind (no user id) — use `getOperationActorAthenaUserId`/`requireOperationActorAthenaUserId` from `operationAdmission/actors.ts` instead of accessing the field directly.
- Cover both the admit and deny paths with tests in `adapters.test.ts` when adding a new public-opted-in operation.

## Examples

Before, an anonymous caller against any mutation would throw at the normal-user adapter with no path to succeed. After, a mutation like register-interest declares:

```ts
actors: { normalUser: "admit", sharedDemo: "deny", public: "admit" }
```

and `resolveOperationAdmission` falls through to the public adapter only for that mutation, while every other mutation (which still declares `public: "deny"` or omits it) keeps throwing "Sign in again to continue." for anonymous callers.

## Related

- [Athena Shared Demo Polish Needs One Story Contract Across Seed Data, Policy, and UI](../workflow-issues/athena-shared-demo-cross-layer-polish-2026-07-22.md)
