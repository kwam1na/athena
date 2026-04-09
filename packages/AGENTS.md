# Athena Packages Agent Router

- For `packages/athena-webapp`, start with [athena-webapp/AGENTS.md](./athena-webapp/AGENTS.md).
- For `packages/storefront-webapp`, start with [storefront-webapp/AGENTS.md](./storefront-webapp/AGENTS.md).
- If a task spans both apps, read both harnesses first, keep docs in sync with code, and finish with `bun run harness:check`.

## Shared Repo Rules

## Git Branching
- After each merged checkpoint, start the next task from a new branch created from the latest `main`.
- Branch names must use the `codex/` prefix.

## PR Preparation
- Before opening or updating a PR, sync the working branch with the latest `origin/main` (merge or rebase).
- Run PR-equivalent test checks after syncing with `origin/main`.
- PR titles must use the format `[V26-123]: title`.
- Every PR body must include a direct Linear link at the end for the ticket referenced in the title.

## PR Body Format
- Every PR body must include these sections:
  - `## Summary`
  - `## Why`
  - `## Validation`
