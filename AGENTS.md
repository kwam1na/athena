# Athena Agent Guide

## Orientation

This is a monorepo with agent docs that are themselves validated by the harness. Route work through them:

- [packages/AGENTS.md](packages/AGENTS.md) — package router plus shared Git/PR rules.
- Per-package: `packages/<pkg>/AGENTS.md`, then `packages/<pkg>/docs/agent/*` — the operational source of truth for that package (`harness:check` fails when these docs go stale).
- For `athena-webapp`: read [docs/agent/architecture.md](packages/athena-webapp/docs/agent/architecture.md) before touching router/auth-shell/Convex boundaries, and [docs/agent/testing.md](packages/athena-webapp/docs/agent/testing.md) to pick the smallest honest validation set.
- Graph-guided navigation: [graphify-out/wiki/index.md](graphify-out/wiki/index.md).

## Repo shape

- Bun workspace, pinned to `bun@1.1.29` via `packageManager`. Use `bun`, not npm/pnpm/node.
- Packages:
  - `packages/athena-webapp` (`@athena/webapp`) — owner/operator app (React + Vite + TanStack Router) **and the entire Convex backend** under its `convex/` dir; public HTTP boundary is Hono composed in `convex/http.ts`.
  - `packages/storefront-webapp` (`@athena/storefront-webapp`) — customer storefront.
  - `packages/valkey-proxy-server` — local Valkey request/response proxy.
- Root `convex/` only holds `_generated/ai/guidelines.md`; the real backend is `packages/athena-webapp/convex`.
- After cloning: `bun install` (also points Git at `.husky/` hooks via the `prepare` script). Re-run it if hooks seem unconfigured.

## Commands

| Task | Command |
| --- | --- |
| Operator app dev server | `bun run --filter '@athena/webapp' dev` |
| Storefront dev server | `bun run --filter '@athena/storefront-webapp' dev` |
| Focused webapp test | from `packages/athena-webapp`: `bun run test -- path/to/file.test.ts -t "test name"` (use package-relative paths) |
| Webapp typecheck | `bun run --filter '@athena/webapp' typecheck` |
| Single Playwright spec | `bun run --filter '@athena/webapp' test:e2e -- src/tests/.../<spec>.ts` (builds the app and serves the production build first) |
| Runtime behavior scenarios | `bun run harness:behavior --list`, then `--scenario <name>` |

Webapp tests are Vitest. Do not run test files with `bun test`; it lacks Vitest globals such as `vi.hoisted` and produces false failures.

## Validation ladder

- While iterating: focused sensors per surface (see `docs/agent/testing.md` escalation lists).
- Merge-ready: `bun run pr:athena` from repo root is the authority. It owns prerequisite ordering, documentation/generated-artifact checks, expensive provider validation, and reusable pre-push proof. At a merge-ready boundary, run `bun run pr:athena` before assembling or running an independent broad validation suite. Never assemble your own broad suite as a substitute final gate.
- `bun run harness:test` after changing anything under `scripts/`.
- Any change under `packages/athena-webapp/convex/`: also run `audit:convex` and `lint:convex:changed` inside that package before handoff.
- Added/removed/re-wrapped a public Convex function or Hono route: `bun scripts/convex-operation-admission-check.ts` must exit 0 with zero findings.
- After modifying code files: `bun run graphify:rebuild`; `graphify:check` blocks PRs when tracked graph artifacts are stale.

## Hooks and gates behave differently than defaults

- Pre-commit repair is fail-closed: hooks regenerate stale docs/graph artifacts, then stop. Review and commit the repaired artifacts instead of fighting the hook.
- Pre-push output is bounded: the terminal shows heartbeats only; the full log path is printed to a retained temp file.
- Substantial behavior-bearing changes are blocked by `compound:check` without a reusable note under `docs/solutions/`. Small edits, test-only, and docs-only changes are exempt.
- Never hand-edit generated files: `src/routeTree.gen.ts`, anything under `convex/_generated`, and the generated `docs/agent/validation-guide.md` / `validation-map.json` (derived from `scripts/harness-app-registry.ts`; update registry metadata and rerun `bun run harness:generate`).
- Refresh Convex generated artifacts with `bunx convex dev --once` from `packages/athena-webapp`. Plain `bunx convex dev` enters watch mode; do not use `bunx convex codegen` (local workspaces may lack `CONVEX_DEPLOYMENT`).

## Architecture facts that change how you write code

- One business action commits everything about itself in **one Convex transaction**. Cross-domain calls are direct `*WithCtx` helper imports inside the caller's transaction — not scheduled jobs. A sale never exists without its stock movement or evidence.
- `convex/inventoryLedger` is the single write path for every stock movement and valuation; nothing else mutates quantity-on-hand.
- Reporting is an append-only fact ledger (`reportFact` + pure `foldDay`), not live queries over domain tables; replay mismatches quarantine rather than overwrite.
- Privileged commands require manager approval proofs consumed in-transaction; a client-supplied staff id is never authorization.
- POS is genuinely local-first (IndexedDB event log under `src/lib/pos`, background sync drain); only in-store sales touch register cash.

## Git & PR

Shared rules live in [packages/AGENTS.md](packages/AGENTS.md). Hard requirements:

- Branches use the `codex/` prefix; start each new task from latest `main`.
- PR titles: `[V26-123]: title`. Body must contain `## Summary`, `## Why`, `## Validation`, and end with a direct Linear link to that ticket.
- Sync with latest `origin/main` before opening or updating a PR, then rerun PR-equivalent checks.
- Include the Linear ticket id in every commit message.
- Never check out `main` itself inside a linked worktree; use `origin/main` only as the base ref for a ticket branch.

## tracking

- project_tracker: linear
- linear_team: yaegars
- linear_team_key: V26
- linear_team_id: 1c947ba4-dd56-4973-b205-3424bfdede61
- linear_project: athena
- linear_project_id: 0a9f3894-fdbb-45dc-b3ff-000af5ba49cc
- linear_project_url: https://linear.app/v26-labs/project/athena-22769268c360

## solutions

Reusable implementation learnings live under docs/solutions/.
Before changing a known bug pattern, search docs/solutions/ for related guidance.

## skills

Athena's agent skills live under `.agents/`: repo-local vendored skills in `.agents/skills/`, alongside members of the generation installed by the `agent-skills` lifecycle under `.agent-skills/`, which are exposed as relative symlinks in `.agents/skills/` and `.claude/skills/`.

Rules:

- Agents working in this repo must use repo-local skills from `.agents/skills/`.
- Do not use global `~/.codex`, plugin-cache, marketplace, or Superpowers skills for Athena workflow behavior when a repo-local skill exists.
- Use `create-linear-ticket` for Linear decomposition and `execute-linear-ticket` for ticket execution, with `deliver-work` as the general workflow entry point. Athena's own delivery rules live in [ticket delivery](#ticket-delivery) below, not in those skills.
- External connectors and platform tools may be used as runtime capabilities, but they are not skill sources for Athena workflow policy.

## ticket delivery

The installed `execute-linear-ticket` skill carries the tracker-neutral workflow. The rules below are Athena's own delivery overlay: they are repository policy, not product behavior. Their step numbers are retained from the retired vendored workflow they were moved out of, so they neither continue nor renumber the installed skill's own steps. Read them before validating, opening the PR, running the review and merge loop, or deploying.

### Delivery contract

- Delivery always includes remote merge and local fast-forward unless the user explicitly opts out, asks to rely on auto-merge, or permissions prevent it.
- For substantial or behavior-bearing work, the delivery PR includes a digestible landed-change report from `$ce-landed-change-report`; do not defer the report to a post-merge follow-up PR.
- After merge, fast-forward the local root checkout to `origin/main`; do not leave the repo on a stale local `main`.
- Before merge, run repo-local `$ce-landed-change-report` for behavior changes, architecture/workflow changes, operator/customer-facing surfaces, cross-layer contracts, coordinated batches, or high-risk refactors. Use the PR URL, candidate head SHA, Linear issue context, and delivered diff as report inputs, follow that skill's subagent requirements, and commit the report to the delivery branch.
- Generate the report after implementation and primary validation have stabilized but before the final review-and-merge loop. Keep pre-merge status language accurate: identify the source as a delivery candidate and do not claim merge, deploy, Linear `Done`, or root alignment before those events happen.
- Satisfy `bun run landed-report:check` before merge with a valid `docs/reports/**/*.html` artifact and current deliverable diff fingerprint. If reviewer-loop edits change the deliverable diff, regenerate the report and rerun its reviewer before merge. Do not generate or refresh the report after merge; any later user-requested correction is separate work, not delivery closeout.
- In Athena, merge or arm auto-merge with `bun run github:pr-merge -- <pr-number-or-url> --method squash --delete-branch` or `bun run github:pr-merge -- <pr-number-or-url> --auto --method squash` instead of raw `gh pr merge`. The helper uses GitHub APIs directly, so it does not try to check out or update local `main` and is safe when `main` is already checked out in the root worktree.
- All PR checks must be green before the PR actually merges. If required checks are still pending after local gates pass, arm auto-merge instead of waiting and manually merging; if a check fails, investigate and fix it.
- `auto_review_and_merge = on` unless the user opts out.
- Prefer Linear MCP operations for status changes, comments, and follow-up issue creation.

### 6. Validate Before Claiming Success

For Athena changes that activate the registered `review.green` obligation, run one independent evidence-bearing review checkpoint before `bun run pr:athena`:

1. Run `bun run pr:athena:prepare`, then capture the exact prepared identity with `bun run harness:review-context`. Preparation runs the mechanical checks (`pr:athena:mechanical` — per-package lint plus project typecheck) and publishes no receipt when they fail, so a deterministic lint or type failure is always discovered before any review is dispatched. Fix it and prepare again; never spend a review on a tree that has not been prepared.
2. Dispatch the complete relevant reviewer set against that exact tree — passing the ticket's delivery contract via `contract:` — and merge their machine-readable results under `/tmp/compound-engineering/execute/<run-id>/`. Do not count implementation subagents as independent reviewers.
3. If a review fix changes the candidate, run `bun run pr:athena:prepare` again and repeat the complete review on the resulting context. A partial follow-up cannot authorize the changed tree. This checkpoint's first dispatch is review round 1 of the delivery and each repeat is the next round; every one counts against the same delivery-wide bound of four rounds declared in the review and merge loop below, and this checkpoint carries no cap of its own.
4. Only after every required reviewer completes with unanimous approval and zero blocking or unresolved in-scope actionable findings, finalize `/tmp/compound-engineering/execute/<run-id>/final-manifest.json` with provider `execute`, the context's worktree/candidate fields, reviewer artifacts, findings and mutation sequence, final pass ID, `verdict: "green"`, zero counts, `editedAfterFinalPass: false`, and `finalized: true`. In-scope means every finding except confirmed deferred-expansion ones: P0/P1 findings are in-scope by definition regardless of scope classification, and a P2/P3 `expansion` finding counts as resolved only when its scope check confirmed the deferral AND a follow-up Linear issue exists — record each in the manifest's `findings` with `disposition: "deferred"` and its `deferredIssueId`. A deferral without a filed issue id is unresolved actionable work; the evidence recorder rejects it and it blocks finalization. Also include the manifest's `reviewLoopTelemetry` block (`iterationCount`, `findingCounts` by severity, `deferredExpansionCount`, `deferredIssueIds`, and `reviewCost` when your agent platform reports what a dispatch consumed) so the same review_iteration/finding-count telemetry posted to Linear also lands repo-side in the obligation record and delivery-run ledger. `reviewCost` carries the platform's own `unit` and `total` plus a `reportedBy` naming that platform — report what it told you, summed across every review round, never an estimate and never converted between units; omit the block when the platform reports nothing.
5. Run `bun run harness:review-evidence -- /tmp/compound-engineering/execute/<run-id>/final-manifest.json`. If review is degraded, times out, exhausts a fix loop, or leaves actionable work, do not finalize or record evidence.

This checkpoint authorizes only the exact pre-validation candidate. Keep the later merge-ready review loop below as a separate post-validation stage.

Order matters, and the harness now enforces the expensive half of it:

- Mechanical before review. `pr:athena:prepare` will not issue a receipt for a tree that fails a deterministic lint rule or the project typecheck, and `harness:review-context` requires that receipt.
- Review evidence binds to the candidate's deliverable identity, not its raw tree. Committing the landed-change report or the solution note after the final pass does not invalidate a recorded review; rerun `bun run pr:athena:prepare` (cheap) and continue. Any other edit — including a comment-only change or a regenerated artifact — does invalidate it and requires a complete re-review.
- Still generate the report and solution note before the final review-and-merge loop. The identity removes the re-review cost of that ordering; it does not license documenting after merge.
- A `candidateRef` resolves to the candidate tree the harness review context records: the `candidate.treeSha` member of the context document `bun run harness:review-context` writes. The reference is opaque — match it by exact text, never by parsing it.

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

- Run `$ce-code-review`, passing the ticket's delivery contract via the review skill's `contract:` argument.
- Treat any of the following as blocking:
  - internal review `decision = CHANGES_REQUESTED`
  - `critical_count > 0`
  - `important_count > 0`
  - unresolved in-scope actionable internal findings (everything except confirmed deferred-expansion findings; P0/P1 are in-scope by definition)
  - a deferred-expansion finding with no filed follow-up Linear issue (deferral without a ticket is unresolved)
  - GitHub review state `CHANGES_REQUESTED`
  - unresolved actionable PR review threads or comments
  - any PR check that failed or was cancelled
- If blocked, fix the issue, rerun the relevant validations, push, rerun `$ce-code-review`, and recheck GitHub feedback plus CI.
- If remote GitHub Actions fails after local validation passed, inspect the failing logs and deduce the concrete root cause instead of guessing from the check name alone.
- Treat remote-only failures as a local parity or harness gap until disproven:
  - if the failure belongs to the current ticket, fix it in the current ticket
  - if the failure exposed missing local guardrails, create a follow-up Linear issue scoped to the missing parity or harness remediation with source evidence from the failing check
  - if both are true, do both
- The follow-up issue should capture the failing remote check, the local validations that passed, the root cause, and the local command, harness mapping, or coverage addition needed so the failure is caught before CI next time.
- Link that follow-up issue from the current Linear ticket and the PR comment trail when it materially affects the handoff.
- Keep looping relevant reviewer subagents until unanimous approval on in-scope work: every selected reviewer must report approval/no blocking in-scope findings, every confirmed deferred-expansion finding must have its follow-up Linear issue filed and linked, GitHub feedback must have no unresolved actionable blockers, and checks must be passing or auto-mergeable. The delivery obtains at most four review rounds in total, counted across the pre-validation checkpoint in step 6 and this post-validation loop; neither stage carries a cap of its own. At the bound with open P0 or P1 findings, stop the delivery as `partial`, record the typed blocker `review.loop-bound-reached` naming those open findings, and let the operator decide; do not obtain another round. Stop earlier when the next fix is not clear, permissions/repo settings block progress, or genuine user input is required.
- When every reviewer is aligned at the bound and a required repair, rebase, or fix would change the candidate, the delivery obtains exactly one grace verification round for that change, at most once per delivery, declared as the grace round when it is obtained; it is an ordinary verification round under the same reviewer set and the same carry-forward rules, and it does not open a further round. Only if that grace round does not align, or a further candidate change is required after it, stop the delivery as `partial` and record `review.loop-bound-reached` naming what is open. The grace round is not available with open P0 or P1 findings at the bound, or where the latest round was blocked by a failed acquisition — a reviewer dispatch that was degraded, timed out, or otherwise returned no usable result.
- File deferred-expansion follow-up issues directly via Linear MCP per the delivery contract above — do not invoke `create-linear-ticket`'s workflow for single deferral follow-ups. The ticket body, however, must follow `create-linear-ticket`'s `references/atomic-ticket-template.md` structure so the deferred ticket is executable by `execute-linear-ticket` and this overlay later without re-derivation. Populate it from the review finding plus `$compound-delivery-kernel`'s ticket-evidence requirements:
  - **Summary**: the finding's `why_it_matters`, plus one line naming the source (review run id, PR, and originating ticket) and why it was deferred (P2/P3 expansion beyond the delivery contract, confirmed by scope check).
  - **Scope**: the concrete change from `suggested_fix` (with any named assumptions carried over); the out-of-scope boundary is the originating ticket's delivered behavior.
  - **Acceptance Criteria / Test Scenarios**: derive from the finding's failure mode and evidence; quote the evidence lines per the kernel's ticket-evidence rules.
  - **Execution Posture / Observability / Expected Sensors / Compounding Opportunity**: fill per the template's own defaults for the work's shape; do not leave them implicit.
  - **Dependencies**: the originating ticket when the deferred work builds on its landed behavior.
  Link the new issue from the originating ticket and the PR. If a review produces a cluster of related expansion findings large enough to need decomposition into multiple tickets, that is the rare case where handing the cluster to `create-linear-ticket` is appropriate.
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

## product copy

For in-product copy work, follow [docs/product-copy-tone.md](docs/product-copy-tone.md).
Keep operator-facing language calm, clear, restrained, and operational, and normalize raw backend wording before it reaches the UI.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read the Convex AI guidelines first** for
important guidance on how to correctly use Convex APIs and patterns. The
canonical file lives at `convex/_generated/ai/guidelines.md`, and Athena also
keeps a package-local mirror at
`packages/athena-webapp/convex/_generated/ai/guidelines.md` for agents working
from inside the webapp package. These files contain rules that override what you
may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
