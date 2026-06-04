---
title: Athena POS Offline Route Access Uses A Static App Shell
date: 2026-06-03
category: architecture
module: athena-webapp
problem_type: pos_offline_route_access
component: pos
symptoms:
  - "A provisioned POS terminal can hard reload into an empty browser page during total network loss"
  - "Offline POS work can be confused with broad offline access to all Athena routes"
  - "Service-worker app-shell caching can be mistaken for POS business-state storage"
root_cause: local_pos_state_was_ready_but_the_browser_app_shell_was_not_available_after_hard_reload
resolution_type: route_scoped_static_app_shell
severity: high
tags:
  - pos
  - offline
  - service-worker
  - app-shell
  - local-first
---

# Athena POS Offline Route Access Uses A Static App Shell

## Problem

Athena's POS register can keep terminal seed, staff authority, catalog
snapshots, availability snapshots, drawer state, and local events in browser
storage. That local POS state still cannot help when a hard reload fails before
React mounts. A provisioned terminal needs the static app shell available after
it has loaded POS online once.

The app-shell fix must stay route scoped. POS offline route continuity is for
`/pos` and `/pos/register` surfaces only. It must not turn Operations, Products,
Services, Admin, Cash Controls, analytics, or generic authenticated app chrome
into offline-capable routes.

## Solution

Keep offline POS route access as a static shell plus local POS state:

- `public/pos-app-shell-sw.js` serves the POS app shell for same-origin POS
  navigations and caches same-origin static JS, CSS, font, and image assets.
- `src/offline/posAppShellRoutes.ts` owns the tested route/request policy:
  POS navigations are eligible, non-POS routes are not, API/data payloads are
  excluded, and generated Convex client modules remain cacheable as static app
  code.
- `src/offline/registerPosAppShellServiceWorker.ts` registers the worker from
  `src/main.tsx` only in browsers that support service workers and avoids
  duplicate registration loops.
- POS route entry remains local-first through `_authed.tsx`,
  `useGetActiveStore.ts`, local terminal seed, and existing register guards.
- Offline readiness copy is diagnostic only. It distinguishes app shell,
  terminal setup, staff authority, register catalog, service catalog, and
  availability snapshot readiness without becoming sale authority.

## Storage Boundary

Cache Storage is for the static browser shell only:

- HTML, JS, CSS, fonts, images, generated client modules, and route chunks can
  be cached so React can mount after a hard reload.
- Convex/API responses, sync secrets, staff proof tokens, cart events, payment
  payloads, customer data, local receipt state, catalog rows, service catalog
  rows, and availability snapshots must not move into Cache Storage.
- POS business state stays in the existing IndexedDB/local POS stores such as
  terminal entry context, staff authority, catalog snapshots, availability
  snapshots, local register events, and pending sync state.

Service-worker availability is not permission to sell. Sale-affecting commands
still depend on terminal integrity, staff proof, drawer authority, local command
preconditions, and existing register read-model state.

## Regression Targets

Use the focused route-access validation slice when service-worker, POS offline
route entry, readiness diagnostics, or register hard-reload behavior changes:

- `src/offline/posAppShellRoutes.test.ts` proves route and request policy.
- `src/offline/registerPosAppShellServiceWorker.test.ts` proves browser-only
  registration and duplicate-registration protection.
- `src/offline/posOfflineReadiness.test.ts` proves readiness classification and
  support-safe descriptions.
- `src/routes/_authed.test.tsx`, `src/hooks/useGetActiveStore.test.ts`,
  `src/components/pos/PointOfSaleView.test.tsx`,
  `src/components/pos/register/POSRegisterOpeningGuard.test.tsx`, and
  `src/lib/pos/presentation/register/useRegisterViewModel.test.ts` prove POS
  route entry and register readiness remain local-first.
- `src/tests/pos/offlineRouteAccess.spec.ts` proves a production-built app can
  load POS online, install/cache the app shell, block network, hard reload, and
  still mount the POS register shell.

The Athena harness registry now includes "POS offline route access and app-shell
edits" so future changed-file validation points to these commands and the
production-build Playwright regression.

## Prevention

- Do not widen the service-worker navigation fallback beyond POS routes without
  a separate product and security review.
- Do not cache API, Convex data, staff proof, payment, customer, or POS local
  business payloads in Cache Storage.
- Do not treat app-shell readiness as terminal integrity, drawer authority,
  local staff authority, or command permission.
- Run browser validation against production build/preview rather than Vite dev
  HMR modules; dev-only clients can create false offline failures.
- Rebuild graphify after code changes and regenerate harness docs after
  changing `scripts/harness-app-registry.ts`.

## Related

- [Athena POS Local-First Sync Uses Event Logs](./athena-pos-local-first-sync-2026-05-13.md)
- [Athena POS Entry And Readiness Are Local First](./athena-pos-local-first-entry-readiness-2026-05-14.md)
- [Athena POS Hub App-Session Continuity Is Route Scoped](./athena-pos-hub-app-session-continuity-2026-06-02.md)
- [Athena QA Smoke Uses DOM Readiness Instead Of Network Idle](../harness/athena-qa-smoke-live-navigation-readiness-2026-06-01.md)
