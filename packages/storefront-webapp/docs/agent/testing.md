# Storefront Webapp Testing

Start with the package suite in [vitest.config.ts](../../vitest.config.ts): `bun run --filter '@athena/storefront-webapp' test`. It is the default regression pass for API wrappers, route helpers, checkout state, and shared utility logic.

Escalate validation based on the surface you touched:

- Checkout flows: target [src/components/checkout/deliveryFees.test.ts](../../src/components/checkout/deliveryFees.test.ts), [src/components/checkout/deriveCheckoutState.test.ts](../../src/components/checkout/deriveCheckoutState.test.ts), and [src/api/checkoutSession.test.ts](../../src/api/checkoutSession.test.ts).
- Checkout/auth route-boundary changes: run `bun run --filter '@athena/storefront-webapp' lint:architecture` to catch lower-layer imports that reach back into checkout or auth route entrypoints.
- Store config or observability changes: target [src/lib/storeConfig.test.ts](../../src/lib/storeConfig.test.ts), [src/lib/storefrontObservability.test.ts](../../src/lib/storefrontObservability.test.ts), and [src/lib/storefrontJourneyEvents.test.ts](../../src/lib/storefrontJourneyEvents.test.ts).
- Type or router changes: run `bunx tsc --noEmit -p packages/storefront-webapp/tsconfig.json` or `bun run --filter '@athena/storefront-webapp' build`.
- Full browser journeys, navigation, or payment redirects: run `bun run --filter '@athena/storefront-webapp' test:e2e` with the setup in [playwright.config.ts](../../playwright.config.ts).

This package exposes a scoped architecture lint command in [package.json](../../package.json) for the checkout/auth hot paths; use it when you need lint coverage for those route boundaries instead of assuming the broader package test suite will catch import-direction regressions.
