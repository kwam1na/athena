---
date: 2026-09-06
topic: athena-delivery-product-cutover
status: approved
---

# Athena delivery product cutover

## Summary

Make the delivery product the single implementation of Athena's preparation, candidate identity, evidence, review admission, validation reuse, and delivery accounting. Repositories supply commands and policy. Codex and Claude Code retain their sessions, agents, tools, permissions, and worktrees.

The operator approved this scope and authorized isolated worktrees, subagents, planning, tracking, execution, and extensive product dogfooding. This document governs the current cutover; the older managed-delivery requirements and plan remain historical context. Their deferred host-trust machinery is not restored to this acceptance boundary.

## Problem frame

Athena consumes portable workflows and a harness package but still implements its own gate engines. Updating workflow text does not remove that integration burden. The product must perform the shared work, while Athena retains its sensor selection, artifact requirements, and authorized finish line.

## Requirements

- **R1 — Ownership:** The product owns candidate capture, preparation receipts, evidence validation and freshness, obligation evaluation, validation reuse, and authoritative delivery accounting. Athena's duplicate implementations are retired, including their hook, CI, scorecard, and documentation consumers.
- **R2 — Policy:** One active repository configuration chooses commands, applicability, additional reviewers/artifacts, and permitted finish lines. Defaults include mechanical preparation, validation, independent review, evidence freshness, and merge admission. Integrity rules cannot be disabled by configuration.
- **R3 — Preparation:** Mechanical failures prevent preparation and review dispatch. Changes during preparation require recapture; an obsolete receipt never authorizes a new candidate.
- **R4 — Identity:** The product supports explicit policy projections. Athena's review projection excludes reports, solutions, and delivery telemetry but includes generated/graph changes; its artifact projection also excludes generated/graph output. Validation reuse permits only its specifically validated post-gate telemetry changes. Base, policy, and product identity participate wherever reuse depends on them.
- **R5 — Review:** Correctness and adversarial-testing are default lenses; repository-required reviewers extend them. Delivery has four rounds plus its existing constrained grace; planning review is unbounded. The host performs genuine independent dispatch. A deterministic freshness decision permits reuse and removes unconditional duplicate review. Tracked deferrals are not automatically executed.
- **R6 — Evidence:** Local and CI evaluate the same candidate and policy with the same product evaluator. Missing, malformed, copied, stale, or mismatched evidence cannot produce a pass. GitHub remains the authority for hosted merge checks and review feedback.
- **R7 — Exceptions:** Only explicitly authorized human waivers permitted by policy may discharge a waivable requirement. They record author, reason, scope, and candidate; agents cannot grant them. Exceptions remain distinct from passes and cannot hide invalid evidence.
- **R8 — Recovery:** Interrupted work resumes from recorded contract, release, candidate, and stage state. Every reused result is revalidated through existing sensors; journal events alone do not authorize skipping work. Uncertain external action outcomes are reconciled before retry.
- **R9 — Artifacts and visibility:** Conditional reports and learning are supported product obligations, with Athena owning content and applicability. Run status and review cost are visible. Missing executor cost is described as partial coverage; no estimates are represented as measured totals.
- **R10 — Finish line:** The default is merge-ready. Explicit repository authority permits merge, local alignment, and applicable deployment using host-owned tools. Athena's existing full finish line remains required; merge, deployment, and production acceptance are distinct observations.
- **R11 — Lifecycle:** One compatible runtime and workflow release installs, updates, and rolls back using distributed artifacts and retained generations, independently of any product source checkout. Adopters do not author emitters, freshness algorithms, or integration plumbing.
- **R12 — Dogfood:** Use installed product workflows and gates throughout this work wherever available. After cutover, both actual Codex and actual Claude Code must complete an Athena delivery through its configured finish line using the installed candidate release. Synthetic qualification and native subagents are useful evidence but do not substitute for either host delivery.

## Actors and flows

- **A1 Operator:** supplies the outcome, reviews evidence, and grants an exception only when repository policy permits it.
- **A2 Coding host:** runs the workflow, agents, repository commands, and authorized external actions.
- **A3 Repository maintainer:** selects policy and sensors, updates one release, and can roll it back.
- **F1 Delivery:** intake and tracked contract → implementation → mechanical preparation → independent review or verified reuse → validation and artifacts → hosted checks → authorized finish line.
- **F2 Resume:** load recorded work → inspect actual workspace and external state → verify release/policy/candidate and retained evidence → continue only stages whose prerequisites hold.
- **F3 Lifecycle:** verify distributed release → atomically install/update both host exposures and runtime → inspect active identity; rollback restores retained verified bytes.

## Acceptance scenarios

- **AE1:** Failed mechanical command publishes no preparation; a source mutation during preparation cannot inherit the earlier candidate receipt.
- **AE2:** Reports/solutions/telemetry preserve review where policy declares them neutral; source comments, generated code, mode changes, renames, and changed bases receive the correct freshness result. Neutral review changes still run their required validation.
- **AE3:** The same bound evidence bundle passes locally and in CI. Independently changing candidate, base, policy, release, reviewer outcome, or referenced artifact causes rejection.
- **AE4:** Human exception has complete bound attribution and is visibly exceptional. Agent, forged, stale, or malformed exception attempts fail.
- **AE5:** Kill a real delivery during a stage. Resume unchanged work with valid reuse; then change source and prove stale evidence is refused. A recorded action with an uncertain response is reconciled before another invocation.
- **AE6:** With source checkouts unavailable to the installation, install/update/rollback and both fresh host exposures work from the exact distributed release. Complete real Codex and Claude deliveries and retain observed merge, alignment, and applicable deploy evidence.

## Finish line

1. Athena's existing required outcomes and blocking cases are covered.
2. Duplicate candidate, preparation, evidence, review, and accounting implementations are removed.
3. Local and CI use the same candidate and policy.
4. An actual Claude Code delivery and an actual Codex delivery each reach Athena's configured finish line.
5. Interrupted work resumes from recorded state without accepting stale evidence.
6. Install, update, and rollback work independently of the product source checkout.

## Scope boundaries and decisions

Reuse the ordinary gate CLI, evaluator, receipts, records, and existing transactional lifecycle. Do not add a scheduler, hosted orchestration, fleet controls, a new host launcher, or a second ledger. Stronger host-trust registration and protected-operation machinery remain deferred. Existing overlapping work should be reused where its contract matches; historical deferred work is not automatically reopened.

The execution plan must preserve unrelated local work, characterize Athena before deleting its machinery, and switch the repository atomically after product capabilities are available. Legacy gates stay authoritative until that switch passes parity evidence.

## Dependencies and open technical decisions

Coordinate `agent-delivery-harness`, `agent-skills`, and Athena. Resolve the existing native-review instruction gap, select one compatible workflow/runtime release, and use existing lifecycle and evidence-transfer seams. These are implementation decisions under the approved scope, not additional product requirements.
