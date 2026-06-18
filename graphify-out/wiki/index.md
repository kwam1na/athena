# Graphify Wiki

Graphify is the navigation layer for the repo graph. Use the entry docs below for operational rules and validation, and open `graphify-out/GRAPH_REPORT.md` for deeper analysis.

## Entry Docs
- [AGENTS.md](../../AGENTS.md) - repo-wide workflow, guardrails, and graphify usage rules
- [packages/AGENTS.md](../../packages/AGENTS.md) - package router plus the operational guides for each harnessed package

## Repo Summary
- Code files discovered: 1981
- Graph nodes: 7184
- Graph edges: 8250
- Communities: 1909

## Graph Hotspots
- `DailyCloseView.tsx` (88 edges, Community 0) - [`packages/athena-webapp/src/components/operations/DailyCloseView.tsx`](../../packages/athena-webapp/src/components/operations/DailyCloseView.tsx)
- `harness-inferential-review.ts` (85 edges, Community 1) - [`scripts/harness-inferential-review.ts`](../../scripts/harness-inferential-review.ts)
- `dailyClose.ts` (65 edges, Community 2) - [`packages/athena-webapp/convex/operations/dailyClose.ts`](../../packages/athena-webapp/convex/operations/dailyClose.ts)
- `ingestLocalEvents.ts` (54 edges, Community 3) - [`packages/athena-webapp/convex/pos/application/sync/ingestLocalEvents.ts`](../../packages/athena-webapp/convex/pos/application/sync/ingestLocalEvents.ts)
- `projectLocalEvents.ts` (53 edges, Community 4) - [`packages/athena-webapp/convex/pos/application/sync/projectLocalEvents.ts`](../../packages/athena-webapp/convex/pos/application/sync/projectLocalEvents.ts)
- `terminalHealthPresentation.ts` (49 edges, Community 5) - [`packages/athena-webapp/src/components/pos/terminals/terminalHealthPresentation.ts`](../../packages/athena-webapp/src/components/pos/terminals/terminalHealthPresentation.ts)
- `posLocalStore.ts` (48 edges, Community 6) - [`packages/athena-webapp/src/lib/pos/infrastructure/local/posLocalStore.ts`](../../packages/athena-webapp/src/lib/pos/infrastructure/local/posLocalStore.ts)
- `dailyOperations.ts` (47 edges, Community 7) - [`packages/athena-webapp/convex/operations/dailyOperations.ts`](../../packages/athena-webapp/convex/operations/dailyOperations.ts)

## Registered Packages
- [Athena Webapp](packages/athena-webapp.md)
- [Storefront Webapp](packages/storefront-webapp.md)
- [Valkey Proxy Server](packages/valkey-proxy-server.md)

## Deep Dives
- [GRAPH_REPORT.md](../GRAPH_REPORT.md) - canonical graph report
- [graph.html](../graph.html) - interactive graph view
