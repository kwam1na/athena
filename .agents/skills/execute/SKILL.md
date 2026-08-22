---
name: execute
description: Use when work already exists in Linear and the user wants implementation rather than new planning.
---

# Execute

Use this skill to carry an existing Linear issue through implementation, review, merge, and ticket closure. Use `$track` first if the work is not yet ticketed or still needs decomposition.

## Delivery Posture

Apply `$compound-delivery-kernel` throughout execution. Linear owns the work record, the repo owns sensors, and the skills system owns the delivery workflow. Preserve test-driven delivery: behavior changes start with a failing test or characterization capture, not implementation.

## When to Use

- The user asks to work on a specific Linear issue.
- The user asks to continue a backlog or execution plan that is already tracked in Linear.
- The work includes implementation plus ticket hygiene such as status updates, comments, PR links, or follow-up issues.

Do not use this skill when:

- the work needs planning or ticket creation first
- the work is not tracked in Linear yet
- the task is unrelated to a Linear workflow

## Delivery Contract

- Default to completing the ticket autonomously end-to-end.
- Delivery usually means the PR is merged into remote `main`, the local root checkout has fast-forwarded to the merged `origin/main`, and the ticket is already marked `Done` in Linear by merge automation.
- When the user or repo workflow asks to skip waiting on remote checks, delivery can hand off with GitHub auto-merge armed after local merge-level sensors and review gates pass. In that case, leave the ticket in the accurate pre-merge state, report that auto-merge is armed, and only claim merged/local fast-forwarded after the remote merge actually happens.
- When executing a coordinated batch of related tickets, delivery can mean all tickets land through one shared integration PR rather than one PR per ticket.
- Delivery always includes remote merge and local fast-forward unless the user explicitly opts out, asks to rely on auto-merge, or permissions prevent it.
- Delivery also means you leave the local repo tidy, back on `main`, and reflecting the merged remote state.
- For substantial or behavior-bearing work, the delivery PR includes a digestible landed-change report from `$ce-landed-change-report`; do not defer the report to a post-merge follow-up PR.
- Do not stop at "PR open" or "ready for review" unless the user explicitly asked for that narrower handoff.
- Only treat something as a blocker when it genuinely requires user input.
- Document significant scope decisions in Linear as you work.

## Red Flags

- "The PR is open, so this is done."
- "I'll update Linear at the end."
- "The review loop hit `3`, so I should stop even though the next fix is obvious."
- "The checks are probably fine" or "the review comments are minor."
- "`pre-push` passed, so remote CI parity is guaranteed."
- "The sub-agent is taking too long, so I should kill it early."
- "Every harness or repo validation failure needs a manual fix."
- "The final suite passed, so test-first happened."
- "The PR merged, so there is nothing left to teach the system."
- "The PR merged, so the human reader does not need a digestible handoff."
- "I'll merge first and add the landed-change report in a second PR."
- "I noticed something adjacent, so I should silently expand this ticket."
- "A vague improvement idea deserves a proactive ticket."
- "A reviewer asked for it, so it must be in scope for this ticket."
- "That P1 is really out-of-scope work, so I can defer it." (P0/P1 always block; only P2/P3 expansion findings defer.)
- "It's classified expansion, so I can just drop it." (Deferral means a filed follow-up issue, not silence.)

## Shared Context

Apply `references/linear-project-resolution.md` before mutating Linear or choosing the next ticket from a backlog.

Use this resolution order before asking the user for context:

- If a Linear issue ID is present, call `get_issue` first and derive the team/project from the issue.
- If no issue id is present, look for explicit project/team names and validate them with `get_team` and `get_project`.
- If neither source resolves context, inspect the current working directory the skill was invoked from.
- Build candidate project names from the current directory basename, the git repo root basename when it differs, and obvious workspace metadata such as `package.json` names.
- If exactly one confident project match exists, use it automatically and report that it was cwd-derived.
- If the issue exists but has no project, stop and ask instead of silently falling back.
- If the named or derived project does not exist in Linear, stop and surface the mismatch clearly.

## Defaults

- Start each ticket from the latest `origin/main` in a fresh worktree and `codex/` branch.
- Never check out `main` itself inside a linked worktree; use `origin/main` only as the base ref for a ticket branch.
- Include the Linear ticket id in every commit message.
- Prefer Linear MCP operations for status changes, comments, and follow-up issue creation.
- Prefer sub-agents when the work can be split into parallelizable chunks with clear ownership.
- If several tickets share high-conflict generated artifacts, prefer isolated worktrees per ticket plus one later integration branch instead of opening multiple artifact-conflicting PRs early.
- Prefer the repo's PR-equivalent validation command when one exists; do not assume local `pre-push` hooks cover the full remote CI surface.
- Default execution posture is `test-first` for new behavior and bug fixes, `characterization-first` for unclear legacy behavior, and `sensor-only` only for pure docs, generated artifacts, configuration, or mechanical changes with no behavior.
- `auto_review_and_merge = on` unless the user opts out.
- Merge target `main`; merge method `squash`; review loops run relevant reviewer subagents until unanimous approval on in-contract work with no numeric cap. P0/P1 findings always block regardless of scope classification; P2/P3 findings scope-classified `expansion` and confirmed by the review's scope check resolve by follow-up Linear issue, never by silently growing the delivery.
- Pass the ticket's delivery contract (title, scope, acceptance criteria; plus plan requirements when a plan exists) into every review dispatch via the review skill's `contract:` argument so scope classification judges against the actual ticket, not an inferred intent line.
- Merge is the default delivery posture. Do not stop at an open PR when auto-review and merge are on.
- After merge, fast-forward the local root checkout to `origin/main`; do not leave the repo on a stale local `main`.
- Before merge, run repo-local `$ce-landed-change-report` for behavior changes, architecture/workflow changes, operator/customer-facing surfaces, cross-layer contracts, coordinated batches, or high-risk refactors. Use the PR URL, candidate head SHA, Linear issue context, and delivered diff as report inputs, follow that skill's subagent requirements, and commit the report to the delivery branch.
- Generate the report after implementation and primary validation have stabilized but before the final review-and-merge loop. Keep pre-merge status language accurate: identify the source as a delivery candidate and do not claim merge, deploy, Linear `Done`, or root alignment before those events happen.
- Satisfy `bun run landed-report:check` before merge with a valid `docs/reports/**/*.html` artifact and current deliverable diff fingerprint. If reviewer-loop edits change the deliverable diff, regenerate the report and rerun its reviewer before merge. Do not generate or refresh the report after merge; any later user-requested correction is separate work, not delivery closeout.
- In Athena, merge or arm auto-merge with `bun run github:pr-merge -- <pr-number-or-url> --method squash --delete-branch` or `bun run github:pr-merge -- <pr-number-or-url> --auto --method squash` instead of raw `gh pr merge`. The helper uses GitHub APIs directly, so it does not try to check out or update local `main` and is safe when `main` is already checked out in the root worktree.
- Human approval is not required unless the user explicitly asks for it.
- All PR checks must be green before the PR actually merges. If required checks are still pending after local gates pass, arm auto-merge instead of waiting and manually merging; if a check fails, investigate and fix it.

## Workflow

### 1. Pick Up The Issue

- Read the Linear issue first.
- Capture title, scope, acceptance criteria, test scenarios, and any relevant labels, milestone, or parent links.
- Capture execution posture, expected repo sensors, and compounding opportunity when present; infer them from the ticket and repo context when absent.
- Move the issue to `In Progress` when work begins.
- If the user asked to continue through a backlog, choose the next ticket by explicit dependencies first, then implementation leverage.

### 2. Prepare An Isolated Workspace

- Create a fresh worktree from the latest `origin/main`.
- Use a `codex/` branch name that includes the ticket id.
- Treat any attempt to create a worktree on `main` or another protected long-lived branch as a setup error and fix it before editing.
- Respect repo rules in `AGENTS.md` and related docs before coding.
- If the overall batch is expected to land through one integration PR, still keep each ticket's implementation isolated in its own worktree or branch so the final integration step is deliberate.

### 3. Reproduce And Understand Before Editing

- Reproduce the failure, warning, or missing behavior before editing code.
- Read the exact files implicated by the ticket.
- If the ticket touches UI or other user-facing surfaces, invoke `$designing-frontends` before shaping the UI implementation.
- Also invoke `$frontend-skill` before shaping the UI implementation.
- Prefer the smallest accurate root-cause statement you can defend.
- Discover the closest existing tests or characterization fixtures before editing behavior.

### 4. Implement With Scope Discipline

- For `test-first` work, write or update the failing test first, run it, and confirm the failure proves the intended behavior before implementation.
- For `characterization-first` work, capture current behavior with a test or fixture before changing it, then add the intended-behavior test when the desired outcome is clear.
- For `sensor-only` work, identify the sensor that proves the mechanical change and record why no behavior test is appropriate.
- Keep changes aligned to the ticket's outcome. Avoid bundling unrelated cleanup just because you are nearby.
- Make reasonable scope decisions without pausing the user unless the consequences materially change the intended outcome.
- When a non-obvious call matters, record what you decided, why, and what you intentionally left out.
- If new work is discovered but should not expand the current ticket, apply `$compound-delivery-kernel` proactive-ticket rules: create a follow-up issue only when the work is concrete, scoped, evidence-backed, and separate from current acceptance criteria; link it in Linear and the PR/handoff.
- When sub-agents are feasible, give them narrow scope and disjoint ownership so work can proceed in parallel safely.
- Do not interrupt, close, or give up on a sub-agent just because it is taking time; let it use its allotted time unless the task is blocked, mis-scoped, conflicting with higher-priority work, or you need to redirect it with better context.

### 5. Keep Linear Current

- Add comments when there is meaningful progress, when the PR opens, and when the ticket state changes.
- Move the issue to `In Review` once implementation is complete, the PR is open, and the ticket is primarily waiting on review or merge.
- For coordinated batches, comment on each issue when its branch is ready for integration, then link the final shared PR on every ticket once opened.
- Include these fields when relevant:
  - branch name
  - current commit or HEAD
  - execution posture
  - validation run
  - major scope decisions
  - compounding decision or pending learning
- When auto-review or merge is active, also include:
  - `review_iteration`
  - `internal_review_decision`
  - `critical_count`
  - `important_count`
  - `github_feedback_blockers`
  - `all_pr_checks_green`
  - `merge_status`
  - `merge_commit_sha` when merged

### 6. Validate Before Claiming Success

For Athena changes that activate the registered `review.green` obligation, run one independent evidence-bearing review checkpoint before `bun run pr:athena`:

1. Run `bun run pr:athena:prepare`, then capture the exact prepared identity with `bun run harness:review-context`. Preparation runs the mechanical checks (`pr:athena:mechanical` — per-package lint plus project typecheck) and publishes no receipt when they fail, so a deterministic lint or type failure is always discovered before any review is dispatched. Fix it and prepare again; never spend a review on a tree that has not been prepared.
2. Dispatch the complete relevant reviewer set against that exact tree — passing the ticket's delivery contract via `contract:` — and merge their machine-readable results under `/tmp/compound-engineering/execute/<run-id>/`. Do not count implementation subagents as independent reviewers.
3. If a review fix changes the candidate, run `bun run pr:athena:prepare` again and repeat the complete review on the resulting context. A partial follow-up cannot authorize the changed tree.
4. Only after every required reviewer completes with unanimous approval and zero blocking or unresolved in-scope actionable findings, finalize `/tmp/compound-engineering/execute/<run-id>/final-manifest.json` with provider `execute`, the context's worktree/candidate fields, reviewer artifacts, findings and mutation sequence, final pass ID, `verdict: "green"`, zero counts, `editedAfterFinalPass: false`, and `finalized: true`. In-scope means every finding except confirmed deferred-expansion ones: P0/P1 findings are in-scope by definition regardless of scope classification, and a P2/P3 `expansion` finding counts as resolved only when its scope check confirmed the deferral AND a follow-up Linear issue exists — record each in the manifest's `findings` with `disposition: "deferred"` and its `deferredIssueId`. A deferral without a filed issue id is unresolved actionable work; the evidence recorder rejects it and it blocks finalization. Also include the manifest's `reviewLoopTelemetry` block (`iterationCount`, `findingCounts` by severity, `deferredExpansionCount`, `deferredIssueIds`, and `reviewCost` when your agent platform reports what a dispatch consumed) so the same review_iteration/finding-count telemetry posted to Linear also lands repo-side in the obligation record and delivery-run ledger. `reviewCost` carries the platform's own `unit` and `total` plus a `reportedBy` naming that platform — report what it told you, summed across every review round, never an estimate and never converted between units; omit the block when the platform reports nothing.
5. Run `bun run harness:review-evidence -- /tmp/compound-engineering/execute/<run-id>/final-manifest.json`. If review is degraded, times out, exhausts a fix loop, or leaves actionable work, do not finalize or record evidence.

This checkpoint authorizes only the exact pre-validation candidate. Keep the later merge-ready review loop below as a separate post-validation stage.

Order matters, and the harness now enforces the expensive half of it:

- Mechanical before review. `pr:athena:prepare` will not issue a receipt for a tree that fails a deterministic lint rule or the project typecheck, and `harness:review-context` requires that receipt.
- Review evidence binds to the candidate's deliverable identity, not its raw tree. Committing the landed-change report or the solution note after the final pass does not invalidate a recorded review; rerun `bun run pr:athena:prepare` (cheap) and continue. Any other edit — including a comment-only change or a regenerated artifact — does invalidate it and requires a complete re-review.
- Still generate the report and solution note before the final review-and-merge loop. The identity removes the re-review cost of that ordering; it does not license documenting after merge.

- Run the smallest targeted test first, then the relevant suite, typecheck, build, lint, repo preflight, and `git diff --check`.
- After reviewer-requested fixes, rerun the focused tests that prove the fixed surface before spending the full merge gate.
- For Athena, run the full `bun run pr:athena` gate when the branch is merge-ready, after syncing or rebasing on a changed base, when `pre-push:review` reports a stale or missing proof, or when the change touches validation wiring such as Git hooks, repo harness scripts, generated-artifact repair, Graphify checks, or PR validation commands.
- Match validation to the ticket's expected sensors and supplement with discovered repo sensors when the ticket is incomplete.
- If the repo defines a PR-equivalent command, run that before trusting local parity with remote CI.
- If the repo has generated-artifact repair hooks, run them before the final commit and inspect the diff. For Athena, `bun run pre-commit:generated-artifacts` refreshes harness docs, Convex generated API files, graphify artifacts, and tracked generated changes so new Convex modules do not leave `_generated/api.d.ts` drift for a follow-up PR.
- When harness or repo validation fails, first classify it as deterministic repairable drift or a semantic blocker.
- For Athena harness failures, treat `scripts/harness-blockers.ts` as the operator contract: identify the blocker by its stable code and typed source, then follow its typed remediations. Run `command` and `retry` argument arrays as rendered; perform `manual_action` and `code_change` guidance deliberately. Do not infer a shell command from explanatory prose.
- When you add or change a harness command, register it in `scripts/harness-blocker-inventory.ts` and run `bun run harness:test`. That sensor is the enforcement half of the contract; its allowlist is a migration boundary, not permission for a new unstructured blocker.
- Treat every remediation as guidance, not authorization. A `command` remediation says what would unblock the gate; the repo's bounded self-repair policy still decides whether you may run it without a human.
- Resolve aggregated blockers as a set. Shared remediation ids are intentionally rendered once even when several owning sources require the same repair; rerun the authoritative failed command after completing the deduplicated guidance.
- A `harness_internal_error` blocker is diagnostic rather than self-repair authority. Inspect the retained log, use the named reproduction command, and investigate the cause before retrying. Do not weaken the gate or convert sanitized exception details into a command.
- If the repo already defines a canonical repair command for deterministic drift, run that repair once, rerun the blocked validation once, and continue only if the rerun passes.
- Do not invent self-corrections for semantic failures; investigate those normally.
- If bounded self-repair refreshed tracked artifacts, review and commit those repaired files before pushing again.
- If a validation step hangs or is blocked, say exactly what happened and whether it appears related to your change.

### 7. Open Or Update The PR Correctly

- sync the branch with the latest `origin/main`
- rerun the relevant validation checks after syncing
- do not open or update the PR until the required local validations pass
- when `auto_review_and_merge = on`, open or keep the PR as draft during review or fix loops
- if multiple tickets were intentionally batched because of shared generated artifacts, open a single integration PR from a branch that contains the combined work plus one fresh regeneration of the shared artifacts

PR conventions:

- title format: `[<TICKET-ID>]: Title`
- body must contain:
  - `## Summary`
  - `## Why`
  - `## Validation`
- include the Linear ticket link at the end of the PR body

For coordinated integration PRs:

- use a combined title that includes all ticket ids or a clear batch label
- list every included ticket in the PR body
- make clear that the shared PR exists to avoid repeated merge conflicts in generated artifacts while preserving ticket-level scope in Linear

After opening the PR:

- push the branch
- add the PR link to the Linear ticket
- if it is a coordinated integration PR, add the same PR link to every included ticket
- note final validation status and major scope decisions in Linear
- decide whether the landed-change report applies using the delivery contract above
- when it applies, generate and review the report with the PR URL and candidate head, commit it to this same delivery branch, rerun `bun run landed-report:check`, and push it before entering the final review-and-merge loop

### 8. Complete Delivery Artifacts + Compound The Learning

- Before the final review-and-merge loop, decide whether the work taught the system something reusable.
- Use the repo-local `$ce-compound` skill when the repo has a `docs/solutions/` knowledge base and the learning is repo-specific. In Athena, do not hand-roll solution-note structure; the repo-local `ce-compound` template is the authoring contract enforced by `compound:check`.
- Update a skill when the learning changes how agents should deliver work across repos.
- Treat a `$ce-landed-change-report` as delivery handoff for human comprehension, not as a replacement for durable solution notes or skill updates.
- Create a follow-up Linear issue when the learning is a concrete missing repo sensor, missing validation map coverage, missing reviewer, or tooling gap that should be implemented later; include the source evidence and why it is separate from the current task.
- Record `No durable learning` only when the change is local, obvious, and unlikely to recur.
- When the landed-change report applies, finish its required subagent evidence and report-review loop now, commit the approved report to the delivery branch, and keep its diff fingerprint current through later review edits.
- Close completed subagents and clean up any worker-only worktrees before the final merge. Keep only the delivery worktree and branch needed by the open PR.

### 9. Run The Review + Merge Loop

- Run `$requesting-code-review`, passing the ticket's delivery contract via the review skill's `contract:` argument.
- Treat any of the following as blocking:
  - internal review `decision = CHANGES_REQUESTED`
  - `critical_count > 0`
  - `important_count > 0`
  - unresolved in-scope actionable internal findings (everything except confirmed deferred-expansion findings; P0/P1 are in-scope by definition)
  - a deferred-expansion finding with no filed follow-up Linear issue (deferral without a ticket is unresolved)
  - GitHub review state `CHANGES_REQUESTED`
  - unresolved actionable PR review threads or comments
  - any PR check that failed or was cancelled
- If blocked, fix the issue, rerun the relevant validations, push, rerun `$requesting-code-review`, and recheck GitHub feedback plus CI.
- If remote GitHub Actions fails after local validation passed, inspect the failing logs and deduce the concrete root cause instead of guessing from the check name alone.
- Treat remote-only failures as a local parity or harness gap until disproven:
  - if the failure belongs to the current ticket, fix it in the current ticket
  - if the failure exposed missing local guardrails, create a follow-up Linear issue scoped to the missing parity or harness remediation with source evidence from the failing check
  - if both are true, do both
- The follow-up issue should capture the failing remote check, the local validations that passed, the root cause, and the local command, harness mapping, or coverage addition needed so the failure is caught before CI next time.
- Link that follow-up issue from the current Linear ticket and the PR comment trail when it materially affects the handoff.
- Keep looping relevant reviewer subagents until unanimous approval on in-scope work: every selected reviewer must report approval/no blocking in-scope findings, every confirmed deferred-expansion finding must have its follow-up Linear issue filed and linked, GitHub feedback must have no unresolved actionable blockers, and checks must be passing or auto-mergeable. There is no numeric iteration cap; stop only when the next fix is not clear, permissions/repo settings block progress, or genuine user input is required.
- File deferred-expansion follow-up issues directly via Linear MCP per the Defaults — do not invoke `$track`'s workflow for single deferral follow-ups. The ticket body, however, must follow `$track`'s `references/atomic-ticket-template.md` structure so the deferred ticket is executable by this skill later without re-derivation. Populate it from the review finding plus `$compound-delivery-kernel`'s ticket-evidence requirements:
  - **Summary**: the finding's `why_it_matters`, plus one line naming the source (review run id, PR, and originating ticket) and why it was deferred (P2/P3 expansion beyond the delivery contract, confirmed by scope check).
  - **Scope**: the concrete change from `suggested_fix` (with any named assumptions carried over); the out-of-scope boundary is the originating ticket's delivered behavior.
  - **Acceptance Criteria / Test Scenarios**: derive from the finding's failure mode and evidence; quote the evidence lines per the kernel's ticket-evidence rules.
  - **Execution Posture / Observability / Expected Sensors / Compounding Opportunity**: fill per the template's own defaults for the work's shape; do not leave them implicit.
  - **Dependencies**: the originating ticket when the deferred work builds on its landed behavior.
  Link the new issue from the originating ticket and the PR. If a review produces a cluster of related expansion findings large enough to need decomposition into multiple tickets, that is the rare case where handing the cluster to `$track` is appropriate.
- Reviewer churn control: a finding first raised in a later round against code that was already present and approved in an earlier round is not automatically blocking — adjudicate its scope and severity like any other finding before treating it as a blocker. The strict P0/P1 rule still applies; churn control never waves through a real defect. This dampens the ratchet where each fix round invites fresh scope on already-approved code.
- If a review-loop edit changes the deliverable diff, refresh the solution/report fingerprints, rerun the report reviewer when applicable, and keep those artifacts in this same PR.
- After the final `bun run pr:athena` passes, run `bun run delivery:telemetry-record` and commit the resulting `telemetry/delivery-runs/*.json` to this delivery branch, so the run's outcome, duration, review-loop iterations, and review cost survive past this worktree. This is enforced by the `telemetry.recorded` gate obligation (once a passing gate run has completed against the current deliverable) and by the CI telemetry check — a substantial delivery with no current record does not merge. It is demanded only at or above 150 changed source lines, the same threshold `compound:check` uses, and a record describing an older deliverable diff counts as stale: if review-loop edits change the deliverable after you recorded, re-run the gate and re-record. Agents cannot waive it; only an interactive human can. Record after the gate, never mid-run — the gate proves the tree it validated, and a mid-run write invalidates that proof. `telemetry/delivery-runs/` is review-neutral and fingerprint-neutral, so committing the record needs only a cheap `bun run pr:athena:prepare`, not a re-review or a report regeneration.
- After the review loop is unanimously green and the candidate head, telemetry, report, and compounding artifacts are final, post or refresh the merge-ready Linear comment with the PR URL, candidate head SHA, final telemetry, validation evidence, report path or skip reason, and compounding decision. Keep the ticket in the accurate pre-merge state so merge automation can move it to `Done`.
- When local gates and review gates pass, mark the PR ready if needed and arm auto-merge with `bun run github:pr-merge -- <pr-number-or-url> --auto --method squash` unless the user explicitly asked you to wait through merge completion or repo settings reject auto-merge.
- If auto-merge cannot be armed and all PR checks are already green, squash-merge into `main` with `bun run github:pr-merge -- <pr-number-or-url> --method squash --delete-branch`.
- Treat the merge as incomplete until the remote merge is confirmed and the local root checkout fast-forwards to the merged `origin/main`.

### 10. Post-Merge: Align Root + Run Non-Deferred Production Deploys

- Once the remote merge is confirmed, post-merge work is limited to aligning and cleaning the local root checkout and running the selected production deploys, except for either action the user or repo workflow explicitly deferred.
- Fetch `origin`, fast-forward the root checkout's `main` branch to the exact merged `origin/main`, verify it is clean, then remove the merged delivery worktree and local branch as part of local alignment cleanup.
- Inspect the merged diff and run the narrowest applicable local production deploy commands from the clean root checkout. If no deployable runtime surface changed, record that explicit no-deploy result. If deployment was deferred by the user or repo workflow, name the deferral accurately.
- In Athena, treat changes under `docs/solutions/**` or `docs/reports/**` as Athena webapp runtime changes because the in-app docs workspace compiles that corpus into its Vite bundle. Deploy those changes with `scripts/deploy-vps.sh athena-local`; do not classify a delivery as no-deploy merely because its other changes are harness-only.
- Do not generate or refresh landed-change reports, solution notes, skills, PR descriptions, or Linear closeout comments after merge. Those artifacts and decisions belong in the delivery PR before merge.
- Include the merged PR, merge SHA, report path or skip reason, validation/review result, Linear state, root alignment, deploy result or deferral, and compounding decision in the final handoff.
- If repeated blockers remain and the next fix is not clear, leave the task in the most accurate state and hand off the exact blocker.
- If merge permissions or repo settings prevent merge, leave the ticket in `In Review` and document the exact blocker.
- If `auto_review_and_merge = off`, stop at review-ready state and say it is awaiting manual review or merge.
