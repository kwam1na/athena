# Storefront Webapp Agent Docs

- [Architecture](./architecture.md)
- [Testing](./testing.md)
- [Code map](./code-map.md)
- [Route index](./route-index.md)
- [Test index](./test-index.md)
- [Key folder index](./key-folder-index.md)
- [Validation guide](./validation-guide.md)

Use this harness when the task touches the shipped browser runtime in [index.html](../../index.html), [src/main.tsx](../../src/main.tsx), and [src/router.tsx](../../src/router.tsx), top-level layout composition in [src/routes/__root.tsx](../../src/routes/__root.tsx), or the browser-to-backend request layer in [src/api/storefront.ts](../../src/api/storefront.ts).

The generated indexes above are the quickest way to confirm the current route tree, test layout, and key folders before you drill into specific modules.

Key boundaries to keep in mind:

- Router runtime wiring lives in [index.html](../../index.html), [src/main.tsx](../../src/main.tsx), and [src/router.tsx](../../src/router.tsx).
- Catalog, bag, and checkout state are coordinated through [src/contexts/StoreContext.tsx](../../src/contexts/StoreContext.tsx), [src/hooks/useShoppingBag.ts](../../src/hooks/useShoppingBag.ts), and [src/components/checkout/CheckoutProvider.tsx](../../src/components/checkout/CheckoutProvider.tsx).
- Most backend calls are thin wrappers under `src/api`, including [src/api/storefront.ts](../../src/api/storefront.ts) and [src/api/checkoutSession.ts](../../src/api/checkoutSession.ts).
- Customer-facing order history and rewards are thin consumers of Athena-owned omnichannel contracts through [src/api/onlineOrder.ts](../../src/api/onlineOrder.ts), [src/lib/queries/onlineOrder.ts](../../src/lib/queries/onlineOrder.ts), and the routes under `src/routes/_layout/_ordersLayout/shop/orders/**` plus `/rewards`.

Common validation commands:

- `bun run --filter '@athena/storefront-webapp' test`
- `bunx tsc --noEmit -p packages/storefront-webapp/tsconfig.json`
- `bun run --filter '@athena/storefront-webapp' build`
- `bun run --filter '@athena/storefront-webapp' test:e2e`
