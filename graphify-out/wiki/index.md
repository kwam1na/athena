# Graphify Wiki

Graphify is the navigation layer for the repo graph. Use the entry docs below for operational rules and validation, and open `graphify-out/GRAPH_REPORT.md` for deeper analysis.

## Entry Docs
- [AGENTS.md](../../AGENTS.md) - repo-wide workflow, guardrails, and graphify usage rules
- [packages/AGENTS.md](../../packages/AGENTS.md) - package router plus the operational guides for each harnessed package

## Repo Summary
- Code files discovered: 1858
- Graph nodes: 6399
- Graph edges: 7049
- Communities: 1786

## Graph Hotspots
- `DailyCloseView.tsx` (87 edges, Community 0) - [`packages/athena-webapp/src/components/operations/DailyCloseView.tsx`](../../packages/athena-webapp/src/components/operations/DailyCloseView.tsx)
- `useRegisterViewModel.ts` (68 edges, Community 1) - [`packages/athena-webapp/src/lib/pos/presentation/register/useRegisterViewModel.ts`](../../packages/athena-webapp/src/lib/pos/presentation/register/useRegisterViewModel.ts)
- `dailyClose.ts` (65 edges, Community 2) - [`packages/athena-webapp/convex/operations/dailyClose.ts`](../../packages/athena-webapp/convex/operations/dailyClose.ts)
- `projectLocalEvents.ts` (51 edges, Community 3) - [`packages/athena-webapp/convex/pos/application/sync/projectLocalEvents.ts`](../../packages/athena-webapp/convex/pos/application/sync/projectLocalEvents.ts)
- `RegisterSessionView.tsx` (47 edges, Community 4) - [`packages/athena-webapp/src/components/cash-controls/RegisterSessionView.tsx`](../../packages/athena-webapp/src/components/cash-controls/RegisterSessionView.tsx)
- `usePosLocalSyncRuntime.ts` (47 edges, Community 6) - [`packages/athena-webapp/src/lib/pos/infrastructure/local/usePosLocalSyncRuntime.ts`](../../packages/athena-webapp/src/lib/pos/infrastructure/local/usePosLocalSyncRuntime.ts)
- `harness-inferential-review.ts` (46 edges, Community 8) - [`scripts/harness-inferential-review.ts`](../../scripts/harness-inferential-review.ts)
- `ingestLocalEvents.ts` (46 edges, Community 7) - [`packages/athena-webapp/convex/pos/application/sync/ingestLocalEvents.ts`](../../packages/athena-webapp/convex/pos/application/sync/ingestLocalEvents.ts)

## Registered Packages
- [Athena Webapp](packages/athena-webapp.md)
- [Storefront Webapp](packages/storefront-webapp.md)
- [Valkey Proxy Server](packages/valkey-proxy-server.md)

## Deep Dives
- [GRAPH_REPORT.md](../GRAPH_REPORT.md) - canonical graph report
- [graph.html](../graph.html) - interactive graph view
