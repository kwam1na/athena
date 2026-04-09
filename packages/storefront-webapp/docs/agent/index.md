# Storefront Webapp Agent Docs

- [Architecture](./architecture.md)
- [Testing](./testing.md)
- [Code map](./code-map.md)

Use this harness when the task touches the TanStack Start runtime in [src/client.tsx](../../src/client.tsx) and [src/ssr.tsx](../../src/ssr.tsx), top-level layout composition in [src/routes/__root.tsx](../../src/routes/__root.tsx), or the browser-to-backend request layer in [src/api/storefront.ts](../../src/api/storefront.ts).

Key boundaries to keep in mind:

- Router runtime wiring lives in [src/router.tsx](../../src/router.tsx), [src/client.tsx](../../src/client.tsx), and [src/ssr.tsx](../../src/ssr.tsx).
- Catalog, bag, and checkout state are coordinated through [src/contexts/StoreContext.tsx](../../src/contexts/StoreContext.tsx), [src/hooks/useShoppingBag.ts](../../src/hooks/useShoppingBag.ts), and [src/components/checkout/CheckoutProvider.tsx](../../src/components/checkout/CheckoutProvider.tsx).
- Most backend calls are thin wrappers under `src/api`, including [src/api/storefront.ts](../../src/api/storefront.ts) and [src/api/checkoutSession.ts](../../src/api/checkoutSession.ts).

Common validation commands:

- `bun run --filter '@athena/storefront-webapp' test`
- `bunx tsc --noEmit -p packages/storefront-webapp/tsconfig.json`
- `bun run --filter '@athena/storefront-webapp' build`
- `bun run --filter '@athena/storefront-webapp' test:e2e`
