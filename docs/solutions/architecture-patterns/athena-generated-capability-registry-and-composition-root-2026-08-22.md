---
title: Publishing A Capability Into A Kernel That May Not Import You
date: 2026-08-22
category: docs/solutions/architecture-patterns
module: Athena agent harness registry, admission composition root, and compatibility fence
problem_type: architecture_pattern
component: tooling
resolution_type: code_fix
severity: high
applies_when:
  - "A kernel must consume domain declarations without being allowed to import any domain"
  - "A composition root that domain modules import needs to import something from those same modules"
  - "A generated artifact is the identity that running work pins itself to"
  - "A deploy can change what an in-flight run would observe"
tags: [athena, convex, agent-harness, generated-artifacts, composition-root, compatibility-digest, import-boundary]
delivery_diff_fingerprint: 32f5f6d5b067c46d2a4766cf5f892bae7ac7e7b231df75a433f1d40c788fc71c
---

# Publishing A Capability Into A Kernel That May Not Import You

## Problem

The Athena agent harness kernel (`packages/athena-webapp/convex/agentHarness/`)
must know every capability a domain publishes — its fields, its filters, its
authority requirements, its read port — while being forbidden from importing a
single product domain. That is what makes the kernel reusable across surfaces,
and `packages/athena-webapp/convex/agentHarness/importBoundary.test.ts` fails the
build if it slips.

Four things have to be true at once, and each one is easy to get subtly wrong:

1. A domain declares a capability next to its own read code, and the kernel
   picks it up without an import.
2. The admission composition root binds each capability's read port — but the
   port modules import the composition root, and the composition root has to
   import the domain's evidence extractors.
3. The compiled result is an **identity** that a running program pins itself to,
   so it has to be stable, inspectable, and typechecked.
4. When that identity changes in a way that would alter what an in-flight run
   observes, the deploy must be fenced — without a drain window, a cohort, or a
   bespoke deploy workflow.

The failures were not theoretical. A single-file capability package produced a
temporal-dead-zone `ReferenceError` at module load, far from its cause. A test
harness that reused the production port bindings silently reauthorised through
the production policy and reported every call `unauthorized`. Function
references handed back through a `runMutation` result arrived as
`Error: [object Object] is not a functionReference`.

## Solution

### 1. Split every package into a declaration half and a ports half

`convex/<domain>/agentCapabilities/<area>.ts` holds the manifest and nothing
that reaches the composition root. `convex/<domain>/agentCapabilities/<area>Ports.ts`
holds the handlers and imports `defineAgentReadPortQuery` from
`convex/platform/operationAdmission.ts`. The composition root imports the
declaration half (and the evidence extractors) but never the ports half.

```
operations/agentCapabilities/storeDay.ts        declarations  ->  imported by the composition root
operations/agentCapabilities/storeDayPorts.ts   handlers      ->  imports the composition root
```

Put both halves in one file and you get a cycle whose only symptom is a TDZ
`ReferenceError` at module load, thrown from whichever module happened to be
entered first. The rule is enforced statically: the declaration half may import
only shared contracts and `convex/lib/agentCapabilityManifests`.

**The general rule:** a composition root that other modules import cannot itself
import those modules. If it must, the thing it needs is a different module.

### 2. A composition root's port queries close over its own admission

This is the corollary that costs the most time to discover. A registered read
port is a Convex query that reauthorises through the durable enablement overlay
*inside its own transaction*. It is not a function you can call under a
different policy — the policy is baked in.

So a harness that needs to run the real contracts under a different policy
(here: a release smoke that must exercise real capabilities while the operator
switch is still off) cannot reuse the production bindings. It has to wrap the
same plain handlers in **its own** port queries and rebuild the registry with
rewritten handler paths. `convex/agentHarness/evals/directHarness.ts` does
exactly that, and declares the two ways it differs from production: every
published profile is registered enabled, and the read-port index names its own
wrappers. Everything else — manifests, handlers, authority ports, extractor
index, executor, sandbox, budgets, evidence — is the production article.

Export the plain handler next to the registered query so this is possible at
all:

```ts
export const listShiftsHandler: AgentReadPortHandler = async (ctx, input) => { /* ... */ };
export const listShifts = defineAgentReadPortQuery({ portKey: "ops.shifts", handler: listShiftsHandler });
```

### 3. Return a key, not a function reference

Convex function references are symbol-keyed and **do not survive a
`runMutation` / `t.run` result boundary**. Handing one back from an admission
mutation produces, at the call site:

```
Error: [object Object] is not a functionReference
```

The fix is also the safer authorisation shape: admission returns a *key*
(`{ invocation, port }`), and the executor resolves that key against an
in-process closed dispatch map. The caller never receives a callable — it
receives a name that only the closed map can turn into a call. Name each
reference literally (`internal.<module>.<export>`) rather than building it by
indexing the api root: an `anyApi`-built reference reads as unadmitted ingress
to this repo's operation-admission checker, and the literal form is what makes
the dispatch map auditable.

### 4. Make the generated artifact a typechecked schema

`bun run agent-sdk:generate` writes `convex/agentHarness/_generated/registry.ts`
as an **annotated TypeScript literal**, not JSON:

```ts
// #region AGENT_GENERATED_REGISTRY_JSON
export const AGENT_GENERATED_REGISTRY: AgentCapabilityRegistry = {
  "capabilities": { ... }
};
// #endregion AGENT_GENERATED_REGISTRY_JSON
```

Two properties fall out of that shape:

- The type annotation turns `tsc --noEmit` into a schema check over the
  artifact. Falsified during delivery by injecting `contractVersion: 99`:
  `convex/agentHarness/_generated/registry.ts(43,7): error TS2322: Type '99' is not assignable to type '1'`.
- Emitting `JSON.stringify(canonical(value), null, 2)` inside a named region
  keeps the file byte-stable across regenerations (so a drift check is
  meaningful) *and* machine-readable (so a tool can lift the region without
  parsing TypeScript).

A generator that writes empty comment lines must emit ` *`, not ` * ` — a
trailing space fails `git diff --check` on the first generated commit.

### 5. Ratchet the privileged consumers with an import-graph allowlist

The generated registry is privileged: it carries every capability, including
ones a given operator may never see. Rather than trusting a convention,
`convex/agentHarness/discovery.test.ts` enumerates every module that imports the
privileged artifact and asserts equality with an explicit allowlist
(`PRIVILEGED_REGISTRY_CONSUMERS`, which started empty). Adding a consumer is a
conscious edit plus proof that nothing model-visible reaches it transitively.

This is a cheap, general ratchet for any "privileged module" claim: assert the
set of importers, not the absence of an import.

### 6. Lifecycle is not identity; the digest covers behaviour

Two decisions that have to be made together:

- **Lifecycle stays out of both digests.** Enabling a capability must never
  invalidate a run pinned to the old digest, and disabling must be an immediate
  live deny rather than a digest change. Enablement is a separate shrink-only
  overlay read live on every dispatch, release, citation, and completion.
- **The compatibility digest covers each port's `implementationVersion` *and* a
  hash of its handler source.** A behavioural change with an unchanged manifest
  would otherwise leave the identity untouched. The generator refuses to write
  when the source moved and the version did not
  (`port_implementation_version_stale`); a port going from absent to present is
  exempt from the bump but still moves the digest.

Two operational consequences worth writing down. Bumping a port's
`implementationVersion` invalidates any drift fixture that used the next number
as its "drifted" value — use a version no package will ever publish (99). And
the source-digest check fires on a pure refactor inside the same uncommitted
change; revert `_generated/**` to `HEAD` and regenerate to restore the
absent-to-present exemption.

### 7. One command fences the deploy

The fence reads the compatibility digest of the **local** generated registry
(the code about to deploy) and, in one transaction on the deployment about to be
replaced, disables the named profiles and advances the durable epoch:

```bash
bun scripts/agent-harness-fence.ts --reason "<deploy id>"    # --dry-run to preview
```

```
epoch advanced (epoch 1, digest fnv1a64:fcd14c0bebbf402d); disabled 2 profile(s) [daily_operations, organization_overview]; canceled 12 active run(s).
```

Every dispatch, release, and completion checkpoint compares pinned epoch against
current, and a repair sweep terminalises idle old-epoch runs. There is no drain
window and no deploy workflow of its own — old-digest runs are terminally
invalidated and retried under the new digest, which is precisely what prevents
mixed-version execution.

Idempotency here comes from the *plan*, not from a mutation key: a retried fence
with the same digest computes no advance and reports `unchanged`. That
distinction matters when you are reading fence output during an incident.

## Prevention

- When a composition root needs something from the modules that import it,
  split the declaration from the runtime rather than reaching across. Enforce it
  with a static import-boundary test, not a comment.
- Before writing an alternate-policy harness over real contracts, check what the
  registered entry point closes over. If it reauthorises inside its own
  transaction, you need your own wrappers and a rebuilt registry — and you
  should declare, in the harness itself, exactly how it differs from production.
- Never return a Convex function reference across a `runMutation` / `t.run`
  boundary. Return a key and resolve it from a closed in-process map.
- Annotate generated TypeScript with its type so `tsc` becomes a schema check,
  and wrap the emitted literal in a named `#region` so it stays byte-stable and
  liftable.
- For any "only these modules may touch X" claim, assert the importer set
  against an explicit allowlist that starts empty.
- Keep operational state (lifecycle, enablement) out of the identity digest;
  keep behavioural state (implementation version, handler source) in it.
- Give the epoch mechanism one command. A mechanism nobody can run under
  pressure is not a safety property.

## Related

- [The sensor ladder: what a green suite cannot see](../harness/the-sensor-ladder-what-a-green-suite-cannot-see-2026-08-22.md)
- [Convex deploy and module-graph constraints](../harness/convex-deploy-and-module-graph-constraints-2026-08-22.md)
- [Answering a caller that is not a person](./athena-answering-a-non-human-caller-2026-08-22.md)
- [Completing an admission rail](./athena-complete-operation-admission-migration-2026-08-16.md)
- Authoring guide: `packages/athena-webapp/docs/agent/capability-authoring.md`
