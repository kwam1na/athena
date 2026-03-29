# @athena/symphony-service

Spec-aligned Symphony service foundation for Athena.

## Current scope

- `WORKFLOW.md` loader with YAML front matter parsing and typed workflow errors
- Config resolution with defaults and env indirection
- Dispatch preflight validation (`tracker` + `codex` required fields)
- Strict prompt rendering (`strictVariables` + `strictFilters`)
- Startup CLI with optional workflow watch/reload

## Commands

```bash
bun run --filter '@athena/symphony-service' start
bun run --filter '@athena/symphony-service' start --watch
bun run --filter '@athena/symphony-service' test
```
