---
name: ce-landed-change-report
description: Create a digestible standalone HTML report for a landed change, merged PR, release, or completed Linear issue, with mandatory subagent-gathered context from prior sessions and delivered code changes plus an interactive comprehension quiz. Use when the user asks for an HTML report, explainer, digest, walkthrough, learning artifact, comprehension quiz, or post-merge understanding aid for work that has landed or is ready to explain.
---

# Landed Change Report

Create a reader-friendly HTML report that explains a landed change with context, intuition, code-level mechanics, validation evidence, and a quiz the reader must pass.

This skill is intentionally subagent-driven. Do not create the report from only the current conversation unless subagents are unavailable in the host environment.

## Output Contract

Produce one standalone static HTML file under `docs/reports/` by default:

```text
docs/reports/YYYY-MM-DD-<short-change-slug>-report.html
```

Generated reports must keep the root marker `data-athena-landed-change-report="v1"` so repo sensors can distinguish intentional landed-change reports from ordinary HTML artifacts. For large branches, also embed the current deliverable diff fingerprint from:

```bash
bun scripts/landed-change-report-check.ts --base origin/main --print-fingerprint
```

Run that command after final code/workflow edits and before final report rendering. If review-loop changes land after report creation, regenerate the report so `data-athena-report-diff-fingerprint` matches the final deliverable diff.

The report must include:

- title, merge/PR/issue metadata, and status pills
- executive summary
- problem/context in plain language
- intuition or mental model
- before/after flow or layer breakdown
- key file table with why each file matters
- what changed and what intentionally did not change
- validation, review, and deployment/root-alignment evidence
- next-time workflow or operational guidance
- interactive quiz with grade/reset behavior, answer explanations, and a pass threshold
- subagent evidence summary naming the subagents used and what each contributed

Default quiz size is 10 questions with a pass threshold of 8/10. Use fewer only for very small changes, and never below 5 questions.

## Mandatory Subagents

Start these subagents before drafting the report. They are read-only. Keep prompts narrow and ask for concise, source-grounded findings.

1. **Session context subagent**
   - Purpose: gather relevant context across prior sessions and the delivery conversation.
   - Preferred role/tool: `ce-session-historian` when available; otherwise an `explorer` or default subagent.
   - Must return: previous attempts, decisions, reviewer loops, finish-line changes, Linear/PR closure context, and any durable lessons.

2. **Delivered diff subagent**
   - Purpose: analyze the landed code/doc changes from git, PR, and repo docs.
   - Preferred role/tool: `explorer`, `ce-repo-research-analyst`, or another read-only codebase researcher.
   - Must return: changed-file map, architectural before/after, behavior boundaries, risks, tests, generated artifacts, and intentionally unchanged behavior.

3. **Quiz/report reviewer subagent**
   - Purpose: review the draft report for comprehension quality and unsupported claims.
   - Preferred role/tool: `ce-testing-reviewer`, `ce-coherence-reviewer`, or default subagent.
   - Must run when the change is broad, high-risk, cross-layer, customer/operator-facing, or the report will be used for onboarding.
   - Must return: unclear sections, missing concepts, weak quiz questions, and any claims not grounded in evidence.

If the platform has no subagent capability, write `SubagentUnavailable` in the report evidence section and proceed only after explicitly saying that the report is less complete than normal. If subagents are available, do not skip them.

Use `references/subagent-prompts.md` for prompt templates.

## Workflow

### 1. Resolve The Landed Change

Accept any of:

- PR number or URL
- merge commit SHA
- Linear issue id
- branch name
- plain-language description of the landed work

Resolve to the most concrete artifact available, preferring a merged PR or merge commit. Capture:

- PR title, URL, body, state, merge SHA, and merged time
- commit range and changed files
- Linear parent and child issues when available
- validation/check status
- deploy or no-deploy finish line
- root-alignment state when relevant

Useful commands:

```bash
gh pr view <pr> --json url,title,body,state,mergedAt,mergeCommit,statusCheckRollup
git show --stat --numstat --name-only <merge-sha>
git show --format=fuller --no-ext-diff <merge-sha> -- <important files>
git status --short --branch
```

For architecture or codebase questions in Athena, read `graphify-out/GRAPH_REPORT.md` and prefer `graphify-out/wiki/index.md` when navigating.

### 2. Dispatch Subagents

Dispatch the session context and delivered diff subagents in parallel when possible. Continue local evidence collection while they run.

The subagent prompts must pass raw identifiers and paths, not your conclusions. Example inputs:

- repo root
- PR number/URL
- merge SHA
- Linear issue ids
- plan/solution/report paths if known

When subagents return, synthesize their findings. Do not paste raw subagent output into the report unless it is concise and reader-useful.

### 3. Gather Primary Evidence Locally

Read the artifacts yourself. Do not rely solely on subagents.

Required evidence categories:

- `git`/GitHub truth: PR, merge commit, changed files, important patches
- work record: Linear issue(s), plan docs, PR body, closeout comments when available
- code truth: core files that explain the behavior
- validation truth: local gates, CI checks, reviewer outcomes, deploy/no-deploy notes
- durable learning: solution notes, agent docs, generated artifacts, or explicit "none"

For repo-local Athena work, prefer direct local files and Linear/GitHub connectors over memory. Use memory only as supplementary context and cite it if used in a final chat response.

### 4. Build The Explanation

The report should teach the reader how to think about the change, not just list files.

Use this narrative order:

1. **What happened**: merged PR, issue, commit, deployment/root state.
2. **Why it mattered**: operator/customer/system risk or product need.
3. **The mental model**: a simple analogy, flow, table, or layer map.
4. **Before vs after**: what was duplicated, broken, unclear, or missing before; what is now authoritative.
5. **Layer-by-layer mechanics**: explain the important files in the order data flows through the system.
6. **Failure boundaries**: how bad inputs, auth failures, race conditions, old data, or unsupported paths behave.
7. **Validation**: what proved the change and what residual risks remain.
8. **Next-time guidance**: how to safely extend or debug the same area.

Avoid marketing copy. Use direct operational language. Include small code snippets only when they clarify a boundary.

### 5. Create The Quiz

The quiz should test comprehension of the change's intent and failure boundaries.

Question mix:

- 2-3 architecture/mental-model questions
- 2-3 behavior/failure-boundary questions
- 1-2 validation/review questions
- 1-2 "what would you do next time" questions
- 1 status/finish-line question when deploy/root/Linear state matters

Avoid trivia such as exact line counts unless the detail is operationally meaningful.

Each question must have:

- one correct answer
- plausible wrong answers based on real misunderstandings
- a short answer explanation shown after grading

### 6. Design The HTML Shell

Before designing or substantially changing the HTML shell, load repo-local `$emil-design-eng` from `.agents/skills/emil-design-eng/SKILL.md` and apply it to the report UI.

For this reporting surface, the default design posture is:

- quiet, work-focused document UI
- strong information hierarchy
- compact metadata and scannable sections
- no decorative motion
- responsive layout with stable dimensions
- quiz controls with clear press feedback and no layout shift
- exact CSS transition properties only, if transitions are used
- `prefers-reduced-motion` support for any nonessential motion

Do not create a marketing landing page. The first viewport should immediately explain the landed change and show the reader where they are.

### 7. Render HTML

Prefer a handcrafted report when the change needs nuanced layout. For a repeatable shell, use:

```bash
python3 .agents/skills/ce-landed-change-report/scripts/render_report.py input.json docs/reports/<report>.html
```

The script expects structured sections and quiz questions. Read `references/report-payload.md` when using the script.

HTML requirements:

- standalone file with embedded CSS and JavaScript
- no remote assets
- no external scripts
- responsive layout
- accessible headings and form labels
- local quiz grading in the browser
- report-shell design informed by `$emil-design-eng`
- no secrets, raw tokens, private credentials, or sensitive customer data

### 8. Validate The Report

Run lightweight checks:

```bash
test -f docs/reports/<report>.html
rg -n "data-athena-landed-change-report|data-athena-report-diff-fingerprint|Subagent Evidence|Quiz: Pass Required|changeQuiz" docs/reports/<report>.html
bun run landed-report:check
```

If you used the renderer script, also run it on a minimal sample or the actual payload before finalizing.

Check manually:

- every major claim traces back to git, PR, Linear, local files, or subagent evidence
- no secrets are present
- quiz pass threshold is visible and enforced in JavaScript
- report states whether production deploy occurred
- report states whether root/local alignment occurred when relevant
- report mentions subagents used

If code files changed as part of creating or updating this skill, follow repo rules for Graphify. Documentation-only reports do not require Graphify unless repo policy says otherwise.

## Output

Return:

```text
=== Landed Change Report Complete ===
Path: docs/reports/<report>.html
Source: <PR/merge SHA/Linear issue>
Subagents: <names/roles used>
Quiz: <N questions, pass threshold>
Validation: <commands/checks run>
Notes: <deploy/root/Linear status, untracked/tracked state>
=== End Report ===
```

## Guardrails

- Do not produce a report without subagent context when subagents are available.
- Do not let subagents write the report. They gather evidence; the orchestrator owns synthesis.
- Do not turn the report into a PR description. It is a teaching artifact.
- Do not overstate validation; say exactly what ran and what passed.
- Do not claim production deployment unless a real deploy command completed.
- Do not include sensitive runtime data or raw secrets.
- Do not mutate Linear, GitHub, or production systems unless the user explicitly asks.
