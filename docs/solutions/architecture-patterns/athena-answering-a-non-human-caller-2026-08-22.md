---
title: Answering A Caller That Is Not A Person
date: 2026-08-22
category: docs/solutions/architecture-patterns
module: Athena agent harness authority, projection, evidence, and denial contracts
problem_type: architecture_pattern
component: authentication
resolution_type: code_fix
severity: critical
applies_when:
  - "A program, model, or automation reads data on behalf of a person"
  - "A surface must hide a field from some callers without lying about its value"
  - "A caller can retry, so a denial has to be machine-actionable"
  - "A deletion cascade has to be audited against what rows actually carry"
tags: [athena, convex, agent-harness, delegated-authority, field-omission, denials, retention, rendering]
delivery_diff_fingerprint: 4045ad992d1e75757b19b95b03058a765fff64bf1947fb9352a1fe7627de3092
---

# Answering A Caller That Is Not A Person

## Problem

Athena's operator surfaces answer a human who is looking at a screen. The agent
harness answers a **program** that a human delegated to: it composes several
domain reads in one turn, retries when it is refused, and hands the result to a
language model that will narrate whatever it is given.

Every convention that is merely awkward for a human turns into a defect for that
caller.

- A screen that renders `0` for a figure the viewer may not see is a small
  inconsistency. A program that reads `0` and reports "sales were zero today" is
  wrong, and the operator has no way to tell.
- A screen that greys out a disabled action is fine. A program that receives
  `{ outcome: "denied" }` with no reason narrates "access restrictions" and
  repeats the same malformed call until it exhausts its attempt budget.
- A screen that shows a markdown-rendered answer is normal. An answer whose text
  came from a model that read store-authored product names is an injection
  surface with a network egress channel attached.

These are the eight rules that came out of building it, each one learned from a
failing proof rather than from design.

## Solution

### 1. Delegation is not an actor kind

An agent run never becomes an actor of the ingress rail. Athena's
`OperationActor` / `OperationActorKind` were left untouched, and asserted so at
the type level. Instead the run holds a **derived grant**, pinned immutably at
run start, recording who delegated, what they held, the projected capability and
projection set, the authority digest, the authorisation epoch, and the admission
policy version.

Every capability call then re-derives authority in a fixed, fail-closed order:

```
run state -> epoch fence -> registry pin -> grant integrity -> live enablement
  -> the one authority port registered for the actor's kind (never a chain)
  -> shrink-only intersection with the pinned grant -> capability -> projections
```

Shrink-only is the load-bearing word: the intersection can only narrow. A forged
wider `grantedProjections` in an invocation changes nothing, because the port
reads its scope from `input.scope`, which the kernel derived from the
reauthorised grant inside that same transaction — never from arguments.

Authority is re-checked again before a result is released, before a citation is
minted, and before completion. A result whose authority disappeared in between
settles as evidence only, with no payload, and the exposure stays auditable.

### 2. Unauthorised data is structurally absent, never zero

Three layers plus a last line of defence:

| Layer | Mechanism |
| --- | --- |
| Type | `ProjectedShape<Fields, Granted>` — an ungranted key does not exist on the type |
| Declaration | `projectManifestForGrant` — an ungranted field is not in the projected manifest the model can see |
| Data | `omitUngrantedFields` — the key is deleted from the payload |
| Last defence | `findDisallowedFields` before anything becomes program-visible |

The contrast is recorded, not asserted. A characterization test captured the
*existing* operator surface first:

```ts
expect(restricted.closeSummary.salesTotal).toBe(0);   // the existing screen substitutes a zero
```

and the agent surface asserts the opposite:

```ts
expect(JSON.stringify(row)).not.toContain('"amount":0');
```

The conformance gate refuses to publish a package that breaks it, and
`bun run agent-sdk:generate` exits 1:

```
- [ungranted_field_present] operations.storeDay.probes[0] ... A field bound to an ungranted projection is present.
```

A zero is a claim. An absence is not. The same rule scales up: a resource whose
read intents the operator does not hold is not in their facade at all, so a
program naming it is rejected by the validator before any read happens — the
surface is structurally smaller, not merely redacted.

### 3. "Unauthorised" is not a value state

`AgentValueState` is exactly `known | unknown | unavailable | stale | partial`.
Writing `{ state: "unauthorized" }` is a compile error, by design: authorisation
is a property of the **call**, not of the value. The unauthorised codes live on
the bridge outcome (`AGENT_UNAUTHORIZED_CODES` in
`packages/athena-webapp/shared/agentHarness/bridge.ts`), distinct from a `denied`
outcome.

Keeping those vocabularies separate is what stops "you may not see this" from
ever being encodable as data the model can average, compare, or narrate.

A figure that genuinely does not exist is `unknown("not_recorded")`. Money is
`{ amount, currency }` in minor units. `0` never stands in for any of the three.

### 4. An empty object means "observed nothing"

A `get` port must return an object — the kernel refuses `null`. So the honest
answer for a subject the caller may not see is `{}` with every source
`unavailable`, which is indistinguishable from a subject that does not exist.

That required teaching the scope-isolation check that a **fieldless object is
empty**. The red that forced it:

```
x cannot describe a store in another organization ... expected 'failed' to be 'result'
```

Absence means *no fields*, not *no body*. Pick one and make every checker agree,
or the doctrine and the kernel rule quietly diverge.

### 5. An unexplained denial is a correctness problem

This was found by the first real turn against a real provider, not by a test.
With four `args_invalid` denials carrying no reason, the model narrated "access
restrictions" and repeated the same malformed call until its attempt cap.

The fix is not UX polish: the call record now carries `reason` and `detail` for
any non-result outcome, the tool surfaces both on each `calls[]` entry, and the
`invalid_arguments` denial names the offending argument. On the next run the
model self-corrected across three attempts:

```
attempt 1  { storeName, operatingDate }  -> denied: storeName is not a declared filter
attempt 2  { }                           -> denied: operatingDate is required
attempt 3  { operatingDate }             -> result, cited answer
```

Machine-actionable feedback is part of a tool contract, not decoration. Two
things make it affordable: describe the *contract* in the tool description (this
one had to say that arguments are declared filters, not free-text), and
remember that a rejected program consumes an attempt slot — with three attempts,
two malformed programs leave one chance.

### 6. Budgets charge what crosses the boundary

A byte budget must count what was released to the caller, not what the port
produced. Charging the full page on truncation exhausted a run's budget and
denied an unrelated later call, which surfaced as:

```
expected ['complete','truncated'] got ['truncated']
```

Charge the **fitted** bytes on truncation; keep `rows` honest as what was read.
And count outstanding *reservations*, not just settled charges, or concurrent
calls inside one attempt overshoot the per-attempt cap by up to one reservation.
A denied call still consumes a call attempt and is recorded as an audit-visible
settled reservation, so a program cannot retry its way around the ceiling.

### 7. Audit deletion cascades by what a row carries, not what it is called

A store-removal suite found `agentCapabilityCall` rows surviving:

```
x removes the store's agent content and leaves another store's untouched
    expected [ { ...(28) }, { ...(28) } ] to deeply equal []
```

A row called "capability call" sounds like metadata. It carried request
arguments and human-readable source labels lifted from the store's own records —
content, not audit. Lineage survives on the citation binding (result hash,
source reference, artifact), marked `deleted_by_lifecycle`, so evidence lookups
still answer honestly.

The general check, worth running against any scope-deletion cascade:

> For each row that survives, is **every** field an identity, a hash, or a
> timestamp? If not, it is content and it should have been deleted.

Watch the reverse direction too: organization-scope removal here reaches those
rows only by cascading into each store, because the table has no organization
index. That is a real coupling, and it should be stated rather than assumed.

### 8. Inert rendering should be a property of the code

Model-authored text is rendered by a component that parses a **closed block and
span vocabulary and only ever emits text nodes** — no image, anchor, iframe,
object, embed, video, or raw HTML can be produced at all
(`packages/athena-webapp/src/components/agent/AthenaAgentSafeText.tsx`).

The rejected alternative was defusing a general markdown renderer, which still
emits `<img>`, anchors, and GFM autolinks and therefore leaves "safe" as a
configuration that a future edit can undo. Proven in a real browser engine with
request interception across stored script, raw HTML and CSS, a remote image,
iframe/object/embed/video, autolinks, `javascript:`, `data:`, percent-encoded,
and chunk-split payloads. jsdom cannot prove any of this: it never fetches
`img`, `link`, or `iframe`.

Interactive destinations follow the same principle — a citation resolves to a
destination from the reference **kind**, never from its label, because labels
carry store-authored text and a destination must not be steerable by it.

## Prevention

- Add a caller kind by giving it a derived grant and one authority port, not by
  adding an actor kind. Assert the actor union is unchanged.
- Assert absence, not zero: `expect(JSON.stringify(row)).not.toContain('"field"')`
  is the shape of the test. Characterize the existing screen's substituted zero
  first, so the difference is on the record.
- Keep authorisation out of value vocabularies. If `unauthorized` is spellable
  as a value state, it will eventually be one.
- Decide once whether absence means "no body" or "no fields", and make the
  kernel, the ports, and every checker agree.
- Give every refusal a code and a message the caller can act on, and say in the
  tool description what the contract actually is. Then watch the denial-code
  mix as a first-class product metric on release.
- Charge budgets at the boundary that released the bytes, and count outstanding
  reservations.
- After any scope-deletion change, enumerate surviving rows and check every
  field is an identity, a hash, or a timestamp.
- Render untrusted model text through a closed vocabulary that cannot emit a
  network-fetching node. Verify it in a real engine with request interception —
  jsdom cannot see it.

## Related

- [Publishing a capability into a kernel that may not import you](./athena-generated-capability-registry-and-composition-root-2026-08-22.md)
- [The sensor ladder: what a green suite cannot see](../harness/the-sensor-ladder-what-a-green-suite-cannot-see-2026-08-22.md)
- [Completing an admission rail](./athena-complete-operation-admission-migration-2026-08-16.md)
- [Athena manager approval authority is decision evidence](../architecture/athena-manager-approval-authority-standard-2026-07-01.md)
- Authoring guide: `packages/athena-webapp/docs/agent/capability-authoring.md`
