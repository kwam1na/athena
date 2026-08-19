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
7. The **grammar itself**, one ring further out. Rounds 4–6 each closed the
   spellings the previous round enumerated, and each time the next review
   found the next ring — because the route walk and the `api.*` ban still
   keyed on ONE call grammar (`<receiver>.<name>(...)`) while ingress
   discovery keys on *any value reference to the builder*. So `sub["get"](…)`,
   `sub.get.call(sub, …)`, `Reflect.apply(sub.get, …)`, `pick().get("evil", h)`,
   `(0, sub).get(…)`, `Holder.r.get(…)`, `{ get r() { return sub } }`,
   `globalThis.r = sub` registered live routes with zero findings;
   `const { example } = internal; ctx.runMutation(example.x.write)`,
   `ctx["runMutation"](api.x)`, `const r = ctx.runMutation; r(api.x)`,
   `({ runMutation }) => runMutation(api.x)` re-entered a public function with
   zero findings. Round 7 replaces the grammar with the design that has kept
   surviving review: **a router is a value, and any value reference to it
   outside the accepted shapes is a finding** (the router reference sweep,
   mirroring the builder orphan sweep); **`isUnresolvableReceiver` defaults to
   unresolvable** (a call / `new` / `await` / conditional / comma result, a
   chain rooted at a class / function / enum / namespace / `globalThis` /
   undeclared name, an untyped parameter, a destructured or call-initialized
   top-level binding — with the `Map` / `Set` / `Headers` constructors, the
   known global value roots, and the `ctx.db` chain (through aliases of the
   context parameter) as the only positive controls); **any value reference
   to an `api` root anywhere in a module is a site**; **`internal` is widened
   like `api` but fails closed on loss of path** (a destructure, container,
   conditional, call, or redeclared local makes the whole local `unknown`, and
   a run argument rooted at it is a site); **run sites are matched by callee
   NAME regardless of shape** (property or bracket, `.call` / `.apply` /
   `Reflect.apply`, a bare identifier bound to a run method); a conditional
   argument is judged on both branches and any other unrootable non-call
   argument fails closed; the CORS assertion fails on a non-literal dynamic
   specifier or a tsconfig-alias import in a router module; imports through
   the webapp tsconfig `paths` aliases (`~/*`, `@/*`, `@cvx/*` — which
   `convex/tsconfig.json` does not declare and the bundler does not resolve
   inside `convex/**`) are resolved by the checker AND reported; and a
   definition module may not read the environment.

8. The **scope** of the round-7 rules. `looksLikeRegistration` kept the
   string / template path rule for every nested-scope receiver, and the router
   sweep tracked only top-level router-like locals and import bindings — so a
   factory (`function make() { const r = new Hono(); const P = "/evil";
   r.get(P, h); return r }`, `export const sub = make()`, mounted with
   `.route`) served `GET /sub/evil` with zero findings; a router module
   obtained through `import("./sub")` reached a `.then((m) => …)` parameter or
   an awaited local the sweep never enumerated; the definition-module
   environment rule keyed on five bare identifiers, so `import { env } from
   "node:process"`, `Bun.env`, and `new Function(…)` passed; and the computed
   router-method diagnostic cast the still-wrapped callee and crashed on
   `((sub)[verb])(…)`. Round 8: a nested local whose initializer is an opaque
   `new` / call / `await` is judged like a module-scoped receiver (any path);
   nested `new Hono()` locals are swept; a dynamic reference to a
   router-exporting module (or a non-literal specifier) is an escape;
   definition modules may not import `process` or a `node:` builtin nor
   reference `Bun` / `Function` / `eval`; the callee is unwrapped once and used
   for both the judgement and the message.

9. **`.use` middleware** (round 9, closing the residual rounds 4–8 documented
   and pinned). Router-level middleware was invisible to the walk except for
   the one `cors(...)` registration, so `sub.use("/evil", async (c) =>
   c.json({ pwned: true }))` — a path-scoped `.use` whose handler never calls
   `next()` — was a terminal unadmitted responder for every method under
   `/sub/evil` with zero findings. And the tree was NOT `cors`-only: five
   route modules carry `.use("*", …)` middleware (the whatsapp / mtn-momo /
   harness-waiver verifiers, and `boundRequestBody(...)` on the two marketing
   routes). Round 9 walks `.use` like every other registration and judges its
   handler against a closed **pass-through-or-deny grammar**: an inline
   `(c, next) => { … }` whose last statement is `await next()` / `return
   next()`, whose every `return` is `next()` / `await next()` or a `return
   c.json(<body>, <literal 4xx/5xx>)` denial, whose `c` appears only as
   `c.req…` (read the request, replace `c.req.raw`) or that denial's callee,
   whose `next` appears only as those calls, with no `this` / `arguments` /
   `eval` / nested returns / redeclared parameters; or a call to a **named
   import from a convex module under `http/`** whose export is exactly one
   returned function passing the same grammar (`boundRequestBody`); or the
   `hono/cors` factory, judged by `assertCorsAllowlist`. Anything else —
   `.use(fn)` with no path, a non-literal path, a third argument, an
   identifier handler, `c.env`, `c.res`, a 2xx, a bare `return`, a factory the
   checker cannot open — is `router-middleware-not-statically-resolvable`. A
   `.use` on a receiver the walk cannot resolve is a
   `route-registration-not-statically-resolvable` like any other registration
   on an unknown router.

   The grammar's first cut said "`throw` is allowed: a thrown error is a
   fault, not a response". In Hono that is false: the default `errorHandler`
   renders any thrown value carrying `getResponse()` — `new
   HTTPException(200, { res })`, `Object.assign(new Error(), { getResponse })`
   — AS the response, with the status it names, and convex-helpers returns
   `app.fetch(...)` unchanged, so a grammar-passing middleware could still
   answer with a 2xx it constructed. Two layers now close that: (a) the
   grammar accepts a `throw` ONLY as the rethrow of the middleware's own
   `catch (<id>)` binding (the harness-waiver `catch (error) { …; throw error
   }` shape), never rebound; every other thrown value — a `new`, an object, a
   call result, an outer local — is a violation; and (b) `http.ts` installs
   exactly one FIXED `app.onError((err, c) => c.json({ error: "internal" },
   500))` (`assertRootErrorHandler`: an inline `(err, c)` arrow whose only
   statement returns `c.json` / `c.text` with a literal 5xx, never referencing
   `err`, `getResponse`, or `c` otherwise; `router-error-handler-not-fixed`
   when missing, doubled, or any other shape), and any `.onError(` in any
   other module under `convex/**` is `error-handler-outside-router-module`, so
   even a `getResponse` error thrown by an imported verifier renders as the
   fixed 5xx. The same round pinned `next()` inside a `try` block or `finally`
   (a middleware may not observe the admitted handler's failure; `return
   next()` inside a `catch` clause — the real `boundRequestBody` — stays
   accepted) and rejected generator middleware. What a `.use` middleware can
   now do, provably: read the request, replace `c.req.raw`, deny with a
   literal 4xx/5xx, rethrow its own caught fault, or hand the request on.

10. **Router acquisition and mounting** (round 9). The round-8 factory fix
   recognised a nested router only when spelled `const <id> = new Hono()`, so
   `function make(r = new Hono())`, `const [r] = [new Hono()]`, `class Box { r
   = new Hono(); build() { this.r.get(P, h) } }`, `for (const r of [new
   Hono()])`, `catch (r)` after `throw new Hono()`, and `[new
   Hono()].forEach((r) => …)` each registered an unadmitted route with zero
   findings — and `.route(prefix, child)` with a child that resolved to no
   walked router (a `declare const ghost`, a router imported from outside
   `convex/**`, an `HttpRouterWithHono` wrapper, a non-router export) walked
   an EMPTY subtree: a pass for routes it never sees. Round 9 fails closed at
   the CONSTRUCTION — every `new Hono()` / `new HttpRouterWithHono(...)` whose
   parent is not `const <identifier> = …` is
   `route-registration-not-statically-resolvable` at the `new` — treats a
   parameter with an opaque default and any nested binding-pattern local as
   opaque (any path is a route), judges a `this`-rooted receiver like a
   module-scoped one, flags a router candidate declared without an
   initializer, flags a `.route` child bound in a nested scope at the site,
   and flags every mount whose child does not resolve to a top-level Hono
   router the walk opened — at the mount's file and line — instead of walking
   it as empty.

11. **The router class is resolved, not spelled** (round 10). Every round-9
   rule above matched the identifier TEXT `Hono` / `HttpRouterWithHono`, so
   `import { Hono as H }; reg(new H())`, `import * as hono; new hono.Hono()`
   and `new (Hono)()` built the same unwalked router with zero findings — a
   one-token change re-opened the round-9 escape. Round 10 resolves the
   class through its IMPORT BINDING (`isHonoClassReference`): `Hono` from
   `hono` (or `hono/quick` / `hono/tiny`) and `HttpRouterWithHono` /
   `HonoWithConvex` from `convex-helpers/server/hono`, under any local alias
   or as `<ns>.<Class>` on a namespace import, behind parens and type-only
   wrappers — in the construction rule, `isHonoRouterDeclaration` (the
   type-name text check is kept and type references resolve through their
   imports too), the nested-router collector, the sweep's `new
   HttpRouterWithHono(app)` acceptance, and the root-handler assertion. Loss
   of identity fails closed: any OTHER value reference to such a binding
   (`const H = Hono`, `const { Hono } = hono`, `hono["Hono"]`, `class Mine
   extends Hono`, `build(Hono)`) and any `import()` / `require()` of `hono` /
   `convex-helpers/server/hono` is `route-registration-not-statically-
   resolvable` at the reference. In the same round a `for..of` / `for..in` /
   `catch (<id>)` binding became an OPAQUE nested declaration (any path
   expression on it is a route — the loop source / thrown value is a
   container the walk does not open); `assertRootErrorHandler` binds the
   handler to the ROOT — the receiver must be the identifier passed to the
   module's single `new HttpRouterWithHono(<root>)`, so a sibling top-level
   router carrying the only `.onError` while the root has none is
   `router-error-handler-not-fixed`; and the rethrow rule accepts a `throw
   <catch binding>` only when the binding is referenced in the clause solely
   as the thrown value, a plain read (a condition, `instanceof`, a property
   read in one), or the argument of a TESTED predicate whose callee is a BARE
   IDENTIFIER (`if (isX(error))`, `!isX(error)`) — `Object.assign(error, …)`,
   `error.x = …`, `[error] = …`, `({ error } = …)`, `const e = error`,
   `seen = error`, `decorate(error)`, `error.setStatus(…)` are violations.

12. **The `hono` package is judged by prefix, and a router candidate must be
   `new Hono()`** (round 11, the final checker change). Round 10 still resolved
   the class through a CLOSED allow-list of (specifier, export) pairs, so
   several one-line spellings built a router the walk never opened with zero
   findings: `import { Hono } from "convex-helpers/server/hono"` (that package
   re-exports `Hono`), `import { HonoBase } from "hono/hono-base"`,
   `hono/factory`'s `createFactory().createApp()`, a convex-module shim
   (`export { Hono } from "hono"`, `export * from "hono"`, `export * as hono
   from "hono"`, import-then-`export { Hono }`), a relative import path into
   `node_modules`, and a top-level candidate with a CALL initializer
   (`export const sub = reg(x)`), which was walked as only its own textual
   registrations. Round 11 closes all of them:
   - a top-level router candidate — one carrying registrations, `.route`-mounted,
     or passed to `new HttpRouterWithHono(...)` — must have an initializer that
     is exactly `new <resolved Hono>()` (or the `new HttpRouterWithHono(...)`
     wrapper itself). A call, a `new` of an unresolved class, an `await`, a
     conditional is `route-registration-not-statically-resolvable` at the
     declaration;
   - any static import, re-export (`export … from`, `export *`, `export * as`),
     or dynamic reference whose specifier IS `hono` or starts with `hono/` —
     including through a relative `node_modules/` path — fails closed unless
     every binding it creates is the Hono class used solely as the callee of a
     resolved `new`, or is never referenced as a value at all (an effectively
     type-only binding such as `import { Context } from "hono"`). The only
     exempt entry points are the non-router ones other rules own: `hono/cors`,
     `hono/http-exception`, `hono/cookie`. `HonoBase` (`hono/hono-base`) maps to
     the Hono class; `hono/factory` is named explicitly in the failure message;
     `convex-helpers/server/hono`'s `Hono` re-export IS the router class;
   - an `ExportSpecifier` (`export { Hono }`) and `export default <id>` count as
     value references to a router-class binding, so a shim cannot re-emit the
     class; and a relative import of a module that re-exports the package does
     not resolve, which makes any `new Hono()` built from it an unresolvable
     candidate initializer.

The argument each time was "the new predicate accepts everything the old one
accepted". That reasons about the predicate's extension rather than about the
set of programs with the same runtime effect, which is why it kept leaving a
door open. A whitelist has no such surface: a shape nobody enumerated is
rejected by default rather than admitted by default.

The corollary is a real constraint on you, not just on an attacker. If a
handler cannot be spelled in one of the three shapes, that is a signal about
the handler, not about the grammar — it means something is running before the
caller has been admitted. Fix the handler.

#### Scope boundary — the checker is frozen at this grammar

Round 11 is the last checker change. Whatever escape surface remains is
**accepted residual**, by owner decision. Every remaining hole is a bypass of a
static lint that requires a committer whose code passed review; none of them is
an anonymous-caller hole — those were closed by the rail itself, not by the
checker. Eight review rounds each found "the next ring", and the ratchet stops
here. Extend this grammar only when a real ingress needs a shape it does not
cover, not to chase a hypothetical committer.

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
| Hono route | a verb / `.on` on a **top-level router binding** (`Hono` / `HonoWithConvex` typed, `new Hono()`, mounted with `.route`, or carrying a registration — so a factory-built router counts), through chained calls and through `(sub)` / `sub!` / `(sub as X)`, with a string-literal path (slash-less accepted: Hono prepends it) and literal method list, and the handler as the **last and only** argument after it. A router VALUE — a router-like local (a router variable, a candidate, or `new HttpRouterWithHono(app)`), or an import binding that resolves to an exported router of a convex module (or a namespace import of a router-exporting module) — may appear ONLY as: the receiver of a `<router>.<verb \| on \| route \| use \| mount>(...)` call, the child of `.route(<literal>, child)` on a router receiver, the argument of `new HttpRouterWithHono(...)` or `<registrar>.addHttpRoutes(...)`, or an export (round 7) | more arguments than (path, handler) — per-route middleware — is a `wrapper-shape` rejection; a non-literal path or method list, `.route` with a non-literal prefix or non-identifier child, `.mount` anywhere, a spread argument list, a computed method (`x[verb](...)`) on a router or an unresolvable receiver — `route-registration-not-statically-resolvable`; **any other value reference to a router** (`sub["get"](…)` — judged as `.get` — `sub.get.call(…)`, `sub.get.bind(sub)`, `Reflect.apply(sub.get, …)`, `return sub`, `{ r: sub }`, `[sub]`, `static r = sub`, `{ get r() { return sub } }`, `register(sub)`, `alias = sub`, `globalThis.r = sub`, `const g = mod`) is `route-registration-not-statically-resolvable` at the reference itself (round 7); a registration on an **unresolvable receiver** with **any** string / template path is `route-registration-not-statically-resolvable`, and on a **module-scoped** unresolvable receiver (an import binding, a top-level binding whose initializer is unresolvable, a class / function / enum / namespace / `globalThis` root) with **any** path expression at all. Unresolvable is the DEFAULT (round 7): resolvable receivers are only a router variable of this module, a top-level binding (destructured or plain) whose declaration initializer resolves — an identifier / property chain that resolves, `new Map()` / `Set` / `WeakMap` / `Headers` / `URLSearchParams` / `URL` / `Date` / `FormData`, or an object / array literal that mentions no unresolvable name outside its functions and, inside its getters / methods / arrows, no unresolvable FREE variable — a parameter typed `DatabaseReader` / `DatabaseWriter`, a chain through a `db` segment off a context parameter or an alias of one (`const ctx = admittedCtx; ctx.db.get("t", id)`), a nested local judged the same way, or a chain rooted at a known global value (`Reflect`, `Object`, `Promise`, …); those still need a `/`-shaped path to count. `.route(<single non-string argument>)` on **any** receiver — the shape of Convex's `HttpRouter.route({ path, method, handler })` — is `route-registration-not-statically-resolvable`. Round 8 closes the factory ring: a **nested-scope local whose initializer is a `new` outside the plain containers, a call, or an `await`** (`function make() { const r = new Hono(); const P = "/evil"; r.get(P, h); return r }`, `const r = await loadRouter()`) is judged like a module-scoped unresolvable receiver — **any** path expression is a route; every nested `const r = new Hono()` / `new HttpRouterWithHono(...)` is swept like a router-like local, so `return r`, `helper(r)`, `{ r }` are escapes; a router module loaded through **`import()` / `require()` / `import x = require()`** (a target that exports a router, or a non-literal specifier that may) is an escape at the reference; and an exported `new HttpRouterWithHono(app)` (`export default http`) is a router-like value for importers too. A **parameter** receiver without a default still keeps the string / template rule: `function reg(r) { r.get(P, h) }` is judged where the router is handed in (`reg(sub)` is the sweep's site). Round 9 fails closed at the **construction**: every `new Hono()` / `new HttpRouterWithHono(...)` that is not the initializer of `const <identifier>` — a parameter default, an array / object element, a class property, a call argument, a return, a loop source, a thrown value — is `route-registration-not-statically-resolvable` at the `new`; a parameter with an opaque default and any nested binding-pattern local (`const [r] = …`) are opaque receivers (any path); a `this`-rooted receiver is judged like a module-scoped one; a router candidate declared without an initializer (`declare const ghost`, `let r: Hono;`) is flagged; a `.route` child bound in a nested scope is flagged at the site; and a `.route(prefix, child)` whose child does not resolve to a **top-level Hono router the walk opened** (an `HttpRouterWithHono` wrapper, a non-router export, a router imported from outside `convex/**`) is flagged at the mount instead of walked as empty. Round 10 resolves the router CLASS through its import binding (`Hono` from `hono`, `HttpRouterWithHono` / `HonoWithConvex` from `convex-helpers/server/hono`, under any alias or `<ns>.<Class>`) everywhere the rules above say `new Hono()` / `new HttpRouterWithHono(...)`; any other value reference to such a class binding (`const H = Hono`, `const { Hono } = hono`, `hono["Hono"]`, `extends Hono`, `build(Hono)`) or a dynamic `import()` / `require()` of those packages is `route-registration-not-statically-resolvable`; and a `for..of` / `for..in` / `catch` binding is an opaque nested receiver (any path). Round 11 judges the `hono` package by PREFIX rather than by an allow-list of entry points: any static import, re-export (`export … from`, `export *`, `export * as`), or dynamic reference whose specifier is `hono` or starts with `hono/` — including through a relative `node_modules/` path — fails closed unless every binding it creates is the Hono class used solely as a resolved `new` callee or is never referenced as a value (effectively type-only); the exempt non-router entry points are `hono/cors`, `hono/http-exception`, `hono/cookie`; `HonoBase` (`hono/hono-base`) maps to the Hono class, `hono/factory` is named explicitly, and `convex-helpers/server/hono`'s `Hono` re-export IS the router class. `export { Hono }` / `export default Hono` count as value references to a router-class binding. And a top-level router candidate must be initialized by exactly `new <resolved Hono>()` (or be the `new HttpRouterWithHono(...)` wrapper): a call, an unresolved `new`, an `await`, or a conditional is `route-registration-not-statically-resolvable` at the declaration |
| definition argument | an import binding (named, aliased, or namespace member) from `definitions.ts`, `readDefinitions.ts`, or `domains/**` whose export evaluates to the **registered** definition for this ingress — the **same object instance** the registry array holds, and nothing weaker: there is no structural fallback, because function-valued policy (`scope.resolve`, guards, verifiers) cannot be compared, so a field-for-field copy (`{ ...registered }`) or a shadow differing only in a resolver is `admission-definition-not-registered` | wrong ingress — `admission-definition-does-not-name-this-ingress`; right name, wrong object — `admission-definition-not-registered`; any other module or an unresolvable member — `admission-definition-not-statically-resolvable` |
| `api.*` self-call | roots are `api` from `_generated/api` (resolved — a tsconfig alias `@cvx/_generated/api` resolves too), `anyApi` and `makeFunctionReference` from `convex/server`, widened through aliases, consts, object and array destructuring, and object / array literals (spreads included); `makeFunctionReference("m:f")` is a site when any statically enumerable value of its argument names a discovered public function; a computed index on a root is always a site. **Any value reference to an `api` root anywhere in a module is a site** (round 7) — `helper(api.x)`, `{ w: api.x }`, `const a = api`, `<ns>.api`, `<ns>["api"]`, the `_generated/api` namespace escaping a plain `.internal` read, `<convexServer>.anyApi` — not only a run-call argument, so `ctx["runMutation"](api.x)`, `const r = ctx.runMutation; r(api.x)`, `({ runMutation }) => runMutation(api.x)` all fall out (the real tree references `api` nowhere under `convex/**` — the last unused `import { api }`, in `storeFront/checkoutSession.ts`, was deleted rather than left as a binding a future edit could reach for). Run sites are matched by callee **name** regardless of shape: `<x>.runMutation` / `runQuery` / `runAction`, `<x>.runAfter` / `runAt` on any receiver, the bracket spellings, `.call` (index shifted), `.apply` / `Reflect.apply` with an array-literal argument list, and a bare identifier bound to a run method (a destructured parameter, `const { runMutation } = ctx`, `const r = ctx.runMutation` / `.bind(ctx)`). Scanned in **every** module, `api` import or not: a string / template function reference is a site when a value it can take names a public function or when it cannot be enumerated; an object literal (`{ [Symbol.for("functionName")]: … }`) is a site; a conditional argument is judged on both branches; a chain rooted at an **import** must be `internal` from `_generated/api` (or `<ns>.internal`), any other imported root is a site; and because `internal` is the same `anyApi` proxy as `api`, an `internal`-rooted chain is enumerated to `a/b:c` and is a site when it names a discovered public function or when any segment is computed. `internal` is widened like `api` but **fails closed on loss of path** (round 7): a local bound to a plain `internal` prefix (`const ex = (internal as any).example.x`) is enumerated through; a local bound through a destructure (`const { example } = internal`), an object / array / spread container (`{ w: internal.a.b }`, `[internal.a.b]`), a conditional, a call, an `await`, any expression that merely mentions an internal root, or a name declared more than once in the file is `unknown`, and a run argument rooted at it is a site; `.apply` / `Reflect.apply` with an argument list the checker cannot see into is a site | a parameter, a call result (`ctx.runMutation(pick(), …)`), or a bare local of unknown provenance is left to the caller table (the rail core forwards injected internal references that way); any OTHER argument the checker cannot root — a comma, an `await`, a `??`, a chain off a call result — is a site (round 7) |
| router CORS | in `http.ts`, exactly one call resolving to `hono/cors` — the named import under any local, `<ns>.cors`, or a local rebound to either — passed directly to `<router>.use(...)`, whose `origin` is an array literal of string literals / spreads of a `platform/storefrontOrigins.ts` export, or such an export (or a zero-argument call to one) directly | any other value fails; a second resolving call by any spelling fails; a `hono/cors` binding used other than as that call's callee fails; a later passing call never masks an earlier failing one; `hono/cors` loaded through `import()` / `require()` / `import x = require()` fails; in `http.ts` or any module declaring a Hono router, a dynamic reference with a **non-literal** specifier or a tsconfig-alias import / reference fails (round 7 — it may be `hono/cors` under a name the checker cannot follow, exactly as it fails discovery); **any other module** that imports or calls `hono/cors` — `cors-middleware-outside-router-module` |
| router error handler | in `http.ts`, exactly one `<root>.onError(<inline arrow>)` as a top-level statement — `<root>` being the top-level Hono router passed to the module's single `new HttpRouterWithHono(<root>)` (round 10; the class resolved through its import) — whose arrow has exactly two plain identifier parameters `(err, c)` and whose body is the single `return c.json(<body>, <literal 500–599>)` / `c.text(...)` (block with that one statement, or that expression), referencing neither `err` nor `getResponse` nor `c` otherwise, with no nested function or `this` — the shipped `app.onError((err, c) => c.json({ error: "internal" }, 500))` | `router-error-handler-not-fixed` (high) when the handler is missing, doubled, on the `HttpRouterWithHono` wrapper or any non-router receiver, registered inside a function, an identifier / non-arrow, renders `err.getResponse()`, passes or reads `err`, uses a non-5xx or non-literal status, or has any other statement; **any `.onError(` in any other module** under `convex/**` — `error-handler-outside-router-module` (a sub-router's handler renders before the root's) |
| router middleware | `<router>.use(<string-literal path>, <handler>)` on a known router, with exactly two arguments, where `<handler>` is (a) an inline arrow / function expression passing the pass-through-or-deny grammar — exactly two plain identifier parameters `(c, next)`, a block body whose LAST statement is `await next();` / `return next();` / `return await next();`, `next` referenced only as the callee of a zero-argument call in one of those positions, `c` referenced only as the receiver of `c.req` (reads, and `c.req.raw = …` re-bodying) or as the callee of a `return c.json(<body>, <literal 400–599>)` / `return c.text(…)` denial, every `return` belonging to the middleware itself and returning one of those, no `this` / `arguments` / `eval` / `Function`, neither parameter redeclared inside, not a generator, no `next()` inside a `try` block or `finally` (inside a `catch` clause is accepted), and a `throw` ONLY as the rethrow of the middleware's own `catch (<id>)` binding, that binding referenced inside the clause solely as the thrown value, a plain read (a condition, `instanceof`, a property read in one), or the argument of a tested predicate whose callee is a **bare identifier** (round 11: `Object.assign(error, …)` / `Reflect.set(error, …)` / `x.decorate(error)` are violations even when the call's result is tested, because they return truthy; and so are `error.x = …`, `[error] = …`, `({ error } = …)`, `const e = error`, `seen = error` — the right side of ANY assignment — and `decorate(error)` untested); (b) a call whose callee is a **named import from a convex module under `http/`** whose `export function` / `export const` is EXACTLY one returned function that passes (a) — the real `boundRequestBody`; or (c) the `hono/cors` factory (resolved like the CORS row), which only `assertCorsAllowlist` judges | `router-middleware-not-statically-resolvable` (high) for `.use(handler)` with no path, a non-literal path, one or three-plus arguments, an identifier / member / optional-call handler, a factory not imported by name from `http/**`, a factory that is a re-export or an aliased export or is missing or does not consist of exactly one returned function, or any grammar violation (a 2xx / non-literal status, a bare `return`, a body not ending in `next()`, `next()` inside a `try` / twice / stored / from a nested function, `c.env` / `c.res` / `c.set` / any other member, `c` as a value / under a cast / computed, `c.json` outside a return, a destructured / rest / redeclared parameter, `this` / `arguments`, a generator, `throw` of anything but the own catch binding — `new HTTPException(200, { res })`, an `Error` with `getResponse`, a call result, a rebound or outer local); a `.use` reached through `sub["use"]` is judged AND swept as a bracket-callee escape; `.use` on an unresolvable receiver (an imported router, an alias) with one or more arguments is `route-registration-not-statically-resolvable` |
| definition modules | `definitions.ts`, `readDefinitions.ts`, `domains/**` reference no environment reader — the value identifiers `process`, `Deno`, `Bun`, `globalThis`, `self`, `window`, `Function`, `eval` (unshadowed), `import.meta`, and no import of `process` or any Node builtin (`node:process`, `node:os`, `fs`, `child_process`, … — static, `import()`, `require()`, `import x = require()`; a type-only import reads nothing; a non-literal dynamic specifier fails closed) — the checker evaluates them in its own process and proves identity against what it loaded, so an environment-dependent field (`import { env } from "node:process"`, `Bun.env.X`, `new Function("return process.env.X")()`) would be verified under one environment and enforced under another (round 7 + 8) | `definition-module-reads-environment` |
| tsconfig `paths` aliases | `packages/athena-webapp/tsconfig.json` declares `~/*` → `./*`, `@/*` → `./src/*`, `@cvx/*` → `./convex/*`; `convex/tsconfig.json` declares none, the Convex bundler resolves none inside `convex/**`, and no convex module uses one. The checker still RESOLVES them (`@cvx/_generated/api` is the api root, `~/convex/_generated/server` the builders, so an aliased import cannot hide a builder or a root) | any alias import or dynamic reference in a convex module is `ingress-not-statically-resolvable` — a specifier the runtime cannot follow — and fails the CORS assertion in a router module (round 7) |

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
