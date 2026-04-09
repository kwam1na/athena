# Athena Webapp Code Map

- App bootstrap and routing: [src/main.tsx](../../src/main.tsx), [src/routes/index.tsx](../../src/routes/index.tsx), [src/routes/_authed.tsx](../../src/routes/_authed.tsx), [src/routeTree.gen.ts](../../src/routeTree.gen.ts)
- Auth and shared frontend state: [src/hooks/useAuth.ts](../../src/hooks/useAuth.ts), [src/components/providers/currency-provider.tsx](../../src/components/providers/currency-provider.tsx)
- Inventory backend surfaces: [convex/inventory/stores.ts](../../convex/inventory/stores.ts), [convex/http/domains/inventory/routes/stores.ts](../../convex/http/domains/inventory/routes/stores.ts), [convex/http/domains/inventory/routes/analytics.ts](../../convex/http/domains/inventory/routes/analytics.ts)
- Storefront backend surfaces: [convex/storeFront/checkoutSession.ts](../../convex/storeFront/checkoutSession.ts), [convex/http/domains/storeFront/routes/checkout.ts](../../convex/http/domains/storeFront/routes/checkout.ts), [convex/http/domains/storeFront/routes/storefront.ts](../../convex/http/domains/storeFront/routes/storefront.ts)
- Existing guardrail tests: [convex/http/routerComposition.test.ts](../../convex/http/routerComposition.test.ts), [convex/inventory/posQueryCleanup.test.ts](../../convex/inventory/posQueryCleanup.test.ts), [src/tests/pos/usePrint.test.ts](../../src/tests/pos/usePrint.test.ts)
