---
date: 2026-08-24
topic: compiled-starter-intents
---

# Compiled Starter Intents

## Summary

Cut one full provider round (and the model's program-authoring variance) from the most-tapped agent interactions by shipping a curated, kernel-validated program with each starter intent. When an operator taps a starter intent, the host executes the curated program through the real executor before the first provider invocation, and the model's first prompt already carries the result: the model narrates and calls `completeRun` — it never authors the read. Free-form questions are untouched.

## Problem Frame

Measured on the eval drive (2026-08-24): a turn's completion is p50 ~14 s on gpt-5-mini, of which one whole provider round (~5–8 s plus output tokens) exists only to author a program the profile could have written better itself. The four Daily Operations starter intents are fixed questions with known-ideal reads; the model's authored programs for them vary (the readiness question read 3 capabilities before the breadth guidance, 6 after — the curated program reads all relevant areas every time). A curated program also makes the most common interactions deterministic in coverage and cost.

Two designs considered:

1. **Prompt-suggested program** (light): include the curated source in the prompt as a known-good program the model may copy through. No flow change, no egress implications — but saves authoring *errors* only, not the provider round. Measured value is small now that breadth guidance landed.
2. **Host pre-execution** (this proposal): the host runs the curated program as attempt 1 before the first provider invocation, exactly the way the direct-harness smoke already drives the executor without a model. Real attempt, real citations, real budget charges. The first prompt carries the result inside the standard untrusted-data fences plus the attempt/citation refs to cite.

## Requirements (host pre-execution)

- A starter intent MAY carry `program: string` in the presentation adapter; profile conformance validates it with the SAME static program validation the sandbox applies (`validateProgramSource` against the profile's own facade), at definition time, so an invalid curated program fails the push.
- The turn host, when the operator's turn names a starter intent id (a new optional `starterIntentId` on `startTurn`, threaded from the panel's tap — never inferred from prompt text), executes the curated program through the production executor before the provider round. Everything downstream is unchanged: admission, grants, budgets, citations, evidence, retention.
- **Egress boundary**: a program result reaching the provider PROMPT is provider egress, the same as a result reaching a tool response. The pre-executed attempt must pass the same authorization-epoch revalidation and record the same `provider_egress_committed` boundary before prompt assembly includes it, and revocation-before-commit must withhold it identically. This is the security-sensitive piece and the reason this ships as its own plan, not a drive-by.
- The result enters the prompt inside the profile's untrusted-data label fences (it is retrieved store data), with the attempt ref and citation refs listed OUTSIDE the fence as policy ("cite these").
- The model keeps every tool: if the curated read did not answer the operator's follow-through, it can still run its own programs within the same run budget (the curated attempt charges the ledger like any other).
- `budget.remaining()` and attempt counting treat the curated attempt as attempt 1.
- Eval: extend `agent-eval-drive` with one starter-intent scenario per intent, asserting completion latency below the free-form baseline and coverage equal to the curated program's read set.

## Open Questions

- Does the provisional-narrative stream start before or after pre-execution? (Pre-execution adds ~0.5–2 s before the first provider byte; likely acceptable, but `firstDeltaMs` must not regress past the current p90.)
- Should a pre-executed result that comes back all-unavailable skip the injection and fall back to the free-form flow?
- Snapshot semantics: the curated program interpolates the turn's operating date — interpolation must go through the same canonicalization as model-authored args (no template holes beyond the snapshot keys).

## Why not now

Everything else in the refinement list was shippable behind existing seams; this one moves the provider-egress commitment point, which plan decision 15 treats as an irreversible boundary with revocation semantics. It needs its own small plan and review, with this note as the seed.
