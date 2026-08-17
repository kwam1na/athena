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

### The wrapper grammar — three shapes, and nothing else

Admission is recognized by a **whitelist grammar**, not by rejecting known-bad
handlers. An ingress is admitted **iff both** of the following hold.

**(1) The wrapper resolves to the composition root.** The import specifier is
resolved against the importing file's own directory, and the result must be
exactly `packages/athena-webapp/convex/platform/operationAdmission.ts`. A bare
or package specifier never qualifies, because it never resolves. A namespace
import (`import * as admission from …`) qualifies only when the same resolution
lands on the same path; a wrapper-named method on any other receiver is not a
wrapper at all.

**(2) The `handler` property is exactly one of these three spellings.**

```ts
// 1. The direct application. The definition may be an identifier or a dotted
//    member expression; the handler an identifier, an inline arrow, or a
//    function expression. Nothing else may appear in the argument list.
handler: admitPublicMutation(def, recordThingWithCtx)

// 2. A top-level const bound to shape 1.
const recordThingAdmittedHandler = admitPublicMutation(def, recordThingWithCtx);
handler: recordThingAdmittedHandler

// 3. The denial-mapping try, and only in this exact form: plain identifier
//    parameters with no defaults, a body of exactly one try, a try block of
//    exactly one statement, the parameters forwarded verbatim, and a catch /
//    finally that never mentions ctx or args.
handler: async (ctx, args) => {
  try {
    return await admitPublicMutation(def, recordThingWithCtx)(ctx, args);
  } catch (error) {
    const mapped = mapDenial(error);
    if (mapped) return mapped;
    throw error;
  }
}
```

Shape 3 exists for one reason: a denial is thrown **by** the wrapper, so the
only place to translate it into a `CommandResult` is around the wrapper call
(see `convex/notifications/subscriptions.ts`). It is the only wrapping function
the grammar accepts. Its `catch` and `finally` clauses are pinned too: they run
after the wrapper has been applied, but "applied" includes **denied** — the
denial is exactly what lands in the catch, with the outer `ctx` / `args` still
in scope. So neither clause may reference an outer parameter, `this`, or
`arguments`, and every callee in them must be a plain identifier or dotted
member (`mapDenial(error)`, `userError({...})`, `error.message`); an IIFE or a
computed callee there is rejected. `catch (error) { return fn(ctx, args); }` is
the unadmitted handler wearing a try, and it fails.

Everything else is rejected, including shapes that look harmless: a concise
arrow around the wrapper, a block arrow that merely returns the invocation, any
call / `await` / IIFE / spread / conditional / comma or logical operator
anywhere in either argument list, a parameter default on the outer handler, a
destructured `ctx`, an optional-chained invocation, a wrapper reached through a
property access on a non-root receiver, a catch or finally that touches `ctx`
or `args`.

```ts
// BAD — the read runs for an un-admitted caller
handler: async (ctx, args) => {
  const row = await ctx.db.get(args.id);
  return admitPublicMutation(def, recordThingWithCtx)(ctx, args);
}

// BAD — a call's arguments evaluate after its callee: the IIFE runs, then
// admission. The wrapper closure was only BUILT first.
handler: async (ctx, args) => {
  try {
    return await admitPublicMutation(def, fn)(ctx, (() => {
      ctx.db.insert("t", args);
      return args;
    })());
  } catch (error) { throw error; }
}

// BAD — a default parameter evaluates before the first statement of the body
handler: async (ctx, args, pre = ctx.db.insert("t", args)) => { … }

// BAD — the catch runs for the caller the wrapper just DENIED
handler: async (ctx, args) => {
  try {
    return await admitPublicMutation(def, fn)(ctx, args);
  } catch (error) {
    return await fn(ctx, args);
  }
}
```

**(3) The definition handed to the wrapper names this ingress.** The wrapper
admits with whatever definition it receives (`rail.ts` does no lookup by
function name), so the checker resolves the first argument — an identifier or
dotted member — through the module's imports to the exported const it denotes,
evaluates it, and requires its `functionName` / `route` to equal the ingress
id. `admitPublicMutation(publicPingDefinition, …)` on `deleteStore` is
`admission-definition-does-not-name-this-ingress`; a definition the checker
cannot follow to a registry export (declared inline, imported from a module
that does not resolve, or a member that does not exist) is
`admission-definition-not-statically-resolvable`. Import the definition const
by name from `definitions.ts`, `readDefinitions.ts`, or a `domains/` module —
those three locations are the **only** ones the checker accepts as a
definition source, and the resolved object must **be** the one the registry
array holds for this ingress (same ESM instance, or field-for-field equal). A
same-named shadow with a laxer `actors` policy — even one placed under
`domains/` but never composed into the registry — is
`admission-definition-not-registered`.

#### Why a whitelist

Because the blacklist lost three times. Each round the checker enumerated the
bad shapes it knew about, and each round a review found one it did not:

1. `const run = admitPublicMutation(def, fn)` accepted as proof of admission — a
   declaration builds the closure; admission happens at the invocation.
2. Pre-admission work hidden in the invocation's argument list.
3. An **IIFE** in that argument list (the function-boundary skip made it
   invisible); a **path-suffix** match on the composition root, so a shim at
   `…/some/other/platform/operationAdmission.ts` or a package named
   `@evil/platform/operationAdmission` counted as canonical; computed and
   destructured `ctx` receivers (`ctx["db"]`, `({ db, …ctx }) => …`); and
   handler **parameter defaults**, which evaluate before the body.
4. The whitelist itself, applied to the wrong set: the grammar pinned the
   `try` block and left the **catch** "unconstrained" — the clause that runs
   precisely when the wrapper has denied the caller. And everything AROUND the
   grammar was still a blacklist: discovery only saw `export const x =
   <builder>(...)`, so `as any`, `export { a }`, a destructured object,
   `mutationGeneric` from `convex/server`, or a `.js` specifier made a public
   function invisible rather than unadmitted; route discovery only looked at
   the last argument of a verb call and only on a `new Hono()` receiver, so
   per-route middleware, chained `.get().get()`, a const-held path, `.mount`,
   and a factory-built router vanished; the `api.*` ban keyed on the spelling
   `api.` rather than on public-function references (`anyApi`,
   `makeFunctionReference`, `.js`, a computed index, an object literal); the
   CORS assertion accepted any `origin` that was not a callback or `"*"`; and
   nothing checked that the definition handed to the wrapper was the
   ingress's own. Round 4 inverted every one of those.
5. The whitelists' **inputs**. Discovery walked only `*.ts` and pruned every
   `_generated/` at any depth, while the bundler registers `.tsx` / `.js` /
   `.mts` / … and skips only the top-level `_generated/`; the builder import
   was a suffix regex, so `../_generated/./server`, a one-line shim, `const m
   = mutation`, or `const { mutation } = server` hid a public function; the
   definition check compared names only, so a same-named shadow with
   `public: "admit"` passed; an unresolved router receiver was flagged only
   for a `/`-prefixed path though Hono prepends the slash itself; the CORS
   count saw only the identifier `cors`, so `honoCors.cors(...)` or a
   sub-router `cors()` reflected origins behind an allowlisted call; the
   `api.*` ban never scanned a module without an `api` import, so a string
   function reference or a `Symbol.for("functionName")` object walked past
   it; and `export let`, a later assignment, or a re-export from outside
   `convex/` was invisible. Round 5 resolves every one of those inputs the way
   the bundler and the runtime do, and fails closed on the rest.
6. The **edges** of round 5. A route on a top-level alias or container of an
   imported router (`const routers = { sub }; routers.sub.get("evil", h)`,
   `const alias = sub; alias.get(P, h)`) sat on the "resolvable" side of the
   receiver rule; the definition check fell back to a JSON comparison that
   serialized every function as `"[function]"`, so a shadow differing only in
   `scope.resolve` or a verifier passed; the `api.*` ban trusted any chain
   rooted at `internal` although `internal` IS `anyApi` at runtime, so
   `(internal as any).example.x.write` called the public function unseen; a
   raw `httpAction` route on the Convex `HttpRouter` (`http.route({ path,
   method, handler })`) beside the Hono app was never a builder and never a
   registration; the external re-export scan followed only `export … from`;
   and a builder or `hono/cors` obtained through `await import()` /
   `require()` / `import x = require()` bound no name discovery could see.
   Round 6 closes each: declaration initializers are resolved for top-level
   receivers (any path on a module-scoped unresolvable receiver is a route),
   definition identity is **instance identity only**, `internal.*` paths are
   enumerated to `a/b:c` against the discovered public set (a computed
   segment fails closed), `httpAction` / `httpActionGeneric` are builders
   with no admitted shape and `.route(<single non-string>)` is flagged on any
   receiver, the external scan follows plain relative imports and fails on
   dynamic module references, and every dynamic reference to the builder
   modules or `hono/cors` is a finding. Definitions are also deep-frozen at
   construction (`defineOperation` / `defineReadOperation`), so mutating the
   registered instance at import time throws instead of relaxing policy, and
   the two registry ARRAYS are frozen as well — an entry pushed in at import
   time would be a definition the checker's identity comparison treats as
   declared, and that nobody reviewed.

The argument each time was "the new predicate accepts everything the old one
accepted". That reasons about the predicate's extension rather than about the
set of programs with the same runtime effect, which is why it kept leaving a
door open. A whitelist has no such surface: a shape nobody enumerated is
rejected by default rather than admitted by default.

The corollary is a real constraint on you, not just on an attacker. If a
handler cannot be spelled in one of the three shapes, that is a signal about
the handler, not about the grammar — it means something is running before the
caller has been admitted. Fix the handler.

#### `wrapper-shape`

The checker raises a single high finding, `wrapper-shape`, whenever a canonical
wrapper appears in a handler but not in one of the accepted shapes. Its
rationale names the specific deviation (`the outer handler's 'pre' parameter has
a default value, and defaults are evaluated on every invocation before the
wrapper closure is applied`) and then prints all three accepted shapes, so the
remediation never requires reading the checker.

It is deliberately distinct from the plain "not on the admission rail" finding:
a handler with no wrapper at all needs "add the wrapper", and a handler with a
misspelled one needs "spell it the accepted way". `wrapper-shape` replaced the
old `wrapper-not-first`, whose text described a purely positional failure and
so read as misleading whenever the real fault was argument evaluation order —
where the wrapper *is* first and work still runs before admission.

There is no `resolveWriteAdmission` export to probe admission separately with.
It was removed: every call site paired it with a second wrapper call, admitting
the same request twice and doing the probe first.

#### What the checker resolves, and what it refuses to guess

Every discovery step is a whitelist with a fail-closed finding for the
remainder. Anything the checker cannot follow is reported as ingress with
unknown admission — never skipped.

| surface | resolved | otherwise |
|---|---|---|
| module set | exactly the bundler's entry points under `convex/`: any of `.js` / `.mjs` / `.cjs` / `.ts` / `.tsx` / `.mts` / `.cts` / `.jsx`, skipping only the **top-level** `_generated/`, dotfiles, and multi-dot basenames (`x.test.ts`, `x.d.ts`, `convex.config.ts`); a nested `foo/_generated/evil.ts` IS scanned | — a file the bundler registers is a file discovery reads |
| builder import | `mutation` / `query` / `action` whose specifier **resolves** (normalized, extension-stripped) to `_generated/server`, named, aliased, or namespaced; `mutationGeneric` / `queryGeneric` / `actionGeneric` from `convex/server`. `httpAction` (resolved `_generated/server`) and `httpActionGeneric` (`convex/server`) are builders with **no** admitted shape: any value reference to either is `ingress-not-statically-resolvable` (kind `http`) — every HTTP route is a Hono route under `admitHttpRoute` / `admitHttpRead`, never a raw `HttpRouter.route({ path, method, handler })`. A builder module reached through `await import(…)` / `require(…)` / `import x = require(…)` (or a dynamic reference with a non-literal specifier) is `ingress-not-statically-resolvable` | a builder rebound (`const m = mutation`), a namespace escaping a plain property read (`const { mutation } = server`, `server["mutation"]`, `const s = server`), a builder called inside a helper or passed to one, a shim (`export { mutation } from "./_generated/server"`, `export * from …`, import-then-`export { mutation }`) — `ingress-not-statically-resolvable`; a handler-local that shadows the builder name (`const query = ctx.db.query(…)`) is scope-resolved and is not the builder |
| exported Convex function | `export const x = <builder>({…})` after peeling `as` / `satisfies` / `!` / parentheses; a top-level `const` re-exported with `export { x }` / `export { x as y }` / `export default x`; `export default <builder>({…})`; `export const { a, b: c } = { a: <builder>({…}), b: <builder>({…}) }` | any exported binding that mentions a builder in another shape (a conditional, a wrapping call, `x \|\| <builder>(…)`); an exported `let` / `var`; any assignment to an exported top-level binding anywhere in the module — `ingress-not-statically-resolvable` |
| re-export | `export { x } from`, `export *`, an import re-exported by name or as default, `export const y = importedX` — resolved with the same resolver: a known convex module is skipped (its own discovery covers it), a bare package is skipped, anything else is **read from disk** through its own re-exports AND its plain relative imports (import-then-export, `export const x = impl.x`), to depth 4, and skipped only when nothing it reaches imports a builder (`operations/serviceIntake.ts` → `shared/serviceIntake.ts` is the real-tree positive control) | a target that resolves to `_generated/server` / a `convex/server` builder, cannot be located (including a followed relative import), imports a builder, or loads a relative module / `convex/server` dynamically — `ingress-not-statically-resolvable` |
| Hono route | a verb / `.on` on a **top-level router binding** (`Hono` / `HonoWithConvex` typed, `new Hono()`, mounted with `.route`, or carrying a registration — so a factory-built router counts), through chained calls and through `(sub)` / `sub!` / `(sub as X)`, with a string-literal path (slash-less accepted: Hono prepends it) and literal method list, and the handler as the **last and only** argument after it | more arguments than (path, handler) — per-route middleware — is a `wrapper-shape` rejection; a non-literal path or method list, `.route` with a non-literal prefix or non-identifier child, `.mount` anywhere — `route-registration-not-statically-resolvable`; a registration on an **import binding**, a chain rooted at one, an element access, a parameter, or a nested local with **any** string / template path is `route-registration-not-statically-resolvable`; a **top-level local that is not a router candidate** is resolved through its declaration initializer — an alias (`const alias = sub`), a container (`const routers = { sub }`, `[sub]`, `const { r } = …`), a conditional, an element access, or a call / `new` result is unresolvable, and on such a module-scoped receiver (or an import binding) a registration-shaped call with **any** path expression, literal or not, is the finding (only a plain property chain such as `ctx.db`, a parameter typed `DatabaseReader` / `DatabaseWriter`, or a top-level object literal that mentions no unresolvable name, still needs a `/`-shaped path to count); `.route(<single non-string argument>)` on **any** receiver — the shape of Convex's `HttpRouter.route({ path, method, handler })` — is `route-registration-not-statically-resolvable` |
| definition argument | an import binding (named, aliased, or namespace member) from `definitions.ts`, `readDefinitions.ts`, or `domains/**` whose export evaluates to the **registered** definition for this ingress — the **same object instance** the registry array holds, and nothing weaker: there is no structural fallback, because function-valued policy (`scope.resolve`, guards, verifiers) cannot be compared, so a field-for-field copy (`{ ...registered }`) or a shadow differing only in a resolver is `admission-definition-not-registered` | wrong ingress — `admission-definition-does-not-name-this-ingress`; right name, wrong object — `admission-definition-not-registered`; any other module or an unresolvable member — `admission-definition-not-statically-resolvable` |
| `api.*` self-call | roots are `api` from `_generated/api` (resolved), `anyApi` and `makeFunctionReference` from `convex/server`, widened through aliases, consts, destructuring, and object literals; `makeFunctionReference("m:f")` is a site when any statically enumerable value of its argument names a discovered public function; a computed index on a root is always a site. Scanned in **every** module, `api` import or not: a string / template function reference is a site when a value it can take names a public function or when it cannot be enumerated; an object literal (`{ [Symbol.for("functionName")]: … }`) is a site; a chain rooted at an **import** must be `internal` from `_generated/api` (or `<ns>.internal`), any other imported root is a site; and because `internal` is the same `anyApi` proxy as `api`, an `internal`-rooted chain (through a const prefix too: `const ex = (internal as any).example.x; ex.write`) is enumerated to `a/b:c` and is a site when it names a discovered public function, or when any segment is computed (`internal.example.x[name]`) | a parameter or a local of unknown provenance is left to the caller table (the rail core forwards injected internal references that way) |
| router CORS | in `http.ts`, exactly one call resolving to `hono/cors` — the named import under any local, `<ns>.cors`, or a local rebound to either — passed directly to `<router>.use(...)`, whose `origin` is an array literal of string literals / spreads of a `platform/storefrontOrigins.ts` export, or such an export (or a zero-argument call to one) directly | any other value fails; a second resolving call by any spelling fails; a `hono/cors` binding used other than as that call's callee fails; a later passing call never masks an earlier failing one; `hono/cors` loaded through `import()` / `require()` / `import x = require()` fails; **any other module** that imports or calls `hono/cors` — `cors-middleware-outside-router-module` |

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
- **A cookie is caller-supplied — twice over.** This took three review rounds
  to get right, so the rule is stated in two halves.

  **(a) The guest cookie is SIGNED.** `guest_id` is minted as `<id>.<hmac>` at
  the two bootstrap routes (`customerChannel/routes/storefront.ts`,
  `routes/guest.ts`) using `platform/storefrontCookieSignature.ts`, and every
  consumer accepts the id only when the HMAC verifies in constant time. An
  unsigned or tampered cookie is **absent**, never an error — a stale cookie is
  a shopper to re-bootstrap, not a fault to page on. Unset secret fails closed:
  no guest is admitted, though anonymous browse still works. Those two routes
  are the **only** mint points — `GET /homepage-snapshot` sets store cookies
  and nothing else — and the one other way to be handed a signed cookie for an
  **existing** row, the storefront's session-recovery `marker`, is treated as a
  secret or not at all: `storeFront/guest:getByMarker` resolves only a
  high-entropy marker (`isRecoverableGuestMarker` in `http/utils.ts`, ≥22
  chars; the storefront mints a UUID) and only within the store being
  bootstrapped. Absent, empty, short or foreign-store markers mint a fresh
  guest — "no marker" must never mean "the oldest marker-less guest". And
  because a marker IS a session, it is never at rest in the clear: `guest.create`
  stores only `hashGuestMarker(marker)` (SHA-256 hex) in the `marker` column,
  applies the same recoverability gate before storing anything, and returns the
  existing row for a repeated `(store, marker)` rather than minting a second
  one; `getByMarker` hashes before the `by_marker` lookup. A guest document
  read back whole — `storeFront/guest:getAll` (now store-scoped),
  `storeFront/users:getByIds`, the public `GET /guests` — therefore carries
  nothing a bootstrap route will resolve.

  **(b) A merge authorizes on a SERVER-ISSUED GRANT, not on the cookie.** A
  callee that absorbs one identity into another (cart claim, order re-owner,
  rewards, analytics timeline) reads the grant off the guest row.
  `POST /auth/verify` writes `mergeGrantedToStoreFrontUserId` after
  authenticating the account and only from a **verified** guest id — 15-minute
  window, once per merge kind, bounded to the admitted store, and a live
  unconsumed grant is never re-pointed to a different account. Use
  `consumeGuestMergeGrant` from `convex/storeFront/customerOwnership.ts`; see
  that file for the contract and for what it deliberately does not buy, and
  `storeFront/bag.ts` for the reference shape.

  The history is the lesson: the guest side of this merge was "fixed" three
  times — a body field, then a cookie compared against itself, then a cookie
  the mint trusted — and each version shipped with a comment asserting a
  guarantee it did not have. When a guard compares two values, write down where
  each one came from.
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
| `ATHENA_STOREFRONT_COOKIE_SECRET` | **new** — no guest session can be issued or accepted, so every guest-identified path (cart, saved bag, orders, rewards, the guest→account merge) goes dark. Anonymous catalog browse is unaffected: `public: "admit"` routes never look at a guest cookie |

## Validation

```bash
cd packages/athena-webapp
bun run test -- convex/operationAdmission convex/sharedDemo \
  convex/storeFront/operationAdapter.test.ts convex/platform \
  convex/lib/athenaUserAuth.test.ts convex/http
bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json
bun run --filter '@athena/webapp' lint:convex:changed
```
