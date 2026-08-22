# Authoring an Agent Capability

This is the guide for adding something the agent can read: a resource, a
package, or a whole profile. It is written for the person who owns the domain,
because the domain owns the meaning; the harness kernel owns authority,
budgets, evidence, and lifecycle, and never learns your vocabulary.

Read [architecture.md](./architecture.md) for where the harness sits, and
[agent-harness-runtime.md](./agent-harness-runtime.md) for the Convex Agent /
sandbox pinning and upgrade path. Two durable notes carry the reasoning behind
the rules below and are worth reading once before your first capability:
[publishing a capability into a kernel that may not import you](../../../../docs/solutions/architecture-patterns/athena-generated-capability-registry-and-composition-root-2026-08-22.md)
and [answering a caller that is not a person](../../../../docs/solutions/architecture-patterns/athena-answering-a-non-human-caller-2026-08-22.md).

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
bun scripts/agent-harness-switch.ts --status
bun scripts/agent-harness-switch.ts --profile daily_operations --enable --reason "<id>"
bun scripts/agent-harness-switch.ts --profile daily_operations --disable --reason "<incident>"   # rollback
```

(`bun run agent-harness:switch` is the same script, but see §10.1 before passing
a multi-word `--reason` through it.)

`--status` prints the durable epoch, the deployed digest, and every profile's
published baseline against its effective switch state; the same answer is
available on a deployment through
`bunx convex run agentHarness/deploymentState:describeDeploymentState '{}'`.

Disabling also runs a bounded cancel pass over the profile's active runs, and
evidence already released is preserved.

Lifecycle is deliberately **not** part of the registry or compatibility digest:
enabling a capability must never invalidate a run pinned to the old digest, and
disabling must be a live deny rather than a digest change.

---

## 10. Deploying a change and releasing a profile

### 10.1 The compatibility fence

Changing a read port's behaviour changes what an in-flight run would observe. So:

1. Bump `implementationVersion` on **both** the manifest binding and the port
   definition. The generator hashes each port's source and refuses to write when
   the source moved and the version did not
   (`port_implementation_version_stale`).
2. Run `bun run agent-sdk:generate`. The compatibility digest moves.
3. Before deploying, run the fence **against the deployment about to be
   replaced**:

   ```bash
   bun scripts/agent-harness-fence.ts --reason "<deploy id>"    # --dry-run to preview
   ```

   Run these two scripts **directly**, not through `bun run agent-harness:fence --`
   / `bun run agent-harness:switch --`. `bun run <script> -- --reason "a b c"`
   re-splits the quoted value into three arguments; the package scripts exist
   as names, but any flag carrying free text has to go through the direct form.

   One transaction disables the named profiles and advances the durable epoch.
   Every dispatch, release, and completion checkpoint compares pinned versus
   current epoch, and the repair sweep (`repairFencedRuns`) terminalizes idle
   old-epoch runs. A retried fence with the same digest is a no-op.
4. Deploy, smoke, then enable with the switch. Deploy, smoke, or rollback
   failure leaves the profile disabled — nothing re-enables it implicitly.

The fence is one atomic transaction, not a phase. There is no drain window, no
"wait for old runs to finish" state, and no deploy workflow of its own: runs
that pinned the old digest are terminally invalidated and can be retried under
the new one, which is exactly what stops mixed-version execution.

### 10.2 The release posture

Releasing a profile is one switch, and the same switch is the rollback. In
order:

1. **Publish in code.** `lifecycle: "enabled"` on the profile plus
   `bun run agent-sdk:generate`. This says the profile *may* reach operators; it
   does not turn it on. A profile that is not published denies
   `profile_unpublished` before any capability is consulted.
2. **Deploy, then fence** if a read port's behaviour moved (§10.1).
3. **Smoke while the operator switch is still off**, through the direct harness
   (§10.3). A switched-off profile denies `profile_disabled`, so this proves the
   real capabilities against the real deployment without any operator being able
   to reach them.
4. **Enable broadly** —
   `bun scripts/agent-harness-switch.ts --profile <id> --enable --reason "<id>"`. One
   flip, everyone who holds the surface's read intents. There are no pilot
   cohorts, no canary stages, no allowlists, no operator sample quotas, no
   staged profile versions, and no formal scorecard gate. Do not add any; if
   scale or an incident ever justifies staging, that is its own plan.
5. **Watch the first real turns.** The signals that matter on day one are
   completion, citation resolution, denial codes and rates (an `args_invalid`
   spike means a tool contract is unclear to the model, not that an operator did
   something wrong), latency to a committed answer, provider cost, cancellation,
   and errors. `describeRunDiagnostics` (§14) is the per-turn view. Targets are
   set from observed usage, not from prerelease samples.
6. **Roll back immediately if needed** —
   `bun scripts/agent-harness-switch.ts --profile <id> --disable --reason "<incident>"`.
   That denies new work at once, cancels the profile's active runs in bounded
   passes, and preserves evidence already released. It stops the operator rail
   only: the direct-harness smoke registers every published profile `enabled` in
   its own admission (§10.3), so the compatibility fence (§10.1) is the complete
   stop when a read port's behaviour, not an operator's reach, is the problem.

What blocks a release and what does not are different questions. Any authority
or data leak, mutation reach, or sandbox escape blocks enablement outright.
Product-quality misses — an unhelpful answer, a model that needs a clearer tool
description — are fixed iteratively after release and do not trigger a gate.

### 10.3 Direct-harness smoke is not an operator turn

These are two different things and the docs, the tests, and the deployment all
keep them apart:

| | Direct-harness smoke | Operator/profile turn |
| --- | --- | --- |
| Entry | `internal.agentHarness.evals.dailyOperations.runSmoke`, composed over `convex/agentHarness/evals/directHarness.ts` | the operation-admitted public turn entry points in `convex/agentHarness/turns.ts` |
| Requires the profile switched on | No — it registers every published profile `enabled` in its own admission | Yes — a switched-off profile denies `profile_disabled` |
| Creates a turn binding | No | Yes |
| Releases an answer to anyone | No — it terminalizes every run it starts | Yes, after completion and reauthorization |
| Capability kill switches | Read live from the durable overlay, so it proves them for real | Same |
| Read ports, manifests, registry, executor, sandbox, budgets, evidence | The production ones | The production ones |

The smoke's admission differs from production in exactly two declared ways:
every published profile is registered `enabled`, and the read-port index names
the direct harness's own wrappers. It has to be that way — a production port
query reauthorizes through the durable overlay *inside its own transaction*, so
a smoke "while the profile is off" cannot use the production bindings. The
production bindings are asserted separately by
`convex/agentHarness/evals/dailyOperations.ports.test.ts` and by
`convex/operationAdmission/coverage.test.ts`.

```bash
bunx convex run agentHarness/evals/dailyOperations:runSmoke \
  '{"organizationSlug":"<org>","storeSlug":"<store>","operatorEmail":"<operator>","operatingDate":"<YYYY-MM-DD>"}'
```

The matrix covers cross-package composition, a role-restricted result, a
partial/no-data day, cancellation, citation resolution, and the capability kill
switch. It runs identically under `convex-test`
(`convex/agentHarness/evals/dailyOperations.test.ts`) and on a deployment.

`directHarness.ts` also carries release-verification drivers that start, read,
acknowledge, and cancel a turn from the command line. They call the same
entry-point functions the public wrappers call, with the actor the admission
rail would have resolved for an operator who already holds membership in the
organization that owns the store; they are internal-only, grant nothing the
operator does not already hold, and **refuse to run when `STAGE === "prod"`**.
Treat them as release tooling with a shelf life, not as an API.

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

Daily Operations is the first adapter, not a special case. The kernel holds no
Daily Operations knowledge — `convex/agentHarness/importBoundary.test.ts` fails
the build if it acquires any — and everything that makes that surface itself
lives in its manifests, its profile, and its presentation adapter. Read those
three artifacts to copy the shape; you do not need to read
`convex/operations/dailyOperations.ts` to build a second surface.

### The presentation contract

`convex/agentHarness/profiles/<profile>.ts` carries the server-side
presentation adapter, but it reaches Convex server code and cannot enter the
browser bundle. So the surface declares the same adapter again in a
browser-safe module, and a drift test asserts the two agree field by field
(`src/components/operations/dailyOperationsAgentPresentation.ts` and its
`.test.ts` are the worked example).

The contract itself is `AgentPresentationAdapterInput` in
`shared/agentHarness/profile.ts`, built through `definePresentationAdapter`
(re-exported for surfaces as `defineAthenaAgentPresentation` from
`src/components/agent/AthenaAgentPresentationAdapter.ts`):

| Field | What you supply |
| --- | --- |
| `contractVersion` | The host contract version this surface compiles against. |
| `profileId` | The published profile's id. Must match the server profile. |
| `contextBinding` | `scopeKind` plus the context `keys` the host must show before any question is sent, and `snapshotKeys` — the keys frozen into every turn (Daily Operations snapshots `operatingDate`). |
| `contextLabel` | Pure function from context values to the one line the host shows above the prompt. |
| `entry` | The entry control's `label` and a stable `location` id for the mount point. |
| `mountMode` | `docked_panel` or full screen. |
| `starterIntents` | Each with `id`, `label`, `prompt`, and `requiresPackages`; every one must be answerable entirely through published resources. |
| `resolveSourceDestination` | Citation reference **kind** → an in-app destination, or `null`. Total over every kind the selected packages can mint. |
| `threadKeyPolicy` | The context parts that compose the thread key; `composeThreadKey` derives the key so a context change detaches the thread rather than silently reusing it. A thread key names the store context, not the person: every operator in the store shares it, but `getThreadHistory` returns only the viewer's own turns (the newest `AGENT_HISTORY_TURN_LIMIT` within a bounded scan) and `thread_busy` is raised only for the operator's own active turn on that key. |

The type lives in `shared/`, but the **value is deliberately declared twice** —
once on the server profile and once in the browser module — because
`src/routeTree.browser-boundary.test.ts` forbids importing the server profile
from `src/`. Do not go looking for a shared adapter value to import; write the
second declaration and write its parity test. That test is the only thing
keeping the two equal.

Mount it with `AthenaAgentSurface` from
`src/components/agent/AthenaAgentPanel.tsx`, passing `presentation`, the store
id, the live `context` values, and optional `routeParams` / `returnLabel` /
`layout` / `activeTurnId`. Drive state with `useAthenaAgentRun`
(`src/components/agent/useAthenaAgentRun.ts`) if you need the panel rather than
the whole surface. The host owns everything else: the entry control, focus
order, the progress live region, the answer and its quality badge, citation
disclosure, stop and new-thread, and reload-rejoin through `sessionStorage`.
The copy for denials, unavailable states, failures, and milestones is host-owned
too (`describeAthenaDenial`, `describeAthenaUnavailable`,
`describeAthenaFailure`, `describeAthenaMilestone`) so two surfaces cannot
describe the same backend state differently.

**Model-authored text is rendered only by `AthenaAgentSafeText`**
(`src/components/agent/AthenaAgentSafeText.tsx`). It parses a closed block and
span vocabulary and emits text nodes — never an image, anchor, iframe, or raw
HTML — so "no network request is possible from an answer" is a property of the
code rather than of a markdown configuration. Do not substitute a markdown
renderer, however configured.

Limits to design around, all current and all deliberate:

- `AthenaAgentSurfaceProps.storeId` is typed `Id<"store">`, so an
  organization-scoped profile needs that prop widened before it can mount.
- A citation destination must be a server-minted internal route, and the host
  renders it as a plain anchor (a full page load), not a router link.
- `mountMode` is a profile value, but the responsive switch is not: below
  768 px the host uses its full-screen sheet regardless of what the adapter
  declares.
- `AGENT_HOST_STATES` has no `canceled` member; a canceled and a failed run
  both arrive as `terminal_denied` and are distinguished by local copy.
- The answer contract carries no per-source freshness field. The host shows an
  answer-level quality badge; per-source freshness and completeness appear only
  after the operator opens a citation and `inspectCitationEvidence` answers.
- Panel width is not persisted; only the active turn reference is, under
  `athena.agent.turn.<threadKey>` in `sessionStorage`.
- There is no dedicated "is this profile available" read — the host infers
  availability from the thread-history query, and an unrecognized reason keeps
  the surface usable rather than closing it.
- A presentation label is composed for humans and is **not** a valid backend
  key. The thread key goes through an explicit injective encoder
  (`composeAthenaThreadKey`, `ATHENA_AGENT_THREAD_KEY_PATTERN`) because the
  readable composition does not satisfy the server's grammar.

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

### What Convex Agent owns, and what Athena owns

The split is the whole reason a runtime can be swapped, so it is worth stating
flatly. **No business record is ever reconstructed from Convex Agent state.**

| Convex Agent owns | Athena owns |
| --- | --- |
| Thread and message mechanics, the model turn, internal step progression, the tool loop | The run, attempts, capability calls, budget ledger, grants, evidence, citations, artifacts, and completion |
| Provider transport for the turn | Provider selection, egress class, spend ceiling, and cost |
| Its own component tables | Every durable business fact, in Athena's own tables |
| A correlation `userId` (`athena:thread:<token>`) | Identity and authority — the `userId` is correlation metadata and is **never** authorization |

What the component is permitted to hold is an allowlist, verified by
`convex/agentHarness/agentRuntime/convexAgentPersistence.test.ts`: the operator
prompt text with its hashes, one status record per attempt, and the committed
narrative projection. Tool calls, tool results, model drafts, and failure
messages stay out (`saveMessages: "none"`). Raw component history is never
replayed to a provider — the adapter installs a `contextHandler` that returns
only the Athena-authored projection, so replay is structurally impossible rather
than merely disabled. Before every turn Athena reauthorizes prior terminal
artifacts and builds a minimized history projection that omits anything beyond
current authority or retention.

### Request-fingerprinted tool dispatch

Every tool call the model makes is bound to an idempotency key that is a
fingerprint over the adapter version, the turn, the tool id, the canonicalized
argument hash, and the call identity. On exact replay the ledger returns the
recorded outcome. On any mismatch the dispatch **fails without invoking a
handler and without returning cached data** — a retry that is not the same
request is not a retry. Because `CONVEX_AGENT_ADAPTER_VERSION` is part of the
fingerprint, a runtime upgrade can never silently reuse a result produced by a
different runtime version. A tool id outside the fixed five is a protocol
violation that invokes nothing.

### Normalized usage settlement

Providers report usage inconsistently, so the adapter normalizes it and Athena
settles it. Each update identifies its provider invocation, declares whether it
is a delta or a cumulative total, is deduplicated and ordered by sequence, and
attributes retries separately. Terminal totals are reconciled; a cancelled turn
or a missing final report is settled **conservatively** (charged, not
forgiven) rather than left open. Cost is then computed by Athena from the
normalized totals against the rate card the model registry holds for that
provider and model (`rateCardFor` in `convex/agentHarness/modelRegistry.ts`) and
charged against the profile's spend ceiling — the runtime never tells Athena
what something cost.

### TanStack AI is a different adapter

`convex/intelligence/providers/tanstack.ts` remains the one-shot structured-
generation adapter for the existing intelligence layer. It is untouched by the
harness, keeps its own regression suite, and is not a fallback runtime for
agent turns. Both provider paths normalize into the same Athena evidence
contracts; neither is layered on the other. Do not route agent work through it,
and do not route structured-generation work through the harness.

### Where these patterns came from

The harness borrows a few ideas that are well described in the public
[Deep Agents](https://docs.langchain.com/oss/javascript/deepagents/overview)
writing: progressive capability discovery instead of a tool per read,
constrained code execution over a generated facade, an explicit scratch
artifact, and explicit completion rather than an inferred stop. Those are
*patterns*, adopted deliberately and reimplemented on Athena's own contracts.
LangChain, LangGraph, and Deep Agents are **not** dependencies of this repo,
are not installed, and are not an alternate runtime — Convex Agent is the sole
orchestration implementation. Do not add a second orchestration or truth
system to reach any of these patterns.

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

One honesty note about the digests, so nobody over-reads them. The registry and
compatibility digests, `normalizedArgsHash`, cursor binding, and opaque-reference
masking use FNV-1a 64 (`computeContentDigest`) — an **identity label, not a
cryptographic commitment, and not a MAC**. SHA-256 (`shared/agentHarness/digest.ts`)
covers program source, validated source, result hashes, claim digests, and
citation bindings. Forgery fails because the program never learns a scope id and
because a reference minted under one scope cannot be unmasked under another, not
because the masking is cryptographically strong. Do not build a new guarantee on
the FNV values.

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
  `standard` class. Store and organization removal deletes agent content —
  including the capability-call ledger, whose rows carry request arguments and
  store-authored labels — and marks grants and citations
  `deleted_by_lifecycle`; runtime-side content goes through the adapter's
  cleanup hook, retried with backoff. Organization-scope removal deletes the
  call ledger directly through its own `by_organizationId_createdAt` index, the
  same as every other table in `deleteAgentHarnessContentWithCtx` — it does not
  cascade into the organization's stores.
  Two tables are honestly outside this today: `agentEvidenceAccessAudit` and
  `agentSpendWindow` are written and asserted payload-free, but nothing expires
  them yet.

---

## 15. The command rail is somewhere else

This is a **read** harness, and that is a boundary, not an omission.

- The model sees exactly five tools: `athena.discover`, `athena.describe`,
  `athena.executeProgram`, `athena.scratch`, `athena.completeRun`. Any other tool
  id is a protocol violation that invokes no handler.
- Manifests support `get` and `list` only. `propose`, `apply`, `execute`,
  `command`, `mutate`, `create`, `update`, and `delete` are rejected at
  generation as `reserved_command_verb` — a *different* code from
  `versioned_extension_required`, precisely so nobody can "version in" a command
  through the read rail. `AGENT_COMMAND_NAMESPACE_RESERVATION` is a frozen
  marker carrying `executable: false`; it reserves the namespace, it does not
  enable it.
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
- [ ] For a new surface: browser-safe presentation adapter plus the drift test
      asserting it against the published profile.
- [ ] Released by publishing, fencing if needed, smoking while the switch is off,
      then one enable — with the disable command ready as the rollback.
- [ ] `bun run --filter '@athena/webapp' test -- convex/agentHarness shared/agentHarness convex/operationAdmission convex/platform src/components/agent`,
      `bun run agent-sdk:check`, `bun run --filter '@athena/webapp' audit:convex`.
