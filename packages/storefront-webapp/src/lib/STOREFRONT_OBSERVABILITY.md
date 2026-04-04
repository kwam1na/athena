# Storefront Observability Contract

New storefront telemetry must use `useStorefrontObservability()` or the pure helpers in `storefrontObservability.ts`. New work should not introduce more direct `postAnalytics(...)` calls with ad hoc action names.

## Transport

- `action`: always `storefront_observability`
- `origin`: preserved as the top-level analytics origin when available
- `data`: the canonical forward-looking observability payload

## Canonical Payload Fields

- `schemaVersion`
- `journey`
- `step`
- `status`
- `route`
- `userType`
- `sessionId`
- optional domain ids such as `productId`, `checkoutSessionId`, and `orderId`
- optional failure metadata:
  - `errorCategory`
  - `errorCode`
  - `errorMessage`

## Journey Taxonomy

- `browse`
- `product_discovery`
- `bag`
- `checkout`
- `auth`

## Status Model

- `viewed`
- `started`
- `succeeded`
- `failed`
- `blocked`
- `canceled`

## Step Naming

Steps must use `snake_case` and should name a single journey milestone, not pack outcome into the step. Examples:

- `landing_page`
- `product_detail`
- `bag_view`
- `payment_submission`
- `auth_verification`

The outcome belongs in `status`, not in a custom action name.

## Migration Rule

- New storefront telemetry is intentionally forward-looking.
- Backward compatibility with legacy storefront analytics event names is not required.
- Historical analytics may remain as-is, but new instrumentation should emit the canonical payload above.
