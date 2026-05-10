# Graphify Wiki

Graphify is the navigation layer for the repo graph. Use the entry docs below for operational rules and validation, and open `graphify-out/GRAPH_REPORT.md` for deeper analysis.

## Entry Docs
- [AGENTS.md](../../AGENTS.md) - repo-wide workflow, guardrails, and graphify usage rules
- [packages/AGENTS.md](../../packages/AGENTS.md) - package router plus the operational guides for each harnessed package

## Repo Summary
- Code files discovered: 1677
- Graph nodes: 5047
- Graph edges: 5052
- Communities: 1606

## Graph Hotspots
- `DailyCloseView.tsx` (71 edges, Community 0) - [`packages/athena-webapp/src/components/operations/DailyCloseView.tsx`](../../packages/athena-webapp/src/components/operations/DailyCloseView.tsx)
- `dailyClose.ts` (54 edges, Community 1) - [`packages/athena-webapp/convex/operations/dailyClose.ts`](../../packages/athena-webapp/convex/operations/dailyClose.ts)
- `harness-inferential-review.ts` (46 edges, Community 2) - [`scripts/harness-inferential-review.ts`](../../scripts/harness-inferential-review.ts)
- `storefrontJourneyEvents.ts` (45 edges, Community 3) - [`packages/storefront-webapp/src/lib/storefrontJourneyEvents.ts`](../../packages/storefront-webapp/src/lib/storefrontJourneyEvents.ts)
- `createJourneyEvent()` (40 edges, Community 3) - [`packages/storefront-webapp/src/lib/storefrontJourneyEvents.ts`](../../packages/storefront-webapp/src/lib/storefrontJourneyEvents.ts)
- `ProcurementView.tsx` (39 edges, Community 4) - [`packages/athena-webapp/src/components/procurement/ProcurementView.tsx`](../../packages/athena-webapp/src/components/procurement/ProcurementView.tsx)
- `DailyOpeningView.tsx` (35 edges, Community 5) - [`packages/athena-webapp/src/components/operations/DailyOpeningView.tsx`](../../packages/athena-webapp/src/components/operations/DailyOpeningView.tsx)
- `DailyOperationsView.tsx` (33 edges, Community 6) - [`packages/athena-webapp/src/components/operations/DailyOperationsView.tsx`](../../packages/athena-webapp/src/components/operations/DailyOperationsView.tsx)

## Registered Packages
- [Athena Webapp](packages/athena-webapp.md)
- [Storefront Webapp](packages/storefront-webapp.md)
- [Valkey Proxy Server](packages/valkey-proxy-server.md)

## Deep Dives
- [GRAPH_REPORT.md](../GRAPH_REPORT.md) - canonical graph report
- [graph.html](../graph.html) - interactive graph view
