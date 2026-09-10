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

Install a verified release artifact with `bun run agent-skills:install -- --archive <archive.zip> --metadata <release.json> --maintenance`. The installed product owns verification, generation changes, host exposure, update, and rollback; no producer checkout is required. Run `bun run delivery:status` and `bun run policy:check` to confirm the selected generation and compiled Athena policy are current. Treat `.agent-skills/` as generated release payload, and review its integrity and claimed behavior rather than its generated code style.

Athena's commands delegate to the installed product through `scripts/delivery-product.ts`. For structured run events, invoke `bun scripts/delivery-product.ts emit <kind> --json '<payload>'` directly so Bun's package-script shell does not reinterpret JSON. The product owns run allocation, the worktree's current-run pointer, accepted context, resume, and event validation. Use `--run <id>` to select an existing run. Never manufacture a run export or infer completion from a label. The two mandated lens ids are `lens.outcome-correctness` and `lens.adversarial-testing`; Athena also requires the applicable local reviewers described below.

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

For Athena changes that activate the registered `review.green` obligation, establish current independent review evidence before `bun run pr:athena`: obtain a complete review or retain the installed product's deterministic proof that the existing review is reusable for the prepared candidate.

The installed product owns review contexts, outcome validation, evidence emission, candidate binding, freshness, and storage. Under the approved cutover requirements R4/R5 and AE2, its configured review projection governs whether review must be obtained. Keep the reviewers' actual reports, originating closures and deferrals, full round history, and product freshness decision as evidence; do not author a second Athena evidence manifest, infer reuse from journal events, or recreate the product's accounting.

1. Run `bun run pr:athena:prepare`, then capture the exact prepared identity with `bun run harness:review-context`. Preparation runs the mechanical checks (`pr:athena:mechanical` — per-package lint plus project typecheck) and publishes no receipt when they fail, so a deterministic lint or type failure is always discovered before any review is dispatched. Fix it and prepare again; never spend a review on a tree that has not been prepared.
2. `delivery:resume` requires the current delivery run to have a saved accepted contract and stage. Preserve any existing context for the freshness check; do not overwrite it first. If `resume_context_missing` reports no saved context, it emits no JSON: recover the accepted contract, ensure the intended delivery run is current, save it with `bun scripts/delivery-product.ts save-context --json '<context-json>'`, then retry. The payload has only `contract` (`objective`, `acceptanceCriteria`, `finishLine`) and `stage`; use the actual accepted values, as shown in the [harness guide](docs/harness.md). Empty output or a nonzero exit is never positive proof by itself. Run `bun run delivery:resume` and inspect `admission.decision.resolutions`. A resolution with `obligationId: "review.green"` and `kind: "satisfied_evidence"` is the product's positive proof of current review evidence; retain its record and candidate binding. Only `satisfied_evidence` is positive review-reuse proof. A current product `not_applicable` resolution means `review.green` is inactive for this candidate and requires no acquisition; it is not evidence reuse. For an active review obligation, every other or missing resolution, including `waived`, requires complete acquisition. Overall `reuseAllowed` and exit status describe the whole resumed delivery: other admission or recovery blockers remain blocking for their own stages and do not by themselves require another review. Reuse is permitted only when the product accepts its freshness and coverage of every currently selected lens, with unanimous approval and no undischarged actionable findings or tracking obligations. New actionable review feedback requires a complete review even if the projection is unchanged. If reuse is accepted and no such feedback is open, retain that proof and continue to validation without another acquisition or emission. For an active review obligation, if reuse is not accepted or actionable feedback remains, dispatch the complete relevant reviewer set against that exact tree — passing the ticket's delivery contract via `contract:` — and merge their machine-readable results under the review run root. Do not count implementation subagents as independent reviewers. The relevant reviewer set beyond the two mandated lenses is whatever `.agents/review-selection.json` names, which is the whole additional roster `harness.config.ts` activates; dispatching a reviewer the file does not name cannot produce review evidence. An ordinary Athena delivery lists there the always-on layer `ce-code-review` declares — the personas `ce-correctness-reviewer`, `ce-testing-reviewer`, `ce-maintainability-reviewer`, and `ce-project-standards-reviewer`, plus the always-on agents `ce-agent-native-reviewer` and `ce-learnings-researcher` — extended by every cross-cutting, stack-specific, and CE conditional reviewer whose declared selection condition the candidate's diff meets. Review `.agent-skills/**` as generated release payload rather than authored code: check that the payload is internally consistent and that it supports the claims this overlay makes about it, and do not raise style, structure, or refactoring findings against it.
3. If a review fix changes the candidate, run `bun run pr:athena:prepare` again and obtain the product's freshness decision for the resulting context. Missing or stale evidence, or new actionable review feedback, requires a complete review; a partial follow-up cannot authorize it. Preserve every prior round and each originating lens's closure and deferral evidence. Every actual acquisition advances the same delivery-wide round history across steps 6 and 9. Reuse adds no acquired round. The installed `review-work` and `execute-work` workflows own the original bound, constrained grace eligibility, and terminal blockers; neither checkpoint resets or inflates that bound.
4. When review is acquired, use the installed `obtain-review` and `review-work` workflows to acquire and reduce the actual reviewer results. The native host coordinates those workflows and their declared bound and constrained grace; the installed Python/provider reducer is a separate executable implementation whose supported capabilities must be verified against the installed release. Athena does not call the legacy product `reduce-review` lane: that lane lets three changes-requested rounds return to remediation and persists the fourth before blocking; it does not implement the portable caller-declared bound or constrained grace. Preserve finding dispositions, filed deferral issue ids, every round, and host-reported costs. Keep unavailable costs unreported; do not estimate or convert units. Only an aligned outcome with all required reviews complete can supply evidence.
5. For newly acquired aligned review, feed the resulting `review-outcome/1` document on stdin to `bun scripts/delivery-product.ts emit-review-evidence --context <review-context.json>`. Submit the manifest path returned by that command with `bun run harness:review-evidence -- --manifest <manifest-path>`. Do not hand-edit the emitted manifest. Failed, degraded, or exhausted review cannot authorize the candidate.

This checkpoint establishes review evidence for the product's current review projection. Step 9 remains a separate post-validation admission and GitHub-feedback checkpoint, but it does not unconditionally acquire another review. Re-evaluate freshness there against the final candidate; reuse requires product proof, not an agent waiver.

Order matters, and the harness now enforces the expensive half of it:

- Mechanical before review. `pr:athena:prepare` will not issue a receipt for a tree that fails a deterministic lint rule or the project typecheck, and `harness:review-context` requires that receipt.
- The installed product evaluates review freshness using the configured review projection and its required candidate, base, policy, release, and evidence bindings. Reports, solutions, and delivery telemetry preserve review only where that policy declares them neutral; they still require preparation, artifact validation, and any applicable full gate or artifact-specific reviewer. Source comments and generated/graph changes remain subject to the configured freshness checks. Do not invent additional neutral paths or treat review neutrality as validation reuse.
- Still generate the report and solution note before the final review-and-merge loop. The identity removes the re-review cost of that ordering; it does not license documenting after merge.
- A `candidateRef` resolves to the candidate tree the harness review context records: the `candidate.treeSha` member of the context document `bun run harness:review-context` writes. The reference is opaque — match it by exact text, never by parsing it. Retain that exact raw-tree reference as the acquired round's audit binding; it does not replace the product's review-projection freshness decision for subsequent reuse.

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

- Run `bun run delivery:resume` and check final admission plus the positive `review.green` resolution described in step 6, then read current GitHub review feedback and PR checks. When the product accepts the complete existing review and no new actionable feedback requires acquisition, reuse it. Otherwise run the complete `$ce-code-review`, passing the ticket's delivery contract via `contract:` and retaining the same delivery history and original bound. Do not dispatch solely because validation has finished.
- Treat any of the following as blocking:
  - internal review `decision = CHANGES_REQUESTED`
  - `critical_count > 0`
  - `important_count > 0`
  - any actionable internal finding the installed `review-work` workflow leaves undischarged, or a deferral whose follow-up Linear issue is not filed
  - GitHub review state `CHANGES_REQUESTED`
  - unresolved actionable PR review threads or comments
  - any PR check that failed or was cancelled
- If blocked, fix the issue, rerun the relevant validations, push, and recheck product admission, review freshness, GitHub feedback, and CI. Obtain a complete review whenever evidence is stale or new actionable review feedback requires it; otherwise retain the product's proof of reuse. A passing freshness decision does not discharge unresolved GitHub feedback or failed checks.
- If remote GitHub Actions fails after local validation passed, inspect the failing logs and deduce the concrete root cause instead of guessing from the check name alone.
- Treat remote-only failures as a local parity or harness gap until disproven:
  - if the failure belongs to the current ticket, fix it in the current ticket
  - if the failure exposed missing local guardrails, create a follow-up Linear issue scoped to the missing parity or harness remediation with source evidence from the failing check
  - if both are true, do both
- The follow-up issue should capture the failing remote check, the local validations that passed, the root cause, and the local command, harness mapping, or coverage addition needed so the failure is caught before CI next time.
- Link that follow-up issue from the current Linear ticket and the PR comment trail when it materially affects the handoff.
- Obtain complete required review rounds when the freshness or feedback checks above require them, until unanimous approval on in-scope work: every selected reviewer must report approval/no blocking in-scope findings, every confirmed deferred-expansion finding must have its follow-up Linear issue filed and linked, GitHub feedback must have no unresolved actionable blockers, and checks must be passing or auto-mergeable. The delivery's round bound, its grace round, and the typed blocker raised when the bound is reached are the installed `review-work` and `execute-work` workflows'; Athena retains one original bound and all actual acquired rounds across the pre-validation checkpoint in step 6 and this post-validation checkpoint, with neither stage carrying a cap of its own. A product-verified reuse does not create a round, reset history, or create grace eligibility. Stop earlier than the bound when the next fix is not clear, permissions/repo settings block progress, or genuine user input is required.
- File deferred-expansion follow-up issues directly via Linear MCP per the delivery contract above — do not invoke `create-linear-ticket`'s workflow for single deferral follow-ups. The ticket body, however, must follow `create-linear-ticket`'s `references/atomic-ticket-template.md` structure so the deferred ticket is executable by `execute-linear-ticket` and this overlay later without re-derivation. Populate it from the review finding plus `$compound-delivery-kernel`'s ticket-evidence requirements:
  - **Summary**: the finding's `why_it_matters`, plus one line naming the source (review run id, PR, and originating ticket) and why it was deferred (P2/P3 expansion beyond the delivery contract, confirmed by scope check).
  - **Scope**: the concrete change from `suggested_fix` (with any named assumptions carried over); the out-of-scope boundary is the originating ticket's delivered behavior.
  - **Acceptance Criteria / Test Scenarios**: derive from the finding's failure mode and evidence; quote the evidence lines per the kernel's ticket-evidence rules.
  - **Execution Posture / Observability / Expected Sensors / Compounding Opportunity**: fill per the template's own defaults for the work's shape; do not leave them implicit.
  - **Dependencies**: the originating ticket when the deferred work builds on its landed behavior.
  Link the new issue from the originating ticket and the PR. If a review produces a cluster of related expansion findings large enough to need decomposition into multiple tickets, that is the rare case where handing the cluster to `create-linear-ticket` is appropriate.
- Reviewer churn control: a finding first raised in a later round against code that was already present and approved in an earlier round is not automatically blocking — adjudicate its scope and severity like any other finding before treating it as a blocker. The installed workflow's definition of an actionable finding still applies; churn control never waves through a real defect. This dampens the ratchet where each fix round invites fresh scope on already-approved code.
- If a review-loop edit changes the deliverable diff, refresh the solution/report fingerprints, rerun the report reviewer when applicable, and keep those artifacts in this same PR.
- `bun run pr:athena` records the accepted contract at the gate boundary, runs the installed gate, exports the actual run, and prepares, records, and verifies the resulting product delivery record. Commit the resulting `telemetry/delivery-runs/*.json` with the delivery. `delivery:telemetry-record` remains available to refresh the export after further real run events; it does not mark the run complete or invent costs. If the deliverable changes, repeat the gate and refresh its records. Record transport is neutral for review but must satisfy the product's own freshness and tracked-record checks. The wrapper uses `prepare --refresh-record-neutral` after staging its own artifacts; the product may reuse mechanics only when the strict validation projection, policy, wiring, workspace, and base still match. Ordinary `pr:athena:prepare` always runs its declared checks. The telemetry sensor requires a current export for substantial deliveries; it has no agent waiver.
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
