# Operation admission rail

The single admission boundary for backend ingress. Every public Convex
mutation, query, and action and every Hono route declares an operation
definition and runs through one canonical wrapper per ingress kind.

There is no exemption list, no inventory, and no "migrate this later" state: an
ingress is admitted or the checker fails.

Plan: `docs/plans/2026-08-16-002-feat-complete-operation-admission-migration-plan.md`.
Solution note: `docs/solutions/architecture-patterns/athena-complete-operation-admission-migration-2026-08-16.md`.

## Adding a public function — the whole contract

Start here. Everything below this section is reference for when a step is not
obvious.

1. **Pick the ingress kind.** `mutation` / `query` / `action` for a Convex
   function; `http` / `http_read` for a Hono route. Reads (`query`,
   `http_read`) declare an `access.intent` from `platform/readIntentCatalog.ts`;
   writes declare a `capability` from `platform/capabilityCatalog.ts`. **Both
   catalogs are closed.** If nothing fits, that is a policy question — propose
   the id, do not coin one at the call site.
2. **Write the definition** in your domain module under `domains/`, using a
   shape from `domains/_shapes.ts` where one fits. Export the const: tests
   assert against definitions by name, not by searching the registry.
3. **State every actor.** `actors.public` is required and is never implied.
   `normalUser` and `sharedDemo` are required. `storefrontCustomer` is valid
   **only** on `http` / `http_read`.
   - `sharedDemo: "admit"` is legal only when the capability is in
     `SHARED_DEMO_ALLOWED_CAPABILITIES` (writes) or the intent is in
     `SHARED_DEMO_ALLOWED_READ_INTENTS` (reads). Both directions are asserted
     statically in `sharedDemo/policy.test.ts`, so an admit for an ungranted
     capability fails the suite rather than silently widening demo reach.
   - `public: "admit"` means genuinely anonymous — pre-auth, webhook, or public
     browse. It clamps nothing.
4. **Scope it.** `store` / `organization` scope is what stops an authenticated
   caller reaching another tenant's rows. `none` is a claim that the operation
   is genuinely global; expect to justify it.
5. **Wrap the export** with the canonical wrapper for the kind, imported from
   the composition root:

   ```ts
   import { admitPublicMutation } from "../platform/operationAdmission";

   export const recordThing = mutation({
     args: recordThingArgs,
     handler: admitPublicMutation(recordThingOperationDefinition, recordThingWithCtx),
   });
   ```

   | kind | wrapper | entry point |
   |---|---|---|
   | `mutation` | `admitPublicMutation` | direct (`ctx.db` available) |
   | `query` | `admitPublicQuery` | direct |
   | `action` | `admitPublicAction` | `admitOperation` internal mutation |
   | `http` | `admitHttpRoute` | `admitOperation` internal mutation |
   | `http_read` | `admitHttpRead` | `admitReadOperation` internal query |

6. **Never call `api.*` from an admitted body.** Use the `internal.*` sibling.
   The checker flags self-calls, because an `api.*` hop re-enters the rail with
   the *server's* identity and launders the caller's actor.
7. **Derive identity from `ctx.operationAdmission`, never from arguments.** Any
   `owner` / `storeId` / `userId` an internal callee needs comes from the
   admitted actor. A caller-supplied id is an argument to validate, not an
   identity to trust.
8. **Run the checker**: `bun scripts/convex-operation-admission-check.ts`
   (add `--path <prefix>` while iterating). Zero findings, exit 0.

### The wrapper must run FIRST

Not "somewhere in the handler". The canonical wrapper has to be the handler
expression itself, or the first unconditional statement of the handler body.
Anything ahead of it — a `ctx.db` read, a `ctx.runQuery` / `runMutation` /
`runAction`, a `ctx.scheduler` call — runs for a caller nobody has admitted,
and a wrapper nested inside an `if` admits on some paths only. The checker
raises `wrapper-not-first` for both.

One shape is accepted besides the direct call: a `try` whose block *starts*
with the wrapper, so a handler can catch a typed denial and reshape it into a
`CommandResult` (see `convex/notifications/subscriptions.ts`). Nothing runs
before the wrapper there, so the guarantee holds.

```ts
// GOOD — the wrapper is the handler
handler: admitPublicMutation(def, recordThingWithCtx)

// GOOD — first statement, denial mapped in the catch
handler: async (ctx, args) => {
  try {
    return await admitPublicMutation(def, recordThingWithCtx)(ctx, args);
  } catch (error) {
    const mapped = mapDenial(error);
    if (mapped) return mapped;
    throw error;
  }
}

// BAD — the read runs for an un-admitted caller
handler: async (ctx, args) => {
  const row = await ctx.db.get(args.id);
  return admitPublicMutation(def, recordThingWithCtx)(ctx, args);
}
```

There is no `resolveWriteAdmission` export to probe admission separately with.
It was removed: every call site paired it with a second wrapper call, admitting
the same request twice and doing the probe first.

### The four things that are not obvious

- **Dynamic capabilities are all-of, not any-of.** A batch that mixes a granted
  and an ungranted capability is denied whole, before the handler runs — it is
  never partially applied. A resolved capability outside `candidates` is
  declaration drift and denies the call.
- **`storefront_customer` is proof of possession, not authentication.** See the
  Actors section; internal callees must still assert ownership.
- **`target` guards protect rows from every actor, including a full admin.**
  They are not actor policy. See Target resource guards.
- **`ingressVerification` runs before admission**, on the raw request, so a
  failed webhook signature leaves no admission row and no capture.
- **A scope constraint from an argument is a CLAMP, not an authorization.**
  `resolveOperationScope` records `args[storeIdArg]` as the constraint; it does
  not verify the caller belongs to that store. The constraint is what confines
  the *handler* (and what `target` guards evaluate against); proving the caller
  may act in that store is still the handler's or the callee's job. Prefer
  `{ resolve }` when the scope can be derived from something the caller does
  not supply.

### Framework entry points

`FRAMEWORK_ENTRY_POINTS` in the checker names the only ingress that is *not*
admitted: the Convex Auth registrar exports (`auth:auth`, `auth:signIn`,
`auth:signOut`, `auth:store`) and the HTTP route family `auth.addHttpRoutes`
installs. Convex Auth is the trust root — it MINTS the principals the adapters
later resolve, so it cannot be admitted by them.

The list is verified **both ways**: an entry naming a registrar that discovery
no longer finds is a finding, and a discovered registrar not named in the list
is a finding. That is what keeps it from becoming an exemption list. Adding an
entry is a deliberate act with a stated reason, not a way to silence the
checker.

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

Denials have a fixed status contract: **401** when no adapter claimed the
caller, **403** for an actual refusal, with a fixed body. They are never 500 —
a refusal reported as a server fault makes clients retry, pages monitoring, and
leaks the internal error text. The 401/403 split is read from typed data on the
error, never from its message, because the classification happens on the far
side of a `runMutation` boundary where the original error class is gone.

Every admitted `http` write body is read under a size bound before admission
(`operationAdmission/ingressBody.ts`, `DEFAULT_INGRESS_MAX_BODY_BYTES`), so an
oversize or endless body is a 413 that leaves no admission row. A route wanting
a tighter cap layers its own middleware in front.


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
migration unit (underscored — Convex module path components allow only alphanumerics, underscores, periods), composed once
into `definitions.ts` / `readDefinitions.ts`.

The `uN_` prefixes are historical — they name the delivery unit that migrated
each group, not a runtime concept. Add a new definition to the domain module
that owns its area; the composing registries need no edit.

## The definition set is dynamic

`OPERATION_ADMISSION_DEFINITIONS` / `OPERATION_READ_ADMISSION_DEFINITIONS` are
the only registries, and everything else is derived from them rather than
maintained alongside them. This migration deleted four hand-kept lists that had
each drifted from the code they described:

| deleted | derived successor |
|---|---|
| `SHARED_DEMO_PUBLIC_FUNCTION_INVENTORY` | `deriveSharedDemoRepresentedCapabilities(definitions)` |
| `SHARED_DEMO_GATEWAY_ENFORCEMENT_BINDINGS` | `deriveSharedDemoGatewayBindings(definitions)` |
| `classifyAthenaPublicWrite` + its module map | the definition's own `capability` |
| hand-listed `sharedDemoCapabilityValidator` | derived from `SHARED_DEMO_ALLOWED_CAPABILITIES` |

The rule this encodes: if a fact is already stated on a definition, do not
restate it in a list that a human has to remember to update. Derive it, and
assert the derivation in both directions.

## One import path per wrapper

Every call site imports its wrapper from the composition root
(`convex/platform/operationAdmission`). The transitional re-export modules
(`publicMutation.ts`, `publicQuery.ts`, `actionAdmission.ts`) and the legacy
`withOperationMutationAdmission` / `withOperationReadAdmission` names are gone,
so the import-allowlist exemption list is empty and stays empty. `adapters.ts`
no longer carries a registered default identity port or a hand-assembled
adapter-set argument: the identity port is a required construction argument and
every adapter is built once, here, at the composition root. Handlers that must
catch a denial and translate it into a `CommandResult` use
a `try` whose first statement is the wrapper call, catching the typed denial
and mapping it.

## Environment prerequisites

Every HTTP verifier fails closed, so an unset variable does not degrade — the
corresponding ingress denies everything.

| variable | unset behaviour |
|---|---|
| `ATHENA_STOREFRONT_ALLOWED_ORIGINS` | every storefront customer write 403s; CORS sends no `Access-Control-Allow-Origin` at all, never `*` |
| `PAYSTACK_SECRET_KEY` | the Paystack webhook rejects every delivery — payment callbacks stop |
| `WHATSAPP_WEBHOOK_APP_SECRET` | WhatsApp webhook rejects |
| `MTN_MOMO_COLLECTIONS_CALLBACK_SECRET` | MTN MoMo callback rejects; must ALSO be appended to the registered callback URL as `callbackSecret=…` |
| `WALKTHROUGH_ALLOWED_ORIGINS` | marketing walkthrough and funnel writes deny (resolved once, in `convex/marketing/walkthroughConfig.ts`, and injected into the verifier) |
| `ATHENA_WAIVER_BROKER_SECRET` | harness waiver routes deny |

## Validation

```bash
cd packages/athena-webapp
bun run test -- convex/operationAdmission convex/sharedDemo \
  convex/storeFront/operationAdapter.test.ts convex/platform \
  convex/lib/athenaUserAuth.test.ts convex/http
bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json
bun run --filter '@athena/webapp' lint:convex:changed
```
