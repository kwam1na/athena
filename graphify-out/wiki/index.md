# Graphify Wiki

Graphify is the navigation layer for the repo graph. Use the entry docs below for operational rules and validation, and open `graphify-out/GRAPH_REPORT.md` for deeper analysis.

## Entry Docs
- [AGENTS.md](../../AGENTS.md) - repo-wide workflow, guardrails, and graphify usage rules
- [packages/AGENTS.md](../../packages/AGENTS.md) - package router plus the operational guides for each harnessed package

## Repo Summary
- Code files discovered: 2999
- Graph nodes: 12966
- Graph edges: 16050
- Communities: 2923

## Graph Hotspots
- `dailyClose.ts` (104 edges, Community 0) - [`packages/athena-webapp/convex/operations/dailyClose.ts`](../../packages/athena-webapp/convex/operations/dailyClose.ts)
- `convex-operation-admission-check.ts` (102 edges, Community 1) - [`scripts/convex-operation-admission-check.ts`](../../scripts/convex-operation-admission-check.ts)
- `harness-inferential-review.ts` (88 edges, Community 3) - [`scripts/harness-inferential-review.ts`](../../scripts/harness-inferential-review.ts)
- `posLocalStore.ts` (87 edges, Community 2) - [`packages/athena-webapp/src/lib/pos/infrastructure/local/posLocalStore.ts`](../../packages/athena-webapp/src/lib/pos/infrastructure/local/posLocalStore.ts)
- `dailyOperations.ts` (76 edges, Community 4) - [`packages/athena-webapp/convex/operations/dailyOperations.ts`](../../packages/athena-webapp/convex/operations/dailyOperations.ts)
- `terminalHealthPresentation.ts` (76 edges, Community 5) - [`packages/athena-webapp/src/components/pos/terminals/terminalHealthPresentation.ts`](../../packages/athena-webapp/src/components/pos/terminals/terminalHealthPresentation.ts)
- `catalogImport.ts` (75 edges, Community 6) - [`packages/athena-webapp/convex/inventory/catalogImport.ts`](../../packages/athena-webapp/convex/inventory/catalogImport.ts)
- `DailyCloseView.tsx` (71 edges, Community 7) - [`packages/athena-webapp/src/components/operations/DailyCloseView.tsx`](../../packages/athena-webapp/src/components/operations/DailyCloseView.tsx)

## Registered Packages
- [Athena Webapp](packages/athena-webapp.md)
- [Storefront Webapp](packages/storefront-webapp.md)
- [Valkey Proxy Server](packages/valkey-proxy-server.md)

## Deep Dives
- [GRAPH_REPORT.md](../GRAPH_REPORT.md) - canonical graph report
- [graph.html](../graph.html) - interactive graph view
