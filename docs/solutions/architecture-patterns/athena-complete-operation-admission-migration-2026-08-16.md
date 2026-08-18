---
title: Completing an Admission Rail — Deriving Invariants Instead of Listing Them
date: 2026-08-16
last_updated: 2026-08-16
category: docs/solutions/architecture-patterns
module: Athena Convex backend ingress admission
problem_type: architecture_pattern
component: authentication
resolution_type: code_fix
severity: critical
applies_when:
  - "A partially-adopted security rail has an exemption list that is no longer shrinking"
  - "Hand-maintained registries restate facts that a declaration already carries"
  - "HTTP routes authenticate from a cookie id read directly out of the request"
  - "A migration must move ~400 call sites without changing normal-user behavior"
tags: [athena, convex, operation-admission, shared-demo, authz, static-checker, http-ingress, derived-invariants]
delivery_diff_fingerprint: fb71d31ea2333075c19f4ac9676529bb729cd628a4d79edb5bc65aa59acd4ebf
---

# Completing an Admission Rail — Deriving Invariants Instead of Listing Them

## Problem

Athena had an operation-admission rail that worked and that nobody finished
adopting. Two prior deliveries established the pattern for writes
([2026-07-21](./athena-operation-admission-rail-2026-07-21.md)) and reads
([2026-07-22](./athena-shared-demo-read-admission-rail-2026-07-22.md)), but
both stopped at demo-reachable surfaces. On `origin/main` that left:

- **411 unadmitted Convex exports** — 189 raw public mutations (against 57
  admitted), 184 raw public queries, 38 raw public actions.
- **A 189-entry exemption list** that was structurally indistinguishable from
  the backlog it represented. An exemption list that stops shrinking stops
  being a migration tool and becomes a permanent second policy.
- **93 Hono HTTP routes with no admission at all** — and this was the real
  exposure, because the storefront webapp reaches the backend *exclusively*
  through those routes. They read a `user_id` / `guest_id` cookie, treated it
  as identity, and passed it into `api.*` and `internal.*` calls as if it had
  been authenticated. The CORS middleware reflected any origin.
- **Four hand-maintained registries** (`classifyAthenaPublicWrite` and its
  module map, `SHARED_DEMO_PUBLIC_FUNCTION_INVENTORY`,
  `SHARED_DEMO_GATEWAY_ENFORCEMENT_BINDINGS`, `sharedDemoCapabilityValidator`)
  that restated, by hand, facts the definitions already carried.
- **~50 handler-local demo guards** (`requireSharedDemoCapabilityIfApplicable`,
  `requireNonDemoFoundationMutation`, `enforceSharedDemoActionCapability`,
  `denySharedDemoEffectIfApplicable`, `requireAuthenticatedNonDemoEffect`)
  spread across the codebase, each stating "not the demo" at one point inside
  one handler.

The property the rail was supposed to give — *capability declared ⇒ admission
installed* — held for about a quarter of the backend.

## Solution

Migrate **all** backend ingress onto one rail, in eleven parallel units behind
one integration branch, then delete every construct that existed only to
tolerate partial adoption.

End state: **605 admitted ingress points** — 244 queries, 232 mutations, 35
actions, 45 HTTP writes and 49 HTTP reads — each declaring an operation
definition and running through one canonical wrapper per ingress kind. The
checker discovers 609 ingress points; the four it does not admit are Convex
Auth's registrar exports, which together with the HTTP route family
`auth.addHttpRoutes` installs are the only non-admitted ingress by design —
auth is the trust root that MINTS the principals the adapters resolve, so
admitting it with them would be circular.
`bun scripts/convex-operation-admission-check.ts` exits 0 with zero findings.
There is no exemption construct anywhere in the tree — not renamed, not
emptied-but-present. `convex/operationAdmission/coverage.test.ts` asserts the
zero-findings result so it cannot regress quietly.

The Convex counts land *below* the peak reached mid-migration (266/245/40)
because closure deleted 40 public exports that had become orphaned: once the
HTTP routes switched to `internal.*` siblings, those exports had no callers
anywhere. `storeFront/auth` ended with no public exports at all. Migrating an
ingress and then discovering nothing calls it is a normal outcome of making
every caller explicit.

### The three ideas worth reusing

#### 1. Derive the invariant; do not maintain a list beside it

Each deleted registry had the same defect: it restated something a definition
already said, so it could disagree with reality and nothing would notice.

| deleted | derived successor | how it had drifted |
|---|---|---|
| `SHARED_DEMO_PUBLIC_FUNCTION_INVENTORY` | `deriveSharedDemoRepresentedCapabilities(definitions)` | claimed representation for functions whose demo guard had since been removed — it only checked the export still existed |
| `SHARED_DEMO_GATEWAY_ENFORCEMENT_BINDINGS` | `deriveSharedDemoGatewayBindings(definitions)` | verified by grepping module source for a guard identifier; every remaining match was inside a `// retired` comment, so it passed while nothing enforced it |
| `classifyAthenaPublicWrite` + module map | the definition's own `capability` | a second, parallel answer to "what capability is this?" |
| hand-listed `sharedDemoCapabilityValidator` | derived from `SHARED_DEMO_ALLOWED_CAPABILITIES` | accepted six capabilities the demo was never granted, plus one (`reports.read`) that no longer existed |

The test for whether a list should exist: *can this be computed from something
already declared?* If yes, the list is not documentation, it is a second source
of truth with no mechanism keeping it honest.

#### 2. Assert derived invariants in **both** directions

Deriving alone is not enough — direction matters, and the two directions catch
opposite failures:

```ts
// forward: a grant that nothing implements
for (const capability of SHARED_DEMO_ALLOWED_CAPABILITIES) {
  expect([...represented]).toContain(capability);
}

// reverse: an operation that admits the demo for something ungranted
for (const capability of represented) {
  expect(granted.has(capability)).toBe(true);
}
```

The legacy inventory could only ever express the forward direction — it was a
list of representatives, so a newly added `sharedDemo: "admit"` on an ungranted
capability was invisible to it. The reverse direction is the one that actually
fences the boundary, and it is free once the set is derived.

#### 3. A retired runtime guard becomes a declaration field, not a deleted line

Every handler-local guard was **re-expressed**, never dropped, with a per-site
mapping table from the retired call site to its successor and a test per site:

| retired guard | successor |
|---|---|
| `requireNonDemoFoundationMutation` / `...ExternalRefs` | bound `target.protectDemoFoundation` guard on the definition |
| `requireAuthenticatedNonDemoEffect`, `denySharedDemoEffectIfApplicable`, `enforceSharedDemoActionCapability` | `actors.sharedDemo: "deny"`, or a declared `effects.protected` gateway |
| `requireSharedDemoCapability*`, `getSharedDemoActorWithCtx` | the definition plus `ctx.operationAdmission` |

This is strictly stronger than what it replaced. A guard said "not the demo" at
one statement inside one handler, and it was only as good as its position in
that function. A declaration says it for the whole operation and is enforced
before the handler is entered — so the property no longer depends on statement
order, and the tests that verify it stop being assertions about source text.

## Why This Matters

**The exemption list was the bug.** Not the unmigrated call sites — those were
just work. A structure that lets "not yet covered" be expressed indefinitely
converts a migration into a permanent two-policy system, and the second policy
is the one nobody reads. The finish line for this delivery was therefore
defined as *the exemption construct does not exist*, not *the exemption list is
empty*, precisely because an empty list is one commit away from being non-empty
again.

**Static checks that grep for identifiers decay silently.** The gateway-binding
check was green throughout the migration while the thing it checked was being
deleted underneath it, because the retired guards left `// Retired: ...`
comments behind and `toContain("requireNonDemoFoundationMutation")` matched
them. A test that passes for the wrong reason is worse than a missing test: it
is a missing test that also blocks you from noticing. Where a property genuinely
needs AST-level knowledge, defer to the AST tool (here, the checker) rather than
writing a weaker regex version of it in a unit test.

**Cookie-as-identity is the failure mode a rail is for.** The HTTP routes were
not lightly guarded; they were unguarded, and every route independently decided
how much to trust the cookie. Introducing `storefront_customer` as an explicit
actor kind with `assurance: "bearer_id"` recorded in provenance forced that
decision into one place and made it reviewable — and made "proof of possession
is not authentication" a property of the type system rather than of reviewer
memory.

## Prevention

- The admission checker runs as a gate (`bun run pr:athena`) and
  `coverage.test.ts` asserts zero findings. New raw ingress fails immediately.
- `FRAMEWORK_ENTRY_POINTS` — the only non-admitted ingress, Convex Auth, the
  trust root that mints principals — is verified **both ways**: a stale entry is
  a finding, and an unlisted registrar is a finding. That is what keeps it from
  becoming an exemption list by another name.
- `importAllowlist.test.ts` enforces a path-prefix allowlist on the rail core,
  with fixtures proving that importing the composition root or a policy module
  fails.
- Both grant sets (`SHARED_DEMO_ALLOWED_CAPABILITIES`,
  `SHARED_DEMO_ALLOWED_READ_INTENTS`) are fenced from both directions by
  `sharedDemo/policy.test.ts` and `readIntentGrants.test.ts`.

## Examples

Adding a public function, end to end — the full contract is in
`packages/athena-webapp/convex/operationAdmission/README.md`:

```ts
// 1. Declare, in the domain module that owns the area.
export const recordThingOperationDefinition = storeWriteOperation({
  functionName: "operations/things:recordThing",
  operationId: "operations/things.recordThing",
  capability: "daily_operations.write",   // closed catalog
  actors: { normalUser: "admit", sharedDemo: "deny", public: "deny" },
});

// 2. Wrap the export with the canonical wrapper from the composition root.
export const recordThing = mutation({
  args: recordThingArgs,
  handler: admitPublicMutation(recordThingOperationDefinition, recordThingWithCtx),
});
```

Rules that are easy to get wrong: `actors.public` is required and never
implied; an admitted body calls only `internal.*` (an `api.*` hop re-enters the
rail with the *server's* identity and launders the caller's actor); and every
`owner` / `storeId` an internal callee needs comes from `ctx.operationAdmission`,
never from arguments.

## Policy-preserved narrowings (for product review)

The migration deliberately did **not** widen demo reach, which means four
narrowings were preserved rather than resolved. These are product questions,
not migration questions:

- `pos.session.manage` — not demo-granted, though the demo shows POS.
- `expenses.view` — not demo-granted, though `/pos/expense` is a demo route.
- `storefront.reviews.view` and `storefront.analytics.view` — not demo-granted.

The retired `reports.read` write capability is a different case and was not a
narrowing: it existed only so the demo could READ Reports, which is what a read
intent is for. Its successor is `reports.view` in
`SHARED_DEMO_ALLOWED_READ_INTENTS` — same reach, correct mechanism.

## Operational prerequisites

The HTTP rail is **fail-closed by construction**, so these must be set before
any deploy or the corresponding ingress denies everything:

| variable | unset behavior |
|---|---|
| `ATHENA_STOREFRONT_ALLOWED_ORIGINS` | every storefront customer write 403s; CORS sends no `Access-Control-Allow-Origin` at all (never `*`) |
| `PAYSTACK_SECRET_KEY` | the Paystack webhook rejects every delivery — **payment callbacks stop**. Newly load-bearing: the signature check existed only as commented-out code before this delivery |
| `WHATSAPP_WEBHOOK_APP_SECRET` | WhatsApp webhook rejects (503 unconfigured) |
| `MTN_MOMO_COLLECTIONS_CALLBACK_SECRET` | MTN MoMo callback rejects — **also** must be appended to the registered callback URL as `callbackSecret=…` |
| `WALKTHROUGH_ALLOWED_ORIGINS` | marketing walkthrough / funnel writes deny |
| `ATHENA_WAIVER_BROKER_SECRET` | harness waiver routes deny |
| `ATHENA_STOREFRONT_COOKIE_SECRET` | **new** — no guest session can be issued or accepted, so every guest-identified path (cart, saved bag, orders, rewards, the guest→account merge) goes dark; anonymous catalog browse is unaffected |

One data prerequisite: the **guest `storeId` backfill** must run before deploy.
`POST /guests` now requires a store and mints a guest only once the store
resolves, so guest rows without `storeId` cannot be re-owned afterwards.

### Live behavior changes worth naming

- Cookieless customer-scoped reads now **fail closed** (`GET /me`, `/orders`,
  `/checkout/*`, `/rewards/*`, …) instead of returning a benign `null`. A guest
  cookie still admits; only a caller with neither `user_id` nor `guest_id` is
  denied.
- `GET /orders/:orderId` returns 403 rather than 404 for a non-existent order —
  missing and foreign rows are refused identically, which is the anti-probe
  property the ownership denial exists for.
- `POST /tracking-events` no longer records an actor. It derived an actor and
  abuse-partition key from a cookie on a route that verifies nothing, so any
  caller could write onto another visitor's timeline. **Storefront tracking
  events lose shopper attribution** — flagged for product confirmation.

## What review caught that the migration did not

Worth recording, because all four were invisible to the units that introduced
them and only surfaced when the closure unit went looking.

**The guest identity chain had five links, and each round found the next one.**
Body field → cookie compared against itself → cookie the mint trusted → signed
cookie → the recovery **marker**, which was caller-chosen and only five base-36
characters, with a marker-less lookup that resolved the oldest marker-less row.
The marker is now treated as what it always was — a session-recovery secret:
minted client-side with `crypto.randomUUID()`, required to be high-entropy,
scoped to the store being bootstrapped, and **hashed at rest** (`hashGuestMarker`,
SHA-256) so a database read cannot hand over live session credentials.
`GET /homepage-snapshot` no longer mints guests at all, leaving exactly two mint
points instead of three. The pattern worth carrying: when one link in an
identity chain is attacker-controlled, fixing it does not end the review — ask
what the *next* input to that flow is, and who chooses it.

**The last qualification on the central claim, closed in round 9.** Through round 8,
router-level middleware was invisible to the route walk except for the
single allowlisted `cors(...)` registration, so a path-scoped `.use` whose
handler never calls `next()` — `sub.use("/evil", async (c) => c.json({
pwned: true }))` — was a terminal responder for every method under that
path with zero findings. The earlier claim that "`.use` carries only
`cors(...)` today" was also wrong: the tree carries five non-CORS `.use`
sites (`whatsapp.ts:53`, `mtnMomo.ts:37`, `harnessWaivers.ts:140` —
inline signature / bearer verifiers — and `walkthroughRequests.ts:51`,
`landingFunnelEvents.ts:21` — `boundRequestBody(...)` from
`boundedBody.ts`). Round 9 walks `.use` like every other registration and
judges its handler against a closed pass-through-or-deny grammar: an
inline `(c, next) => {…}` that ends in `await next()` / `return next()`,
returns only `next()` or a `return c.json(<body>, <literal 4xx/5xx>)`
denial, touches `c` only as `c.req…` or that denial, and never `c.env` /
`c.res` / a 2xx / a bare `return` / `next()` twice or from a nested
function; or a factory imported by name from a convex module under
`http/` whose export is exactly one returned function passing the same
grammar; or the `hono/cors` factory, judged by `assertCorsAllowlist`.
Everything else is `router-middleware-not-statically-resolvable` (high).
All five real sites pass the grammar unchanged (a probe that mutates each
one to answer 2xx / set `c.res` / drop the trailing `next()` produces one
finding per site); the pinned residual test now asserts the finding. The
qualification on the central claim — an ingress is either admitted or
flagged — is gone. Note the grammar proves the middleware cannot
*respond* except with a denial or by rethrowing its own caught fault, and
cannot *reach* the ActionCtx; it does not (and does not claim to) prove
what an imported verifier does with the bytes it is handed.

The grammar's first cut let `throw` through as "a fault, not a response".
In Hono that premise is false: the default error handler renders any thrown
value carrying `getResponse()` — `new HTTPException(200, { res })`, an
`Error` with a `getResponse` property — as *the response*, with the status
it names, so a grammar-passing middleware could still answer every request
under its path with a constructed 2xx. Two layers close it. The grammar now
accepts a `throw` **only** as the unrebound rethrow of the middleware's own
`catch (<id>)` binding (the harness-waiver shape); every constructed or
obtained value fails. And `http.ts` installs exactly one fixed
`app.onError((err, c) => c.json({ error: "internal" }, 500))` — asserted by
`assertRootErrorHandler` to be that shape and nothing else, with any
`.onError(` elsewhere under `convex/**` a finding — so even a `getResponse`
error thrown by an imported verifier renders as the fixed 5xx. The same
round pinned `next()` inside a `try` block / `finally` (a middleware may not
observe the admitted handler's failure), rejected generator middleware, and
failed closed on router *acquisition* — every `new Hono()` outside `const
<name> = …` (parameter default, destructuring, class property, loop / catch
binding, call argument) is a finding at the construction, and a
`.route(prefix, child)` whose child the walk cannot open is a finding at the
mount rather than an empty subtree.

**Freeze what the checker trusts.** A static check that compares definition
IDENTITY against a registry is only as good as the registry's immutability: a
module that pushes an entry in at import time gets a definition treated as
declared that no reviewer ever saw. `defineOperation` / `defineReadOperation`
deep-freeze each definition so an admitted handler cannot mutate the policy it
was admitted under, and both registry arrays are frozen so nothing can be
appended. Cheap, and it closes the gap between "the checker verified this
object" and "this object is what runs".

**A blacklist of bad shapes cannot win; a whitelist of one good shape can.**
The structural checker was defeated in three consecutive review rounds, each
time by an expression form its blacklist did not enumerate: a const-bound
wrapper, work hidden in the invocation's arguments, an IIFE argument, and a
composition-root match on an unresolved **path suffix** that any shim — or a
package named `@evil/operationAdmission` — satisfied. Enumerating bad shapes is
unbounded. The checker now accepts a **closed grammar**: the wrapper identifier
must resolve, by fully resolved module path, to the composition root, and the
handler must be exactly `handler: wrapper(definition, handler)` (or a top-level
const of that shape). Everything else raises `wrapper-shape` with a rationale
naming the accepted form. A novel shape now fails closed instead of slipping
through, and the repo's own call sites were adjusted to fit — the grammar is the
contract.

**A grammar over the CALL is still a blacklist over the VALUE.** Rounds 4–6
closed each ring of registration and self-call spellings the previous round
enumerated, and each subsequent review found the ring outside it: the route
walk and the `api.*` ban keyed on one call grammar (`<receiver>.<name>(...)`),
so `sub["get"](…)`, `sub.get.call(sub, …)`, `pick().get("evil", h)`,
`{ get r() { return sub } }`, `ctx["runMutation"](api.x)`, `const { example }
= internal; runMutation(example.x.write)` all served or re-entered with zero
findings. Ingress discovery had never had this problem, because it keys on
*any value reference to the builder* — the value cannot be obtained without
being referenced. Round 7 gave the router and the `api` root the same
treatment: any value reference outside a short list of accepted positions is
a finding, receivers are unresolvable by default, `internal` locals fail
closed on loss of path, and run sites are matched by callee name in every
shape. The generalisable rule: when the thing you are guarding is a *value*
(a builder, a router, a function reference), guard the value's references,
not the syntax of one call on it.

**A wrapper "somewhere in the handler" is not admission.** The checker
originally accepted an inline handler as admitted if a wrapper call appeared
anywhere in its body and no public `ctx.db` write came first. That let nine
handlers read the database, call `ctx.runQuery` / `runMutation`, or run a
*second* admission probe before the caller was admitted. The rule is now
positional — wrapper as the handler expression, or the first unconditional
statement (a `try` starting with it is fine) — and violations raise
`wrapper-not-first`. All nine sites were converted from a double admission
(`resolveWriteAdmission` probe, then `admitPublicMutation`) to a single
admission with the denial mapped in a catch around it, and
`resolveWriteAdmission` is no longer exported so the shape cannot return.

**A refusal was reported as a server fault.** Admission denials thrown inside
the HTTP entry-point mutation escaped the Hono handler, so Convex rendered them
as **500** — clients retried, monitoring paged, and the response carried the
internal error text. HTTP denials now have a fixed contract: 401 when no
adapter claimed the caller, 403 for an actual refusal, fixed body. The split is
read from typed data on the error, because the classification happens across a
`runMutation` boundary where the original error class is gone — deciding it by
message text would have reintroduced exactly the string-matching this rail
removed from the adapters.

**An optional argument disguised a skipped check.** `assertCustomerOwnsRowIfPropagated`
returned silently when `owner` was absent, and read at the call site exactly
like an ownership check that runs. It was a deliberate transitional measure
while routes were migrating — and the transition finished without anyone
removing it. Eighteen internal callees (not the nine a first pass found: several
inlined the same `if (args.owner)` shape rather than calling the helper) now
take a required `owner`. Where no customer actor genuinely exists, absence is
now explicit and greppable via `SERVER_INITIATED_OWNER` rather than an omitted
argument.

**Bounds applied to the routes someone thought about.** Body-size limits lived
in per-route middleware on the two public marketing routes; the other forty-plus
admitted writes read an unbounded body before admission. The bound now lives in
the rail and applies to every `http` write, before admission, so an oversize
request is a 413 that leaves no admission row.

The shared shape: each was a control that *looked* present at the call site.
That is the failure mode a rail is supposed to eliminate, and eliminating it
means the check has to be somewhere a reader cannot mistake for optional.

## What the independent review round caught

Thirteen reviewer personas ran against the closure candidate. They found two P0s
and a set of P1s, and the pattern in them is worth more than the individual
fixes: **three of the blocking findings were defects introduced by the closure
work itself** — the round that was supposed to be the safety net.

- **A webhook break (P0).** Bounding the ingress body inside the rail meant the
  rail read `c.req.raw.body` directly, while the WhatsApp and MTN MoMo
  middlewares had already consumed it with `c.req.text()`. A Fetch body stream
  reads once, so the rail re-verified an EMPTY body against the same declared
  signature verifier and would have denied every genuine callback with a 403.
  The middlewares now reconstruct the request (`requestWithBody`), and
  `readBoundedRequestBody` throws on an already-consumed body so the next
  instance of this is loud instead of silent.
- **A checker hole (P1).** The new positional rule accepted
  `const run = admitPublicMutation(def, fn)` as proof the wrapper ran first. A
  declaration is not an invocation: a handler could write rows and call
  `ctx.runMutation` before any caller was admitted and still be reported as
  admitted. Worse, `isPreAdmissionCtxEffect` — written specifically to catch
  pre-admission work — was never called from anywhere.
- **An inverted fault contract (P2, found independently by two reviewers).**
  Tagging admission failures at the *catch* site marked every error as a
  denial, so a database error or a throwing scope resolver reached clients as
  403 "Request rejected." — an expected status on these routes, so nothing
  retried and no 5xx reached monitoring. Denials are now tagged at the *throw*
  site with a non-enumerable marker, and anything unmarked surfaces as a 500.

The rest were genuine gaps in the migration: a `bag`/`savedBag` re-owner that
admitted a caller matching EITHER side of a merge (so a signed-in shopper could
absorb and destroy a stranger's cart), guest merges bounded by store but not by
anything else, route handlers mapping every fault to an expected client status,
and lost behavioral coverage on the checkout and sign-in paths.

### The fix that wasn't: a third round, and the sharpest lesson here

The guest-merge fix went out in round 2 bounded by "possession" — comparing the
body's guest id against the request's `guest_id` **cookie**. Two reviewers
independently pointed out in round 3 that a cookie is caller-supplied, so both
operands arrived on the same request and any caller satisfied the check by
typing the same id twice. The exploit precondition was unchanged: know a guest
id, and a stranger's orders, reward points, analytics and cart move into your
account. The delivery had also shipped comments and a solution-note paragraph
asserting the opposite ("they hold no such cookie") — the exact defect this
work exists to remove, committed while removing it.

That fix — a server-issued grant — was **still not enough**, and a fourth round
found why: `POST /auth/verify` minted the grant from the caller's **raw**
`guest_id` cookie, so an attacker presenting a victim's id while signing in to
their own account received a grant on it. Three rounds, three versions of the
same bug: a body field, a cookie compared against itself, a cookie the mint
trusted. The server had no way to tell a guest session it issued to *this
browser* from an id somebody typed.

The complete fix is two layers:

**The guest cookie is signed.** `guest_id` is minted as `<id>.<hmac>` at the two
bootstrap routes and verified in constant time by every consumer
(`convex/platform/storefrontCookieSignature.ts`, gated on
`ATHENA_STOREFRONT_COOKIE_SECRET`). An unsigned or tampered cookie is treated as
**absent**, not as an error — a stale cookie is a shopper to re-bootstrap, not a
fault to page on. Unset secret fails closed: no guest is admitted, while
anonymous catalog browse keeps working. `GET /storefront` and `GET /guests` are
the **only** mint points: `GET /homepage-snapshot` used to be a third that set
a bare unsigned `guest_id` (which no consumer accepted, and which the storefront
never exercised); that branch is deleted and the route now sets store cookies
only.

**The recovery marker is a secret, or nothing.** Both bootstrap routes will
still resolve an *existing* guest from the storefront's session-recovery
`marker` and hand out a signed cookie for it — so "present the right marker" is
"hold the session". Round 4 found the marker was caller-chosen, five base-36
characters of `Math.random()`, matched across every store, and *optional*: no
marker at all resolved the oldest marker-less row under `undefined`, signed.
Now `storeFront/guest:getByMarker` takes a required `marker` and a `storeId`,
answers `null` unless the marker is high-entropy (`isRecoverableGuestMarker`,
≥22 chars, `[A-Za-z0-9_-]`) and the row belongs to that store, and the
storefront mints the marker with `crypto.randomUUID()` (replacing any stored
short one). Absent, empty, short or foreign-store markers mint a fresh guest.
The route tests drive the round-4 attack end to end — cookie-less bootstrap with
the victim's marker, sign in as another shopper, run the five merges — and it
fails at the first step.

Round 5 closed the disclosure side of the same secret. A marker stored in the
clear on the guest row is handed out by every surface that returns a guest
document — `storeFront/guest:getAll` was `scope: none` and listed every
tenant's guests to any signed-in Athena account, `storeFront/users:getByIds`
returns the same document, and so does the public `GET /guests` — so the row now
holds only `hashGuestMarker(marker)` (SHA-256 hex, `http/utils.ts`; the same
mint-raw/store-digest shape as the shared-demo ticket and the receipt-share
token). `guest.create` applies the recoverability gate before storing anything,
writes the digest, and returns the existing row for a repeated
`(store, marker)` instead of minting a second one — which also closes the
two-bootstraps-race that used to leave two rows behind one marker.
`getByMarker` hashes before the `by_marker` lookup, so a digest lifted from a
document is hashed again and misses. `guest:getAll` is now store-scoped
(`storeId` required, `by_storeId`); it had no webapp caller. No backfill: the
branch is undeployed and legacy short markers were already unresolvable. Not
done, on purpose: the marker still travels as `?marker=` on the two bootstrap
GETs — moving it to a header would add a CORS preflight to the store-bootstrap
critical path for a log-exposure benefit that hashing at rest already halves,
so it stays a documented residual rather than a silent widening; and
`storeFront/users:getByIds` remains `scope: none` (outside this change's files,
harmless for the marker now that the column is a digest, still a cross-store
listing worth scoping in its own change).

A hand-rolled synchronous HMAC rather than `hono/cookie`'s signed helpers,
because verification also happens inside `getStorefrontClaimFromRequest`, which
the rail calls **synchronously** — and widening the rail's signature was outside
this change's blast radius.

**The merge authorizes on the server-issued grant**, now minted only from a
verified guest id. Stated precisely, because the previous rounds' imprecision is
the whole lesson:

- It ends the "any signed-in shopper may absorb any guest id, at any time, with
  one request" shape. A merge is possible only inside a **15-minute window**
  opened by an authenticated sign-in, **once per merge kind** (bag, savedBag,
  onlineOrder, analytics, rewards), and **bounded to the admitted store**.
- A live, unconsumed grant is never re-pointed to a different account, so a
  second sign-in cannot strand a half-finished merge sequence.
- **The remaining residual is the legacy-cookie upgrade window.** Pre-signing
  cookies still in browsers are re-minted signed at bootstrap — otherwise the
  deploy would empty every existing cart — and while that path exists, someone
  who knows another shopper's guest id can present it unsigned at bootstrap and
  be handed a signed cookie for it. The upgrade is confined to the two
  bootstrap routes (never at `/auth/verify`, never at a merge), and a cookie
  carrying a signature that does not verify is treated as tampering rather than
  as legacy. **Delete this path once legacy cookies have aged out — 90 days,
  the cookie's own max-age.** Tracked in **V26-1240**.
- `user_id` is deliberately still an unsigned bearer cookie. Signing it is not a
  small delta — it changes the authenticated-shopper claim path rather than the
  guest one — so it stays with the session-assurance work in **V26-1240**.

Three lessons, in order of how much they cost:

1. **"Caller-supplied" includes cookies — and it kept being forgotten.** Three
   rounds, three versions of the same bug, each shipped believing it was fixed.
   A guard comparing two caller-supplied values is not a guard, and a
   server-issued token minted *from* a caller-supplied value inherits that
   value's trust class. The fix has to be something the server issued **and**
   can verify it issued to this caller.
2. **State what a control does NOT buy, at the control.** The residual above is
   written into `customerOwnership.ts` beside the mechanism. A comment naming
   only the guarantee is how the round-2 version survived review by its own
   author.
3. **A security fix deserves the same "does this test fail without it?" check
   as a bug fix** — and here it deserved an adversarial reading of the trust
   class of every operand, which is exactly what the review round supplied and
   self-review did not.

Two lessons generalise:

**A control that reads as present at the call site is the failure mode, and it
recurs.** `assertCustomerOwnsRowIfPropagated` was the first instance; the
either-side merge check, the store-only guest bound, and the catch-all 403 are
the same shape. Each looked like a guard and guarded nothing on the path it was
written for.

**Verify that a regression test fails without its fix.** The first test written
for the webhook P0 asserted `not.toBe(403)` and passed with the fix removed —
the harness returned 500 for an unrelated reason. That is precisely the
"passing for the wrong reason" defect this delivery set out to remove, produced
while removing it. Reverting the fix and watching the test go red is cheap and
is the only thing that actually establishes the test pins the bug.

## Residual risks, ranked

Not fixed here — recorded so they are decisions rather than oversights.

1. **A scope constraint from an argument is a clamp, not an authorization.**
   `resolveOperationScope` records `args[storeIdArg]` as the constraint without
   verifying the caller belongs to that store. Handlers and callees still carry
   the authorization (`requireCashControlsStoreAccess` and friends). Only three
   HTTP definitions resolve scope from a request arg today — the inert
   `/organizations` operator stubs, whose handlers return `{}` and read nothing
   — so there is no live exposure, but the property is easy to misread as
   stronger than it is.
2. **The legacy-cookie upgrade window on the bootstrap routes.** `GET /guests`
   and `GET /storefront` no longer trust an arbitrary `guest_id`: an unsigned
   or tampered cookie is treated as absent, and a bad signature is refused
   outright rather than read as legacy. What remains is the migration path —
   a pre-signing cookie naming a real guest row in that store is re-minted
   signed, so existing carts survive the deploy, and while that path exists
   someone who knows another shopper's guest id can present it unsigned at
   bootstrap and be handed a signed cookie for it. Confined to the two
   bootstrap routes (never at `/auth/verify`, never at a merge).
   **Delete once legacy cookies have aged out — 90 days, the cookie's own
   max-age.** Tracked in **V26-1240**.

   Worth recording how this one read at each stage: the route once carried a
   comment claiming "the id is read from the cookie, never from the request,
   so no supplied id can select another shopper's row" — a cookie *is*
   caller-supplied. That single wrong sentence survived several rounds, and
   the chain of fixes behind it (body field → cookie vs itself → cookie the
   mint trusted → signed cookie → hashed recovery marker) is the delivery's
   most expensive lesson.
3. **Convex Auth's HTTP route family is not admitted.** It is the trust root,
   registered once ahead of the CORS middleware, and `routerComposition.test.ts`
   pins registration order and single registration by source inspection. A
   behavioural precedence test would be stronger.
4. **Payment audit attribution is still read from client arguments** rather
   than from the admitted actor, so the audit record states what the caller
   claimed. Scope-checked as an expansion beyond this contract and deferred to
   **V26-1241**.
5. **`checkoutSession.updateCheckoutSession` / `getByIdInternal`** keep an
   optional `owner` with the `if (args.owner)` no-op shape. Callers are
   genuinely mixed (the Paystack webhook and `inventory/promoCode.ts` have no
   customer actor), so converting them needs the `SERVER_INITIATED_OWNER`
   sentinel plus edits to three route files. `routes/checkout.ts` calls
   `updateCheckoutSession` with a caller-supplied session id and no owner even
   though one is in scope — a defence-in-depth gap, not a live hole, because
   the route checks ownership earlier. Deferred to **V26-1242**.
6. **`userOffers.getEligibility`** takes caller-supplied `storeFrontUserId` and
   `storeId` and asserts nothing. Its only caller derives both from the
   admitted claim, so it is not currently exploitable — but the callee has no
   guard of its own. Deferred to **V26-1242**.
7. **Read amplification against the project's own rule.** The shared-demo
   adapter runs first in the chain for all 605 admitted ingress points, so
   every authenticated staff request now performs an extra indexed
   `sharedDemoPrincipal` lookup that resolves to `null` for the overwhelming
   majority of non-demo traffic. Before this migration only the ~17 demo-aware
   handlers paid it. That is in tension with the standing Convex
   read-minimization rule, and it is the one place this delivery made something
   measurably worse. Accepted for now because the fix — branching on a cheap
   identity claim before touching `ctx.db` — depends on a design call about
   what the auth identity payload can carry. Deferred to **V26-1243**.

8. **Checker residuals after round 7**, all documented in the README table:
   a function reference produced by a *call* (`ctx.runMutation(pick(), …)`),
   a bare parameter, or a bare local of unknown provenance is still left to
   the caller table (the rail core forwards injected internal references that
   way); a router declared *outside* `convex/**` and imported through a
   relative path is caught only when registered on (`.verb(…)` on an import
   binding), not when its value escapes; (`.use('*')` middleware other than
   CORS was invisible by design until round 9 closed it — see "The last
   qualification on the central claim" above); and
   the tsconfig `paths` aliases
   (`packages/athena-webapp/tsconfig.json` declares `~/*`, `@/*`, `@cvx/*`;
   `convex/tsconfig.json` declares none, the Convex bundler resolves none
   inside `convex/**`, and no convex module uses one) are both resolved by the
   checker and reported as unresolvable imports, so an aliased builder or
   `api` import cannot pass — an earlier note that "no such config" existed
   was wrong and is corrected here. Definition modules are additionally
   forbidden from referencing an environment reader (`process`, `import.meta`,
   `globalThis`), because the checker evaluates them in its own process; a
   `Map` / `Set` / class-instance field inside a definition would not be
   deep-frozen (none exists today).

The 41 deleted public functions are enumerated in the U10/U11 hand-off comments
on V26-1237 / V26-1238 and reflected in the regenerated caller table at
`docs/plans/2026-08-16-002-backend-caller-table.md`.

## Related

- [Athena Operation Admission Rail (2026-07-21)](./athena-operation-admission-rail-2026-07-21.md) — established the write rail; superseded in scope by this note.
- [Athena Shared Demo Read Admission Rail (2026-07-22)](./athena-shared-demo-read-admission-rail-2026-07-22.md) — established the read rail; superseded in scope by this note.
- [A static check must resolve what the runtime resolves, and fail closed on the rest](../workflow-issues/static-checks-must-resolve-not-pattern-match-2026-08-17.md) — the checker lesson, extracted for anyone building a merge-gating static check.
- [Verify the Fix — three rounds where the previous round's fix was the defect](../workflow-issues/verifying-a-fix-actually-fixes-2026-08-17.md) — the workflow learning this delivery produced, extracted so it is findable by someone who is not reading about admission rails.
- [Athena Public Operation Admission (2026-07-24)](./athena-public-operation-admission-2026-07-24.md)
- [Reconciling divergent WIP read contracts, not deletions (2026-07-23)](../workflow-issues/reconciling-divergent-wip-read-contracts-not-deletions-2026-07-23.md) — the test this delivery had to pass. That note's lesson is **"intent is recorded somewhere; inference is a last resort"**: its own episode ended in a deletion, and what it argues against is inferring deletion-intent from a diff rather than checking the actual record. This delivery has that record — a written contract (R10 in the plan, restated in the ticket) names every construct to delete and requires each one's invariants to be re-derived rather than dropped. The deletions here are executions of a recorded decision, not inferences from a diff. (A secondary and weaker point: the deleted constructs were duplicates of facts the definitions already carried, so nothing was lost that was not stated elsewhere. The recorded-intent test is the one that actually governs.)
- Plan: `docs/plans/2026-08-16-002-feat-complete-operation-admission-migration-plan.md`
- Contract: `packages/athena-webapp/convex/operationAdmission/README.md`
- Demo coverage: `packages/athena-webapp/docs/shared-demo-backend-coverage.md`
