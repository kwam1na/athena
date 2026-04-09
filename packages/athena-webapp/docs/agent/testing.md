# Athena Webapp Testing

Start with the package suite in [vitest.config.ts](../../vitest.config.ts): `bun run --filter '@athena/webapp' test`. It covers both `src/**/*.test.{ts,tsx}` and `convex/**/*.test.{ts,tsx}`, so it is the default regression pass for mixed UI and backend changes.

Escalate validation based on the surface you touched:

- Convex HTTP composition or auth-route changes: run targeted tests like [convex/http/routerComposition.test.ts](../../convex/http/routerComposition.test.ts) and [convex/http/domains/storeFront/routes/security.test.ts](../../convex/http/domains/storeFront/routes/security.test.ts).
- Inventory query or POS behavior changes: spot-check existing guards such as [convex/inventory/posQueryCleanup.test.ts](../../convex/inventory/posQueryCleanup.test.ts) and [src/tests/pos/usePrint.test.ts](../../src/tests/pos/usePrint.test.ts).
- Any change under `convex/`: run `bun run --filter '@athena/webapp' audit:convex` and `bun run --filter '@athena/webapp' lint:convex:changed` before PR handoff.
- Route, typing, or build-pipeline changes: run `bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json` or `bun run --filter '@athena/webapp' build`.

Avoid editing generated files like [src/routeTree.gen.ts](../../src/routeTree.gen.ts) or anything under `convex/_generated`; regenerate instead if a tool owns them.
