---
title: Landing Story Told With Real Product Components As Exhibits
date: 2026-07-17
last_updated: 2026-07-22
category: design-patterns
module: Athena marketing landing page and shared demo store
problem_type: design_pattern
component: frontend_ui
resolution_type: code_fix
severity: medium
applies_when:
  - Building marketing or onboarding surfaces that should mirror the real product UI
  - Rendering authenticated workspace components on a public, unauthenticated page
  - Keeping demo/marketing copy in sync with the store the demo actually opens
  - Making one exhibit on an otherwise-inert marketing page genuinely interactive
tags: [landing-page, demo-store, marketing, exhibits, animation, design-pattern, pos]
related_components: [athena-webapp, landing, sharedDemo, cash-controls, daily-operations, pos]
delivery_diff_fingerprint: 1e201d589c2b81c805054403237fabc8a5792f26c7e5992714d14f1d4d7824bb
---

# Landing Story Told With Real Product Components As Exhibits

## Problem

A marketing landing page that shows screenshots or bespoke mock UI drifts from
the real product: the mock says one thing, the app another, and every product
change silently ages the marketing page. For Athena we wanted the public
landing page to walk a store owner through one operational day — opening
handoff, daily operations, a POS sale, the sync bridge, cash controls, and the
end-of-day close — and to show the *actual* workspace surfaces the owner would
use, not redrawn facsimiles. Two failure modes had to be avoided:

1. **Divergence.** Hand-built marketing mockups duplicate product layout and
   copy, then rot. The demo store the page describes (name, catalog, staff) must
   also match the store the "Try the demo" button actually provisions, or the
   first click contradicts the pitch.
2. **Leakage.** The product components assume an authenticated store context,
   pointer interactivity, navigation, live data hooks, and the app theme. Drop
   them onto a public page unchanged and they try to navigate, fetch, or crash
   on a missing store.

## Solution

Render the product's real presentational components as **inert exhibits** fed by
fixture data, wrapped in lightweight chrome, and keep the story's facts in one
shared module the demo provisioner also reads.

- **Exhibit wrappers isolate the product component.** `WorkspaceExhibit`
  (`packages/athena-webapp/src/components/landing/story/SceneChrome.tsx`) marks
  its subtree `inert` and `pointer-events-none select-none`, removing embedded
  links/controls from focus order and the a11y tree; the enclosing `figure`
  carries the descriptive `aria-label`. `WorkspaceFrame` and `AppShellExhibit`
  supply the surrounding browser/app-shell chrome (top bar, collapsed sidebar
  rail) so a single presentational component reads as a real screen. Scale the
  whole exhibit with the `zoom` style rather than rewriting internals.
- **Feed real components fixture data, not live hooks.** Each scene
  (`CashControlsScene`, `DailyOperationsScene`, `EodReviewScene`,
  `PosSaleScene`, `SyncBridgeScene`, `OpeningHandoffScene`) renders the same
  presentational component the app uses (`CashControlsDashboardContent`,
  `StorePulseSummaryView`, `DailyCloseReadOnlyReport`, register/session views)
  with `isLoading={false}` and a fixture snapshot from
  `story/demoDayFixtures.ts`. Prefer components that accept their data as props;
  stub the few unavoidable context hooks at the page boundary (see
  `landing.test.tsx`'s mocks for `useGetActiveStore`, `use-navigate-back`).
- **One source of story facts.** The store identity, staff, and catalog live in
  `shared/sharedDemoStory.ts`, which both the landing scenes and the demo
  provisioner (`convex/sharedDemo/provision.ts`) consume, so the page describes
  exactly the store the demo opens. Changing the story is a baseline-version
  bump in the provisioner plus the shared facts — not parallel edits in two
  places.
- **Degrade animation to the final frame.** Scene reveals use `animejs` driven
  by an `IntersectionObserver` (`useSceneAnimation`). Where the observer is
  absent (reduced motion, SSR, jsdom tests) the components must already be in
  their final, readable state — the animation only adds entrance motion, it is
  never required to see content. Keep nonessential motion behind
  `prefers-reduced-motion`.
- **Force the marketing theme locally.** The page pins light theme
  (`useForcedLightTheme`) instead of leaking the app's theme state onto a public
  route.
- **Keep the funnel measurable but the page quiet.** CTA intent is recorded
  through `emitLandingFunnelEvent` (`src/lib/marketing/landingFunnelClient.ts`)
  into a Convex marketing events endpoint. Secondary navigation (sign-in,
  walkthrough) can be removed without touching the underlying routes — the
  marketing page links are independent of the route definitions.

## Prevention

- When a marketing/onboarding surface needs to show a product screen, reach for
  the real presentational component inside `WorkspaceExhibit`/`AppShellExhibit`
  before drawing a mock. If the component can't take its data as props, that's a
  signal to lift its presentation layer, not to fork it.
- Never render an authenticated workspace component on a public route without
  the `inert` + `pointer-events-none` exhibit wrapper and prop-driven fixture
  data; otherwise it will try to navigate or fetch against a missing store.
- Keep demo-store facts in `shared/sharedDemoStory.ts` only. If you find catalog
  or identity strings hard-coded in a scene, move them to the shared module so
  the page and the provisioned demo can never disagree.
- Any entrance animation must have a static final-frame fallback; assert it in a
  jsdom test (no `IntersectionObserver`) the way `landing.test.tsx` renders the
  finished scene compositions.
- Treat removing a marketing link (e.g. "Sign in", "Request a walkthrough") as a
  page-copy change, and update the corresponding `landing.test.tsx` assertions;
  the routes themselves stay intact.

## Addendum (2026-07-22): a partially-interactive exhibit

The POS section's hub act (`PosHubRoleSwitcher.tsx`) extends the pattern one
step further: the exhibit is not fully inert. It renders `PosHubBody` (the POS
hub split out from `PointOfSaleView` without the app's `View` chrome) live,
scoped to two roles (manager/staff) with a role toggle, and — unlike every
other exhibit on the page — its store-pulse window tabs (Today / This week /
This month / All time) are genuinely clickable and re-render real charts from
authored fixture data (`stories/operations/posHubFixtures.ts`).

- **Selective inertness, not blanket `inert`.** Only the launcher-tile grid is
  disabled (`pointer-events-none` scoped to `[data-testid=athena-pos-hub-ready]`
  via a CSS descendant selector) — the store-pulse tabs stay interactive on
  purpose. This is a deliberate exception to the "mark the whole subtree inert"
  rule above: decide inertness per-control, not per-exhibit, when a scoped
  interaction is the point of the exhibit.
- **Author fixture data for every mode the live control can reach.** Because the
  tabs are real, all four pulse windows need authored, story-reconciled data
  (metrics, trend, top items, payment mix, vs-prior comparison) — not just the
  one window a static shot would have captured. Round comparison deltas to
  whole percents in the fixture (`Math.round((current−prior)/prior·100)`),
  matching how `operationsMetricFormatting.tsx`'s `getDeltaPercent` computes
  them live; authoring decimals here reads as a bug on the page. Keep
  cross-surface numbers literally aligned — e.g. the POS hub's "Today" top
  items must list in the same order as Daily Operations' for the same day, not
  just match on total.
- **A height-swapping toggle fights scroll anchoring.** Toggling between two
  states whose rendered height differs by hundreds/thousands of px lets the
  browser's scroll anchoring silently reposition the viewport — intermittently,
  because the anchor node it picks depends on current scroll position, and it
  is **not enough** to set `overflow-anchor: none` on the toggling subtree
  alone: anchoring can pick a node in an unrelated section below the toggle
  that also happens to move. Set `overflow-anchor: none` on the containing
  page-level element (safe when every other exhibit reserves explicit
  width/height). Belt-and-braces: record the toggle's `getBoundingClientRect().top`
  before the state change and correct any drift with `window.scrollBy` in a
  `useLayoutEffect` (runs pre-paint).
- **Drive a click-triggered fade from state, not from an animation callback.**
  Swap the state **synchronously** on click; treat the `animejs` fade
  (`opacity: {from: 0}`) as a fire-and-forget entrance effect in the
  `useLayoutEffect` that follows the state change. Do not gate the state swap
  on an animation's `onComplete` — if that callback doesn't fire (easy to get
  wrong when mocking `animejs` in tests, or under real browser jank), a guard
  flag can get stuck `true` and the control stops responding to any further
  clicks.
- **Scale a live exhibit with `zoom`, not `transform: scale`.** `zoom` reflows
  layout height at the scaled size, so the exhibit's footprint in the page
  shrinks along with its rendered size (needed for a live grid + chart, which
  `transform: scale` would leave taking full untransformed space).
- Testing an interactive exhibit: assert the real behavior
  (`userEvent.click` on a tab, then check the chart's own description text
  changes) rather than an `alt` text swap — there is no captured image to key
  off anymore. Mock `animejs`'s `animate` via `importActual` (override only
  `animate`, keep the real `createTimeline`/`onScroll`/`stagger` other scenes
  depend on) so a click-driven fade resolves synchronously under jsdom.
