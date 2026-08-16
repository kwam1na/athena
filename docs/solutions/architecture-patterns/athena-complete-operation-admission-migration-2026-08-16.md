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
delivery_diff_fingerprint: 3596601bf861aa683e77e8cae73cb7943ba886e6b5856ce848abc708d1ce4eba
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
2. **`checkoutSession.updateCheckoutSession` / `getByIdInternal`** still carry
   an optional `owner` with the `if (args.owner)` no-op shape. Callers are
   genuinely mixed (the paystack webhook and `inventory/promoCode.ts` have no
   customer actor), so converting them needs the sentinel plus edits to three
   route files. `routes/checkout.ts` calls `updateCheckoutSession` with a
   caller-supplied session id and no owner even though one is in scope; the
   route checks ownership earlier, so this is a defence-in-depth gap, not a
   live hole.
3. **`userOffers.getEligibility`** takes caller-supplied `storeFrontUserId` and
   `storeId` and asserts nothing. Its only caller derives both from the
   admitted claim, so it is not currently exploitable — but the callee has no
   guard of its own.
4. **`GET /guests` remains a public bootstrap read**: any caller presenting an
   arbitrary `guest_id` cookie can read that guest row. Accepted so cookie
   recovery keeps working; now named in code rather than described as safe.
   (The route previously carried a comment claiming "the id is read from the
   cookie, never from the request, so no supplied id can select another
   shopper's row" — a cookie *is* caller-supplied, so the comment asserted
   safety the code did not have.)
5. **Convex Auth's HTTP route family is not admitted.** It is the trust root,
   registered once ahead of the CORS middleware, and `routerComposition.test.ts`
   pins registration order and single registration by source inspection. A
   behavioural precedence test would be stronger.
6. **`verifyPaymentInternal` has no `returns` validator.** The deleted public
   `verifyPayment` declared a union its own handler could violate; deleting it
   made the mismatch latent rather than fixing it.

The 41 deleted public functions are enumerated in the U10/U11 hand-off comments
on V26-1237 / V26-1238 and reflected in the regenerated caller table at
`docs/plans/2026-08-16-002-backend-caller-table.md`.

## Related

- [Athena Operation Admission Rail (2026-07-21)](./athena-operation-admission-rail-2026-07-21.md) — established the write rail; superseded in scope by this note.
- [Athena Shared Demo Read Admission Rail (2026-07-22)](./athena-shared-demo-read-admission-rail-2026-07-22.md) — established the read rail; superseded in scope by this note.
- [Athena Public Operation Admission (2026-07-24)](./athena-public-operation-admission-2026-07-24.md)
- Plan: `docs/plans/2026-08-16-002-feat-complete-operation-admission-migration-plan.md`
- Contract: `packages/athena-webapp/convex/operationAdmission/README.md`
- Demo coverage: `packages/athena-webapp/docs/shared-demo-backend-coverage.md`
