# Athena System Manifest

A reference document for agents and contributors. Describes what the system is, what each package does, how things connect, and where to find key files.

---

## System Overview

Athena is a multi-tenant retail platform for **wigclub.store**. It consists of two customer-facing and internal apps backed by a shared Convex serverless backend and a local cache proxy (Valkey).

| Package | Name | Purpose |
|---------|------|---------|
| `packages/athena-webapp` | `@athena/webapp` | Admin dashboard — inventory, orders, POS, analytics |
| `packages/storefront-webapp` | `@athena/storefront-webapp` | Customer storefront — shop, cart, checkout, rewards |
| `packages/valkey-proxy-server` | — | HTTP bridge to local Valkey cache on the DigitalOcean droplet |

---

## Monorepo Layout

**Runtime:** Bun
**Workspaces:** `packages/*` (defined in root `package.json`)

```
athena/
├── packages/
│   ├── athena-webapp/        # Admin app + Convex backend
│   ├── storefront-webapp/    # Customer storefront
│   ├── valkey-proxy-server/  # Cache proxy
│   └── docs/
├── CLAUDE.md                 # Dual-graph context policy (read this first)
├── MANIFEST.md               # This file
├── CONTEXT.md                # Session context (updated at session end)
├── deploy-athena.sh          # Deploy to DigitalOcean via scp + symlink swap
└── package.json              # Workspace root
```

---

## Backend: Convex (`packages/athena-webapp/convex/`)

The entire data and API layer for both apps.

**Deployments:**
- Dev: `https://jovial-wildebeest-179.convex.cloud` / `.convex.site`
- Prod: `https://colorless-cardinal-870.convex.cloud` / `.convex.site`

**Auth:** `@convex-dev/auth` with ResendOTP provider (email OTP)

### Schema Domains (`convex/schema.ts`)

**Inventory**
- `store`, `organization`, `organizationMember`, `athenaUser`, `inviteCode`
- `product`, `productSku`, `category`, `subcategory`, `color`
- `cashier`, `bannerMessage`, `bestSeller`, `storeAsset`
- `promoCode`, `promoCodeItem`, `redeemedPromoCode`
- `complimentaryProductsCollection`, `complimentaryProduct`

**Storefront**
- `storeFrontUser`, `storeFrontSession`, `storeFrontVerificationCode`, `guest`
- `bag`, `bagItem`, `savedBag`, `savedBagItem`
- `customer`, `onlineOrder`, `onlineOrderItem`
- `checkoutSession`, `checkoutSessionItem`
- `review`, `rewardPoints`, `rewardTiers`, `rewardTransactions`
- `analytics`, `supportTicket`, `offer`

**POS**
- `posSession`, `posSessionItem`, `posTransaction`, `posTransactionItem`
- `posCustomer`, `posTerminal`
- `expenseSession`, `expenseTransaction`, `expenseTransactionItem`

### HTTP Routes (`convex/http.ts` — Hono)

`/auth`, `/stores`, `/storefront`, `/products`, `/categories`, `/subcategories`, `/colors`, `/organizations`, `/analytics`, `/bags`, `/savedBags`, `/guests`, `/users`, `/checkout`, `/orders`, `/reviews`, `/me`, `/rewards`, `/offers`, `/user-offers`, `/upsells`, `/banner-message`, `/webhooks/paystack`

### Key Directories

| Directory | Purpose |
|-----------|---------|
| `convex/inventory/` | Inventory functions (products, stores, orgs, cashiers, promos) |
| `convex/storeFront/` | Storefront functions (orders, checkout, reviews, rewards) |
| `convex/pos/` | POS functions (sessions, transactions, terminals, expenses) |
| `convex/llm/` | AI insights via OpenAI / Anthropic |
| `convex/cloudflare/` | R2 image storage, Stream video |
| `convex/services/` | External service integrations (Paystack, Stripe, email) |
| `convex/http/` | Route handler definitions |
| `convex/schemas/` | Per-domain schema files imported by `schema.ts` |

---

## Admin App (`packages/athena-webapp`)

**Package:** `@athena/webapp`
**Dev port:** 5173
**Tech:** React 18, Vite 5, TanStack Router (file-based), TanStack Query, Convex, Zustand, shadcn/ui + Radix UI, Tailwind CSS, React Hook Form + Zod

### Auth
1. User logs in via Convex Auth (email OTP through Resend)
2. `useAuth` hook (`src/hooks/useAuth.ts`) reads user ID from localStorage
3. Queries `api.inventory.athenaUser.getUserById` to hydrate user
4. `PermissionsContext` (`src/contexts/PermissionsContext.tsx`) checks org membership and role
5. `_authed` layout (`src/routes/_authed.tsx`) redirects to `/login` if unauthenticated

### Route Tree (TanStack Router, file-based)

```
/                         → index
/login                    → login
/join-team                → org invite
/_authed/
  $orgUrlSlug/            → org dashboard
    settings/             → org settings
    store/$storeUrlSlug/
      dashboard           → store analytics
      products/           → product listing, new, edit, complimentary
      assets              → media management
      orders/             → all, open, ready, completed, cancelled, refunded, delivery
      pos/                → register, transactions, expense, reports
      promo-codes/        → list, new, details
      reviews/            → published, new
      bags/               → shopping bag management
      checkout-sessions   → online checkout sessions
      users.$userId       → customer profile
      members             → team management
      logs                → activity audit trail
      configuration       → store config
      analytics           → detailed analytics
```

### State Layers

| Layer | Technology | Scope |
|-------|-----------|-------|
| Server state | Convex + TanStack Query | Products, orders, users, POS data |
| Client state | Zustand | POS cart/session (`posStore`), expense session (`expenseStore`) |
| Context | React Context | Permissions, current user, theme, product edit flow |
| Form state | React Hook Form + Zod | All forms |
| URL state | TanStack Router | Route params, filters |

### Key Files

| File | Purpose |
|------|---------|
| `src/main.tsx` | Entry point |
| `src/routes/__root.tsx` | Root layout |
| `src/routes/_authed.tsx` | Auth guard |
| `src/components/app-sidebar.tsx` | Navigation sidebar |
| `src/hooks/useAuth.ts` | Auth hook |
| `src/contexts/PermissionsContext.tsx` | Role-based access control |
| `src/stores/posStore.ts` | POS Zustand store |
| `src/stores/expenseStore.ts` | Expense Zustand store |
| `convex/schema.ts` | Full database schema |
| `convex/http.ts` | HTTP route mounting |

### Key Env Vars

| Var | Purpose |
|-----|---------|
| `VITE_CONVEX_URL` | Convex deployment URL |
| `VITE_API_GATEWAY_URL` | Convex HTTP endpoint |
| `VITE_STOREFRONT_URL` | Storefront URL (default: `http://localhost:5174`) |
| `VITE_HLS_URL` | Cloudflare Stream HLS base URL |

---

## Storefront App (`packages/storefront-webapp`)

**Package:** `@athena/storefront-webapp`
**Dev port:** 5174
**Tech:** React 18, Vite 5, TanStack Router (file-based), TanStack Query, Zustand, Radix UI, Tailwind CSS, React Hook Form + Zod, hls.js, Paystack inline

> Note: `aws-amplify` and `amazon-cognito-identity-js` remain in `package.json` as dead code from a prior setup. They are not used. Auth is handled by Convex.

### Auth
- Email OTP flow via Convex API (`POST {VITE_API_URL}/auth/verify`)
- Session stored in cookies: `athena-access-token`, `athena-refresh-token`, `athena-storefront-user-id`
- `useAuth` hook (`src/hooks/useAuth.ts`) — returns `user`, `userId`, `guestId`
- Guest mode supported for anonymous checkout
- localStorage keys: `logged_in_user_id`, `guest_id`, `organization_id`, `store_id`

### Multi-Tenant Setup

`StoreContext` (`src/contexts/StoreContext.tsx`) is the root tenant context:
- Reads `STORE_ID_KEY` and `ORGANIZATION_ID_KEY` from localStorage
- Provides: `storeId`, `organizationId`, store config, current user, currency formatter
- Store config controls: currency (USD/GHS), maintenance mode, branding
- All API calls include store/org context

### Route Tree

```
/                         → homepage (best sellers, promos)
/login                    → email OTP login
/signup                   → account creation
/auth/verify              → OTP verification
/shop/
  $categorySlug/          → category browse (with color/length filters)
  $categorySlug/$subcategorySlug/  → subcategory browse
  product.$productSlug    → product detail + reviews
  bag                     → shopping cart
  saved                   → saved/wishlist items
  checkout/               → checkout flow
    $sessionIdSlug/       → active session
      complete            → order confirmation
      canceled            → payment canceled
      incomplete          → incomplete order
    pending               → pending checkouts
    verify                → Paystack callback verification
    pod-confirmation      → payment on delivery confirmation
  orders/                 → order history
    $orderId/             → order detail
      review              → leave review
      $orderItemId.review → item-level review
/account                  → customer dashboard
/rewards                  → loyalty points + tiers
/contact-us               → contact form
/policies/*               → privacy, ToS, delivery, returns
```

### Checkout Flow

1. Create checkout session with bag items
2. Select delivery method: **store pickup** or **home delivery**
3. Enter customer details (name, email, phone)
4. Enter delivery address (delivery only)
5. Select payment: **Paystack** (online) or **Payment on Delivery**
6. Complete payment via Paystack inline or POD confirmation
7. Land on `/checkout/$sessionId/complete` with order number

Key files: `src/components/checkout/Checkout.tsx`, `src/api/checkoutSession.ts`, `src/contexts/CheckoutProvider.tsx`

### Key Files

| File | Purpose |
|------|---------|
| `src/main.tsx` | Entry point |
| `src/__root.tsx` | Root layout (QueryClient, navbar, footer) |
| `src/router.tsx` | TanStack Router config |
| `src/contexts/StoreContext.tsx` | Multi-tenant state |
| `src/hooks/useAuth.ts` | Auth hook |
| `src/hooks/useShoppingBag.ts` | Cart logic |
| `src/api/auth.ts` | Auth API calls |
| `src/api/bag.ts` | Cart API calls |
| `src/api/checkoutSession.ts` | Checkout API calls |
| `src/lib/queries/` | TanStack Query hooks (user, bag, store, checkout, rewards) |
| `src/lib/utils.ts` | `getStoreDetails()` and other utilities |

### Key Env Vars

| Var | Purpose |
|-----|---------|
| `VITE_API_URL` | Convex HTTP endpoint (default: `https://jovial-wildebeest-179.convex.site`) |
| `VITE_HLS_URL` | Cloudflare Stream HLS base URL |

---

## Valkey Proxy (`packages/valkey-proxy-server`)

HTTP bridge to the local Valkey instance on the DigitalOcean droplet.

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/` or `/health` | GET | Health check |
| `/get` | POST | Retrieve a cache value |
| `/set` | POST | Store a cache value |
| `/invalidate` | POST | Delete keys by pattern |

**Port:** 3000

---

## External Services

| Service | Role |
|---------|------|
| **Convex** | Backend-as-a-service: DB, auth, HTTP API, crons. Dev deployment: `jovial-wildebeest-179`. Prod: `colorless-cardinal-870` |
| **Cloudflare R2** | Image and asset storage (S3-compatible; uses `@aws-sdk/client-s3` pointed at R2). Code: `convex/cloudflare/r2.ts` |
| **Cloudflare Stream** | Video hosting + HLS delivery. Code: `convex/cloudflare/stream.ts` |
| **Cloudflare Tunnel** | Routes all subdomains (wigclub.store, www, athena, api, dev, cache) to the DigitalOcean droplet |
| **DigitalOcean** | Droplet at 178.128.161.200 running Nginx + PM2. Deploy via `deploy-athena.sh` |
| **Valkey (local)** | Redis-compatible cache running locally on the DO droplet |
| **Paystack** | Payment processing (Ghana/Africa). Inline JS in storefront; webhook at `/webhooks/paystack` |
| **Stripe** | Payment processing (international) |
| **Resend** | Transactional email (OTP codes, order confirmations) |
| **Linear** | Issue tracking |
| **PostHog** | Product analytics in storefront (installed, currently disabled in `main.tsx`) |
| **OpenAI / Anthropic** | LLM-powered store and user insights (via `convex/llm/`) |

## Production Observability

Production monitoring is documented in [docs/operations/production-observability-v1.md](./docs/operations/production-observability-v1.md).

- Athena public availability is the shallow Convex Hono `/health` route on the API gateway or Convex HTTP host, separate from the Athena browser app host.
- Storefront production readiness uses browser-level selectors and a dedicated synthetic checkout-start journey, not a route-local `/health`.
- Synthetic storefront traffic must use `origin=synthetic_monitor` so Athena can exclude it from business analytics defaults while keeping it visible in operator diagnostics.
- Cloudflare, Checkly, Slack routing, and the dedicated monitor SKU contract are external operator configuration and should be updated through the runbook, not by guessing from vendor dashboards.

---

## Local Development

**Package manager:** Bun (use `~/.bun/bin/bun` if `bun` is not on `PATH`)

**Start the apps:**
```bash
# Admin dashboard
cd packages/athena-webapp && bun run dev        # → http://localhost:5173

# Customer storefront
cd packages/storefront-webapp && bun run dev    # → http://localhost:5174
```

Both use Vite. Start them in separate terminals (or background processes). The storefront connects to the Convex backend via `VITE_API_URL`; the admin connects via `VITE_CONVEX_URL`.

**Run tests:**
```bash
bun run --filter '@athena/webapp' test
bun run --filter '@athena/storefront-webapp' test
```

**Type-check:**
```bash
bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json
bunx tsc --noEmit -p packages/storefront-webapp/tsconfig.json
```

---

## Key Files for Agent Orientation

Start here when beginning a new session:

1. `CLAUDE.md` — dual-graph context policy (mandatory, read first)
2. `packages/AGENTS.md` — git branching rules (`codex/` prefix) and PR format
3. `packages/athena-webapp/convex/schema.ts` — source of truth for the data model
4. `packages/athena-webapp/convex/http.ts` — all HTTP routes
5. `packages/athena-webapp/src/routes/_authed.tsx` — admin auth guard
6. `packages/storefront-webapp/src/contexts/StoreContext.tsx` — multi-tenant root state
7. `packages/storefront-webapp/src/components/checkout/Checkout.tsx` — checkout flow
