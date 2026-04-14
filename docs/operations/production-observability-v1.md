# Production Observability v1

This runbook defines the production monitoring contract for Athena and the storefront web app. Use it to configure Cloudflare, Checkly, and Slack consistently without guessing which signals are repo-controlled versus account-controlled.

## Scope

- Environment: production only
- Alert destination: one dedicated Slack incident channel
- Detection layers:
  - Cloudflare for Athena backend reachability
  - Checkly browser checks for storefront customer-visible readiness and checkout-start behavior
  - Checkly browser check for Athena login reachability

## Monitor Inventory

| Surface | Detector | Target | Success contract | Alert class |
|---------|----------|--------|------------------|-------------|
| Athena public backend | Cloudflare health check | `https://<athena-api-host>/health` | HTTP `200` with shallow JSON from [packages/athena-webapp/convex/http.ts](../../packages/athena-webapp/convex/http.ts) | `Availability` |
| Athena login entry | Checkly browser check | `https://<athena-app-host>/login` | Page renders `[data-testid=\"athena-login-ready\"]` from [packages/athena-webapp/src/routes/login/_layout.index.tsx](../../packages/athena-webapp/src/routes/login/_layout.index.tsx) | `Journey` |
| Storefront homepage readiness | Checkly browser check | `https://<storefront-host>/` | Page renders `[data-testid=\"storefront-homepage-ready\"]` from [packages/storefront-webapp/src/components/HomePage.tsx](../../packages/storefront-webapp/src/components/HomePage.tsx) | `Journey` |
| Storefront checkout-start journey | Checkly browser check | `https://<storefront-host>/shop/product/<monitor-product-slug>?origin=synthetic_monitor` | Product page, add-to-bag, bag checkout start, and checkout ready selectors all succeed | `Journey` |

Storefront does not expose a shallow public `/health` route. Do not add a route-local health page under `packages/storefront-webapp/src/routes` or treat a plain homepage `200` as the primary readiness contract. Use the browser selectors above instead.

## Repo-Controlled Contracts

These contracts live in the repo and should not be changed in the monitoring vendors without a matching code or docs update:

- Athena shallow health endpoint:
  - Path: `/health`
  - Purpose: prove the public host, tunnel, and Hono boundary can answer unauthenticated traffic
  - Current payload contract: shallow JSON with `app` and `status`
- Athena login readiness selector:
  - `data-testid=\"athena-login-ready\"`
- Storefront readiness selectors:
  - homepage: `data-testid=\"storefront-homepage-ready\"`
  - product CTA: `data-testid=\"storefront-product-add-to-bag\"`
  - bag CTA: `data-testid=\"storefront-bag-start-checkout\"`
  - checkout shell: `data-testid=\"storefront-checkout-ready\"`
- Synthetic traffic marker:
  - query param or route state must preserve `origin=synthetic_monitor`
  - canonical contract lives in [packages/storefront-webapp/src/lib/STOREFRONT_OBSERVABILITY.md](../../packages/storefront-webapp/src/lib/STOREFRONT_OBSERVABILITY.md)
- Dedicated monitor merchandise:
  - production must maintain one always-available monitor product or SKU for synthetic runs
  - use explicit monitor configuration, never “pick any live product”

## External Configuration

These values are configured outside the repo and must be maintained in the monitoring vendors or secret stores:

| System | Config | Notes |
|--------|--------|-------|
| Cloudflare | Athena API host | Point the health check at the production Convex HTTP or API gateway hostname, not the browser app host |
| Cloudflare | Health check path | `/health` |
| Cloudflare | Interval | `1 minute` |
| Cloudflare | Failure threshold | alert after `2` consecutive failures |
| Cloudflare | Recovery threshold | recover after `1` success |
| Checkly | Primary region | use one region in v1, closest to the production audience |
| Checkly | Athena app host | public Athena browser host that serves `/login` |
| Checkly | Storefront base URL | public storefront host |
| Checkly | Monitor product slug | use the dedicated production monitor product, not a rotating live listing |
| Checkly | Monitor product SKU | optional when the monitor product has multiple variants |
| Checkly | Browser retry policy | alert after `2` failed runs; recover after `1` passing run |
| Checkly | Browser schedule | every `5 minutes` |
| Slack | Incident channel | one shared production incident channel for all observability v1 alerts |
| Slack | Incoming webhook or app integration | used directly by the vendors, or by a thin relay if a vendor plan cannot post to Slack natively |

Repo-native checkout bootstrap helpers already use:

- `PLAYWRIGHT_CHECKOUT_PRODUCT_SLUG`
- optional `PLAYWRIGHT_CHECKOUT_PRODUCT_SKU`

If operators wire Checkly through shared repo automation or bootstrap helpers, map the monitor product inputs to those existing names instead of inventing a parallel secret contract.

## Cloudflare Setup

Configure exactly one production alerting health check for Athena:

1. Target the production Athena API host and `/health`.
2. Keep the check unauthenticated and shallow.
3. Set the interval to one minute.
4. Trigger Slack after two consecutive failures.
5. Send a matching recovery notification after the first healthy response.

The Athena login browser check should point at the Athena app host separately. In production deploys those surfaces are configured independently through `VITE_API_GATEWAY_URL` and the Athena browser app host.

Operational expectation:

- Run at least two production `cloudflared` connectors for the Athena public origin so one connector failure does not take alert coverage down with the service.
- If Cloudflare reports Athena down but Checkly login still passes, treat the Cloudflare alert as a routing or health-check configuration problem first.

## Checkly Setup

Create three production browser checks.

### Athena Login Reachability

1. Load the public Athena login URL.
2. Wait for `[data-testid=\"athena-login-ready\"]`.
3. Do not authenticate.
4. Alert after two failed runs.
5. Send recovery after one passing run.

### Storefront Homepage Readiness

1. Load the public storefront homepage.
2. Wait for `[data-testid=\"storefront-homepage-ready\"]`.
3. Keep the check shallow and unauthenticated.
4. Alert after two failed runs.
5. Send recovery after one passing run.

### Storefront Checkout-Start Journey

1. Start from the dedicated monitor product URL with `origin=synthetic_monitor`.
2. Confirm `[data-testid=\"storefront-product-add-to-bag\"]`.
3. Add the monitor product to the bag.
4. Confirm `[data-testid=\"storefront-bag-start-checkout\"]`.
5. Start checkout.
6. Confirm `[data-testid=\"storefront-checkout-ready\"]`.

Use the production monitor SKU every time. Do not rotate through live merch or scrape category pages for a random in-stock item.

## Slack Alerting

Send all alerts and recoveries into one production incident channel. Each message should include:

- app or surface
- environment
- check name
- failing URL
- failing step when applicable
- first failed time
- direct link to the Cloudflare or Checkly incident page

Use two user-facing classes only:

- `Availability`: Athena `/health` failure
- `Journey`: Athena login reachability or storefront checkout-start failure

## Triage Guidance

- `Availability` alert only:
  - suspect Athena public routing, tunnel, or origin reachability first
  - validate `cloudflared` redundancy before debugging application code
- `Journey` alert on Athena login:
  - suspect public page boot, static asset delivery, or auth-entry rendering
- `Journey` alert on storefront:
  - inspect Athena storefront observability diagnostics for `origin=synthetic_monitor`
  - use the failing selector or step to decide whether the break is on product render, bag transition, or checkout boot

Repeated synthetic runs are expected. Treat `origin=synthetic_monitor` as deliberate operator traffic, not as customer behavior and not as fraud or abnormal commerce activity.

## Deferred or Unsupported in v1

- No full authenticated Athena admin synthetic
- No full storefront payment completion synthetic
- No storefront route-local `/health`
- No multi-region browser quorum or canary routing logic

If those become required, create a follow-up Linear ticket instead of widening this contract informally in vendor dashboards.
