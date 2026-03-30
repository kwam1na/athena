# Symphony Conformance Matrix

This document tracks `@athena/symphony-service` against the Symphony spec definition of done.

Spec reference: https://github.com/openai/symphony/blob/main/SPEC.md

## Core Conformance (`SPEC` §18.1)

| Requirement | Status | Implementation | Validation |
| --- | --- | --- | --- |
| Workflow path selection supports explicit path and cwd default | Implemented | `src/cli.ts`, `src/workflow.ts` | `tests/cli.test.ts`, `tests/workflow.test.ts` |
| `WORKFLOW.md` loader parses YAML front matter and prompt body | Implemented | `src/workflow.ts` | `tests/workflow.test.ts` |
| Typed config layer with defaults and `$` environment resolution | Implemented | `src/config.ts`, `src/types.ts` | `tests/config.test.ts` |
| Dynamic `WORKFLOW.md` watch/reload/re-apply | Implemented | `src/service.ts`, `src/workflow.ts` | `tests/service.test.ts` |
| Polling orchestrator with single authoritative mutable state | Implemented | `src/orchestrator.ts`, `src/runtime.ts`, `src/service.ts` | `tests/orchestrator.test.ts`, `tests/runtime.test.ts`, `tests/service.test.ts` |
| Tracker client supports candidate fetch, state refresh, terminal fetch | Implemented | `src/issue.ts`, `src/tracker/linear.ts` | `tests/linearTracker.test.ts`, `tests/startup.test.ts` |
| Workspace manager with sanitized per-issue workspaces | Implemented | `src/workspace.ts` | `tests/workspace.test.ts` |
| Workspace lifecycle hooks (`after_create`, `before_run`, `after_run`, `before_remove`) | Implemented | `src/workspace.ts`, `src/startup.ts`, `src/worker.ts`, `src/service.ts` | `tests/workspace.test.ts`, `tests/startup.test.ts`, `tests/worker.test.ts` |
| Hook timeout config (`hooks.timeout_ms`, default `60000`) | Implemented | `src/config.ts`, `src/workspace.ts` | `tests/config.test.ts`, `tests/workspace.test.ts` |
| Coding-agent app-server subprocess client with JSON line protocol | Implemented | `src/codex/client.ts`, `src/codex/protocol.ts` | `tests/codexClient.test.ts`, `tests/codexProtocol.test.ts` |
| Codex launch command config (`codex.command`, default `codex app-server`) | Implemented | `src/config.ts`, `src/service.ts` | `tests/config.test.ts`, `tests/service.test.ts` |
| Strict prompt rendering with `issue` and `attempt` variables | Implemented | `src/template.ts`, `src/worker.ts` | `tests/template.test.ts`, `tests/worker.test.ts` |
| Exponential retry queue with continuation retries after normal exit | Implemented | `src/retry.ts`, `src/orchestrator.ts`, `src/runtime.ts` | `tests/retry.test.ts`, `tests/orchestrator.test.ts`, `tests/runtime.test.ts` |
| Configurable retry backoff cap (`agent.max_retry_backoff_ms`) | Implemented | `src/config.ts`, `src/orchestrator.ts`, `src/runtime.ts` | `tests/config.test.ts`, `tests/orchestrator.test.ts` |
| Reconciliation that stops runs on terminal/non-active tracker states | Implemented | `src/orchestrator.ts`, `src/runtime.ts`, `src/service.ts` | `tests/orchestrator.test.ts`, `tests/runtime.test.ts`, `tests/service.test.ts` |
| Workspace cleanup for terminal issues (startup sweep + active transition) | Implemented | `src/startup.ts`, `src/service.ts` | `tests/startup.test.ts`, `tests/service.test.ts` |
| Structured logs including issue and session context fields | Implemented | `src/service.ts`, `src/worker.ts` | `tests/service.test.ts` |
| Operator-visible observability (structured logs; optional snapshot/status surface) | Implemented | `src/service.ts` (`getRuntimeSnapshot`), `src/cli.ts` | `tests/service.test.ts`, `tests/cli.test.ts` |

## Extension Conformance (`SPEC` §18.2)

| Extension | Status | Notes |
| --- | --- | --- |
| Optional HTTP server/status surface (`SPEC` §13.7) | Implemented | `src/httpServer.ts`, `src/cli.ts`, `tests/httpServer.test.ts`, `tests/cli.test.ts` |
| Optional `linear_graphql` client-side tool extension | Not implemented | Out of current scope |
| Persistent retry/session state across restarts | Not implemented | Future improvement |
| Workflow-configurable observability settings | Not implemented | Future improvement |
| First-class tracker write APIs in orchestrator | Not implemented | Current boundary keeps writes in agent tools |
| Pluggable tracker adapters beyond Linear | Not implemented | Future improvement |

## Real Integration Profile (`SPEC` §18.3)

| Item | Status | Notes |
| --- | --- | --- |
| Real integration smoke can be executed in CI with credentials and optional Codex tooling | Implemented | GitHub Actions workflow: `.github/workflows/athena-symphony-real-integration.yml` |
| Real integration smoke command is available from package scripts | Implemented | `bun run --filter '@athena/symphony-service' test:integration:real` |
