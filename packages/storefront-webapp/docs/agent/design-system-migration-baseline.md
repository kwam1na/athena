# Storefront Design-System Migration Baseline

This is the contract freeze for the 34 storefront route sources present when normalization
began. It records behavior that presentation work must preserve; it is not a claim that every
state already has ideal UI or automated coverage.

## How to use this matrix

Before migrating a row, confirm its URL and search parameters, reachable state transitions,
readiness selectors or test IDs, persistence, telemetry timing, and baseline evidence. Add a
focused automated check or a policy-compliant capture when the listed evidence is only source
characterization. Do not change a redirect destination, storage shape, API call, payment
transition, merchandising decision, selector, or journey event as part of visual normalization.

“Shell” means the route composes providers or an outlet and has no independent customer data
state. “None local” means the route adds no persistence or telemetry itself; contracts owned by
its children still apply. Dynamic values below are placeholders, never retained live data.

| Route source | URL / search contract | Reachable states and transitions | Readiness / selectors | Persistence | Telemetry | Baseline evidence |
|---|---|---|---|---|---|---|
| `src/routes/__root.tsx` | All URLs; validated global search includes `color`, `length`, `checkoutSessionId`, `email`, `origin`, `utm_source`, `reference` | Store loading, maintenance, normal shell, error, not-found | `body`, navigation, route outlet | Store provider and query cache; no new storage | Observability provider preserves child timing | Source characterization + boot E2E |
| `src/routes/_layout.tsx` | Layout-only parent | Shell/outlet | Navigation and outlet content | None local | None local | Source characterization + boot E2E |
| `src/routes/_layout/_ordersLayout.tsx` | Orders layout parent | Shell/outlet | Orders outlet | Auth inherited from children | None local | Source characterization |
| `src/routes/_layout/_ordersLayout/shop/orders/$orderId/$orderItemId.review.tsx` | `/shop/orders/:orderId/:orderItemId/review` | Loading, unavailable/error, review form, submitted | Existing headings, form controls, submit action | Existing review and auth state | Existing review journey events retain order/item context and timing | Source characterization; add synthetic order fixture before capture |
| `src/routes/_layout/_ordersLayout/shop/orders/$orderId/index.tsx` | `/shop/orders/:orderId` | Loading, missing/error, order detail success | Existing order heading and item links | Logged-in customer identity | Existing order-detail telemetry | Source characterization; synthetic order fixture required |
| `src/routes/_layout/_ordersLayout/shop/orders/$orderId/review.tsx` | `/shop/orders/:orderId/review` | Loading, missing/error, eligible items, redirect/complete | Existing review heading, item actions | Logged-in customer identity and review state | Existing review-entry telemetry | Source characterization; synthetic order fixture required |
| `src/routes/_layout/_ordersLayout/shop/orders/index.tsx` | `/shop/orders/` | Loading, empty, error, order list | Existing orders heading and order links | Logged-in customer identity | Existing order-list telemetry | Source characterization; synthetic empty/list fixtures required |
| `src/routes/_layout/_shopLayout.tsx` | Shop layout parent | Store/catalog loading, unavailable/error, shell/outlet | Shop navigation and outlet content | Store context, bag, saved items | Child journey timing remains unchanged | Source characterization + catalog browser scenarios |
| `src/routes/_layout/_shopLayout/shop/$categorySlug/$subcategorySlug.tsx` | `/shop/:categorySlug/:subcategorySlug` | Loading, empty, unavailable/error, product grid | Existing product links and filter controls | Store config, bag, saved items | Existing catalog/context events | Source characterization; synthetic category fixture required |
| `src/routes/_layout/_shopLayout/shop/$categorySlug/index.tsx` | `/shop/:categorySlug/` | Loading, empty, unavailable/error, category success | Existing category heading and product links | Store config, bag, saved items | Existing catalog/context events | Source characterization; synthetic category fixture required |
| `src/routes/_layout/account.tsx` | `/account`; unauthenticated redirects to `/login` | Auth check, redirect, loading, error, account success | Existing account heading and controls | `LOGGED_IN_USER_ID_KEY`; storage shape is frozen | Existing account/auth events | Source characterization; synthetic authenticated fixture required |
| `src/routes/_layout/contact-us.tsx` | `/contact-us` | Static success; outbound/contact actions | Existing page heading and links | None local | Existing page/context telemetry | Source characterization |
| `src/routes/_layout/policies/delivery-returns-exchanges.index.tsx` | `/policies/delivery-returns-exchanges/` | Static success | Existing page heading and policy links | None local | Existing page/context telemetry | Source characterization |
| `src/routes/_layout/policies/privacy.index.tsx` | `/policies/privacy/` | Static success | Existing page heading | None local | Existing page/context telemetry | Source characterization |
| `src/routes/_layout/policies/tos.index.tsx` | `/policies/tos/` | Static success | Existing page heading and links | None local | Existing page/context telemetry | Source characterization |
| `src/routes/_layout/rewards.index.tsx` | `/rewards/`; current auth navigation remains unchanged | Auth redirect/navigation, loading, error, rewards success | Existing rewards heading and actions | Logged-in customer identity and loyalty query cache | Existing rewards/context events | Source characterization; synthetic balance fixture required |
| `src/routes/_layout/shop.product.$productSlug.tsx` | `/shop/product/:productSlug`; global `color` and `length` search values | Loading, missing/error, product success, option changes, add/save actions | Existing product heading and option controls; `data-testid="storefront-product-add-to-bag"` | Bag, saved items, store config; URL options | Existing product-view and commerce events retain timing | Source characterization; synthetic product variants required |
| `src/routes/_layout/shop.saved.index.tsx` | `/shop/saved/` | Loading, empty, error, saved-product list | Existing saved heading and product actions | Existing saved-item store | Existing saved-item/context events | Source characterization; synthetic empty/list fixtures required |
| `src/routes/auth.verify.tsx` | `/auth/verify`; `email` and existing return/origin search values | Ready, submitting, invalid/expired code, success, current redirect | Existing code inputs, resend and verify actions | Auth challenge state; writes `LOGGED_IN_USER_ID_KEY` only on success | Verification view/request/success events preserve timing | Source characterization + auth tests; synthetic identity only |
| `src/routes/index.tsx` | `/` plus accepted global campaign/search values | Home loading, error/fallback, success | `data-testid="storefront-homepage-ready"` and `data-testid="homepage-critical-content"` | Store config and catalog query cache | Existing home/context events | Source characterization + boot E2E |
| `src/routes/login.tsx` | `/login`; `email`, `origin`, and current return search values | Existing-user redirect, ready, submitting, failure, verification transition | Existing email field and submit action | Reads/removes `LOGGED_IN_USER_ID_KEY` under current auth rules | Login entry/request events preserve timing | Source characterization + auth tests |
| `src/routes/shop/bag.index.tsx` | `/shop/bag/` | Empty, populated, quantity update, removal, checkout transition | Existing bag items and quantity controls; `data-testid="storefront-bag-start-checkout"` | Existing shopping-bag storage shape is immutable | Existing bag/checkout journey events | Source characterization; synthetic empty/populated fixtures required |
| `src/routes/shop/checkout/$sessionIdSlug/canceled.tsx` | `/shop/checkout/:sessionIdSlug/canceled` | Loading, missing/error, canceled success, return action | Existing canceled heading and navigation actions | Checkout session identity; no storage-shape change | Checkout-canceled event remains after session resolution | Source characterization; synthetic canceled session required |
| `src/routes/shop/checkout/$sessionIdSlug/complete.tsx` | `/shop/checkout/:sessionIdSlug/complete` | Loading, missing/error, completed order success | Existing completion heading and order actions | Checkout session and order query state | Existing completion telemetry timing | Source characterization; synthetic completed session required |
| `src/routes/shop/checkout/$sessionIdSlug/incomplete.tsx` | `/shop/checkout/:sessionIdSlug/incomplete` | Loading, missing/error, blocked/incomplete state, recovery action | Existing incomplete heading and actions | Checkout session and order state remain intact | Completion-blocked event fires from resolved order state | Source characterization; synthetic incomplete session required |
| `src/routes/shop/checkout/$sessionIdSlug/index.tsx` | `/shop/checkout/:sessionIdSlug/` | Loading, missing/error, order review, payment/fulfillment transition | Existing order-review content and primary action | Checkout session shape and payment state are immutable | Order-review-viewed event preserves session resolution timing | Source characterization; synthetic review session required |
| `src/routes/shop/checkout/complete.index.tsx` | `/shop/checkout/complete/`; existing completion search/reference values | Resolving, error, success, follow-up navigation | Existing completion heading and order/reference content | Checkout completion query/session behavior | Completion-succeeded event remains idempotent and timing-stable | Source characterization; synthetic completion fixture required |
| `src/routes/shop/checkout/index.tsx` | `/shop/checkout/` | Checkout entry/redirect under current bag and session rules | `data-testid="storefront-checkout-ready"` | Bag and checkout-session creation shape | Existing checkout-entry telemetry | Source characterization; checkout browser scenario |
| `src/routes/shop/checkout/pending.tsx` | `/shop/checkout/pending` | Pending, poll/retry, success redirect, failure/recovery | Existing pending status and recovery link | Current payment/session reference behavior | Existing verification/completion timing | Source characterization; synthetic pending fixture required |
| `src/routes/shop/checkout/pod-confirmation.tsx` | `/shop/checkout/pod-confirmation` | Confirmation success and navigation | Existing confirmation heading and actions | Current pay-on-delivery completion state | Existing completion/context telemetry | Source characterization; synthetic order fixture required |
| `src/routes/shop/checkout/verify.index.tsx` | `/shop/checkout/verify/`; existing external `reference` and session search values | Verification start, waiting, error, success redirect, timeout recovery | Existing verification status and fallback link | Payment reference and checkout session contracts are immutable | Payment-verification-started event preserves timing | Source characterization; synthetic reference only |
| `src/routes/shop/receipt/-PosReceiptPage.tsx` | Component backing receipt route; no independent URL | Loading, unavailable/error, printable receipt success | Existing receipt heading/content and print action | No customer storage; receipt query result only | No new telemetry | Source characterization; synthetic/redacted receipt fixture required |
| `src/routes/shop/receipt/s/$token/index.tsx` | `/shop/receipt/s/:token/` | Loading, invalid/expired token, receipt success | Existing receipt content and print action | Access token stays URL-only and must never enter artifacts | Existing receipt access behavior; no new event | Source characterization; only synthetic token may be captured |
| `src/routes/signup.tsx` | `/signup`; `email`, `origin`, and current return search values | Existing-user redirect, ready, submitting, failure, verification transition | Existing signup fields and submit action | Reads/removes `LOGGED_IN_USER_ID_KEY` under current auth rules | Signup entry/request events preserve timing | Source characterization + auth tests |

## Cross-route frozen contracts

- `src/routeTree.gen.ts` remains generated.
- Store configuration, currency, fulfillment availability, bag and checkout serialization,
  payment provider behavior, and protected/object access checks are not presentation concerns.
- Existing `data-testid` values and production-readiness selectors are compatibility APIs. If a
  migrated route lacks one, add evidence without renaming or deleting an existing selector.
- Preserve journey and failure event names, fields, deduplication, and the point in the state
  transition at which they fire.
- Preserve current authentication destinations. Any suspected return-path defect requires a
  separate product decision.
- Evidence follows [`design-system-artifact-policy.md`](./design-system-artifact-policy.md).
