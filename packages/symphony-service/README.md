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

## Specification tracking

- Conformance matrix: [`CONFORMANCE.md`](./CONFORMANCE.md)

## Status server (optional extension)

When enabled (`--port` or `server.port` in `WORKFLOW.md`), the service exposes:

- `GET /` dashboard
- `GET /api/v1/state`
- `GET /api/v1/<issue_identifier>`
- `POST /api/v1/refresh`

## Commands

```bash
bun run --filter '@athena/symphony-service' start
bun run --filter '@athena/symphony-service' start --watch
bun run --filter '@athena/symphony-service' start --port 3000
bun run --filter '@athena/symphony-service' test
bun run --filter '@athena/symphony-service' test:integration:real WORKFLOW.md --linear=true --codex=false
```
