# @athena/symphony-service

Spec-aligned Symphony service foundation for Athena.

## Current scope

- `WORKFLOW.md` loader with YAML front matter parsing and typed workflow errors
- Config resolution with defaults and env indirection
- Dispatch preflight validation (`tracker` + `codex` required fields)
- Strict prompt rendering (`strictVariables` + `strictFilters`)
- Workspace manager with safety checks and hook execution semantics
- Codex app-server protocol + client integration
- Runtime tick orchestration (reconciliation, dispatch, retry handling)
- Worker attempt execution loop (workspace, hooks, prompt, Codex turns)
- Startup terminal workspace cleanup
- CLI-hosted service loop with optional workflow watch/reload
- Optional HTTP status server (`--port` or `server.port`) with dashboard + JSON APIs
- Hook-driven git worktree provisioning for issue workspaces (`after_create`, `before_run`, `before_remove`)

## Specification tracking

- Conformance matrix: [`CONFORMANCE.md`](./CONFORMANCE.md)

## Status server (optional extension)

When enabled (`--port` or `server.port` in `WORKFLOW.md`), the service exposes:

- `GET /` dashboard
- `GET /api/v1/state`
- `GET /api/v1/<issue_identifier>`
- `POST /api/v1/refresh`

`/api/v1/state` now includes `completed` delivery signals (issue, final state, attempt, observed timestamp), and
`/api/v1/<issue_identifier>` can return `status: "completed"` when a done signal is present in runtime state.

## Commands

```bash
bun run --filter '@athena/symphony-service' start
bun run --filter '@athena/symphony-service' start --watch
bun run --filter '@athena/symphony-service' start --port 3000
bun run --filter '@athena/symphony-service' test
bun run --filter '@athena/symphony-service' test:integration:real WORKFLOW.md --linear=true --codex=false
```

## Athena Package Routing Contract

Package routing is driven by Linear labels and configured in the root `WORKFLOW.md` prompt:

- `pkg:athena-webapp` -> `packages/athena-webapp`
- `pkg:storefront-webapp` -> `packages/storefront-webapp`
- `pkg:symphony-service` -> `packages/symphony-service`
- `pkg:valkey-proxy-server` -> `packages/valkey-proxy-server`

If labels are missing, scope is inferred from issue text and touched files, and must be documented in PR summary.

## Done Signal Contract

- Configure tracker handoff state via `tracker.handoff_state` in `WORKFLOW.md` (default: `Human Review`).
- Symphony records a delivery-complete signal when a run exits with issue state equal to handoff state
  or any terminal state.
- On signal, Symphony writes a structured tracker comment so operators can quickly verify delivery status.

## Workspace Hook Notes

Root `WORKFLOW.md` uses:

- `hooks.after_create: bash /Users/kwamina/athena/scripts/symphony/after-create.sh`
- `hooks.before_run: bash /Users/kwamina/athena/scripts/symphony/before-run.sh`
- `hooks.before_remove: bash /Users/kwamina/athena/scripts/symphony/before-remove.sh`

These hooks require:

- `ATHENA_REPO_ROOT` set to the athena repository root.
