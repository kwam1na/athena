# Authoring an Agent Capability

This is the guide for adding something the agent can read: a resource, a
package, or a whole profile. It is written for the person who owns the domain,
because the domain owns the meaning; the harness kernel owns authority,
budgets, evidence, and lifecycle, and never learns your vocabulary.

Read [architecture.md](./architecture.md) for where the harness sits, and
[agent-harness-runtime.md](./agent-harness-runtime.md) for the Convex Agent /
sandbox pinning and upgrade path.

---

## 1. What you are adding, and where it lives

A capability is three artifacts that live **next to the domain read code**, not
inside the harness:

| Artifact | File | What it is |
| --- | --- | --- |
| Manifest | `convex/<domain>/agentCapabilities/<area>.ts` | The semantic contract: namespace, scope, verbs, filters, result fields, projections, freshness, completeness, citation, evidence, cost. |
| Read port | `convex/<domain>/agentCapabilities/<area>Ports.ts` | The actual read, wrapped in the kernel's port query. |
| Conformance fixture | `convex/agentHarness/profiles/<profile>Conformance.ts` | Probes proving the port obeys the manifest, plus the evidence extractor. |

The split between the declaration half and the ports half is not stylistic.
`convex/platform/operationAdmission.ts` — the admission composition root — must
import your evidence extractor, and your port module must import that same file
for `defineAgentReadPortQuery`. A single file makes that a cycle, and the
symptom is a temporal-dead-zone `ReferenceError` at module load, far from the
cause. `convex/agentHarness/importBoundary.test.ts` holds the rule: the
declaration half may import only shared contracts and
`convex/lib/agentCapabilityManifests`.

Nothing under `convex/agentHarness/` may import your domain. That is what makes
the kernel reusable, and it is enforced statically.

---

## 2. Naming a resource semantically, not screen-shaped

Name what the operator would ask about, not what a screen renders.
`operations.storeDay` is a store's day; `reports.daySales` is the authoritative
daily sales record. A resource named after a view (`operations.dashboardHeader`)
locks the agent to a layout and cannot be composed.

- `package` is a domain area an operator recognises (`operations`, `reports`,
  `cash`, `automation`, `inventory`).
- `resource` is the thing itself, singular in meaning even when listed.
- Verbs are `get` (one snapshot) and `list` (a bounded page). There is no third
  verb, and there is no command verb — see §11.
- `capabilityId` is immutable and opaque (`cap_dailyops_store_day`). The
  namespace is the readable path and may be renamed with a version bump; the id
  may not.

Filters are a closed vocabulary. A filter may not carry a timestamp, a timezone,
a UTC offset, or a time window: the operating day is the only time input a
caller may name, and the server resolves it through `convex/storeTime`. This is
a schema rule, so it fails at generation rather than in a handler.

---

## 3. Declaring completeness and freshness honestly

Every envelope reports where its data came from and how sure it is. Two fields
carry the weight:

- **Freshness** — `live` (read now), `accepted` (an authoritative record such as
  a folded report day), `derived` (computed from samples), `stale`. The
  `authority` says who decided: `live_read`, `authoritative_record`, `derived`.
  Where an authoritative revision exists, put it on `sourceRefs[].version`;
  completion then records an immutable revision reference and the citation stays
  reconstructible after the replay window closes.
- **Completeness** — one entry per declared `sourceKeys` entry, each
  `complete | partial | truncated | unavailable` with a reason. The envelope's
  aggregate is derived from them, so you cannot overstate it.

Rules that have already caught real bugs:

- A bounded read is `truncated`, never `complete`. If your seam caps at 200
  events, say so and add a warning.
- A missing scheduled window is `partial` with a `missing` list, not a clean day.
- A fallback is reported, not hidden. When no store schedule governs the date,
  `resolveAgentOperatingWindowWithCtx` answers `utc_fallback`; put that on the
  row and raise an `operating_window_fallback` warning.
- A figure that does not exist is `unknown("not_recorded")`, never `0`.

---

## 4. Sensitivity: projections, and why absence beats zero

A sensitive field declares `projection: "<key>"`, and the manifest declares what
that projection requires:

```ts
projections: {
  costOverlay: {
    requires: { tier: "full_admin", readIntents: ["inventory.cost_overlay.view"] },
    egressClass: "sensitive",
    meaning: "Unit cost and stock value.",
  },
}
```

An operator who does not hold the projection does not get a zeroed field, an
empty array, or a `null` — the key is **absent**, at the type level
(`ProjectedShape`) and at runtime (`omitUngrantedFields`, then
`findDisallowedFields` as the last defence before data becomes program-visible).
The existing operator surface substitutes zeroes in places; the agent surface
deliberately does not, because a zero is a claim and an absence is not.

The same rule applies to whole resources: a resource whose read intents the
operator does not hold is not in their facade at all, so a program naming it is
rejected by the validator before any read happens.

Egress classes order `operational < sensitive < restricted`. A result inherits
the maximum class of every input it read, and the profile's `egressPolicy.maxClass`
bounds what may reach a provider at all.

---

## 5. Binding admission: read intents and the port

`binding.readIntents` names intents from the closed catalog in
`convex/platform/readIntentCatalog.ts` — the same intents the public read rail
uses. The catalog carries a `delegation` annotation per intent
(`{ minimumRole }` or `null` for never-delegable), derived from the roles the
owning handlers already enforce, and the operator's held intents are re-derived
from their **current** membership on every call.

Choose conservatively: if a surface mixes full-admin-only reads with both-role
reads, the intent floor is full admin. Lower it deliberately, with the product
owner, not by default.

Registering the port is three edits plus generation:

1. Write the handler with `defineAgentReadPortQuery` (see §6).
2. Add the manifests, ports, profiles, conformance fixtures, and extractors to a
   registration in `convex/agentHarness/manifestRegistrations.ts`.
3. Run `bun run agent-sdk:generate`, then bind the port key to its
   `internal.*` reference in the `agentReadPorts` list in
   `convex/platform/operationAdmission.ts`.

A binding whose function name is not the registered path fails at composition
time (`handler_path_mismatch`). A missing binding leaves the port unreachable
(`unavailable: port_unbound`), and `agentReadPorts.listUnboundPorts()` is
asserted empty by the admission coverage suite.

---

## 6. Writing the read port

```ts
export const listShiftsHandler: AgentReadPortHandler = async (ctx, input) => {
  const storeId = input.scope.storeId;            // from the VERIFIED grant
  if (!storeId) return { kind: "unavailable", reason: "store_scope_missing", retryable: false, sourceKey: "pages" };
  // ... one indexed read per source; `.collect()` is banned.
  return {
    kind: "data",
    data: rows,                                    // every declared field; the kernel strips
    observedAt: input.now,
    freshness: { class: "live", authority: "live_read" },
    sources: [{ sourceKey: "pages", status: page.hasMore ? "partial" : "complete", capturedAt: input.now }],
    sourceRefs: [...],
    page: { hasMore: page.hasMore, rawCursor: page.rawCursor },
  };
};

export const listShifts = defineAgentReadPortQuery({ portKey: "ops.shifts", handler: listShiftsHandler });
```

Non-negotiables:

- **Never read scope from `args`.** The store or organization comes from
  `input.scope`, which the kernel derived from the reauthorized grant inside
  this transaction. A forged wider `grantedProjections` in the invocation
  changes nothing.
- **Never return a raw document id.** Mint opaque references with
  `mintAgentResourceRef(kind, scopeId, id)` (masked, bound by a digest over
  `(kind, scopeId, id)`) and `mintAgentSourceRef` for citation sources. A
  reference minted under another store's scope cannot be unmasked here, so it
  resolves to nothing.
- **Answer absence structurally.** A `get` must return an object; a snapshot the
  caller may not see is `{}` with both sources `unavailable`, which is
  indistinguishable from a subject that does not exist. Use
  `kind: "unavailable"` when a reference is unresolvable.
- **Export the plain handler** next to the registered query, so the release
  smoke can bind the same read to a different admission.

Undeclared fields, raw identifiers, exceeded page bounds, freshness outside the
manifest, and undeclared completeness sources all fail the call closed with
`port_contract_violation`. That is the port's own bug, not the caller's.

---

## 7. Evidence extractors

A citation is only as good as what it can still prove later. Declare one of two
modes on the manifest:

```ts
evidence: { mode: "extractor", extractorKey: "operations.storeDay", extractorVersion: "1", claimShapes: ["lifecycleStage"] }
// or
evidence: { mode: "provenance_only", reason: "Roster rows are references." }
```

An extractor is a **pure, deterministic, field-minimizing** function over
already-authorized result data. It returns `{ claim }` — the smallest slice that
substantiates one declared claim shape — or `{ unsupported: reason }`. It may
not read the clock, randomness, or anything ambient; the conformance gate runs
it twice and scans its source for ambient-state markers.

Register it in the package's extractor index and add it to
`AGENT_EVIDENCE_EXTRACTORS` in `convex/agentHarness/manifestRegistrations.ts` and
to the runtime index in `convex/platform/operationAdmission.ts`. The executor
seams resolve through `resolveAgentEvidenceExtractor`, so a registered extractor
turns a citation into `claim_support`; an unregistered one degrades to
`provenance_only`, which is honest but weaker.

---

## 8. Conformance: what stands between a capability and an operator

`bun run agent-sdk:generate` refuses to write the artifacts unless every
`enabled` capability passes `runCapabilityConformance`. Ship probes for each
declared verb, plus one foreign-scope probe that must return nothing:

- scope isolation (a foreign scope returns nothing),
- field omission (no ungranted or undeclared field survives),
- pagination and snapshot bounds,
- declared freshness class and authority,
- completeness source coverage,
- determinism (the same call twice, ignoring the wall clock),
- budget accounting (settled within the declared worst case),
- evidence extraction (deterministic, minimal, authorization-preserving,
  hash-bound).

`convex/agentHarness/releaseConformance.test.ts` runs that gate over every
registered manifest, so a package cannot reach an operator without it.

---

## 9. Lifecycle, enablement, and the switch

Three states, and they mean different things:

| State | Meaning |
| --- | --- |
| `unpublished` | Not offered at all. Denied before any capability is consulted. |
| `enabled` | May be reached — the code-side decision. |
| `disabled` | Explicitly off. |

Publication (`lifecycle: "enabled"` in code, then regeneration) says a profile
**may** reach operators. Enablement is separate and durable: profiles are
**default off**, and `agentEnablementSwitch` rows narrow the published baseline.
The overlay is shrink-only — a switch can never widen beyond what is published —
and it is read live on every dispatch, result release, citation, and completion,
so a flip denies immediately even for a run that pinned an older registry digest.

```bash
bun run agent-harness:switch -- --status
bun run agent-harness:switch -- --profile daily_operations --enable --reason <id>
bun run agent-harness:switch -- --profile daily_operations --disable --reason <incident>   # rollback
```

Disabling also runs a bounded cancel pass over the profile's active runs, and
evidence already released is preserved.

Lifecycle is deliberately **not** part of the registry or compatibility digest:
enabling a capability must never invalidate a run pinned to the old digest, and
disabling must be a live deny rather than a digest change.

---

## 10. Deploying a behavioural change: the compatibility fence

Changing a read port's behaviour changes what an in-flight run would observe. So:

1. Bump `implementationVersion` on **both** the manifest binding and the port
   definition. The generator hashes each port's source and refuses to write when
   the source moved and the version did not
   (`port_implementation_version_stale`).
2. Run `bun run agent-sdk:generate`. The compatibility digest moves.
3. Before deploying, run the fence **against the deployment about to be
   replaced**:

   ```bash
   bun scripts/agent-harness-fence.ts --reason "<deploy id>"     # --dry-run to preview
   ```

   One transaction disables the named profiles and advances the durable epoch.
   Every dispatch, release, and completion checkpoint compares pinned versus
   current epoch, and the repair sweep terminalizes idle old-epoch runs. A
   retried fence with the same digest is a no-op.
4. Deploy, smoke, then enable with the switch. Deploy, smoke, or rollback
   failure leaves the profile disabled — nothing re-enables it implicitly.

---

## 11. Profiles: selecting capabilities into a surface

A profile is what an operator surface offers. It selects packages, pins budgets
and prompt policy, declares its egress ceiling and provider allowance, and
carries the presentation adapter (entry label, mount mode, context binding,
starter intents, source destinations, thread-key policy).

- A profile adds **no kernel code**. `convex/agentHarness/profiles/syntheticSecondSurface.ts`
  is the proof: organization-scoped rather than store-scoped, a different package
  mix, a full-screen mount, its own thread key — and it runs on the same
  registry, admission, executor, sandbox, budgets, evidence, and citations
  (`convex/agentHarness/evals/syntheticSecondSurface.test.ts`).
- `egressPolicy.providers` must list a provider that is actually configured. A
  profile whose only allowance is the contract fake is `no_compatible_provider`
  in production.
- Every starter intent must be answerable entirely through published resources.
- `resolveSourceDestination` must be total over every citation kind any selected
  resource can mint, and must resolve from the reference **kind**, never from a
  label. Labels carry store text; destinations must not be steerable by it.

---

## 12. Runtime-adapter ownership

Athena owns the protocol; the runtime is an implementation detail behind it.

- `shared/agentHarness/agentRuntime.ts` is the `AgentRuntimeAdapter` contract:
  opaque refs, normalized events, the fingerprinted tool-dispatch ledger, and the
  usage reconciler. Athena computes cost, not the runtime.
- `convex/agentHarness/agentRuntime/` is the **only** directory that may import
  `@convex-dev/agent`, `ai`, or `@ai-sdk/*`; the root `convex/convex.config.ts`
  mounts the component and imports the constants-only registration shim. Static
  import-boundary checks enforce both.
- The selected adapter identity (`AGENT_SELECTED_RUNTIME_ADAPTER`) is part of the
  compatibility digest, so changing the adapter or its pinned versions requires
  the fence.
- The deterministic contract fake and the real adapter pass the same suite, which
  is what "replaceable" means here — not that a second runtime exists.

Do not add a second orchestration runtime, and do not let runtime types cross
into capability, admission, executor, evidence, completion, or UI code.

---

## 13. Authority

An agent run is never an actor of the public ingress rail. It holds a **derived
grant**:

- the operator was admitted by the public rail when the turn opened;
- the grant pins, immutably, who delegated, what they held, the projected
  capability and projection set, the authority digest, the authorization epoch,
  and the admission policy version;
- every capability call re-derives that operator's **current** authority through
  the one authority port registered for their kind, intersects it with the pinned
  grant (shrink only, never widen), and re-checks the live enablement overlay;
- authority is re-checked again before a result is released, before a citation is
  minted, and before completion. A result whose authority disappeared in between
  is settled as evidence only, with no payload.

Never treat a runtime-native or Convex Agent `userId` as identity.

---

## 14. Investigating an incident

Start from the run.

- **What the model did**: `internal.agentHarness.evals.directHarness.describeRunDiagnostics`
  gives the run status, the budget charged, each attempt's status and validator
  diagnostic, each capability call with its refusal, and the authored program
  text while its short-lived payload lives.
- **What an answer was grounded in**: `api.agentHarness.turns.inspectCitationEvidence`
  (operator-facing, reauthorized, audited) or the seam
  `readCitationEvidence`. Every read writes an `agentEvidenceAccessAudit` row
  recording who read what and for what purpose — never the payload.
- **Exposure**: `describeAttemptExposure` answers whether an attempt reached the
  provider, whether the operator released or viewed it, and whether authority was
  revoked after provider exposure.
- **Evidence states**: `reconstructible` (a claim slice, replay payload, or
  immutable revision still exists), `provenance_only` (identity and hashes only),
  `evidence_expired` (retention window closed), `evidence_deleted_by_lifecycle`
  (store or organization removal). These are different answers on purpose;
  "missing" is not one of them.
- **Retention**: prompts, scratch, provisional program and call bodies are
  30-day `short_lived`. Completion promotes only the cited attempts' exact
  validated program, structured result, and minimal claim slices to the 365-day
  `standard` class. Store and organization removal deletes agent content and
  marks grants and citations `deleted_by_lifecycle`, and runtime-side content is
  removed through the adapter's cleanup hook, retried with backoff.

---

## 15. The command rail is somewhere else

This is a **read** harness, and that is a boundary, not an omission.

- The model sees exactly five tools: `athena.discover`, `athena.describe`,
  `athena.executeProgram`, `athena.scratch`, `athena.completeRun`. Any other tool
  id is a protocol violation that invokes no handler.
- Manifests support `get` and `list` only. `propose`, `apply`, `execute`,
  `command`, `mutate`, `create`, `update`, and `delete` are reserved and rejected
  at generation, distinctly from an unknown read verb, so nobody can "version in"
  a command through the read rail.
- Every read port is an `internal_query`. There is no mutation reach, no
  scheduler, no `ctx.db` handle, and no `api.*` re-entry anywhere the model can
  touch.

Future command work begins from its own requirements and plan artifact, and must
use proposal, fresh precondition re-check, Athena-native approval, and admitted
domain-command rails. Do not extend this surface to reach it.

---

## 16. Checklist

- [ ] Manifest in the domain's `agentCapabilities/` declaration module; ports in
      the sibling `*Ports.ts`.
- [ ] Read intents from the closed catalog, chosen conservatively.
- [ ] Sensitive fields behind projections; unauthorized data absent, never zeroed.
- [ ] Freshness, completeness, and warnings honest, including fallbacks.
- [ ] Opaque references only; scope from the grant, never from arguments.
- [ ] Evidence extractor registered, or `provenance_only` with a reason.
- [ ] Conformance probes for every verb plus a foreign-scope probe.
- [ ] `bun run agent-sdk:generate`, port bound at the composition root.
- [ ] `implementationVersion` bumped if a port's behaviour changed, and the fence
      run before deploying.
- [ ] `bun run --filter '@athena/webapp' test -- convex/agentHarness shared/agentHarness convex/operationAdmission convex/platform`,
      `bun run agent-sdk:check`, `bun run --filter '@athena/webapp' audit:convex`.
