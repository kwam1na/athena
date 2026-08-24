---
title: Recovery Must Not Require What It Restores
date: 2026-08-24
category: architecture-patterns
module: athena-webapp
problem_type: logic_error
component: sharedDemo
resolution_type: policy_correction
severity: high
applies_when:
  - "An operation mints, renews, or restores the credential that authorizes callers"
  - "A session-expiry path is being put behind an admission rail"
  - "A client needs to tell 'this is not allowed' apart from 'your session ended'"
tags:
  - shared-demo
  - operation-admission
  - session-expiry
  - recovery
  - convex-error
delivery_diff_fingerprint: 305b5f3afd5ac2d247f183f84987eeaf7d2cf7f787f2b2eaf61933c010218a9e
---

# Recovery Must Not Require What It Restores

## Problem

A shared-demo visitor whose session passed its three-hour admission window was
stranded. The app correctly detected the expiry and offered "Your demo session
ended" with an **Open demo again** button — and the button did nothing. It
returned to the same screen, every time.

The cause is a circular dependency created when the demo went onto the
admission rails. `sharedDemo/admission:issueSharedDemoTicket` is the operation
that MINTS a demo session. Its own definition says `public: "admit"` — an
anonymous visitor may call it, which is exactly how anyone enters the demo in
the first place. But admission runs the shared-demo adapter first, and that
adapter resolves the caller's principal before anything else. For an expired
principal it raised a terminal denial, so the chain never reached the public
adapter.

The result: **you needed a live admission to obtain an admission.** Every route
back in was closed, including the manual one the UI was offering. The visitor's
only escape was clearing site data.

Two things hid this:

- `app:getCurrentUser`, the identity probe every page issues, also threw. The
  error boundary was the only thing that still rendered, so the failure looked
  like a UI problem rather than a deadlock.
- The expiry travelled as a plain `Error`. Convex scrubs the message of a
  non-`ConvexError` outside dev, so the client's `/(?:shared )?demo session has
  expired/i` message test matched on a developer's machine and would have
  matched nothing in production.

## Solution

**Let the recovery operation through.** The shared-demo write adapter now
treats an expired session as "not a demo actor" for a write carrying the
`demo.lifecycle` capability AND `public: "admit"`, returning `not_applicable`
so the chain continues to the public adapter.

Both halves of that condition were earned. Keying on `public: "admit"` alone —
the first shape this took — releases about thirty operations, including a dozen
carrying a deliberate `sharedDemo: "deny"` (invite redemption, auth-code
verification, passkey registration, remote-assist credentials): a demo principal
would reach by waiting what it was refused while live. Worse, the
`terminalProofStoreWrite` family is store-scoped and demo-admitted, so a stale
expired POS tab would keep writing terminal status into the demo store as an
anonymous caller, with the store clamp and the restore fence both skipped —
the public adapter applies neither. `demo.lifecycle` is exactly the set that
manages a demo session, which is all an expired session needs.

It cannot escalate: a demo auth identity is stored with a name and no email,
and the normal-user adapter resolves its Athena user BY email, so it finds
nothing and falls through too. Only `public` picks it up.

**Only on the write path.** Reads keep denying an expired session, including
reads the public may make. That asymmetry is deliberate and was found the hard
way: letting `app:getCurrentUser` fall through to `public` answers it
successfully, so the app sees a half-identified visitor rather than an expired
demo, and quietly redirects to a sign-in form the visitor has no credentials
for. The read denial IS the signal the client renews on. Recovery is a write.

**Make the signal structured.** `session_expired` now leaves the adapters as a
`ConvexError` carrying `shared_demo_session_expired`, distinct from
`shared_demo_action_denied`. The distinction is load-bearing: the client renews
on expiry and must never renew on a policy denial, which would spin forever
against a surface that is never coming back.

**Renew without asking.** `SharedDemoSessionRenewal` takes a fresh ticket, signs
in over the dead session, and reloads — no button. It deliberately does NOT
sign out first, which the demo entry route does: signing out leaves the app
with no identity, the router redirects to sign-in, and the component is
unmounted mid-renewal. Taking the ticket first and signing in over the expired
session swaps identity in one step with no signed-out window to react to.

A capped counter (2 attempts, cleared whenever a live demo context renders)
stops a renewal that keeps landing back on the same failure from reloading
forever; past the cap the manual button returns as the fallback.

## Prevention

The rule this is an instance of: **an operation that mints or restores a
credential must not require that credential.** Before putting a session,
ticket, token, or license operation behind a policy check, ask what the caller
holds at the moment they need it most — which is precisely the moment they hold
nothing valid. If the answer is "the thing this operation issues", the check is
a deadlock, and it will only be discovered by someone whose session actually
expired.

The same review question applies to the error contract: if a client must
*behave differently* based on why it was refused, the reason has to travel as
structured data. A message string is not a contract — Convex scrubs it outside
dev, and matching on it produces code that works locally and silently fails in
production.

Pinned by `operationAdapter.test.ts` — the lifecycle write is reachable, a
public-admitted STORE write is not, and the real ticket definition is asserted
to still carry both keys the exception depends on — plus
`readOperationAdapter.test.ts` (the matching read still denies, and the denial
carries the code as data) and `sharedDemoSessionExpired.test.ts` (a policy
denial is never mistaken for an expiry). Verified in the running app against a
deliberately expired session.

One more trap worth naming: renewal keys on the CODE, never the legacy message.
Renewing is an identity swap, and the message pattern also matches the plain
error thrown for any caller with no demo principal at all — so on a developer
machine, where Convex still forwards that message, a signed-in merchant hitting
such an error would have been silently moved into the demo.

See also [[architecture-patterns/athena-demo-reachable-reads-need-their-own-sensor-2026-08-24]],
the read-reachability half of the same migration.
