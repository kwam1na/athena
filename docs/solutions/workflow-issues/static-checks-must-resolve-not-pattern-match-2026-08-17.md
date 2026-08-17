---
title: A Static Check Must Resolve What the Runtime Resolves, and Fail Closed on the Rest
date: 2026-08-17
last_updated: 2026-08-17
category: docs/solutions/workflow-issues
module: Static analysis, build tooling, security checks
problem_type: best_practice
component: tooling
resolution_type: tooling_addition
severity: high
applies_when:
  - "A static check gates merges on a security or correctness property"
  - "A check enumerates bad shapes rather than accepting a closed set of good ones"
  - "A checker walks files, imports, or references with globs, suffix regexes, or name comparison"
  - "Someone argues a new predicate is safe because it accepts everything the old one accepted"
delivery_diff_fingerprint: 54f53863706e600a4652228a8ff38d3c141346dbc42ae5f2cfac5f30ed7ed827
tags: [static-analysis, security, ast, fail-closed, code-review, tooling]
---

# A Static Check Must Resolve What the Runtime Resolves, and Fail Closed on the Rest

## Problem

A structural checker gated a 14-ticket migration on one property: *every backend
ingress runs through the admission rail*. It was defeated in **five consecutive
independent review rounds**. Not by exotic attacks — by ordinary code shapes
nobody had enumerated.

| Round | The escape |
|---|---|
| 1 | `const run = wrapper(def, fn)` accepted as proof of admission — a declaration is not an invocation |
| 2 | Work hidden in the invocation's **arguments**: `wrapper(def, fn)(ctx, { row: await ctx.db.get(id) })` — the callee evaluates first, then the arguments, then admission |
| 3 | An **IIFE** argument; and composition-root identity matched on an unresolved **path suffix**, so any shim — or a package literally named `@evil/operationAdmission` — qualified |
| 4 | Catch/finally clauses; per-route middleware; a definition whose name matched but which was a same-named shadow with `public: "admit"` |
| 5 | The whitelists' **inputs**: discovery walked only `*.ts` while the bundler registers `.tsx`/`.js`/`.mts`; the builder import was a suffix regex, so `../_generated/./server` or `const { mutation } = server` hid a public function; the `api.*` ban never scanned a module without an `api` import, so a string reference walked past; `export let` and re-exports from outside the tree were invisible |

Each round the argument for the new predicate was the same: *"it accepts
everything the old one accepted."* That reasons about the predicate's extension
instead of about **the set of programs with the same runtime effect** — which is
exactly why it kept leaving a door open.

## Solution

Three rules, in the order they mattered.

### 1. Accept a closed grammar; reject everything else

Enumerating bad shapes is unbounded — JavaScript will always supply another
one. Enumerating *good* shapes is finite. State the exact accepted form:

```
handler: <wrapper>(<definitionIdentifier|member>, <handlerIdentifier|inline arrow|function>)
```

and reject every deviation with a finding whose text names the deviation and
prints the accepted shapes, so remediation never requires reading the checker.

The corollary is a constraint on your own code, not just on an attacker: **if a
handler cannot be spelled in an accepted shape, that is a signal about the
handler.** Here it always meant something ran before the caller was admitted.
Fix the handler; do not widen the grammar.

### 2. Resolve what the runtime resolves — never pattern-match a name

Every input the checker consumed was originally approximated, and every
approximation was a hole:

| approximated by | must instead |
|---|---|
| glob `*.ts` | enumerate what the **bundler** registers (`.tsx`, `.js`, `.mts`, …), and prune only what it prunes |
| suffix regex on an import specifier | `path.resolve` against the **importing file's** directory and compare resolved paths; a bare or package specifier never qualifies |
| comparing a symbol's **name** | resolve the binding to its declaration and compare **identity** against the registry |
| "the module imports `api`, so scan it" | scan every module; a string reference or a `Symbol.for(...)` object is still a reference |
| `const` only | follow `export let`, later assignment, destructuring, and re-exports — including across files |

A name is a coincidence; a resolution is a fact. If the runtime resolves it,
the checker must resolve it the same way.

### 3. Anything unresolvable is a finding, not a skip

The default for "I could not follow this" must be **report**, never **ignore**.
This is the rule that turns the remaining unknowns from silent holes into
visible work:

- an exported binding built in a shape the grammar does not cover →
  `ingress-not-statically-resolvable`
- a route registered on a receiver the checker cannot tie to a router →
  `route-registration-not-statically-resolvable`
- a definition argument that does not resolve to a registered definition →
  `admission-definition-not-registered`

Each is a *high* finding. A checker that skips what it cannot parse reports
success on exactly the code most likely to be wrong.

### 4. Guard the value's references, not the syntax of one call on it

The subtle way to reintroduce a blacklist under a whitelist is to accept a
closed grammar over the *call* while the guarded thing is a *value* that can
travel anywhere. Three rounds after the wrapper grammar landed, the route walk
still keyed on `<receiver>.<verb>(...)` and the `api.*` ban on
`<ctx>.runMutation(...)`, so `sub["get"](…)`, `sub.get.call(sub, …)`,
`pick().get("evil", h)`, `{ get r() { return sub } }`, `ctx["runMutation"](api.x)`
and `const { example } = internal; runMutation(example.x.write)` each passed
— each a new ring outside the previous ring's enumeration. The part of the
checker that never had this problem was builder discovery, which flags **any
value reference to a builder outside an accepted position**: the value cannot
be obtained without being referenced. The fix was to give routers and `api`
roots the same treatment (a short list of accepted positions; every other
reference is a finding), make receivers unresolvable *by default*, and match
run sites by callee name in every shape. Ask of every guarded thing: is it a
value? Then the reference set, not a call pattern, is what the check must
close over.

## Why This Matters

The failure mode is asymmetric and quiet. A checker that **over-rejects** fails
loudly and gets fixed within the hour. A checker that **under-detects** reports
green forever, and everything downstream — the merge gate, the coverage test,
the delivery report, the reviewers who trust it — inherits a false guarantee.
Here, that guarantee was "no unadmitted backend ingress reaches production" for
605 ingress points across 14 tickets.

It also cost five review rounds to find, because each round's fix was written by
someone reasoning about the predicate they had just changed rather than about
the language. That is not a competence problem; it is what a blacklist does to
whoever maintains it.

## Prevention

- Write the grammar down in the code and in the docs, with the accepted shapes
  spelled out. If a call site cannot fit, change the call site.
- For every input the check consumes, ask: *does the runtime resolve this by
  name, by path, or by identity?* Match it exactly.
- Give every discovery step an explicit fail-closed finding for the remainder,
  and assert in tests that an unresolvable shape produces it.
- Fixture the escapes. Every shape that ever defeated the check earns a
  permanent negative test, plus positive controls covering every shape the
  repo legitimately uses — so a future tightening cannot silently reject real
  code.
- Distrust "it accepts everything the old one accepted." Ask instead: *what set
  of programs has the same runtime effect, and does the check cover all of
  them?*

## Related

- [Verify the Fix — three rounds where the previous round's fix was the defect](verifying-a-fix-actually-fixes-2026-08-17.md) — the companion lesson from the same delivery.
- [Completing an Admission Rail — Deriving Invariants Instead of Listing Them](../architecture-patterns/athena-complete-operation-admission-migration-2026-08-16.md) — the delivery, and the checker described here.
