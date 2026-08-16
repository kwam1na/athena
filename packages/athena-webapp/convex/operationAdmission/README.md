# Operation admission rail

The single admission boundary for backend ingress. Every public Convex
mutation, query, and action and every Hono route declares an operation
definition and runs through one canonical wrapper per ingress kind.

Plan: `docs/plans/2026-08-16-002-feat-complete-operation-admission-migration-plan.md`.
This file describes the U1a end-state contract; U12 finishes the docs.

## Shape

```
ingress ──► canonical wrapper ──► composition root ──► rail core ──► handler
```

- **Rail core** (`convex/operationAdmission/**`) owns sequencing and pure logic:
  definitions and their validation, scope resolution, the adapter chain, target
  resource guards, ingress verification sequencing, and the wrapper factories in
  `rail.ts` (`createAdmissionRail({ adapters, readAdapters, resourceGuards,
  capture, ingressVerifiers, entrypoints, extractIngressClaim })`). It imports
  **only** files under `convex/operationAdmission/**`, `convex/_generated/**`,
  and `convex/platform/{capabilityCatalog,readIntentCatalog,storefrontOrigins}.ts`.
  A path-prefix allowlist lint (`importAllowlist.test.ts`) enforces this, with
  fixtures proving that importing the composition root or a policy module fails.
- **Composition root** (`convex/platform/operationAdmission.ts`) registers the
  policy — shared-demo write/read adapters, the storefront-customer adapter,
  the demo foundation guards, the shared-demo capture port — and exports the
  canonical wrappers `admitPublicMutation`, `admitPublicQuery`,
  `admitPublicAction`, `admitHttpRoute`, `admitHttpRead`.
- **Registered entry points** (`convex/platform/admissionEntrypoints.ts`)
  provide the internal mutation (`admitOperation`, write path, with capture) and
  internal query (`admitReadOperation`, read path, no write and no capture) that
  actions and routes call, since they have no `db` of their own.

## Definition contract

```
OperationDefinition {
  kind: "mutation" | "action" | "http",
  functionName? | route?, operationId,
  capability: AthenaCapability | { kind: "dynamic", candidates, resolve(args) },
  scope: none | store(storeIdArg | resolve) | organization(...),
  readiness: none | store_write (mutation only) | store_ready (action/http only),
  effects: none | protected { gateways },
  target?: { protectDemoFoundation?, protectDemoFoundationExternalRefs? },
  ingressVerification?  (http kinds),
  actors: { normalUser, sharedDemo, storefrontCustomer?, public }
}
```

Read definitions are the sibling type: `kind: "query" | "http_read"` with
`access.intent: AthenaReadIntent` and no `target`.

Validation rules worth stating out loud:

- `actors.public` is required on every definition; `actors.storefrontCustomer`
  is required on `http`/`http_read` and rejected elsewhere (a plain argument is
  not a claim boundary), and requires a store scope.
- On an `http` **write**, `storefrontCustomer: "admit"` and `public: "admit"`
  are mutually exclusive — a cookieless request to a customer write route is a
  terminal denial, not an anonymous admission — and such a route must declare
  `ingressVerification: { kind: "origin_allowlist" }`. A `public` `http`
  definition (webhook, tracking event) must declare some `ingressVerification`.
- `store_write` is valid only on `mutation`; `action`/`http` declare
  `store_ready`, the admission-time restore fence without write semantics. Any
  demo-reachable write those bodies perform lands in an internal mutation that
  re-applies `requireReadySharedDemoWriteWithCtx` with the admitted store id.
- A dynamic capability is all-of: every resolved capability must be granted, and
  a resolved capability outside `candidates` denies the call.

## Adapter chain

Order is trust order: **shared demo → normal user → storefront customer →
public**. Adapters return `admitted | denied(recognized, typed reason) |
unauthenticated | not_applicable`. The chain falls through **only** on
`unauthenticated` / `not_applicable`; a `denied` outcome is terminal and is
never retried against a lower-trust adapter; any unexpected throw propagates.
Identity is resolved before scope, so a scope-resolver failure can never
downgrade an authenticated caller. Reasons are data (`session_expired`,
`demo_disabled`, `scope_denied`, `unknown_claim`, `claim_missing`, …) — no
adapter classifies by error-message text.

## Actors

- `normal_user` — an authenticated Athena user, resolved through an injected
  identity port so the rail core imports no auth module.
- `shared_demo` — a server-owned demo principal; writes are gated by the closed
  capability grant set, reads by `SHARED_DEMO_ALLOWED_READ_INTENTS`
  (`convex/sharedDemo/policy.ts`, asserted against the demo-admitted read
  definitions in `readIntentGrants.test.ts`).
- `storefront_customer` — a shopper identified by the `user_id` / `guest_id`
  cookie, admitted only on `http` / `http_read`. **This is proof of possession,
  not authentication**: `assurance: "bearer_id"` is recorded in provenance, the
  store is derived from the claim ROW (the `store_id` cookie is only
  cross-checked), and every internal callee reachable from a customer route
  still asserts ownership of caller-supplied ids against the admitted actor.
  Unknown id, foreign store, a guest without `storeId`, or a missing claim on a
  write route is a terminal denial.
- `public` — no identity at all; admitted only where `actors.public: "admit"`,
  and it clamps nothing.

## Target resource guards

`target` guards protect demo fixture rows from **every** actor, including a
normal full admin, so they are guards rather than actor policy. They are bound
on the definition — `true` (use the resolved scope constraints), an id-binding
object, or `{ resolve }` — validated at declaration and evaluated by the rail
after scope on every write/action/http definition. On action/http kinds the
guarantee is ingress-time only; the internal mutation that performs the write
re-applies it.

## HTTP ingress

`admitHttpRoute` reads the raw body **once**, runs `ingressVerification` on the
raw request **before** the admission mutation (a verification failure leaves no
admission row and no capture), then admits and hands the handler
`{ admission, ingress }` — the handler parses `ingress.rawBody`, so a signature
covers exactly what the handler acts on and the `Request` body is never read
twice. `admitHttpRead` admits through the internal query with no write and no
capture. The origin allowlist is `convex/platform/storefrontOrigins.ts`:
env-backed, exact-match, and fail-closed — absent, `null`, or unlisted origins
deny, and an unset allowlist allows nothing.

## Per-unit domain modules

`domains/_shapes.ts` holds the shared definition shapes and `domains/uN_<name>_definitions.ts` / `domains/uN_<name>_readDefinitions.ts` hold one array per
Phase B unit (underscored — Convex module path components allow only alphanumerics, underscores, periods), composed once
into `definitions.ts` / `readDefinitions.ts`. A Phase B unit fills its own pair
and edits neither composing file.

## Transitional debt (deleted by U1c)

Three rail-core modules are exempt from the import allowlist and exist only so
pre-existing call sites keep their current import paths for one more step:
`publicMutation.ts` and `publicQuery.ts` (the legacy
`withOperationMutationAdmission` / `withOperationReadAdmission` names, now thin
aliases of the canonical wrappers with the full default chain) and
`actionAdmission.ts` (the narrow `admitOperationForAction` entry point).
`adapters.ts` additionally keeps a registered default identity port and a legacy
adapter-set argument shape for the three call sites that hand-assemble a chain.
`migrationInventory.ts` is retired by U1b's checker coverage test.

## Validation

```bash
cd packages/athena-webapp
bun run test -- convex/operationAdmission convex/sharedDemo \
  convex/storeFront/operationAdapter.test.ts convex/platform \
  convex/lib/athenaUserAuth.test.ts convex/http
bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json
bun run --filter '@athena/webapp' lint:convex:changed
```
