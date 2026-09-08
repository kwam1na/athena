---
title: "feat: Replace Athena delivery machinery with the installed delivery product"
type: feat
status: active
date: 2026-09-06
origin: docs/brainstorms/2026-09-06-athena-delivery-product-cutover-requirements.md
---

# Athena delivery product cutover

## Outcome and authority

Athena declares its delivery requirements and repository sensors; the installed product supplies preparation, candidate identity, independent-review evidence, validation admission, freshness, recording, and progression through the authorized finish line. Remove the duplicate Athena implementation after proving the replacement preserves its meaningful blocking cases.

The user approved the scope, requested a worktree and subagents for planning, tracking, and execution, and asked to dogfood the product as much as possible. This plan proceeds into tracked execution after independent review; there is no additional permission checkpoint. Hosts continue to own agents, tools, sessions, worktrees, and credentials. Existing permission failures remain visible blockers rather than grounds to bypass enforcement. On 2026-09-07, the user explicitly confirmed that the known GitHub billing failure should not block sign-off and directed reliance on local checks. For this delivery, use complete local checks and review evidence when hosted jobs cannot start because of billing; actual test failures still require correction.

Execution posture: **characterization-first**. Capture Athena's externally meaningful behavior before replacement, then use test-first additions for gaps in the ordinary installed product. Historical shadow qualification and stronger host-trust work remain separate.

On 2026-09-07, after the preparation unit exhausted its review grace with two open findings, the user resumed the goal with explicit authority to make judgment calls to reach these acceptance criteria. Continue the narrow repair and verification under that operator authority, retaining the prior review rounds, failed grace, and findings. This delivery exception does not change the product's default bound or erase its earlier blocker.

The approved [requirements addendum](../brainstorms/2026-09-06-athena-delivery-product-cutover-requirements.md) is the current requirements source. U1/U5 cover R1–R4 and R10, U2/U3 cover R5–R7 and R9, and U4/U6 cover R8 and R11–R12; each owning unit also tests shared requirements at its boundary.

Baseline inspected on 2026-09-06: Athena main `69d96aa`, agent-delivery-harness main `a33decc`, agent-skills main `0e9d159`. Reconcile these with current upstream before starting each repository's implementation. Existing open work is an input, not completed evidence.

## Acceptance criteria

These six criteria preserve the agreed cutover finish line. Each must have direct evidence; successful intermediate releases do not complete the objective.

| ID | Required outcome | Completion evidence |
| --- | --- | --- |
| AC1 | Athena's existing required outcomes and blocking cases remain covered. | Characterization scenarios pass against the installed product and Athena policy; missing checks, failed mechanics, missing/unresolved review, stale artifacts, invalid waivers, and disallowed merge all block for the expected reason. |
| AC2 | Duplicate candidate, preparation, evidence, review, and accounting implementations are removed. | Final source/caller inventory shows retired implementations absent; entry points, hooks, CI, report consumers, and skills use product contracts. Any surviving wrappers only supply repository policy, sensor results, or command invocation. |
| AC3 | Local admission and CI verify the same candidate and policy. | A real PR and controlled negative fixtures show the same delivery record and policy binding accepted locally and in CI; changed candidate, base, policy, or incompatible release invalidates evidence in both. |
| AC4 | Claude Code and Codex each complete a real delivery through Athena's configured finish line. | Two identifiable host-native runs using the installed release, with real changes, independent review, local/hosted gates, merged PRs, root alignment, and applicable deployment evidence. Simulated host labels or fixture execution do not count. |
| AC5 | Interrupted work can resume from recorded state without inheriting stale evidence. | Terminate a real process mid-delivery, verify terminal process state, resume its recorded run, and prove a source/base/policy change rejects old evidence. An interrupted run must never become a passing record implicitly. |
| AC6 | Installation, update, and rollback work without depending on the product's source checkout. | In a clean consumer environment with product source paths inaccessible, install one compatible release, update it, roll back, verify the active release and both host exposures, and run the product commands successfully. |

## Product and repository decisions

- Ship preparation, validation, independent review, evidence freshness, and merge admission as defaults. Missing required configuration yields an actionable setup blocker.
- Repository policy chooses commands, activation rules, optional artifacts, reviewer additions, and authorized completion. Candidate/evidence integrity remains invariant.
- A deliberate human waiver records author, reason, obligation scope, and candidate. Agents cannot grant waivers. Malformed or mismatched evidence is rejected rather than hidden by a waiver; a waived obligation remains visibly distinct from a passing check.
- Default review requires `lens.outcome-correctness` and `lens.adversarial-testing`, with relevant additions. Delivery defaults to four rounds and the existing limited grace round. Planning review remains unbounded. Deferred actionable expansion requires a tracked follow-up and does not automatically become the next delivery's scope.
- Mechanical checks precede independent review. A deterministic sensor decides whether existing review applies. Remove unconditional duplicate review loops while retaining Athena's required lenses and meaningful review policy.
- Report and learning gates are conditional product capabilities; Athena retains its applicability rules and formats. Product run visibility is included. Missing or partial cost measurements are explicitly labeled; no estimated full-cost claim.
- Default completion is merge-ready. Athena policy authorizes remote merge, local root fast-forward/cleanup, and applicable deployment. GitHub enforces hosted checks; the host executes authorized actions.
- One release operation installs compatible workflow and harness components, and supports update/rollback. No adopter-authored evidence emitter or separate manual stage integration is required.

## Minimal implementation approach

Extend the existing ordinary CLI, evaluator, identity engine, preparation receipts, record verifier, and lifecycle. Do not introduce another state machine, ledger, policy compiler, authority broker, or parallel delivery engine. Use the existing run store for execution observations and the existing evidence/record contracts for admission. Observability events alone never satisfy a gate.

The current kernel already contains `identity.ts`, `candidate.ts`, `preparation.ts`, `evaluator.ts`, `admission.ts`, `records.types.ts`, `delivery-record.ts`, and `context.ts`. The installed CLI's `commands/prepare.ts` currently captures and publishes a receipt without running repository mechanical checks. The harness repository's `scripts/emit-review-evidence.ts` is an adopter-specific gap to move behind a supported product command, not a template every adopter should copy. Reuse `runProviderBackedAdmission` in `commands/gate.ts` for configured argv dispatch. Add product-owned deterministic check result construction and the minimum evidence contract so adopters do not write stdio providers for ordinary commands.

Use one active executable Athena policy configuration. Reconcile or retire `.agents/policy` shadow artifacts rather than leaving a second apparent authority. The current shadow policy grants only merge-ready/PR creation and forbids merge/deploy; it cannot describe the approved Athena finish line. Preserve historical artifacts only as clearly labeled historical evidence without runtime authority.

### Preserve three identity projections

| Projection | Athena policy | Consequence |
| --- | --- | --- |
| Review identity | Exclude `docs/reports/`, `docs/solutions/`, and `telemetry/delivery-runs/`; include generated code, graph artifacts, file modes, and exact paths. | Report/learning/telemetry commits can preserve review; source comments, generated changes, rename/delete/mode changes invalidate it. |
| Report/learning deliverable fingerprint | Existing exclusions also cover generated/graph artifacts and non-deliverable output. | Artifact freshness tracks the implementation described; it cannot authorize review reuse. |
| Validation reuse | Only valid machine telemetry JSON is neutral after the gate. | Reports and learning notes preserve review but still require their applicable validation. |

Implement these through existing product identity primitives and explicit configuration. Do not use the broad report fingerprint as review identity, and do not make all `telemetry/` neutral. Candidate, base, policy, and release compatibility remain explicit evidence bindings. Exact path bytes and modes must survive Git capture.

### Local and CI evidence

Use the product's delivery record and verifier as the transport and evaluation boundary. The record carries the evidence needed for the final candidate and policy; CI verifies it with the installed compatible product. Resolve the actual PR head and base consistently instead of accidentally comparing local HEAD with GitHub's synthetic merge tree. Repository checks may run in separate CI jobs, but skipping a check requires an explicit current result covering that same obligation/candidate, not a flag claiming a parent ran it.

Resume loads the recorded contract, release, candidate, and stage, then checks actual workspace and external state. Revalidate retained evidence before skipping work. If an external action such as PR creation, merge, or deployment returned an uncertain response, reconcile its real outcome through the host's existing tools before invoking it again. Persist observed outcomes in the existing run/record surfaces; do not add an action scheduler or a second recovery ledger.

Current `ATHENA_HARNESS_CI_POLICY` delegation and `--validation-provided-by` shortcuts must not become an alternative route around review. Reuse supported product verification instead of building a second CI evaluator. Missing, stale, malformed, or incomplete evidence must block the hosted merge check.

U2 must extend the existing versioned delivery record with accepted manifests and the bounded artifact bytes their claims require, plus the active policy digest and compatible release identity. Current records contain summaries and manifest digests, which alone cannot support a new CI checkout revalidating reviewer outcomes. Record production captures the portable payload before temporary artifacts disappear. Both local verification and CI feed it through the existing evidence validators with a portable artifact reader; absent, empty, corrupt, or mismatched content blocks. Preserve self-attestation. U5 selects the neutral tracked record location and actual PR-head checkout; it does not implement another verifier.

### Ordinary resume contract

Before U4 packaging, U2 and U3 implement a versioned saved contract, release identity, candidate/policy bindings, stage observations, and external-action reconciliation identifiers in the existing run namespace. The ordinary resume command returns this context and current evidence freshness to the host. Missing or corrupt required context produces a typed blocker; unfinished actions remain unknown until reconciled. The workflow records intent before an authorized external action and its observed result afterward. These records do not grant authority, schedule work, or authorize reuse: existing sensors revalidate evidence, and the native host checks actual workspace and external state before continuing. U6 exercises this shipped contract rather than inventing recovery during field proof.

## Implementation units and ownership

One executor owns each unit's mutation surface; research/review agents remain independent. Workers must preserve other changes. Units are delivery slices, not a mandate for one ticket per file. Existing relevant tickets should be reused or narrowed before creating duplicates.

| Unit | Ownership and deliverable | Dependencies | Proof and dogfood |
| --- | --- | --- | --- |
| U1 — Characterize and map | Athena policy/configuration, characterization fixtures, this plan's retirement inventory; no replacement engine. Capture required behavior and policy deltas explicitly. | None. | Run existing focused root-script tests and equivalent scenario fixtures. Plan/track through installed skills and emit real product run events. Existing engine remains authoritative until cutover. |
| U2 — Complete ordinary gates | Harness `packages/kernel/src/{config,identity,candidate,preparation,evaluator,admission,records.types,delivery-record,context}.ts` as needed; CLI `commands/{prepare,gate,review-context}.ts` and supported review-evidence command/provider wiring. Add only missing product capabilities. | U1 scenarios. | Failed configured mechanical check publishes no receipt; missing provider/config blocks; all identity/waiver/evidence falsifiers pass. Deliver this product change using its current product flow, then exercise the resulting ordinary CLI without local helper emitters. |
| U3 — Align installed workflows | Agent-skills `agent_skills/review_orchestration.py`, relevant workflow skills/graph/contracts/tests, and only necessary host exposure integration. Reuse V26-1541 for the obtain-review Python seam after verifying its current scope/state. | U2 evidence command contract; work on defaults can proceed concurrently if that contract is stable. | Actual independent reviewers use product context/recording; four-round/grace delivery behavior, unbounded planning, tracked deferrals, and deterministic evidence reuse are covered. Avoid rewriting source defaults that already satisfy the requirement. |
| U4 — Package one consumer release | Harness `packages/kernel/src/substrate/{installer,lifecycle}.ts`, CLI lifecycle surfaces, release packaging/tests; agent-skills release packaging only where needed. Replace source-checkout-required adopter installation. | U2 and U3 final compatible artifacts. | Clean consumer install/update/rollback with source checkouts inaccessible; both hosts discover installed skills and executable product. Dogfood the candidate archive before publication. |
| U5 — Cut Athena over atomically | Athena active config, package scripts, `.husky`, `.github/workflows`, local workflow overlay, repository sensor adapters, report/scorecard consumers; delete the retirement closure below. Reuse V26-1544 for Athena freshness consumption after correcting its older generated-artifact-neutral suggestion. | U1–U4; installed candidate release. | Same characterization vectors through actual Athena entry points and CI record verifier. Product owns gates and accounting. Complete one substantive Codex delivery using the installed product; report and learning remain in the delivery PR. |
| U6 — Complete field proof | Two real host delivery records, acceptance evidence, lifecycle/resume verification; remaining product defects within the agreed scope. No new orchestration service. | U5 installed and authoritative. | Finish any missing Claude/Codex delivery, actual interrupt/resume, hosted parity negatives, merge/root alignment/deploy. Recheck all six criteria against final state. |

U2 and U3 may share a coordinated release but retain non-overlapping code ownership. U5 is one atomic Athena transition so hooks and CI do not depend on half of each engine. U6 should use bounded useful follow-up work discovered during the cutover; do not invent a no-op delivery merely to fill a host checkbox. A qualifying U5 delivery counts toward AC4 when it uses the final installed product and fulfills the entire finish line.

V26-1541 and V26-1544 are overlap candidates, not assumed completed dependencies. V26-1486's stronger trust boundary remains separate. Do not pull the historical deferral backlog into this plan unless a finding directly prevents one of the six criteria.

The independently scoped native-review gap in U3 can proceed before U2; later workflow integration consumes U2's final CLI contracts. Current tracked execution is V26-1541 (native acquisition), V26-1842 (mechanical preparation), V26-1843 (shipped review ingestion), V26-1844 (portable evidence), V26-1845 (ordinary resume), V26-1846 (declared checks), and V26-1847 (attributed human exceptions). Their separate mutation surfaces keep work bounded; package a compatible batch rather than releasing each instruction change independently.

The pre-cutover acceptance mapping also requires fresh live-provider observations
in both CLI and hosted verification. A recorded live run identifier is audit
history and cannot satisfy a new invocation. Reuse the existing provider rail
and evaluator for this path. Athena retains its GitHub App, workflow, relay,
environment, passkey, and artifact issuer checks for documentation approvals;
free-form author text cannot replace those checks. Any accepted exception must
remain explicit and bound to the current candidate and complete finding scope.
This is ordinary policy sensor integration, not the deferred managed-trust lane.

For accounting retirement, `runs show <run-id> --json` exports the product's
validated journal and existing summary/readout. Athena persists and presents
that output rather than implementing totals in another ledger. Keep review
and whole-run counters separate and unavailable measurements unreported.
Athena still owns its artifact-directory policy: reject malformed changed
telemetry siblings and required untracked records using product parsers and Git
tracking information.

## Athena retirement closure

| Surface | Required final disposition |
| --- | --- |
| `harness-candidate.ts`, `harness-review-identity.ts` | Remove independent implementations; consume product identity/candidate contracts with Athena projection policy. |
| `pr-athena-prepare.ts` | Remove preparation receipt/wiring engine; retain only a thin alias if needed. Product executes Athena repair/mechanical commands before receipt publication. |
| `harness-review-evidence.ts`, `harness-obligation-records.ts` | Remove local review manifest validation/storage; use product evidence command and store. |
| `harness-gate-obligations.ts`, `harness-gate-registry.ts`, `harness-gate-admission.ts` | Remove generic evaluation/admission/types. Preserve Athena activation thresholds, sensitive scenarios, required lenses/providers, and local sensor definitions in active configuration/adapters. |
| `pre-push-validation-proof.ts`, `pr-athena-delivery-run.ts`, `harness-delivery-run-ledger.ts` | Remove independent proof, sequencing, corroboration, and accounting. Thin familiar commands invoke the product. |
| `delivery-run-telemetry.ts`, `delivery-diff-fingerprint.ts` | Replace generic accounting/fingerprinting with product contracts. Retain only Athena presentation/applicability/format adaptation that still has a real consumer. |
| `pre-push-review.ts`, `.husky/pre-push` | Product admission/reuse replaces orchestration. Preserve honest heartbeat/logging, interruption handling, and repository bootstrap checks where still needed. |
| `harness-review.ts` | Retain validation-map sensor selection. Remove legacy parent-provider proof/skip accounting and feed selected commands/results through product contracts. |
| `harness-scorecard.ts` | Consume product run/record output; retain Athena-specific scorecard metrics. |
| `compound-solution-check.ts`, `landed-change-report-check.ts`, `delivery-documentation-check.ts` | Retain Athena content/templates/activation checks; consume product fingerprints instead of a duplicate identity implementation. |
| `delivery-documentation-admission.ts`, `documentation-waiver-command.ts`, `documentation-waiver-attestation.ts`, waiver workflows | Preserve trusted human approval and exact finding/candidate scope using product waiver contracts; retire duplicate generic candidate/preparation/waiver evaluation. |
| `portable-shadow-observation.ts`, `policy-projection-check.ts`, `.agents/policy` shadow snapshots/oracles | Remove runtime dependency on retired engines. Preserve historical evidence only when useful and explicitly non-authoritative; replace active equivalence tests with the cutover characterization suite. |
| `.github/workflows/athena-pr-tests.yml`, `package.json`, local CE wrappers and AGENTS | One installed product admission path, coherent policy, current command names; remove duplicate review-stage and temp-manifest choreography. |
| Superseded `scripts/*.test.ts` | Port meaningful behavior tests to product/adapter coverage, then remove tests that only assert retired internals. `harness:test` still covers surviving root scripts. |

Keep `harness-app-registry.ts`, validation maps, mechanical selection, contract preflight, architecture/Convex sensors, Graphify/generated repair, and real repository validation. A filename containing “harness” is not by itself evidence that the file belongs in the product.

## Named scenarios and falsifiers

| Scenario | Required assertion |
| --- | --- |
| Mechanical failure | A real configured lint/typecheck failure blocks preparation and review-context; no receipt exists for the failed attempt. Fixing it permits preparation. Mutating source while preparation runs requires recapture and cannot inherit the earlier candidate receipt. |
| Candidate capture | Clean and staged-only candidates work; unstaged/untracked content, unresolved base, and unstable observations produce the appropriate block. |
| Review freshness | Report-only commit preserves review; source-comment, generated/graph, mode, rename/delete, base, and policy changes invalidate affected evidence. Legal newline/backslash/trailing-space paths cannot collide. |
| Evidence integrity | Missing/mismatched reviewer artifacts, unresolved findings, malformed records, incomplete lens coverage, and untracked deferrals block. No copied “green” summary replaces evidence. |
| Human exception | Exact authorized human approval with author/reason/scope/candidate can waive only configured findings; agent invocation, stale candidate, untrusted GitHub issuer, or malformed evidence is rejected. |
| Reuse and accounting | Reusable validation must have a complete matching record; stale/corrupt/revoked record forces validation. Failed/interrupted runs never publish passing proof. Partial cost data stays labeled. |
| Artifact obligations | Athena thresholds/sensitive activation and report/learning formats remain enforced. Telemetry written after gate does not invalidate review but must satisfy its own record check. |
| Hosted parity | Same candidate/base/policy record produces compatible local and hosted admission. Mutate each binding independently; both reject it. Actual failing checks still require correction. Billing-blocked hosted jobs use the user-authorized local-check exception recorded above. |
| Resume | Interrupt a confirmed live process, verify it stopped, then resume recorded contract/release/candidate/stage. Prove unchanged valid evidence can be reused; change a source file before resume and observe stale review rejection. An uncertain external-action response is reconciled before another invocation; only freshly satisfied obligations allow completion. |
| Lifecycle | Source-inaccessible clean install, compatible update, rollback, interrupted-update recovery, and both host exposures work using the existing lifecycle. Old evidence is not reused across incompatible policy/release state. |
| Host field delivery | Actual Claude Code and actual Codex runs complete useful changes through Athena's declared finish line with independent reviewer evidence. Label host provenance and record which installed release each used. |

Existing test sources: `scripts/{harness-candidate,harness-review-identity,pr-athena-prepare,harness-review-evidence,harness-gate-obligations,pr-athena-delivery-run,pre-push-validation-proof,delivery-run-telemetry,documentation-waiver-attestation}.test.ts`. Characterize behavior, not temporary paths, old provider names, or old manifest formatting that the product intentionally replaces.

## Validation and delivery

Each repository follows its current local instructions and smallest relevant tests while implementing. Harness changes use its focused Vitest tests, typecheck, import/CLI inventory sensors, and standalone-install sensor before its required final gate. Agent-skills changes use focused review-orchestration/workflow/provider tests and lifecycle/release tests only for affected surfaces. Inspect those repositories' live instructions before selecting final commands.

Athena root-script changes require focused Bun script tests and `bun run harness:test`. Code changes require `bun run graphify:rebuild`; generated repairs are reviewed before commit. Convex changes, if a real acceptance defect requires them, additionally require package `audit:convex`, `lint:convex:changed`, and admission checks for public boundary changes. No Convex feature work is otherwise in scope.

Before the Athena transition lands, the existing `bun run pr:athena` remains its authoritative merge gate. After transition, the same familiar command may remain but must invoke the installed product and declared Athena sensors. Its replacement must not be a reduced selection invented to make migration pass. Validate the new candidate through the changed gate and verify the shared local/hosted enforcement path before merging, applying the user-authorized billing exception to jobs that cannot start.

Generate applicable solution notes and landed-change reports in the delivery branch after implementation stabilizes and before final review/merge. Independent code/report review follows active repository authority; do not count implementation agents as reviewers. Final record/report/telemetry evidence binds to the final deliverable. Complete tracked review updates before merge. Use passing local checks under the user-authorized billing exception when hosted jobs cannot start; actual failed validation remains blocking. Otherwise require green hosted checks or arm authorized auto-merge and confirm eventual merge. Fast-forward the root and remove merged delivery worktrees when safe, preserving unrelated dirt.

Deploy the narrowest applicable runtime surfaces from the aligned root. Athena reports/solutions compile into its app and therefore require `scripts/deploy-vps.sh athena-local`; a harness-only rationale does not waive that deployment. Record a no-deploy outcome only for a delivery with no applicable runtime change.

## Completion audit and non-goals

The final audit maps AC1–AC6 to exact source revisions, installed release identities, test/negative-case output, host run IDs, PR/check state, merge SHAs, root state, and deploy results. Test names, event emission, fixtures, pending PRs, or intent alone are insufficient. Leave the objective active whenever any criterion is missing or supported only indirectly.

Excluded: hosted orchestration/fleet management; replacing native hosts; the deferred higher-assurance admission/trust lane; backlog-wide cleanup; new general-purpose policy languages; speculative infrastructure; unrelated business features. Concrete defects that prevent the accepted cutover are in scope and should be fixed in the owning unit rather than masked by a compatibility wrapper.
