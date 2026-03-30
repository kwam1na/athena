# Athena Packages Agent Rules

## Git Branching
- After each merged checkpoint, start the next task from a new branch created from the latest `main`.
- Branch names must use the `codex/` prefix.

## PR Preparation
- Before opening or updating a PR, sync the working branch with the latest `origin/main` (merge or rebase).
- Run PR-equivalent test checks after syncing with `origin/main`.

## PR Body Format
- Every PR body must include these sections:
  - `## Summary`
  - `## Why`
  - `## Validation`
