---
title: "feat: Compiled starter intents — host pre-execution of curated reads"
type: feat
status: active
date: 2026-08-24
origin: docs/brainstorms/2026-08-24-compiled-starter-intents-requirements.md
deepened: 2026-08-24
---

# feat: Compiled starter intents — host pre-execution of curated reads

## Summary

Ship a curated, conformance-validated program with each starter intent, executed by the turn host through the production executor as attempt 1 — after `markTurnRunning`, before the first provider invocation — whenever the operator's tap names that intent. The result reaches the model as a **synthetic tool exchange** (an `executeProgram` call plus its sanitized result, seeded into the runtime transcript through a versioned runtime-input extension), not as prompt text: the prompt stays byte-identical to today, the egress checkpoint stays exactly where `finishAttempt` records it, and the model continues from the shape it is trained to continue from — "I already read this" — so it narrates and commits instead of authoring the read. One full provider round (~5–8 s plus its output tokens) leaves the latency path for the most-tapped interactions; free-form questions are untouched and the model keeps every tool.

---

## Problem Frame

Completion is p50 ~14 s on the current model, of which one whole provider round exists only to author a program the profile could have written better itself; the model's authored coverage for the fixed starter questions varies while a curated program reads the full relevant set every time (see origin: docs/brainstorms/2026-08-24-compiled-starter-intents-requirements.md). The reason this is a plan and not a drive-by: a pre-read result reaching the provider is provider egress with an irreversible `provider_egress_committed` checkpoint (docs/plans/2026-08-21-001-feat-athena-agent-harness-foundation-plan.md, decision 15). This plan keeps that checkpoint where it lives today — inside the executor's attempt finish — and moves only *when* the attempt runs.

**Prerequisite:** the `feat/agent-harness-agency-levers` batch. File paths are repo-root-relative throughout.

---

## Requirements

- R1. A starter intent MAY have a curated program, registered kernel-side and keyed by `(profileId, starterIntentId)`; an intent without one behaves exactly as today. The presentation adapter (and its browser-side duplicate) carry no program source.
- R2. Profile conformance validates every registered program at definition time: each key names a declared starter intent of its profile, and the rendered source (placeholders filled with shape-valid sample values) passes `validateProgramSource` against the profile's full-authority-tier facade. An invalid program fails the push, not the turn.
- R3. A turn opts in ONLY by an explicit `starterIntentId` argument on `startTurn`, stored on the turn's prompt payload; intent is never inferred from prompt text. When the id is present, the server substitutes the pinned intent's canonical prompt as the question. An id the pinned profile does not declare is a **downgrade, not a refusal**: the turn free-forms and the skip is traced with outcome `intent_unknown` (stale panels across a deploy are routine, and the tap already carries usable prompt text).
- R4. The curated source may reference only the profile's snapshot context keys through fixed `{{key}}` placeholders. Rendering is pure and V8-safe, substitutes strictly shape-checked values (an operating date must match the ISO date shape), and **fails closed for any placeholder key absent from the shape table**. The rendered source is then validated at turn time by the executor's own `validateProgramSource` pass — no second kernel-side validation path.
- R5. Pre-execution runs through the production executor with the run's own grant, budgets, admission, citations, evidence, and trace: a real attempt (attempt 1), real capability calls, real charges. It runs in the host slot **after `markTurnRunning`** (dispatch admission requires a `running` run) and before the provider invocation. No parallel read path.
- R6. The egress checkpoint is `finishAttemptWithCtx` — the same revalidate-and-record the tool-response path uses, at the same place, with no second checkpoint. Pre-executed attempts commit `provider_egress_committed` at attempt finish; the finish-to-provider-send gap is wider than the tool path's and is accepted as a truthfulness asymmetry (an exposure record may exist for an injection later abandoned; over-reporting is the safe direction and the abandonment is traced). A revocation or epoch fence observed at finish (`withheld`) is an **authority signal, not an executor failure**: the turn cancels through the host's existing revocation handling, exactly as a mid-turn revocation does today.
- R7. The pre-read reaches the model as a synthetic tool exchange — the normalized `executeProgram` result envelope a real dispatch would return, carried by a versioned runtime-input extension the adapters render natively. The exchange payload is exactly the kernel-sanitized result (opaque refs, sanitized envelope; never raw labels in any policy position); the prompt gains only one policy sentence for starter-intent turns ("this question's read has already run; answer from it and cite its refs, reading again only if it is insufficient"). The exchange payload is byte-capped by a measured injected-exchange budget (NOT `maxPromptBytes`, which governs the operator question); an over-cap result truncates JSON-safe with a marker instructing the model to re-read past the truncation before answering beyond it.
- R8. An executor failure, rejection, unknown id, or `resumed` (already-executed) outcome never fails the turn: the turn proceeds free-form with a `starter_intent_preexec_skipped` trace event carrying the outcome code. A skipped turn's *prompt* is byte-identical to today's; its run state is not (a failed pre-read attempt has consumed attempt headroom and charges — accepted and asserted). An attempt whose reads succeeded but returned absent/unknown data still injects — honest absence is information — and curated programs must return structured objects with explicit absent fields, never bare null (the executor rejects unstructured results).
- R9. The pre-executed attempt counts as attempt 1 for `maxAttempts` and charges the run budget like any other; `athena.budget.remaining()` semantics are unchanged.
- R10. `agent-eval-drive` gains one scenario per shipped starter intent asserting: median completion over N drives at or below the free-form baseline median for the same question; `firstDeltaMs` p90 within the pre-change bound (origin constraint, restored); the committed answer cites the pre-executed attempt; and the re-read detector — attempt count 1 and cited refs drawn from the pre-read — as a soft trend signal. An over-cap/truncation scenario is included.
- R11. The runtime-input extension is a versioned adapter-contract evolution: protocol version bump, contract-fake and Convex Agent adapter parity proven by the shared contract suite, deployed behind the compatibility fence.

---

## Scope Boundaries

- No change to `completeRun`, its transaction, citations, retention, discovery, or the tool catalog; the model's tools are identical on starter-intent turns.
- No prompt-text intent matching, no classifier; selection stays a UI tap.
- No panel redesign: the panel change is sending `starterIntentId` plus the `reading_ahead` milestone copy entry.
- No lifecycle or binding-ladder changes: the pre-execution slot sits inside the existing `running` state.

### Deferred to Follow-Up Work

- Curated programs for free-form question *shapes* (classifier-selected): future iteration, own plan.
- Per-intent freshness policies (skip pre-execution when a seconds-old snapshot exists): future iteration.
- Refunding a failed pre-read's attempt slot: revisit only if eval evidence shows the reduced headroom biting.

---

## Context & Research

Research was performed first-hand in the session that produced this plan, then hardened by a four-persona document review (coherence, feasibility, security-lens, adversarial) whose accepted findings are folded in below; external research skipped — strong local patterns.

### Relevant Code and Patterns

- `packages/athena-webapp/convex/agentHarness/runtimeHost.ts` — `driveTurn` ladder (`prepareTurn` → `ensureThread` → `saveInput` → `markTurnRunning` → provider turn): the pre-execution slot sits between the last two; the host already constructs the production executor (`getProductionProgramExecutor`) per turn, and its existing mid-turn revocation handling is the cancel path R6 reuses.
- `packages/athena-webapp/convex/agentHarness/executorSeams.ts` — `finishAttemptWithCtx` (~620–653): the revalidate-and-record egress checkpoint R6 names; `replayStoredResult` / `resumed` semantics R8 handles.
- `packages/athena-webapp/convex/agentHarness/executor.ts` — `executeProgram` validates the (rendered) source against the run's live facade before `beginAttempt` (the R4 turn-time check), and rejects unstructured results (`program_result_not_structured` — the R8 structured-return rule).
- `packages/athena-webapp/shared/agentHarness/agentRuntime.ts` — `AGENT_RUNTIME_PROTOCOL_VERSION`, `AGENT_PROGRESS_MILESTONES` (closed union — `reading_ahead` is a contract addition), the contract suite pattern from the `narrative_delta` evolution (docs/plans/2026-08-22-001-feat-agent-response-streaming-plan.md, U1).
- `packages/athena-webapp/convex/agentHarness/agentRuntime/convexAgent.ts` + `agentRuntimeFake.ts` + `agentRuntime.contractSuite.ts` — where the runtime-input extension is rendered natively and proven in parity.
- `packages/athena-webapp/convex/agentHarness/turns.ts` — `startTurn` argument validation; the prompt payload (open bounded record) that carries `starterIntentId`; `startTurnOperationDefinition` in `packages/athena-webapp/convex/operationAdmission/domains/agentHarness_definitions.ts`.
- `packages/athena-webapp/shared/agentHarness/profile.ts` — `starterIntents`, `contextBinding.snapshotKeys`; `src/components/operations/dailyOperationsAgentPresentation.ts` and its parity test — the browser-side duplicate whose drift guard is why programs are NOT presentation data.
- `packages/athena-webapp/convex/agentHarness/programRuntime/programValidation.ts` (`"use node"` — reachable from conformance tests and the executor, not from V8 kernel modules).
- `packages/athena-webapp/convex/agentHarness/evals/directHarness.ts`, `releaseConformance.test.ts` — the generated-registry wiring conformance validation follows.
- `packages/athena-webapp/convex/agentHarness/tools.ts` — `completeRun` resolves refs against the run, not against tool-dispatched attempts, so a host-minted attempt's refs are citable with no tool change (verified).
- `packages/athena-webapp/src/components/agent/AthenaAgentPresentationAdapter.ts` — `MILESTONE_COPY` is exhaustive over the milestone union; gains the `reading_ahead` entry.
- `scripts/agent-eval-drive.ts` (repo root) — scenario structure, digest guard, tags for multi-run medians.

### Institutional Learnings

- docs/brainstorms/2026-08-24-compiled-starter-intents-requirements.md — origin.
- docs/solutions/workflow-issues/static-checks-must-resolve-not-pattern-match-2026-08-17.md — validate the rendered source, not the template.
- docs/plans/2026-08-22-001-feat-agent-response-streaming-plan.md — the protocol-evolution playbook (version bump, contract suite, fence) R11 follows.

---

## Key Technical Decisions

- **Transcript-shaped injection over fenced-prompt injection**: the pre-read enters the runtime transcript as a synthetic tool exchange. Three independent review findings converge here: the prompt stays byte-identical (no `promptHash` surgery, no prompt re-assembly mutation), the egress checkpoint stays at `finishAttempt` (no second checkpoint, no seam parameterization), and a tool-result is the representation every provider model is post-trained to continue from — maximizing first-pass commit, which the whole latency bet depends on. Fenced-prompt injection is the rejected alternative (it moved the checkpoint into prompt assembly and fought the standing "read data only through executeProgram" policy).
- **Kernel-side program registry, not presentation data**: the browser duplicates `starterIntents` and a parity test enforces `toEqual` — program source on the presentation contract either breaks the guard or ships read topology to the browser bundle. Programs live in a convex-side registry keyed by `(profileId, starterIntentId)`; the intent's identity stays presentation data.
- **Unknown id is a downgrade**: panel/deployment skew is routine during rollouts and the tap already carries prompt text; refusing would strand operators for the length of every deploy window. The disagreement signal is the `intent_unknown` trace outcome.
- **Revocation at finish cancels; executor failure downgrades**: withheld-at-finish is an authority signal and takes the host's existing cancel path (today's semantics — the host never knowingly proceeds after observing revocation); rejections, failures, unknown ids, and resume-replays downgrade to free-form with the skip trace.
- **The slot is after `markTurnRunning`**: dispatch-purpose reauthorization refuses non-`running` runs, so pre-execution cannot precede the ladder's `running` rung; because injection is transcript-shaped, the already-saved prompt needs no patching and the ladder is untouched.
- **Falsify the behavioral bet before the contract work**: the one untested assumption is that a model handed the exchange commits first-pass. A throwaway dev experiment (hand-seeded synthetic exchange through the contract-fake path against one intent) measures first-pass commit rate before U5/U2 wiring lands; if the model routinely re-reads, stop and revisit the policy sentence rather than shipping the plumbing.

---

## Open Questions

### Resolved During Planning

- All-unavailable pre-read: inject — honest absence is information; curated programs return structured absence (never bare null).
- Facade tier: conformance validates against the full-tier facade; an operator whose narrower grant rejects the curated program at `beginAttempt` free-forms via the R8 skip — accepted and traced, not an error.
- Resume: a re-driven turn whose pre-read attempt already exists receives `resumed` from the executor and skips injection via R8 — no replay seam added in v1.
- `firstDeltaMs`: the origin's "must not regress past the current p90" bound is restored as an explicit R10 assertion (the pre-read adds ~0.5–2 s before the first provider byte; the `reading_ahead` milestone covers the gap).
- One curated attempt per intent in v1.

### Deferred to Implementation

- The injected-exchange byte budget: measure the four intents' result sizes first (the readiness result is the largest; its curated program's `return` is the shaping lever).
- Exact placement of the synthetic exchange in each adapter's native message shape (adapter-internal; proven by the contract suite, not specified here).

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```mermaid
sequenceDiagram
    participant P as Panel
    participant T as turns.startTurn / prepareTurn
    participant H as runtimeHost.driveTurn
    participant X as Executor (attempt 1)
    participant A as Runtime adapter
    participant M as Provider

    P->>T: startTurn(prompt, starterIntentId)
    T->>T: id → prompt payload; canonical prompt substituted
    H->>H: prepareTurn → ensureThread → saveInput → markTurnRunning
    H->>X: executeProgram(rendered curated source) under the run's grant
    Note over X: finishAttempt = the egress checkpoint (unchanged)
    alt result produced (egress committed at finish)
        H->>A: provider turn + preExecutedExchange {call, sanitized result, refs}
        A->>M: native transcript: [... synthetic tool exchange ...] + unchanged prompt
    else withheld at finish (revocation / fence)
        H->>H: cancel via existing revocation path
    else rejected / failed / unknown id / resumed
        H->>H: trace starter_intent_preexec_skipped(outcome)
        H->>A: provider turn (today's flow, prompt byte-identical)
    end
    M-->>P: narrate → completeRun citing the pre-read refs
```

---

## Implementation Units

- U1. **Kernel-side starter-intent program registry, rendering, and conformance**

**Goal:** a convex-side registry keyed by `(profileId, starterIntentId)`; pure V8-safe template rendering with a fail-closed per-key shape table; definition-time conformance; four curated Daily Operations programs returning structured results.

**Requirements:** R1, R2, R4, R8 (structured-return rule)

**Dependencies:** None

**Files:**
- Create: `packages/athena-webapp/shared/agentHarness/starterIntentProgram.ts` (pure render + shape checks), `packages/athena-webapp/convex/agentHarness/profiles/dailyOperationsStarterPrograms.ts`
- Modify: `packages/athena-webapp/convex/agentHarness/profileConformance.test.ts`
- Test: `packages/athena-webapp/shared/agentHarness/starterIntentProgram.test.ts`

**Approach:** rendering is a pure function of (template, snapshot context) with a per-key shape table; conformance wires the generated registry the way `releaseConformance.test.ts` does, checks every program key names a declared intent, and validates the rendered source (shape-valid sample values) against the full-tier facade via `validateProgramSource` (Node test context). The presentation adapter and its browser duplicate are untouched.

**Execution note:** test-first.

**Patterns to follow:** `validateProfileDefinition`'s issue-list style; `releaseConformance.test.ts` registry wiring; `runSmoke`'s program-authoring style for the curated sources.

**Test scenarios:**
- Happy path: a valid template renders with a snapshotted date and passes `validateProgramSource` against the full-tier facade.
- Edge case: a template with no placeholders renders unchanged; an intent without a program is simply absent from the registry.
- Error path: an unknown placeholder, a non-snapshot key, a malformed date value, and a snapshot key with no shape-table entry each fail closed with a named issue.
- Error path: a program key naming an undeclared intent, and a program reading an ungranted namespace, each fail conformance.
- Happy path: each curated program's return shape is a structured object with explicit absent-capable fields (asserted structurally, not value-exact).

**Verification:** conformance fails the push for an invalid registry; all four Daily Operations programs validate.

---

- U5. **Runtime contract evolution: the pre-executed exchange**

**Goal:** a versioned runtime-input extension (`preExecutedExchange`: the normalized call, sanitized result envelope, attempt/citation refs) that the contract fake and the Convex Agent adapter render natively as a synthetic tool exchange, plus the `reading_ahead` milestone in the closed union; protocol version bump; parity proven by the shared contract suite.

**Requirements:** R7, R11

**Dependencies:** None (parallel with U1)

**Files:**
- Modify: `packages/athena-webapp/shared/agentHarness/agentRuntime.ts`, `packages/athena-webapp/shared/agentHarness/agentRuntimeFake.ts`, `packages/athena-webapp/shared/agentHarness/agentRuntime.contractSuite.ts`, `packages/athena-webapp/convex/agentHarness/agentRuntime/convexAgent.ts`
- Test: `packages/athena-webapp/shared/agentHarness/agentRuntime.contract.test.ts`, `packages/athena-webapp/convex/agentHarness/agentRuntime/convexAgent.contract.test.ts`

**Approach:** follow the `narrative_delta` evolution playbook (streaming plan U1): strict validation of the new input, protocol bump, digest movement asserted, both adapters run the same new suite case (exchange precedes the first model step; refs surface identically). No runtime-native types leave the adapter directory.

**Execution note:** test-first. Before wiring U2, run the falsification experiment: hand-seed an exchange through the contract-fake path on dev for one intent and measure first-pass commit rate; stop and revisit the policy sentence if the model routinely re-reads.

**Test scenarios:**
- Happy path: a valid `preExecutedExchange` renders as a tool exchange before the first model step in both adapters (contract-suite parity case).
- Error path: a malformed exchange fails validation; an old-protocol run is refused and fenced (digest movement).
- Edge case: a turn without the input behaves byte-identically to today (both adapters).

**Verification:** shared contract suite green for fake and Convex adapter; `agent-sdk:check` fresh; digest moved.

---

- U2. **Turn flow: id through startTurn, host pre-execution, downgrade/cancel semantics**

**Goal:** `starterIntentId` on `startTurn` (public wrapper, admission definition, `directHarness` driver) stored on the prompt payload with canonical-prompt substitution; host pre-execution in the post-`markTurnRunning` slot through the production executor; `finishAttempt`-committed exchange handed to the adapter; downgrade skips (`intent_unknown`, rejected, failed, `resumed`) with the trace event; withheld-at-finish cancels via the existing revocation path; `reading_ahead` milestone reported; injected-exchange byte budget with the instructive truncation marker.

**Requirements:** R3, R5, R6, R7, R8, R9

**Dependencies:** U1, U5

**Files:**
- Modify: `packages/athena-webapp/convex/agentHarness/turns.ts`, `packages/athena-webapp/convex/agentHarness/runtimeHost.ts`, `packages/athena-webapp/convex/agentHarness/evals/directHarness.ts`, `packages/athena-webapp/convex/operationAdmission/domains/agentHarness_definitions.ts`
- Test: `packages/athena-webapp/convex/agentHarness/turns.test.ts`, `packages/athena-webapp/convex/agentHarness/runtimeHost.test.ts`, `packages/athena-webapp/convex/agentHarness/security.test.ts`

**Approach:** no new seams and no second egress checkpoint — the host calls the same `executeProgram` it already binds, and `finishAttemptWithCtx` does what it does today; the abandonment case (committed at finish, injection never sent) is traced. The one policy sentence for starter-intent turns is added at prompt assembly behind the id's presence (free-form prompts byte-identical).

**Execution note:** test-first; the security scenarios (withheld-at-finish cancels; exchange payload carries only sanitized envelope and opaque refs) land before the injection wiring.

**Test scenarios:**
- Happy path: a starter-intent turn pre-executes, seeds the exchange, and the driven flow commits citing the pre-read refs.
- Error path: unknown `starterIntentId` free-forms with `starter_intent_preexec_skipped(intent_unknown)`; prompt byte-identical to a turn without the id.
- Error path (security): a revocation observed at attempt finish cancels the turn through the existing revocation path — no provider invocation follows.
- Error path: a rejected or failed pre-execution skips with the trace event; the test asserts the intended run-state arithmetic (attempt 1 consumed, prompt unchanged).
- Edge case: a re-driven turn receives `resumed` and skips injection without a second attempt or charge.
- Edge case: an over-budget exchange truncates JSON-safe with the instructive marker inside the payload.
- Integration: budget and attempt accounting show the curated attempt as attempt 1 and a follow-up model program as attempt 2 under the same run budget.

**Verification:** `security.test.ts` covers the cancel and sanitization scenarios; a driven starter-intent turn on dev commits citing the pre-executed attempt; free-form turns byte-identical prompts.

---

- U3. **Panel: submission field and milestone copy**

**Goal:** starter-intent taps send `starterIntentId`; `MILESTONE_COPY` gains the `reading_ahead` entry.

**Requirements:** R3, R7 (operator-visible progress during the pre-read)

**Dependencies:** U2, U5; sequenced against the in-flight detached-panel refactor, which owns these files — lands as a small rebase on whichever ships second.

**Files:**
- Modify: `packages/athena-webapp/src/components/agent/useAthenaAgentRun.ts`, `packages/athena-webapp/src/components/agent/AthenaAgentPresentationAdapter.ts`
- Test: `packages/athena-webapp/src/components/agent/useAthenaAgentRun.test.tsx`, `packages/athena-webapp/src/components/agent/AthenaAgentPresentationAdapter.test.ts`

**Test scenarios:**
- Happy path: tapping a starter intent submits its id; a typed free-form question submits none; the `reading_ahead` milestone renders its copy.

**Verification:** panel suites green (the milestone-copy exhaustiveness typecheck forces the entry).

---

- U4. **Evals and docs**

**Goal:** one drive scenario per shipped starter intent implementing the R10 gates; runbook note for the pre-execution slot, the trace event as the diagnostic, and the eval as the guard.

**Requirements:** R10

**Dependencies:** U2

**Files:**
- Modify: `scripts/agent-eval-drive.ts`, `docs/agent/agent-harness-runtime.md`
- Test: `scripts/agent-eval-drive.test.ts`

**Approach:** latency gates compare medians over N tagged drives (the report methodology), never single samples; the re-read detector (attempt count 1, cited refs from the pre-read) is a soft trend signal; citing the pre-executed attempt is the hard assertion; the truncation case drives an oversized fixture intent.

**Test scenarios:**
- Happy path: the scenario passes when the turn cites the pre-executed attempt and medians hold.
- Error path: the scenario fails when the answer does not cite the pre-read or `firstDeltaMs` p90 regresses past the bound.
- Edge case: the truncation scenario asserts the marker reached the model and the answer acknowledges the bound.

**Verification:** `bun run agent-eval:drive` includes the scenarios and passes against dev.

---

## System-Wide Impact

- **Interaction graph:** panel tap → `startTurn(id → prompt payload)` → ladder to `running` → executor attempt 1 (`finishAttempt` = egress checkpoint) → adapter renders the synthetic exchange → provider round → `completeRun` citing pre-read refs. Skip paths rejoin today's flow at the provider round; withheld-at-finish exits through the existing cancel path.
- **Error propagation:** executor failures downgrade with a trace; authority signals cancel; the only new operator-visible artifact of failure is latency.
- **State lifecycle risks:** the pre-executed attempt is a normal attempt — clamp, retention, replay, and trace semantics unchanged; no new tables; the committed-but-unsent window is traced, accepted, and documented.
- **API surface parity:** both runtime adapters (fake and Convex Agent) prove the exchange in the shared contract suite; the protocol bump rides the compatibility fence.
- **Integration coverage:** the driven-turn eval proves tap-to-committed-answer citing the pre-read — the path unit tests cannot.
- **Unchanged invariants:** `completeRun` remains the only release; citations resolve only against committed evidence; budgets, grants, read ports, capability conformance, the persistence allowlist, the binding ladder, and free-form turns are untouched.

---

## Alternative Approaches Considered

- **Fenced-prompt injection** (the original mechanism): rejected — it moves the egress checkpoint into prompt assembly (a seam change the review showed is either a double-record or a widening), requires re-assembling the prompt and patching the invocation row's `promptHash` after `prepareTurn`, and asks the model to answer from fenced data while the standing policy says "read data only through executeProgram".
- **Prompt-suggested program** (origin design 1): rejected — saves authoring errors, not the provider round, and the round is the measured cost.
- **Kernel-rendered answer (zero provider rounds)**: for a fixed question over a deterministic read, a templated narrative or panel widget would cut ~7–9 s to ~1–2 s with no egress movement at all. Rejected as the *default* because the conversational surface is the product bet — the answer seeds a thread whose follow-ups are free-form, the synthesis ("which lane is each item in") is the model's value, and a widget-shaped answer forks the surface. The binding constraint is conversation continuity; noted so a future latency push can revisit it deliberately.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Egress-boundary regression (the material risk) | The checkpoint does not move — `finishAttemptWithCtx` unchanged; withheld-at-finish cancels; security scenarios land before wiring; fence on deploy |
| The model re-reads anyway, negating the saved round | Falsification experiment before U2 wiring (U5 execution note); the policy sentence is the named lever; the eval's re-read detector trends it |
| Committed-but-unsent exposure records | Accepted truthfulness asymmetry (over-reporting), traced abandonment, documented in the runbook |
| Exchange size pressure on the readiness intent | Measured injected-exchange budget; curated `return` shaping; instructive truncation marker; truncation eval |
| Panel/deploy skew during rollouts | Unknown id downgrades with `intent_unknown` — no operator-facing refusal window |
| Collision with the detached-panel refactor | U3 is one field plus one copy entry; sequencing is a rebase decision |
| Failed pre-read consumes attempt headroom | Accepted for v1 (asserted in U2 tests); refund deferred until evidence shows it biting |

---

## Documentation / Operational Notes

- `docs/agent/agent-harness-runtime.md` gains the pre-execution slot, the `preExecutedExchange` input, the `starter_intent_preexec_skipped` outcomes (`intent_unknown`, `rejected`, `failed`, `resumed`, `abandoned_after_commit`), and the note that the trace is the diagnostic while the U4 eval is the guard (trace capture is env-gated).
- Deploy behind the compatibility fence (protocol bump moves the digest); enablement rides the profile switch.

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-08-24-compiled-starter-intents-requirements.md](../brainstorms/2026-08-24-compiled-starter-intents-requirements.md)
- Related plans: docs/plans/2026-08-21-001-feat-athena-agent-harness-foundation-plan.md (decision 15); docs/plans/2026-08-22-001-feat-agent-response-streaming-plan.md (protocol-evolution playbook)
- Review evidence: four-persona document review, 2026-08-24 (coherence, feasibility, security-lens, adversarial), findings folded into R3–R11 and the decisions above.
- Eval evidence: `agent-eval-drive` runs tagged `postrefine` and `gpt5ab`, 2026-08-24.
