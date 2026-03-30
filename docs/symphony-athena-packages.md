# Symphony Athena Package Runbook

This runbook explains how to operate Symphony against real Athena package code.

## Required Environment

- `LINEAR_API_KEY`: Linear API token used by tracker integration.
- `ATHENA_REPO_ROOT`: absolute path to this repository root.

Recommended setup from repo root:

```bash
export ATHENA_REPO_ROOT="$(pwd)"
```

## Label Taxonomy

Use `pkg:*` labels on Linear issues:

- `pkg:athena-webapp`
- `pkg:storefront-webapp`
- `pkg:symphony-service`
- `pkg:valkey-proxy-server`

If multiple `pkg:*` labels are present, Symphony treats scope as multi-package.

If no recognized package label is present, scope is inferred from issue content and touched paths.

## Local Commands

Start service:

```bash
bun run symphony
```

Start with workflow reload watch:

```bash
bun run symphony:watch
```

## Validation Expectations

Validation is package-scoped by label and defined in root `WORKFLOW.md`.

- Webapp: `@athena/webapp` tests + TypeScript check.
- Storefront: `@athena/storefront-webapp` tests + TypeScript check.
- Symphony: `@athena/symphony-service` tests + TypeScript check.
- Valkey proxy: connection test when env prerequisites are present; fallback to `node --check` with explicit skip reason when unavailable.

## Done Signal and Operator Readiness

- Configure `tracker.handoff_state` in `WORKFLOW.md` (default: `Human Review`).
- Symphony records a delivery-complete signal when issue state is handoff or terminal.
- Operator-facing checks:
  - Dashboard/API: `GET /api/v1/state` shows `completed` entries.
  - Per-issue API: `GET /api/v1/<issue_identifier>` may return `status: "completed"`.
  - Tracker comment includes completion details and operator checklist.

## Hook Behavior Overview

Hooks configured in `WORKFLOW.md`:

- `after_create`: create/reuse git worktree from `origin/main` and ensure issue branch `codex/<issue-id>` exists.
- `before_run`: verify git-backed workspace, enforce issue branch checkout, run `bun install` when `node_modules` is missing.
- `before_remove`: remove/prune worktree metadata best effort.

## Troubleshooting

### Missing `ATHENA_REPO_ROOT`

Symptoms:

- `after_create` or `before_run` fails early with explicit hook error.

Fix:

```bash
export ATHENA_REPO_ROOT="/absolute/path/to/athena"
```

### Invalid repo root

Symptoms:

- hook logs indicate `ATHENA_REPO_ROOT is not a git repository`.

Fix:

- point `ATHENA_REPO_ROOT` to the actual repo root.

### Worktree add conflict

Symptoms:

- `git worktree add` fails (path already attached or stale metadata).

Fix:

```bash
git -C "$ATHENA_REPO_ROOT" worktree list
git -C "$ATHENA_REPO_ROOT" worktree prune
```

If needed, remove stale entry manually:

```bash
git -C "$ATHENA_REPO_ROOT" worktree remove --force <workspace-path>
```

### Valkey connection test unavailable

Symptoms:

- valkey connection test cannot run due to missing runtime prerequisites.

Expected behavior:

- Symphony should report skip reason and run fallback syntax check:

```bash
node --check packages/valkey-proxy-server/index.js
```
