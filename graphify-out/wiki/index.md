# Graphify Wiki

Graphify is the navigation layer for the repo graph. Use the entry docs below for operational rules and validation, and open `graphify-out/GRAPH_REPORT.md` for deeper analysis.

## Entry Docs
- [AGENTS.md](../../AGENTS.md) - repo-wide workflow, guardrails, and graphify usage rules
- [packages/AGENTS.md](../../packages/AGENTS.md) - package router plus the operational guides for each harnessed package

## Repo Summary
- Code files discovered: 2378
- Graph nodes: 9724
- Graph edges: 11926
- Communities: 2305

## Graph Hotspots
- `dailyClose.ts` (87 edges, Community 1) - [`packages/athena-webapp/convex/operations/dailyClose.ts`](../../packages/athena-webapp/convex/operations/dailyClose.ts)
- `harness-inferential-review.ts` (86 edges, Community 2) - [`scripts/harness-inferential-review.ts`](../../scripts/harness-inferential-review.ts)
- `posLocalStore.ts` (84 edges, Community 0) - [`packages/athena-webapp/src/lib/pos/infrastructure/local/posLocalStore.ts`](../../packages/athena-webapp/src/lib/pos/infrastructure/local/posLocalStore.ts)
- `terminalHealthPresentation.ts` (76 edges, Community 3) - [`packages/athena-webapp/src/components/pos/terminals/terminalHealthPresentation.ts`](../../packages/athena-webapp/src/components/pos/terminals/terminalHealthPresentation.ts)
- `dailyOperations.ts` (74 edges, Community 4) - [`packages/athena-webapp/convex/operations/dailyOperations.ts`](../../packages/athena-webapp/convex/operations/dailyOperations.ts)
- `DailyCloseView.tsx` (71 edges, Community 5) - [`packages/athena-webapp/src/components/operations/DailyCloseView.tsx`](../../packages/athena-webapp/src/components/operations/DailyCloseView.tsx)
- `projectLocalEvents.ts` (66 edges, Community 6) - [`packages/athena-webapp/convex/pos/application/sync/projectLocalEvents.ts`](../../packages/athena-webapp/convex/pos/application/sync/projectLocalEvents.ts)
- `usePosLocalSyncRuntime.ts` (65 edges, Community 7) - [`packages/athena-webapp/src/lib/pos/infrastructure/local/usePosLocalSyncRuntime.ts`](../../packages/athena-webapp/src/lib/pos/infrastructure/local/usePosLocalSyncRuntime.ts)

## Registered Packages
- [Athena Webapp](packages/athena-webapp.md)
- [Storefront Webapp](packages/storefront-webapp.md)
- [Valkey Proxy Server](packages/valkey-proxy-server.md)

## Deep Dives
- [GRAPH_REPORT.md](../GRAPH_REPORT.md) - canonical graph report
- [graph.html](../graph.html) - interactive graph view
