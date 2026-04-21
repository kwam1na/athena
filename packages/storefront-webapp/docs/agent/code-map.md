# Storefront Webapp Code Map

- [Route index](./route-index.md)
- [Key folder index](./key-folder-index.md)

- Runtime entrypoints: [src/client.tsx](../../src/client.tsx), [src/ssr.tsx](../../src/ssr.tsx), [src/router.tsx](../../src/router.tsx), [src/routes/__root.tsx](../../src/routes/__root.tsx)
- Store and navigation context: [src/contexts/StoreContext.tsx](../../src/contexts/StoreContext.tsx), [src/contexts/NavigationBarProvider.tsx](../../src/contexts/NavigationBarProvider.tsx), [src/contexts/StorefrontObservabilityProvider.tsx](../../src/contexts/StorefrontObservabilityProvider.tsx)
- Checkout flow: [src/components/checkout/CheckoutProvider.tsx](../../src/components/checkout/CheckoutProvider.tsx), [src/components/checkout/deliveryFees.ts](../../src/components/checkout/deliveryFees.ts), [src/components/checkout/BagSummary.tsx](../../src/components/checkout/BagSummary.tsx)
- API and query layer: [src/api/storefront.ts](../../src/api/storefront.ts), [src/api/checkoutSession.ts](../../src/api/checkoutSession.ts), [src/lib/queries/onlineOrder.ts](../../src/lib/queries/onlineOrder.ts)
- Order history and rewards surfaces: [src/api/onlineOrder.ts](../../src/api/onlineOrder.ts), [src/routes/_layout/_ordersLayout/shop/orders/index.tsx](../../src/routes/_layout/_ordersLayout/shop/orders/index.tsx), [src/routes/_layout/_ordersLayout/shop/orders/$orderId/index.tsx](../../src/routes/_layout/_ordersLayout/shop/orders/$orderId/index.tsx), [src/routes/_layout/rewards.index.tsx](../../src/routes/_layout/rewards.index.tsx), [src/components/rewards/RewardsPanel.tsx](../../src/components/rewards/RewardsPanel.tsx), [src/components/rewards/OrderPointsDisplay.tsx](../../src/components/rewards/OrderPointsDisplay.tsx), [src/components/rewards/GuestRewardsPrompt.tsx](../../src/components/rewards/GuestRewardsPrompt.tsx)
- Observability and event helpers: [src/lib/storefrontObservability.ts](../../src/lib/storefrontObservability.ts), [src/lib/storefrontJourneyEvents.ts](../../src/lib/storefrontJourneyEvents.ts)
