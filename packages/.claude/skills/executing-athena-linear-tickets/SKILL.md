---
name: executing-athena-linear-tickets
description: Use when implementing one or more existing Athena Linear tickets end-to-end — when a specific ticket like V26-174 is referenced, the user says to proceed with Athena Linear work, or asks to pick the next ticket from a known backlog. Covers the full loop from ticket pickup through implementation, Linear status updates, PR creation, and CI verification. Do NOT use when work isn't tracked in Linear yet or the user is still deciding scope.
---

# Executing Athena Linear Tickets

## Overview

Turn an existing Linear ticket into a delivered PR with no human intervention between steps. Pick up the ticket, implement on a clean branch in an isolated worktree, make reasonable scope decisions, keep Linear synchronized, and finish with a validated PR and passing CI.

This is the execution companion to the ticketing workflow. Use the ticketing workflow to create or restructure tickets. Use this skill to carry existing tickets through implementation.

**Announce at start:** "I'm using the executing-athena-linear-tickets skill to implement this ticket."

## Autonomy Model

Execute the entire workflow from ticket pickup through PR creation without pausing for confirmation at each step. The goal is to deliver a complete, validated PR that the user can review as a finished artifact.

**Act autonomously when:**
- The ticket's acceptance criteria are clear enough to implement
- Scope decisions align with what the ticket describes
- Follow-up work can be split into a new ticket rather than expanding scope
- Validation passes

**Pause and ask only when:**
- The ticket is genuinely ambiguous and two reasonable interpretations lead to materially different implementations
- A required dependency is missing or broken in a way that blocks the entire ticket
- Validation reveals a systemic issue unrelated to your change that you cannot work around

Default to action. If a decision is close to 50/50, pick the simpler option, document it in Linear, and keep moving. The user will see your judgment calls in the PR and Linear comments — they do not need to approve each one in real time.

## When to Use

- The user references a specific Athena Linear issue like `V26-174`
- The user asks to "proceed" with outstanding Athena Linear work
- The user expects you to choose the next sensible ticket from a known backlog
- The work spans implementation plus ticket hygiene: status updates, comments, PR links, follow-up tickets

Do not use when:
- The user is still deciding scope and wants planning first
- The work is not tracked in Linear yet
- The task is unrelated to Athena's Linear workflow

## Defaults

- Team: `yaegars` / `V26`
- Project: `athena`
- Start each new implementation branch from the latest `origin/main`
- Use an isolated worktree for each ticket (via `EnterWorktree` or the `using-git-worktrees` skill)
- Branch prefix and PR conventions come from `AGENTS.md` in the repo root — read it before creating a branch
- Prefix every commit message with the Linear ticket id, e.g. `V26-123: tighten billing retry guard`
- Use Linear MCP operations for status changes, comments, and issue creation

## Workflow

Execute steps 1 through 9 as a continuous sequence. Do not stop between steps to ask for confirmation.

### 1. Pick Up The Ticket

Read the Linear issue first. Capture:
- title, scope, acceptance criteria
- test scenarios
- milestone, labels, and parent issue when relevant

Move the issue to `In Progress` immediately — this signals work has begun.

If the user asked for a series of tickets, choose the next one based on explicit dependencies first, then implementation leverage. Do not ask which ticket to pick unless the priority is genuinely ambiguous.

### 2. Set Up An Isolated Workspace

- Use `EnterWorktree` or the `superpowers:using-git-worktrees` skill to create an isolated worktree from the latest `origin/main`
- Name the branch with the prefix from `AGENTS.md` and include the ticket id (e.g. `codex/V26-123-short-name`)
- Do not branch from a stale local `main` — always fetch first
- Read `AGENTS.md` and `CLAUDE.md` in the repo before coding

### 3. Reproduce and Understand Before Fixing

- Reproduce the failure, warning, or missing behavior before editing code
- Read the exact files implicated by the ticket
- If the issue is ambiguous, confirm the real code path locally instead of trusting memory or ticket phrasing
- Prefer the smallest accurate root-cause statement you can defend

### 4. Implement

- Implement the fix or feature end-to-end in one pass — do not break for confirmation between sub-tasks
- Make reasonable scope decisions. If the ticket says what to do, do it. If it leaves room for interpretation, pick the simpler path and note it
- Keep changes aligned to the ticket's outcome — avoid bundling unrelated cleanup just because you are nearby
- If a related improvement is necessary to make the fix coherent, include it and explain why
- Commit incrementally with the ticket id prefix so the branch history tells a clear story

### 5. Make Judgment Calls Deliberately

When you make a non-obvious call, document it in Linear. Do not pause execution to ask — decide, record, continue.

Typical judgment calls:
- Splitting follow-up work into a new ticket instead of broadening the current one
- Keeping a ticket scoped to one subsystem even when adjacent code is tempting to clean up
- Preserving a runtime boundary because it appears intentional
- Choosing a library-supported composition pattern over inventing a custom helper
- Separating unrelated frontend or infra drift from the primary ticket

For each significant judgment call, record what you decided, why, and what you intentionally left out.

### 6. Keep Linear In Sync While You Work

Update Linear as part of execution, not only at the end.

Minimum expectations:
- Move the issue to `In Progress` when work starts (step 1)
- Add a comment when there is meaningful implementation progress or a judgment call
- Add a comment when you open the PR
- Move the issue to `In Review` once the PR is open and the ticket is primarily waiting on review/merge
- Include branch name, commit HEAD, validation status, and major scope decisions in comments

If you discover follow-up work during implementation:
- Create a follow-up issue immediately — do not defer this to the end
- Put it in the correct milestone/state
- Link it back to the parent issue when appropriate
- Explain the split in a Linear comment

### 7. Validate

Run the smallest targeted tests first, then broader checks. Do this without prompting — validation is not optional.

Typical validation ladder:
- Focused failing/regression test
- Package test suite
- Typecheck/build/lint checks relevant to the package
- `git diff --check`

If a validation step fails:
- Fix it if it's caused by your change
- If it's a pre-existing failure unrelated to your change, note it in the PR body and Linear comment, then proceed
- If it's blocking and you cannot determine the cause, that's a valid reason to pause and ask

### 8. Prepare The PR

Before opening the PR:
- Sync the branch with the latest `origin/main`
- Rerun validation after syncing
- When the repo exposes CI entrypoints locally, run them so PR checks are unsurprising

PR conventions (from `AGENTS.md`):
- Title format: `[V26-123]: Title`
- Body must contain:
  - `## Summary`
  - `## Why`
  - `## Validation`
- Include the Linear ticket link at the end of the PR body

Open the PR and push. Do not ask for permission to push — the entire point of this skill is autonomous delivery.

### 9. Close The Loop

After opening the PR:
- Add the PR link to the Linear ticket
- Move the Linear issue to `In Review`
- Note final validation status in Linear
- Mention any remaining caveats precisely
- Check GitHub CI status — if checks fail, investigate and fix before reporting completion
- Do not treat "PR opened" as the terminal state if required CI is still red or unknown

When the loop is fully closed, report to the user with:
- PR link
- Summary of what changed
- Any judgment calls made
- Any follow-up tickets created
- CI status

If multiple tickets were requested, proceed to the next ticket without waiting for confirmation.

## Ticket Selection Rules

When the user asks to continue a program of work:

1. Respect explicit dependency chains first
2. Prefer tickets that unblock others
3. Prefer setup/hardening tickets before broad refactors when they reduce downstream friction
4. Avoid starting a cleanup ticket that is obviously superseded by unmerged blocking work

Pick the next ticket and start immediately. Only ask if the priority is genuinely ambiguous between two equally valid choices.

## Linear Comment Template

Use concise Linear comments with this shape:

```md
Implementation update:

- Branch: `codex/V26-123-short-name`
- Current commit: `abc1234`

What changed:
- short concrete outcome
- short concrete outcome

Validation:
- `bun run test` pass/fail
- `bunx tsc --noEmit --pretty false` pass/fail

Judgment call:
- explain the scoped decision and why
```

## Multi-Ticket Execution

When given multiple tickets or told to "work through the backlog":

1. Select the first ticket per the selection rules above
2. Execute the full workflow (steps 1-9) autonomously
3. Report completion with PR link and summary
4. Immediately select and begin the next ticket
5. Repeat until all tickets are delivered or a genuine blocker requires user input

Use parallel subagents (via the `Agent` tool with `isolation: "worktree"`) when tickets are independent and share no files. This lets you work on multiple tickets simultaneously.

## Common Mistakes

- Starting from a stale branch after a prior checkpoint merged
- Treating ticket execution as code-only work and forgetting Linear status/comments
- Leaving the issue in `In Progress` after the work is effectively handed off for review
- Expanding ticket scope silently instead of recording a judgment call
- Discovering follow-up work and leaving it undocumented
- Opening a PR without rebasing onto the latest `origin/main`
- Creating commits whose messages omit the Linear ticket id
- Using a PR title that omits the Linear ticket id
- Putting the Linear link at the top of the PR body instead of the end
- Stopping at "PR opened" without verifying the checks that gate merge
- Claiming tests pass without actually running them
- Pausing to ask for confirmation on decisions that are clearly within ticket scope
- Waiting for user approval between tickets when told to work through a set

## Quick Reference

| Situation | Action |
|-----------|--------|
| Existing ticket, execution requested | Use this skill |
| Need to create/split/restructure tickets | Use ticketing workflow |
| New branch after a merged checkpoint | Always from latest `origin/main` |
| Commits for ticket work | Include ticket id in every message |
| Non-obvious implementation choice | Decide, note it in Linear, keep moving |
| Deferred scope found during execution | Create a follow-up ticket immediately |
| Validation passes | Open PR and push without asking |
| Multiple tickets requested | Execute sequentially or in parallel, report each |
| Close to 50/50 decision | Pick the simpler option, document why |
