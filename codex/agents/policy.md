# Agent Policy

## Default stance

- Prefer local, inspectable commands.
- Prefer existing repo workflows over custom scripts.
- Prefer small edits and narrow verification.

## Approval-required actions

- Destructive git operations
- Recursive deletes
- Wide refactors across many files
- Commands that touch secrets or deployment state
- Any action the user explicitly asked to review first

## Reviewer-required actions

- Medium or high risk changes
- Verification warnings or failures
- Changes in auth, payments, env/config, migrations, or similar critical areas

## Command policy

- Prefer `rg` and `rg --files` for search.
- Read before editing.
- Use repo-native package managers and scripts when available.
- Prefer parallel command and agent work when tasks are independent and the environment supports it.
- Avoid background processes unless the user asked for them.
- Log the actual commands you ran in the run record.

## Parallelism policy

- Bias toward parallel work for independent scope discovery, implementation batches, and verification checks.
- Serialize work when tasks share files, migrations, env/config, approvals, or a strict dependency chain.
- Merge and reconcile all parallel outputs before reporting final status.

## Editing policy

- Make the smallest change that solves the current batch.
- Do not mix planning files with runtime code.
- Do not create framework code when an instruction file is what the system actually needs.

## Reporting policy

- State uncertainty explicitly.
- Report blocked states immediately.
- If checks were not run, say so.
