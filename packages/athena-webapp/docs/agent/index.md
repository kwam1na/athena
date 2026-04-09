# Athena Webapp Agent Docs

- [Architecture](./architecture.md)
- [Testing](./testing.md)
- [Code map](./code-map.md)

Use this harness when the task touches the authenticated dashboard shell in [src/main.tsx](../../src/main.tsx), route files under [src/routes/_authed.tsx](../../src/routes/_authed.tsx), or the Convex-backed HTTP surface in [convex/http.ts](../../convex/http.ts).

Key boundaries to keep in mind:

- Browser entry and generated TanStack Router state live in [src/main.tsx](../../src/main.tsx) and [src/routeTree.gen.ts](../../src/routeTree.gen.ts).
- Inventory and storefront backend routes are composed in [convex/http.ts](../../convex/http.ts) over the schema in [convex/schema.ts](../../convex/schema.ts).
- App-level auth and shell state usually fan out from [src/hooks/useAuth.ts](../../src/hooks/useAuth.ts) and the authenticated layout in [src/routes/_authed.tsx](../../src/routes/_authed.tsx).

Common validation commands:

- `bun run --filter '@athena/webapp' test`
- `bun run --filter '@athena/webapp' audit:convex`
- `bun run --filter '@athena/webapp' lint:convex:changed`
- `bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json`
- `bun run --filter '@athena/webapp' build`
