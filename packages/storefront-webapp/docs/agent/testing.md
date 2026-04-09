# Storefront Webapp Testing

Start with the package suite in [vitest.config.ts](../../vitest.config.ts): `bun run --filter '@athena/storefront-webapp' test`. It is the default regression pass for API wrappers, route helpers, checkout state, and shared utility logic.

Escalate validation based on the surface you touched:

- Checkout flows: target [src/components/checkout/deliveryFees.test.ts](../../src/components/checkout/deliveryFees.test.ts), [src/components/checkout/deriveCheckoutState.test.ts](../../src/components/checkout/deriveCheckoutState.test.ts), and [src/api/checkoutSession.test.ts](../../src/api/checkoutSession.test.ts).
- Store config or observability changes: target [src/lib/storeConfig.test.ts](../../src/lib/storeConfig.test.ts), [src/lib/storefrontObservability.test.ts](../../src/lib/storefrontObservability.test.ts), and [src/lib/storefrontJourneyEvents.test.ts](../../src/lib/storefrontJourneyEvents.test.ts).
- Type or router changes: run `bunx tsc --noEmit -p packages/storefront-webapp/tsconfig.json` or `bun run --filter '@athena/storefront-webapp' build`.
- Full browser journeys, navigation, or payment redirects: run `bun run --filter '@athena/storefront-webapp' test:e2e` with the setup in [playwright.config.ts](../../playwright.config.ts).

This package does not expose a dedicated lint script in [package.json](../../package.json). If you need lint coverage for a risky refactor, run ESLint intentionally rather than assuming `pr:athena` will do it for you.
