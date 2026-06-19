---
title: Athena App Updates Use Operator-Applied Refresh With Opt-In Blockers
date: 2026-06-17
category: architecture
module: athena-webapp
problem_type: app_update_apply_safety
component: app-update
symptoms:
  - "A new deployed webapp build previously caused the version checker to reload active browser sessions"
  - "POS continuity was the first visible risk, but other resumable work surfaces need the same protection"
  - "Static assets could be fetched behind the scenes without making refresh automatic"
root_cause: version_detection_was_coupled_to_immediate_page_reload
resolution_type: update_ready_coordinator_with_opt_in_apply_blockers_and_surface_communication_preferences
severity: high
tags:
  - app-update
  - service-worker
  - pos
  - inventory-import
  - continuity
---

# Athena App Updates Use Operator-Applied Refresh With Opt-In Blockers

## Problem

Detecting a newer deployed build is not the same as safely applying it. A
browser can prefetch or stage static files behind the scenes, but the running
React application still needs one page reload to execute the new bundle.
Reloading immediately can interrupt sale work, draft import decisions, command
mutations, or any future surface that has non-resumable local work.

POS should not be the hard-coded rule for this behavior. The update system is
foundational: any surface can opt in when its current work should defer the
operator-applied refresh.

## Solution

Split update handling into three separate responsibilities:

- `src/utils/versionChecker.ts` detects a changed deployed build and emits an
  update event. It no longer reloads the page.
- `src/lib/app-update/updateAssetStaging.ts` extracts same-origin static shell
  assets from entry HTML and asks the POS app-shell service worker to fetch
  them into the existing static cache policy.
- `src/lib/app-update/updateCoordinator.ts` owns update readiness, cross-tab
  blocker state, and the single reload latch used only after the operator
  chooses Refresh.

The root app wraps Athena in `UpdateCoordinatorProvider` and renders
`UpdateReadyBanner`. The banner is the only user-facing affordance for applying
the update. It shows Refresh when no active blocker exists, and it shows the
highest-priority blocker guidance when a surface has opted in.

The coordinator should not encode presentation rules for individual routes.
Surfaces that need a different communication shape opt in through
`UpdateCommunicationPreferenceProvider`. The default remains the persistent
banner. POS register surfaces opt in to persistent toast communication so the
update notice does not shift the register shell or compete with the checkout
workspace. Both modes use the same coordinator state and the same Refresh action.

## Remote Terminal Update Commands

Remote Terminal Health can ask an active POS terminal to update through the
same coordinator, but the support command is only intent. The browser that
claims `update_app` reads its local coordinator snapshot, acknowledges the local
decision, and calls the coordinator reload latch only after acknowledgement
persists. It does not call a blind reload path and it cannot bypass blockers
owned by POS, inventory import, or another surface.

The terminal applies the latest pending build it sees at execution time. The
support user's build metadata is context for the action, not a frozen target.
Terminal Health verifies the command through a fresh, command-correlated runtime
check-in after the command was issued. A command acknowledgement saying
`applying`, `current`, or `blocked` is lifecycle evidence, not proof that the
terminal is running a newer bundle.

`ready-unstaged` must stay visible but not applyable. The coordinator should
only set `canApply` for staged updates; an unstaged update means detection
succeeded but the browser has not proved that the static assets are prepared.
The app-shell staging handshake uses a `MessageChannel` reply path and treats
partial asset failures as unstaged. Runtime check-ins publish compact staging
diagnostics, including reason and asset counts, so Terminal Health can explain
whether staging failed because the service worker was unavailable, timed out, or
could not cache every required asset.

## Apply Blockers

Surfaces opt in through `useUpdateApplyBlocker` with:

- `surfaceId`: stable owner key for cross-tab reconciliation.
- `priority`: `critical-workflow`, `active-command`, or `resume-required`.
- `label`: concise surface name for the banner.
- `guidance`: operator-facing action required before Refresh is offered.

Local blockers are authoritative for the current tab. Remote blockers are
leased through `BroadcastChannel` and ignored when they refer to a stale pending
build. Malformed messages are ignored. Clearing a remote blocker cannot clear a
local blocker for the same surface.

## Current Surfaces

POS registers a critical blocker only for active sale work, checkout mutations,
drawer/register transitions, or local runtime save risk. An idle register does
not defer refresh merely because it is the POS route.

POS register routes also opt in to toast communication for update-ready notices.
This is a surface preference, not a coordinator rule: adding another route that
needs toast behavior should wrap that surface with the same preference provider
instead of branching on route names inside the coordinator.

Inventory Import registers while review work is not safely resumable, a save or
stage command is active, or autosave has failed. Once import work is saved to
durable review state, the blocker clears.

## Cache Boundary

The service worker stages only same-origin static browser assets that already
fit the POS app-shell cache policy: JS, CSS, fonts, images, and generated client
modules. API, Convex, auth, diagnostic, source-map, JSON, text, customer,
payment, and other business payloads stay out of Cache Storage.

Static asset staging improves the chance that Refresh is fast and available
after the operator chooses it. It does not remove the need for one browser
reload to run the new app bundle.

## Regression Targets

Run this focused slice for changes to app update detection, staging, blockers,
or the banner:

- `src/lib/app-update/updateCoordinator.test.ts`
- `src/lib/app-update/updateAssetStaging.test.ts`
- `src/lib/app-update/useUpdateCommunicationPreference.ts`
- `src/utils/versionChecker.test.ts`
- `src/components/app-update/UpdateReadyBanner.test.tsx`
- `src/offline/posAppShellRoutes.test.ts`
- `src/offline/posAppShellReadiness.test.ts`
- `src/offline/registerPosAppShellServiceWorker.test.ts`
- `src/lib/pos/presentation/register/useRegisterViewModel.test.ts`
- `src/components/pos/register/POSRegisterView.test.tsx`
- `src/components/operations/InventoryImportView.test.tsx`

Run `bun run graphify:rebuild` after code changes so graphify reflects the new
app-update module boundary.

## Prevention

- Do not call `window.location.reload()` from detection code.
- Do not call `window.location.reload()` from terminal command code; route
  remote update requests through the coordinator apply API after acknowledgement.
- Do not make POS route presence itself an update blocker.
- Do not hard-code route names in the update coordinator for banner versus toast
  presentation; make the owning surface opt in through the preference provider.
- Do not add a surface blocker unless the surface has active work, in-flight
  commands, or resumability risk.
- Do not widen service-worker staging beyond static browser assets.
- Do not treat remote command acknowledgement as update proof; require fresh
  command-correlated runtime evidence.
- Keep operator-facing copy calm and action-oriented; normalize implementation
  details before they reach the banner.

## Related

- [Athena POS Offline Route Access Uses A Static App Shell](./athena-pos-offline-route-access-2026-06-03.md)
- [Athena Inventory Import Review Uses Explicit Server Versions](./athena-inventory-import-review-version-2026-06-07.md)
- [Athena POS Register ViewModel Boundaries](./athena-pos-register-viewmodel-boundaries-2026-06-17.md)
