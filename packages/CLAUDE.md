# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Monorepo Structure

This is a Bun-based monorepo with three packages:

- `packages/athena-webapp` — Admin/merchant dashboard (React + Convex)
- `packages/storefront-webapp` — Customer-facing storefront (React + Convex)
- `packages/valkey-proxy-server` — HTTP proxy for AWS ElastiCache (Redis Cluster)

## Commands

All commands should be run from the relevant package directory unless noted. The package manager is **Bun**.

### Development
```bash
bun run dev          # Start Vite dev server (athena-webapp or storefront-webapp)
bun run start        # Start valkey-proxy-server
```

### Build & Type Check
```bash
bun run build        # vite build + tsc --noEmit
```

### Testing
```bash
# From package directory
bun run test                 # Single vitest run
bun run test:watch           # Watch mode
bun run test:coverage        # Coverage (v8 provider, HTML + lcov + json-summary)
bun run test:ui              # Vitest browser UI (athena-webapp only)

# From monorepo root
bun run test                 # Runs both webapps
bun run test:coverage        # Coverage for both + combined summary

# Run a single test file
bunx vitest run src/path/to/file.test.ts
```

### Email Development (athena-webapp)
```bash
bun run email:dev    # React Email dev server for templates in convex/emails/
```

## Architecture

### Frontend (both webapps)

- **React 18** with **TanStack Router** (file-based routing in `src/routes/`)
- **TanStack Query** for server state; **Zustand** for client state
- **Convex** as the realtime backend — queries and mutations are defined in `convex/` and used via hooks (`useQuery`, `useMutation`, `useAction`)
- **Tailwind CSS** + **Radix UI** headless components
- Generated Convex types live in `convex/_generated/` — do not edit these manually

### Convex Backend (athena-webapp)

The backend lives in `packages/athena-webapp/convex/` and is organized by domain:

- **`http.ts`** — Mounts Hono-based HTTP routes for external access (storefronts, webhooks, integrations). CORS origins are configured here.
- **`http/domains/inventory/`** — Routes for products, categories, stores, organizations, colors, subcategories
- **`http/domains/storeFront/`** — Routes for checkout, bag, saved bag, guest/user auth, orders
- **`inventory/`** — Convex query/mutation functions for inventory management
- **`storeFront/`** — Convex query/mutation functions for shopping, orders, rewards
- **`llm/`** — LLM provider abstraction (OpenAI + Anthropic)
- **`paystack/`** — Payment webhook handling
- **`aws/`** — S3 file upload actions
- **`cache/`** — Redis/Valkey caching via valkey-proxy-server
- **`schemas/`** — Zod schemas shared between frontend and backend
- **`crons.ts`** — Scheduled jobs

### Storefront Authentication Flow

The storefront uses dual auth paths: AWS Cognito (`amazon-cognito-identity-js`, `aws-amplify`) for registered customers and a guest flow backed by Convex. OTP logic lives in `convex/otp/`.

### Testing Setup

- **Vitest** with jsdom environment; globals enabled
- Tests in `src/**/*.test.{ts,tsx}` (and `convex/**/*.test.{ts,tsx}` in athena-webapp)
- `vitest.setup.ts` mocks: `react-hot-toast`, Convex hooks (`useQuery`, `useMutation`, `useAction`), `window.print`, `window.open`, `localStorage`, `sessionStorage`
- Storefront has **Playwright** e2e tests in `tests/e2e/` (Chromium only, dev server auto-started)

### Path Aliases

Both webapps use:
- `@/*` → `./src/*`
- `@cvx/*` → `./convex/*` (athena-webapp only)
- `~/*` → `./*` (project root)

### Key Environment Variables

`athena-webapp/.env`:
- `VITE_CONVEX_URL` — Convex deployment URL
- `VITE_API_GATEWAY_URL` — Convex HTTP actions base URL (used for storefront API calls)
