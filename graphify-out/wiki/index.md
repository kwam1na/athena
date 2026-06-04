# Graphify Wiki

Graphify is the navigation layer for the repo graph. Use the entry docs below for operational rules and validation, and open `graphify-out/GRAPH_REPORT.md` for deeper analysis.

## Entry Docs
- [AGENTS.md](../../AGENTS.md) - repo-wide workflow, guardrails, and graphify usage rules
- [packages/AGENTS.md](../../packages/AGENTS.md) - package router plus the operational guides for each harnessed package

## Repo Summary
- Code files discovered: 1825
- Graph nodes: 6126
- Graph edges: 6586
- Communities: 1753

## Graph Hotspots
- `DailyCloseView.tsx` (84 edges, Community 0) - [`packages/athena-webapp/src/components/operations/DailyCloseView.tsx`](../../packages/athena-webapp/src/components/operations/DailyCloseView.tsx)
- `dailyClose.ts` (65 edges, Community 1) - [`packages/athena-webapp/convex/operations/dailyClose.ts`](../../packages/athena-webapp/convex/operations/dailyClose.ts)
- `useRegisterViewModel.ts` (58 edges, Community 2) - [`packages/athena-webapp/src/lib/pos/presentation/register/useRegisterViewModel.ts`](../../packages/athena-webapp/src/lib/pos/presentation/register/useRegisterViewModel.ts)
- `harness-inferential-review.ts` (46 edges, Community 3) - [`scripts/harness-inferential-review.ts`](../../scripts/harness-inferential-review.ts)
- `RegisterSessionView.tsx` (45 edges, Community 4) - [`packages/athena-webapp/src/components/cash-controls/RegisterSessionView.tsx`](../../packages/athena-webapp/src/components/cash-controls/RegisterSessionView.tsx)
- `storefrontJourneyEvents.ts` (45 edges, Community 5) - [`packages/storefront-webapp/src/lib/storefrontJourneyEvents.ts`](../../packages/storefront-webapp/src/lib/storefrontJourneyEvents.ts)
- `usePosLocalSyncRuntime.ts` (44 edges, Community 6) - [`packages/athena-webapp/src/lib/pos/infrastructure/local/usePosLocalSyncRuntime.ts`](../../packages/athena-webapp/src/lib/pos/infrastructure/local/usePosLocalSyncRuntime.ts)
- `ProcurementView.tsx` (41 edges, Community 8) - [`packages/athena-webapp/src/components/procurement/ProcurementView.tsx`](../../packages/athena-webapp/src/components/procurement/ProcurementView.tsx)

## Registered Packages
- [Athena Webapp](packages/athena-webapp.md)
- [Storefront Webapp](packages/storefront-webapp.md)
- [Valkey Proxy Server](packages/valkey-proxy-server.md)

## Deep Dives
- [GRAPH_REPORT.md](../GRAPH_REPORT.md) - canonical graph report
- [graph.html](../graph.html) - interactive graph view
