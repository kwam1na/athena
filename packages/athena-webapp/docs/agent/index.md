# Athena Webapp Agent Docs

- [Architecture](./architecture.md)
- [Testing](./testing.md)
- [Code map](./code-map.md)
- [Route index](./route-index.md)
- [Test index](./test-index.md)
- [Key folder index](./key-folder-index.md)
- [Validation guide](./validation-guide.md)

Use this harness when the task touches the authenticated dashboard shell in [src/main.tsx](../../src/main.tsx), route files under [src/routes/_authed.tsx](../../src/routes/_authed.tsx), or the Convex-backed HTTP surface in [convex/http.ts](../../convex/http.ts).

The generated indexes above are the fastest way to confirm the current route set, test surface layout, and package landmarks before you read deeper docs.

Key boundaries to keep in mind:

- Browser entry and generated TanStack Router state live in [src/main.tsx](../../src/main.tsx) and [src/routeTree.gen.ts](../../src/routeTree.gen.ts).
- Inventory and storefront backend routes are composed in [convex/http.ts](../../convex/http.ts) over the schema in [convex/schema.ts](../../convex/schema.ts).
- App-level auth and shell state usually fan out from [src/hooks/useAuth.ts](../../src/hooks/useAuth.ts) and the authenticated layout in [src/routes/_authed.tsx](../../src/routes/_authed.tsx).
- Shared workflow traces now converge under [convex/workflowTraces](../../convex/workflowTraces), the shared trace contract in [shared/workflowTrace.ts](../../shared/workflowTrace.ts), the store-scoped route in [src/routes/_authed/$orgUrlSlug/store/$storeUrlSlug/traces/$traceId.tsx](../../src/routes/_authed/$orgUrlSlug/store/$storeUrlSlug/traces/$traceId.tsx), and the reusable trace UI in [src/components/traces/WorkflowTraceView.tsx](../../src/components/traces/WorkflowTraceView.tsx).
- POS workflow traces now layer on top of that foundation through [convex/workflowTraces/adapters/posSale.ts](../../convex/workflowTraces/adapters/posSale.ts), [convex/workflowTraces/adapters/posSession.ts](../../convex/workflowTraces/adapters/posSession.ts), [convex/workflowTraces/adapters/registerSession.ts](../../convex/workflowTraces/adapters/registerSession.ts), the write-path helpers in [convex/pos/application/commands/posSessionTracing.ts](../../convex/pos/application/commands/posSessionTracing.ts) and [convex/operations/registerSessionTracing.ts](../../convex/operations/registerSessionTracing.ts), and the operator entry points under [src/components/pos](../../src/components/pos), [src/components/pos/transactions](../../src/components/pos/transactions), and [src/components/cash-controls](../../src/components/cash-controls).
- POS register bootstrap now pauses behind the drawer gate in [src/components/pos/register/POSRegisterView.tsx](../../src/components/pos/register/POSRegisterView.tsx) and [src/lib/pos/presentation/register/useRegisterViewModel.ts](../../src/lib/pos/presentation/register/useRegisterViewModel.ts); confirm the downstream result in [src/components/cash-controls/CashControlsDashboard.tsx](../../src/components/cash-controls/CashControlsDashboard.tsx) and [src/components/cash-controls/RegisterSessionView.tsx](../../src/components/cash-controls/RegisterSessionView.tsx) whenever drawer-opening behavior changes.
- Stock adjustments, purchase-order workflows, replenishment guidance, and receiving now converge under `convex/stockOps/*` plus the operator views in `src/components/operations` and `src/components/procurement`.
- Omnichannel returns, exchanges, loyalty milestones, and follow-up history now converge under `convex/storeFront/*` plus the operator views in `src/components/orders` and `src/components/users`.

Common validation commands:

- `bun run --filter '@athena/webapp' test`
- `bun run --filter '@athena/webapp' audit:convex`
- `bun run --filter '@athena/webapp' lint:convex:changed`
- `bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json`
- `bun run --filter '@athena/webapp' build`

Generated Convex client note:

- If you need refreshed `convex/_generated` artifacts or new client refs, start `bunx convex dev` from `packages/athena-webapp`.
- Do not default to `bunx convex codegen`; in this repo it can fail in local workspaces that do not have `CONVEX_DEPLOYMENT` configured.
