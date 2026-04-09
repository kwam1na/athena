# Storefront Webapp Code Map

- Runtime entrypoints: [src/client.tsx](../../src/client.tsx), [src/ssr.tsx](../../src/ssr.tsx), [src/router.tsx](../../src/router.tsx), [src/routes/__root.tsx](../../src/routes/__root.tsx)
- Store and navigation context: [src/contexts/StoreContext.tsx](../../src/contexts/StoreContext.tsx), [src/contexts/NavigationBarProvider.tsx](../../src/contexts/NavigationBarProvider.tsx), [src/contexts/StorefrontObservabilityProvider.tsx](../../src/contexts/StorefrontObservabilityProvider.tsx)
- Checkout flow: [src/components/checkout/CheckoutProvider.tsx](../../src/components/checkout/CheckoutProvider.tsx), [src/components/checkout/deliveryFees.ts](../../src/components/checkout/deliveryFees.ts), [src/components/checkout/BagSummary.tsx](../../src/components/checkout/BagSummary.tsx)
- API and query layer: [src/api/storefront.ts](../../src/api/storefront.ts), [src/api/checkoutSession.ts](../../src/api/checkoutSession.ts), [src/lib/queries/onlineOrder.ts](../../src/lib/queries/onlineOrder.ts)
- Observability and event helpers: [src/lib/storefrontObservability.ts](../../src/lib/storefrontObservability.ts), [src/lib/storefrontJourneyEvents.ts](../../src/lib/storefrontJourneyEvents.ts)
