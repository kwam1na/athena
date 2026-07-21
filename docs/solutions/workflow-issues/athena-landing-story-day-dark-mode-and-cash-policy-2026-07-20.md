---
title: Landing Story-Day Delivery — Dark-Mode Theming, Hero Motion, and Cash-Policy Seed Must Stay Reconciled
date: 2026-07-20
category: workflow-issues
module: athena-webapp
problem_type: workflow_issue
component: development_workflow
resolution_type: feature_delivery
severity: low
applies_when:
  - The landing page's "one-day story" needs new dark-mode assets, motion, or a scene reconciled to demo-store state
  - The shared demo store's staff identity or cash-controls policy needs to change and downstream fixtures/tests must be kept in sync
  - A new landing scene renders a real presentational component as an inert exhibit
tags:
  [landing, shared-demo, dark-mode, cash-controls, animejs, register-session]
delivery_diff_fingerprint: bf75c8273834c0d2c6f49687a4f07e0d72226fd5bee54791ea6cad892a9e268f
---

# Landing Story-Day Delivery — Dark-Mode Theming, Hero Motion, and Cash-Policy Seed Must Stay Reconciled

## Problem

The landing page (`/landing`) narrates a single fixed day (Wednesday 2026-07-15)
in the shared demo store's life, built from two sources that must agree:
`demoDayFixtures.ts` (what the live React scenes render) and the
`src/stories/operations/*Fixtures.ts` + captured PNG shots (what the static
hero/product screenshots show). Prior work (`14a22923`, `e48ef7c9`) reconciled
the numbers across both, but the landing was still forced fully light
(`useForcedLightTheme`) with no dark-mode assets, the hero had no entrance
motion, and the demo store's cash-controls config never actually enabled the
`requireManagerSignoffForAnyVariance` gate the story implies — the narrated
GH₵5 drawer shortage read as "needs a manager" in copy but the underlying seed
would have let the closeout auto-clear.

Separately, the demo cashier/manager names ("Efua Tetteh", "Kwabena Osei") needed
to be recast without breaking any of the several places that reference them by
exact string (Convex seed, shared story constants, activity-feed fixtures, and
half a dozen POS/staff-auth tests).

## Solution

- Added a `useLandingTheme` hook that replaces `useForcedLightTheme`: instead of
  hard-forcing light mode, it now respects the visitor's light/dark preference
  and, only when dark is active, pins `data-theme-variant="charcoal"` (via a
  `MutationObserver` so it re-pins if the theme system reasserts a different
  variant), restoring the prior variant on component unmount. Every landing shot got a
  `-dark.png` sibling asset selected through this hook's resolved theme.
- Seeded `store.config.operations.cashControls.requireManagerSignoffForAnyVariance
= true` in `convex/sharedDemo/provision.ts` — this is an existing,
  already-consumed config field (read by
  `convex/operations/registerSessionCloseoutGate.ts` and surfaced in
  `POSSettingsView.tsx`), not a new mechanism, so no baseline-registry or
  capability-catalog changes were needed. This is what makes the story's GH₵5
  variance correctly gate into "manager approval pending" end to end.
- Renamed the demo cashier/manager (`Efua Tetteh` → `Afua Okyere`, username
  `efua` → `afua`; `Kwabena Osei` → `Kwabena Agyei`) in one source of truth
  (`shared/sharedDemoStory.ts`) and updated every test/fixture that pinned the
  old strings by exact match. Added `sharedDemoStaffShortName()` for the
  abbreviated "Afua O." form the activity feed uses, instead of hand-writing
  the abbreviation at each call site.
- Added anime.js-driven entrance choreography to the hero (staggered
  eyebrow/headline/subhead/CTA/shot, reduced-motion-aware via
  `window.matchMedia("(prefers-reduced-motion: reduce)")`) and a new
  `RegisterSessionScene` that renders the real `RegisterSessionViewContent`
  read-only — all its command handlers are stubbed to return an
  "unexpected_error"/"Read-only exhibit" result and the exhibit disables
  pointer events, so it can safely reuse production presentational code
  without risk of mutating anything from the marketing page.

## Prevention

- When a demo/story fixture references staff by literal name or username,
  search for the old string across `shared/*.ts`, `convex/sharedDemo/**`, and
  `src/components/**/*.test.tsx` before renaming — the rename touches Convex
  seed constants, TypeScript fixture constants, and test assertions
  independently; there is no single indirection point today.
- Before adding a new "gates on X" narrative beat to the landing story, verify
  the underlying Convex seed actually sets the config field the gate reads
  (`grep` the field name across `convex/operations` and `convex/sharedDemo`
  first) — a plausible-sounding demo policy that isn't wired to a real
  consumer will silently no-op.
- New inert landing exhibits that embed a real production component should
  stub every command/mutation prop to a rejected/"read-only" result and
  disable pointer events on the wrapper, matching the pattern in
  `RegisterSessionScene.tsx`, rather than mocking the component itself.
- This delivery only changed the seed/config side of the cash-controls gate;
  it did not add a dedicated test asserting the demo store's variance now
  actually blocks auto-clear end to end. A follow-up could add one alongside
  the existing `registerSessionCloseoutGate.test.ts` coverage of that field.
- A new dev-only script under `packages/athena-webapp/scripts/` needs an
  explicit `touchedPaths` entry in the relevant scenario in
  `scripts/harness-app-registry.ts` (then `bun run harness:generate`) or the
  pre-push `harness:self-review` gate blocks with a "coverage gap" error —
  the derived `docs/agent/validation-map.json` is generated from that
  registry file and must not be hand-edited directly.
