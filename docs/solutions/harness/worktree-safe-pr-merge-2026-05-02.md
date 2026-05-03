# Worktree-Safe PR Merges

## Context

Agents often execute Athena tickets from linked worktrees while the root checkout keeps `main` checked out. Raw `gh pr merge` can run local git operations after the remote merge and fail with:

```text
fatal: 'main' is already checked out at '/Users/kwamina/athena'
```

That failure does not mean the PR is unsafe to merge. It means the merge command tried to use the local checkout layout as part of a remote GitHub operation.

## Pattern

Use the repo helper:

```bash
bun run github:pr-merge -- <pr-number-or-url> --method squash --delete-branch
```

The helper reads PR metadata through `gh pr view`, merges through `gh api --method PUT /repos/:owner/:repo/pulls/:number/merge`, and deletes same-repo head branches through the GitHub refs API. It does not check out, pull, or update local `main`, so it works when `main` is already checked out in the root worktree.

## Guardrail

`scripts/github-pr-merge.test.ts` covers the API-only merge path and asserts that `.agents/skills/execute/SKILL.md` keeps pointing agents to `bun run github:pr-merge`.

Run the targeted sensor after changing the helper or execute workflow:

```bash
bun test scripts/github-pr-merge.test.ts scripts/worktree-manager.test.ts
```
