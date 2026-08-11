---
title: "Candidate-Bound Gate Obligations Before Expensive Validation"
date: 2026-08-11
category: architecture-patterns
module: harness
problem_type: architecture_pattern
component: development_workflow
resolution_type: workflow_improvement
severity: high
applies_when:
  - "A public harness gate must enforce prerequisite work before starting an expensive provider"
  - "Agent automation needs stricter admission than interactive human use"
  - "Review evidence must remain valid only for the exact prepared candidate and base"
  - "Multiple gates should share one typed prerequisite model without duplicating workflow policy"
related_components:
  - "candidate-preparation"
  - "review-evidence"
  - "gate-admission"
  - "ci-delegation"
  - "delivery-documentation"
tags:
  - "harness"
  - "gate-obligations"
  - "candidate-evidence"
  - "review-ordering"
  - "agent-workflow"
  - "ci-delegation"
  - "human-waiver"
  - "validation"
delivery_diff_fingerprint: "c67b8608dc1228479537bc9cf719b5865cf9817960253a7676ce14b04ebf3d23"
---

# Candidate-Bound Gate Obligations Before Expensive Validation

## Problem

Skill instructions said to complete code review before Athena's expensive merge-grade validation, but the harness could not enforce the order. An agent could start `pr:athena:validate-provider` without proving that the exact candidate had received a final-green review. A tracked marker would still be forgeable, stale after edits or rebases, portable across worktrees, and unable to distinguish evidence from an intentional human waiver or CI delegation.

## Solution

Model admission as a typed obligation decision over an exact prepared candidate, then put the decision boundary inside the wrapper that owns the expensive effect.

### Stabilize the candidate before evaluating policy

`scripts/harness-candidate.ts` brackets mutable Git inputs with two complete observations. A candidate is accepted only when HEAD, index tree, base tip, merge base, status, and untracked state match. The binding keeps separate identities:

- `treeSha` is the complete clean or staged-index tree being validated.
- `baseTipSha` invalidates evidence when the configured base advances.
- `diffBaseSha` is the merge base used for activation and review scope.
- `worktreeId` comes from Git-private storage and prevents cross-worktree reuse.

`scripts/pr-athena-prepare.ts` owns Bun/dependency checks, generated repair, readiness, candidate capture, and receipt publication. The receipt is written only after the whole sequence succeeds and becomes stale when the tree, base, or preparation fingerprint changes.

### Resolve declared obligations with a pure evaluator

`scripts/harness-gate-registry.ts` declares the initial `athena.pr-validation` gate. `review.green` uses exact-candidate historical evidence from `ce-code-review` or `execute`; `documentation.current` is an always-on live deterministic fact. The registry also owns activation, allowed providers, freshness, exception posture, remediation, public entrypoints, CI policy, and prevented cost class.

`scripts/harness-gate-obligations.ts` resolves immutable inputs without filesystem, prompt, telemetry, or process effects. Every obligation returns one discriminated outcome:

```text
satisfied_live_fact | satisfied_evidence | waived |
delegated | not_applicable | blocked
```

These outcomes are not interchangeable. A waiver is never provider-green evidence, CI delegation is not review success, and non-applicability is not a provider pass.

### Let approved workflows issue evidence only at final green

`scripts/harness-review-evidence.ts` accepts provider-owned manifests only from the approved run roots. A manifest names its run, final pass, worktree, exact candidate, selected and completed reviewers, reviewer artifacts, findings, and mutation sequence. The recorder rejects failed or timed-out reviewers, unresolved or ignored actionable findings, edits after the final pass, path escapes, missing artifacts, and candidate/worktree drift.

After any fix, the provider prepares the resulting candidate and performs another complete review. The recorder independently recaptures the candidate before atomically publishing evidence; dispatch metadata or textual “Ready” output cannot authorize a gate.

`scripts/harness-obligation-records.ts` stores deterministic, immutable records under `git rev-parse --git-path codex/harness-obligations/v1/records`. Publication uses a restrictive temporary file plus atomic create-if-absent. An identical replay converges on the same record, while a conflicting occupant fails closed.

### Apply caller-specific posture at one heavy boundary

`scripts/harness-execution-context.ts` applies this precedence:

```text
repository-authorized CI > recognized agent > interactive human > unknown
```

Recognized agents cannot become human merely because they have a PTY. Interactive humans may deliberately accept a candidate-bound waiver only when universal deterministic facts are green. CI delegation requires the exact GitHub runner, workflow, job, event, gate, obligation, and registry policy; generic `CI`-like values are inert.

`package.json` routes `pr:athena:validate-provider` only to `scripts/harness-gate-admission.ts`. That wrapper verifies preparation, computes activation, evaluates documentation once, discovers records, aggregates every blocker, records a correlated decision, recaptures the candidate, and directly spawns its private heavy command list. There is no shell `check && heavy-command` tail that callers can bypass.

The wrapper publishes a reusable human waiver only after successful unchanged validation. Decision events are worktree-local and correlated to an outer or standalone invocation; `scripts/pr-athena-delivery-run.ts` admits only events for its current invocation into `scripts/harness-delivery-run-ledger.ts`.

## Why This Matters

The enforceable statement is now “this gate's declared obligations resolve for this exact candidate under this caller posture,” not “a marker exists.” Review evidence cannot authorize an edited tree, moved base, or different worktree. Agents receive strict enforcement without imposing the same friction on deliberate interactive human work, and CI cannot claim ownership outside a repository-authorized policy.

The registry and pure evaluator also make the posture reusable. Historical review evidence and live documentation currentness exercise different provider models without gate-specific decision branches. The effectful wrapper remains small enough to own prompts, persistence, telemetry, and the final spawn safely.

## Prevention

- Bind historical records to the complete tree, base ref/tip, merge base, worktree, gate, obligation, schema, and provider identity.
- Keep facts, evidence, waivers, delegation, non-applicability, and blocks as distinct tagged values in records and telemetry.
- Require provider-owned final manifests and a complete re-review after every candidate mutation.
- Keep reusable records Git-private, worktree-local, immutable, deterministic, and atomic.
- Keep policy evaluation pure; prompts, record writes, telemetry, and spawning belong in the admission adapter.
- Make the guarded wrapper the sole owner of private expensive commands and keep the final stable capture adjacent to the first spawn.
- Audit registry references, exact public routing, CI authorization tokens, scenario IDs/sensitivity, generated maps, and validation-fingerprint inputs.
- Test combined failures and assert that blocking cases start zero heavy commands.

## Examples

```text
qualifying agent + no review evidence
  review.green          -> blocked(review_evidence_missing)
  documentation.current -> satisfied_live_fact
  heavy commands        -> not started

interactive human + explicit acknowledgement
  review.green          -> waived
  documentation.current -> satisfied_live_fact
  reusable waiver       -> published only after unchanged provider success

repository-authorized CI
  review.green          -> delegated(athena-pr-tests)
  documentation.current -> still binding

small non-sensitive candidate
  review.green          -> not_applicable
  documentation.current -> satisfied_live_fact
```

## Related

- [Prepare, Validate, and Record Same-Tree Proof](../harness/pr-athena-prepare-validate-proof-2026-06-13.md)
- [Proof-Aware Delivery Run Metrics](../harness/proof-aware-delivery-run-metrics-2026-06-18.md)
- [Repository Validation Rerun Policy](../harness/repo-validation-rerun-policy-2026-05-07.md)
- [CI Duplicate Test Pruning](../harness/ci-duplicate-test-pruning-2026-05-10.md)
- [Static Harness Contract Preflight Before Provider Validation](../workflow-issues/static-harness-contract-preflight-before-provider-validation-2026-07-13.md)
- [Landed Change Report Gate](../harness/landed-change-report-gate-2026-07-09.md)
- Linear delivery chain: V26-1194 through V26-1200
